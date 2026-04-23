import { getDb } from "../storage/db.js"
import { randomUUID } from "crypto"

/**
 * Pattern Miner — discovers recurring tool-call sequences across trajectories.
 *
 * Based on the AWO (Agent Workflow Optimization) paper:
 * "AWO analyzes existing workflow traces to discover recurring sequences
 * of tool calls and transforms them into meta-tools."
 *
 * We mine N-grams (sequences of 2-5 tool calls) from trajectory steps,
 * count their frequency, and promote frequent patterns to meta-tools.
 */

export interface ToolPattern {
  id: string
  sequence: string[]          // e.g. ["grep", "read", "edit"]
  frequency: number
  avgDuration: number | null
  metaToolId: string | null
  lastSeen: number
  createdAt: number
}

export interface PatternCandidate {
  sequence: string[]
  frequency: number
  totalDuration: number
  occurrences: PatternOccurrence[]
}

interface PatternOccurrence {
  trajectoryId: string
  startStep: number
  endStep: number
  duration: number
}

/**
 * Mine tool-call N-grams from all completed trajectories.
 *
 * Returns sequences that appear at least `minFrequency` times,
 * sorted by frequency descending.
 */
export function minePatterns(
  minFrequency: number = 3,
  minLength: number = 2,
  maxLength: number = 5,
): PatternCandidate[] {
  const db = getDb()

  // Get all completed trajectories with their steps
  const trajectories = db.query(`
    SELECT t.id FROM trajectories t
    WHERE t.status = 'completed' AND t.total_steps >= ?
    ORDER BY t.created_at DESC
    LIMIT 200
  `).all(minLength) as any[]

  // Build sequences per trajectory
  const allSequences: { trajectoryId: string; tools: { name: string; duration: number; stepIndex: number }[] }[] = []

  for (const traj of trajectories) {
    const steps = db.query(`
      SELECT tool_name, duration, step_index
      FROM trajectory_steps
      WHERE trajectory_id = ?
      ORDER BY step_index
    `).all(traj.id) as any[]

    allSequences.push({
      trajectoryId: traj.id,
      tools: steps.map((s: any) => ({ name: s.tool_name, duration: s.duration ?? 0, stepIndex: s.step_index })),
    })
  }

  // Extract all N-grams of length minLength..maxLength
  const patternMap = new Map<string, PatternCandidate>()

  for (const seq of allSequences) {
    for (let n = minLength; n <= maxLength; n++) {
      for (let i = 0; i <= seq.tools.length - n; i++) {
        const slice = seq.tools.slice(i, i + n)
        const key = slice.map(s => s.name).join(" → ")
        const names = slice.map(s => s.name)
        const duration = slice.reduce((sum, s) => sum + s.duration, 0)

        if (!patternMap.has(key)) {
          patternMap.set(key, {
            sequence: names,
            frequency: 0,
            totalDuration: 0,
            occurrences: [],
          })
        }

        const pattern = patternMap.get(key)!
        pattern.frequency++
        pattern.totalDuration += duration
        pattern.occurrences.push({
          trajectoryId: seq.trajectoryId,
          startStep: slice[0].stepIndex,
          endStep: slice[slice.length - 1].stepIndex,
          duration,
        })
      }
    }
  }

  // Filter by minimum frequency and sort
  return Array.from(patternMap.values())
    .filter(p => p.frequency >= minFrequency)
    .sort((a, b) => b.frequency - a.frequency)
}

/**
 * Save discovered patterns to the database.
 */
export function savePatterns(patterns: PatternCandidate[]): void {
  const db = getDb()
  const now = Date.now()

  for (const p of patterns) {
    const key = p.sequence.join(" → ")
    const existing = db.query("SELECT id, frequency FROM tool_patterns WHERE pattern = ?").get(key) as any

    if (existing) {
      db.run(
        "UPDATE tool_patterns SET frequency = ?, avg_duration = ?, last_seen = ? WHERE id = ?",
        [p.frequency, p.totalDuration / p.frequency, now, existing.id]
      )
    } else {
      db.run(
        "INSERT INTO tool_patterns (id, pattern, frequency, avg_duration, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [randomUUID(), key, p.frequency, p.totalDuration / p.frequency, now, now]
      )
    }
  }
}

/**
 * Get all saved patterns, optionally filtered by minimum frequency.
 */
export function getSavedPatterns(minFrequency: number = 1): ToolPattern[] {
  const db = getDb()
  const rows = db.query(`
    SELECT id, pattern, frequency, avg_duration, meta_tool_id, last_seen, created_at
    FROM tool_patterns
    WHERE frequency >= ?
    ORDER BY frequency DESC
  `).all(minFrequency) as any[]

  return rows.map(r => ({
    id: r.id,
    sequence: r.pattern.split(" → "),
    frequency: r.frequency,
    avgDuration: r.avg_duration,
    metaToolId: r.meta_tool_id,
    lastSeen: r.last_seen,
    createdAt: r.created_at,
  }))
}
