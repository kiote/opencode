import { getDb } from "../storage/db.js"
import { randomUUID } from "crypto"

/**
 * Experience Extractor — extracts reusable patterns from completed trajectories.
 *
 * Based on the AutoRefine paper:
 * "For procedural subtasks, we extract specialized subagents with independent
 * reasoning and memory. For static knowledge, we extract skill patterns as
 * guidelines or code snippets."
 *
 * We analyze completed trajectories and extract two types of patterns:
 *
 * 1. PROCEDURAL — multi-step workflows that can be replayed as recipes
 *    (e.g., "to fix a test failure: read the test, read the source, edit the source, run test")
 *
 * 2. DECLARATIVE — facts, guidelines, or code patterns learned from experience
 *    (e.g., "this project uses vitest, not jest" or "config files are in src/config/")
 */

export interface ExperiencePattern {
  id: string
  type: "procedural" | "declarative"
  name: string
  description: string
  content: string // JSON: { steps: [...] } for procedural, { guideline: "..." } for declarative
  score: number
  useCount: number
  projectDir: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Extract experience patterns from a completed trajectory.
 *
 * Analyzes the tool-call sequence and outputs to identify:
 * - Procedural patterns: successful multi-step workflows
 * - Declarative patterns: project-specific knowledge discovered during execution
 */
export function extractFromTrajectory(trajectoryId: string, projectDir: string): ExperiencePattern[] {
  const db = getDb()
  const steps = db.query(`
    SELECT step_index, tool_name, tool_input, tool_output, duration
    FROM trajectory_steps
    WHERE trajectory_id = ?
    ORDER BY step_index
  `).all(trajectoryId) as any[]

  if (steps.length < 2) return []

  const patterns: ExperiencePattern[] = []
  const now = Date.now()

  // --- Extract procedural patterns ---
  // A successful trajectory IS a procedural pattern
  const procedural = extractProceduralPattern(steps, projectDir, now)
  if (procedural) patterns.push(procedural)

  // --- Extract declarative patterns ---
  // Analyze tool outputs for project-specific knowledge
  const declarative = extractDeclarativePatterns(steps, projectDir, now)
  patterns.push(...declarative)

  return patterns
}

function extractProceduralPattern(steps: any[], projectDir: string, now: number): ExperiencePattern | null {
  if (steps.length < 3) return null // Need at least 3 steps for a meaningful procedure

  const toolSequence = steps.map((s: any) => s.tool_name)
  const name = `workflow_${toolSequence.join("_").slice(0, 60)}`

  // Build the recipe
  const recipe = steps.map((s: any) => ({
    tool: s.tool_name,
    input_summary: summarizeInput(s.tool_name, s.tool_input),
    output_summary: summarizeOutput(s.tool_output),
  }))

  return {
    id: randomUUID(),
    type: "procedural",
    name,
    description: `${steps.length}-step workflow: ${toolSequence.join(" → ")}`,
    content: JSON.stringify({ steps: recipe }),
    score: 0.5,
    useCount: 0,
    projectDir,
    createdAt: now,
    updatedAt: now,
  }
}

function extractDeclarativePatterns(steps: any[], projectDir: string, now: number): ExperiencePattern[] {
  const patterns: ExperiencePattern[] = []

  for (const step of steps) {
    const output = step.tool_output ? (typeof step.tool_output === "string" ? step.tool_output : JSON.stringify(step.tool_output)) : ""

    // Extract file structure knowledge from glob/ls/find outputs
    if (step.tool_name === "bash" || step.tool_name === "glob") {
      const input = typeof step.tool_input === "string" ? step.tool_input : JSON.stringify(step.tool_input)
      if (/\b(ls|find|tree)\b/.test(input) && output.length > 50) {
        patterns.push({
          id: randomUUID(),
          type: "declarative",
          name: `project_structure_${Date.now()}`,
          description: "Project directory structure discovered during exploration",
          content: JSON.stringify({ guideline: `Project structure: ${output.slice(0, 500)}` }),
          score: 0.3,
          useCount: 0,
          projectDir,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    // Extract test framework knowledge from test runs
    if (step.tool_name === "bash") {
      const input = typeof step.tool_input === "string" ? step.tool_input : JSON.stringify(step.tool_input)
      if (/\b(vitest|jest|pytest|cargo test|bun test|npm test)\b/i.test(input)) {
        const framework = input.match(/\b(vitest|jest|pytest|cargo test|bun test|npm test)\b/i)?.[0] ?? "unknown"
        patterns.push({
          id: randomUUID(),
          type: "declarative",
          name: `test_framework`,
          description: `This project uses ${framework} for testing`,
          content: JSON.stringify({ guideline: `Test framework: ${framework}. Command: ${input.slice(0, 200)}` }),
          score: 0.7,
          useCount: 0,
          projectDir,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    // Extract error patterns from failed commands
    if (step.tool_name === "bash" && output.includes("error") || output.includes("Error")) {
      const errorLines = output.split("\n").filter((l: string) => /error/i.test(l)).slice(0, 3)
      if (errorLines.length > 0) {
        patterns.push({
          id: randomUUID(),
          type: "declarative",
          name: `error_pattern_${Date.now()}`,
          description: "Common error encountered in this project",
          content: JSON.stringify({ guideline: `Known error: ${errorLines.join("; ").slice(0, 300)}` }),
          score: 0.4,
          useCount: 0,
          projectDir,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
  }

  return patterns
}

function summarizeInput(toolName: string, input: any): string {
  const str = typeof input === "string" ? input : JSON.stringify(input)
  if (str.length > 200) return str.slice(0, 200) + "..."
  return str
}

function summarizeOutput(output: any): string {
  if (!output) return "(no output)"
  const str = typeof output === "string" ? output : (output.output ?? JSON.stringify(output))
  if (str.length > 100) return str.slice(0, 100) + "..."
  return str
}

/**
 * Save extracted patterns to the database.
 * Deduplicates by name+projectDir — updates score if pattern already exists.
 */
export function saveExperiencePatterns(patterns: ExperiencePattern[]): number {
  const db = getDb()
  let saved = 0

  for (const p of patterns) {
    const existing = db.query(
      "SELECT id, score, use_count FROM experience_patterns WHERE name = ? AND (project_dir = ? OR project_dir IS NULL)"
    ).get(p.name, p.projectDir) as any

    if (existing) {
      // Boost score on re-discovery (pattern is reinforced)
      const newScore = Math.min(1.0, existing.score + 0.1)
      db.run(
        "UPDATE experience_patterns SET score = ?, updated_at = ? WHERE id = ?",
        [newScore, Date.now(), existing.id]
      )
    } else {
      db.run(
        "INSERT INTO experience_patterns (id, type, name, description, content, score, use_count, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [p.id, p.type, p.name, p.description, p.content, p.score, p.useCount, p.projectDir, p.createdAt, p.updatedAt]
      )
      saved++
    }
  }

  return saved
}

/**
 * Get relevant experience patterns for the current context.
 * Returns patterns sorted by score, optionally filtered by type and project.
 */
export function getRelevantExperience(
  projectDir: string,
  type?: "procedural" | "declarative",
  limit: number = 20,
): ExperiencePattern[] {
  const db = getDb()
  let query: string
  let params: any[]

  if (type) {
    query = "SELECT * FROM experience_patterns WHERE (project_dir = ? OR project_dir IS NULL) AND type = ? ORDER BY score DESC, use_count DESC LIMIT ?"
    params = [projectDir, type, limit]
  } else {
    query = "SELECT * FROM experience_patterns WHERE (project_dir = ? OR project_dir IS NULL) ORDER BY score DESC, use_count DESC LIMIT ?"
    params = [projectDir, limit]
  }

  const rows = db.query(query).all(...params) as any[]
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    content: r.content,
    score: r.score,
    useCount: r.use_count,
    projectDir: r.project_dir,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/**
 * Increment use count for a pattern (called when injected into context).
 */
export function markUsed(patternId: string): void {
  const db = getDb()
  db.run("UPDATE experience_patterns SET use_count = use_count + 1, updated_at = ? WHERE id = ?", [Date.now(), patternId])
}

/**
 * Maintenance: prune low-scoring patterns to prevent repository degradation.
 * Per AutoRefine paper: "A continuous maintenance mechanism scores, prunes,
 * and merges patterns to prevent repository degradation."
 */
export function prunePatterns(threshold: number = 0.3, maxPatterns: number = 500): number {
  const db = getDb()
  const count = (db.query("SELECT count(*) as cnt FROM experience_patterns").get() as any)?.cnt ?? 0

  if (count <= maxPatterns) return 0

  // Delete lowest-scoring patterns that have never been used
  const deleted = db.run(
    "DELETE FROM experience_patterns WHERE score < ? AND use_count = 0",
    [threshold]
  )
  return deleted.changes
}

/**
 * Format experience patterns for injection into system prompt.
 */
export function formatExperienceContext(patterns: ExperiencePattern[]): string {
  if (patterns.length === 0) return ""

  const lines: string[] = [
    "## Learned Experience (from prior sessions)",
    ""
  ]

  const declarative = patterns.filter(p => p.type === "declarative")
  const procedural = patterns.filter(p => p.type === "procedural")

  if (declarative.length > 0) {
    lines.push("### Project Knowledge")
    for (const p of declarative.slice(0, 10)) {
      const content = JSON.parse(p.content)
      lines.push(`- ${content.guideline ?? p.description}`)
    }
    lines.push("")
  }

  if (procedural.length > 0) {
    lines.push("### Known Workflows")
    for (const p of procedural.slice(0, 5)) {
      lines.push(`- **${p.description}** (used ${p.useCount}×, score ${p.score.toFixed(1)})`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
