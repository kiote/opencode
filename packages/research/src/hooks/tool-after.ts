import type { TrajectoryTracker } from "../replay/trajectory.js"
import { classifyFailure, findRelevantLessons, saveLesson, formatLessonsContext, markLessonUsed } from "../tracing/analyzer.js"
import { getDb } from "../storage/db.js"

/**
 * tool.execute.after hook — captures tool executions and analyzes failures.
 *
 * TraceCoder HLLM design (per paper):
 * - "HLLM *distills* insights from prior failed repair attempts"
 * - Lessons should be SELECTIVE, not exhaustive
 * - Only inject lessons that are RELEVANT to the current failure
 * - Deduplicate: don't save the same lesson twice
 * - Cap injection: max 3 lessons, max 500 chars total
 * - Decay: lessons with low use_count and old age get pruned
 *
 * AWO paper insight:
 * - "Shorter execution paths lead to fewer failures"
 * - Minimize injected context to reduce path length
 */
export function createToolAfterHook(tracker: TrajectoryTracker, tracingEnabled: boolean = false) {
  // Track recently saved lessons to avoid duplicates within a session
  const recentLessonKeys = new Set<string>()
  // Track injection count per session to avoid overwhelming the agent
  const sessionInjections = new Map<string, number>()
  const MAX_INJECTIONS_PER_SESSION = 5
  const MAX_LESSON_CHARS = 500

  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
    // Always: record trajectory step
    await tracker.recordStep({
      sessionId: input.sessionID,
      toolName: input.tool,
      toolInput: input.args,
      toolOutput: {
        title: output.title,
        output: output.output,
        metadata: output.metadata,
      },
      callId: input.callID,
    })

    // TraceCoder: analyze bash failures and inject lessons
    if (tracingEnabled && input.tool === "bash") {
      const command = typeof input.args === "string"
        ? input.args
        : (input.args?.command ?? input.args?.cmd ?? JSON.stringify(input.args))

      const exitCode = output.metadata?.exitCode ?? (output.output.includes("exit code") ? 1 : undefined)
      const classification = classifyFailure(command, output.output, exitCode)

      if (classification) {
        // --- Selective injection (per TraceCoder paper: "distill, don't dump") ---
        const injectionCount = sessionInjections.get(input.sessionID) ?? 0
        if (injectionCount < MAX_INJECTIONS_PER_SESSION) {
          const lessons = findRelevantLessons(classification.type, 3)
          if (lessons.length > 0) {
            const context = formatLessonsContext(lessons)
            // Cap injection size
            if (context.length <= MAX_LESSON_CHARS) {
              output.output = output.output + "\n\n" + context
              for (const l of lessons) markLessonUsed(l.id)
              sessionInjections.set(input.sessionID, injectionCount + 1)
            }
          }
        }

        // --- Deduplicated lesson saving ---
        // Create a stable key from failure type + command signature
        const cmdSignature = command.slice(0, 50).replace(/\d+/g, 'N').replace(/\s+/g, ' ')
        const lessonKey = `${classification.type}:${cmdSignature}`

        if (!recentLessonKeys.has(lessonKey)) {
          // Also check DB for existing similar lessons
          const db = getDb()
          const existing = db.query(
            "SELECT id FROM lessons WHERE failure_type = ? AND insight LIKE ? LIMIT 1"
          ).get(classification.type, `%${cmdSignature.slice(0, 30)}%`) as any

          if (!existing) {
            const insight = `When running "${command.slice(0, 80)}": ${classification.summary}. ${classification.details.slice(0, 200)}`
            saveLesson(classification, insight)
            console.log(`[research:tracing] Lesson saved: ${classification.type} — ${classification.summary.slice(0, 60)}`)
          }

          recentLessonKeys.add(lessonKey)
          // Keep the set bounded
          if (recentLessonKeys.size > 100) {
            const first = recentLessonKeys.values().next().value
            if (first) recentLessonKeys.delete(first)
          }
        }
      }
    }
  }
}
