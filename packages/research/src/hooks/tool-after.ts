import type { TrajectoryTracker } from "../replay/trajectory.js"
import { classifyFailure, findRelevantLessons, saveLesson, formatLessonsContext, markLessonUsed } from "../tracing/analyzer.js"

/**
 * tool.execute.after hook — captures tool executions and analyzes failures.
 *
 * Two responsibilities:
 * 1. Record every tool call into the trajectory DB (always active)
 * 2. When tracing is enabled: detect bash failures, find relevant lessons,
 *    and append lesson context to the output (TraceCoder HLLM)
 */
export function createToolAfterHook(tracker: TrajectoryTracker, tracingEnabled: boolean = false) {
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
        // Find and inject relevant lessons
        const lessons = findRelevantLessons(classification.type, 3)
        if (lessons.length > 0) {
          const context = formatLessonsContext(lessons)
          output.output = output.output + "\n\n" + context
          for (const l of lessons) markLessonUsed(l.id)
        }

        // Auto-generate a lesson from this failure
        const insight = `When running "${command.slice(0, 80)}": ${classification.summary}. ${classification.details.slice(0, 200)}`
        saveLesson(classification, insight)
        console.log(`[research:tracing] Lesson saved: ${classification.type} — ${classification.summary.slice(0, 60)}`)
      }
    }
  }
}
