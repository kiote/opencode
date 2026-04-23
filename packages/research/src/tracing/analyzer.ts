import { getDb } from "../storage/db.js"
import { randomUUID } from "crypto"

/**
 * TraceCoder — runtime trace analysis for debugging.
 *
 * Based on the TraceCoder paper (Feb 2026):
 * "TraceCoder emulates the observe-analyze-repair process of human experts"
 * "Historical Lesson Learning Mechanism (HLLM) distills insights from
 * prior failed repair attempts"
 *
 * Our implementation:
 * 1. Detects failed bash commands from tool.execute.after output
 * 2. Classifies the failure type (compile error, test failure, runtime error, etc.)
 * 3. Stores failure→insight pairs as lessons
 * 4. Injects relevant lessons when similar failures occur
 */

export interface Lesson {
  id: string
  trajectoryId: string | null
  failureType: string
  failureContext: string  // JSON
  insight: string
  useCount: number
  createdAt: number
}

/**
 * Classify a bash command failure from its output.
 */
export function classifyFailure(
  command: string,
  output: string,
  exitCode?: number,
): FailureClassification | null {
  // Only analyze failures
  if (exitCode === 0 && !output.match(/error|Error|ERROR|failed|FAILED/)) return null

  const lowerOutput = output.toLowerCase()
  const lowerCmd = command.toLowerCase()

  // Test failures
  if (/\b(test|jest|vitest|pytest|cargo test)\b/i.test(lowerCmd)) {
    const testNames = output.match(/FAIL\s+(.+)|✗\s+(.+)|FAILED\s+(.+)/g)?.slice(0, 5) ?? []
    return {
      type: "test_failure",
      summary: `Test failure in: ${lowerCmd.slice(0, 100)}`,
      details: testNames.join("; ").slice(0, 500) || "Test command failed",
      command: command.slice(0, 200),
    }
  }

  // TypeScript / compile errors
  if (lowerOutput.includes("ts") && (lowerOutput.includes("error ts") || lowerOutput.includes("cannot find"))) {
    const errors = output.match(/error TS\d+:.+/g)?.slice(0, 5) ?? []
    return {
      type: "compile_error",
      summary: "TypeScript compilation error",
      details: errors.join("; ").slice(0, 500) || "TS compilation failed",
      command: command.slice(0, 200),
    }
  }

  // Module/import errors
  if (lowerOutput.includes("cannot find module") || lowerOutput.includes("module not found") || lowerOutput.includes("no such file")) {
    return {
      type: "import_error",
      summary: "Module or file not found",
      details: output.split("\n").filter(l => /cannot find|not found|no such/i.test(l)).slice(0, 3).join("; ").slice(0, 500),
      command: command.slice(0, 200),
    }
  }

  // Permission errors
  if (lowerOutput.includes("permission denied") || lowerOutput.includes("eacces")) {
    return {
      type: "permission_error",
      summary: "Permission denied",
      details: output.split("\n").filter(l => /permission|eacces/i.test(l)).slice(0, 3).join("; ").slice(0, 500),
      command: command.slice(0, 200),
    }
  }

  // Generic error
  if (exitCode !== 0 || lowerOutput.includes("error")) {
    const errorLines = output.split("\n").filter(l => /error|Error|ERROR/i.test(l)).slice(0, 5)
    return {
      type: "runtime_error",
      summary: `Command failed: ${command.slice(0, 80)}`,
      details: errorLines.join("; ").slice(0, 500) || "Command returned non-zero exit code",
      command: command.slice(0, 200),
    }
  }

  return null
}

/**
 * Save a lesson learned from a failure.
 */
export function saveLesson(
  classification: FailureClassification,
  insight: string,
  trajectoryId?: string,
): void {
  const db = getDb()
  db.run(
    "INSERT INTO lessons (id, trajectory_id, failure_type, failure_context, insight, use_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    [randomUUID(), trajectoryId ?? null, classification.type, JSON.stringify(classification), insight, Date.now()]
  )
}

/**
 * Find relevant lessons for a given failure type.
 */
export function findRelevantLessons(
  failureType: string,
  limit: number = 5,
): Lesson[] {
  const db = getDb()
  const rows = db.query(`
    SELECT id, trajectory_id, failure_type, failure_context, insight, use_count, created_at
    FROM lessons
    WHERE failure_type = ?
    ORDER BY use_count DESC, created_at DESC
    LIMIT ?
  `).all(failureType, limit) as any[]

  return rows.map(r => ({
    id: r.id,
    trajectoryId: r.trajectory_id,
    failureType: r.failure_type,
    failureContext: r.failure_context,
    insight: r.insight,
    useCount: r.use_count,
    createdAt: r.created_at,
  }))
}

/**
 * Mark a lesson as used.
 */
export function markLessonUsed(lessonId: string): void {
  const db = getDb()
  db.run("UPDATE lessons SET use_count = use_count + 1 WHERE id = ?", [lessonId])
}

/**
 * Get all lessons, optionally filtered by type.
 */
export function getAllLessons(failureType?: string, limit: number = 50): Lesson[] {
  const db = getDb()
  const query = failureType
    ? "SELECT * FROM lessons WHERE failure_type = ? ORDER BY created_at DESC LIMIT ?"
    : "SELECT * FROM lessons ORDER BY created_at DESC LIMIT ?"
  const params = failureType ? [failureType, limit] : [limit]
  return (db.query(query).all(...params) as any[]).map(r => ({
    id: r.id,
    trajectoryId: r.trajectory_id,
    failureType: r.failure_type,
    failureContext: r.failure_context,
    insight: r.insight,
    useCount: r.use_count,
    createdAt: r.created_at,
  }))
}

/**
 * Format lessons for injection into tool output when a failure is detected.
 */
export function formatLessonsContext(lessons: Lesson[]): string {
  if (lessons.length === 0) return ""
  const lines = [
    "💡 **Relevant lessons from prior failures:**",
    "",
  ]
  for (const l of lessons) {
    lines.push(`- ${l.insight} (used ${l.useCount}×)`)
  }
  return lines.join("\n")
}

export interface FailureClassification {
  type: string
  summary: string
  details: string
  command: string
}
