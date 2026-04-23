import { getDb, trajectorySteps } from "../storage/index.js"
import type { TrajectoryTracker } from "../replay/trajectory.js"

/**
 * tool.execute.after hook — captures every tool execution into the trajectory.
 *
 * This is the primary data collection point. Every tool call (bash, edit, read,
 * write, grep, etc.) flows through here with full input/output.
 */
export function createToolAfterHook(tracker: TrajectoryTracker) {
  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
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
  }
}
