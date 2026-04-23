import type { Event } from "@opencode-ai/sdk"
import type { TrajectoryTracker } from "../replay/trajectory.js"

/**
 * event hook — listens to Bus events for session lifecycle tracking.
 *
 * Captures session start/idle transitions to mark trajectory boundaries.
 */
export function createEventHook(tracker: TrajectoryTracker) {
  return async (input: { event: Event }) => {
    const event = input.event
    if (!event) return

    // Session became idle — finalize trajectory
    if (event.type === "session.status") {
      const props = event.properties as { sessionID: string; status: { type: string } }
      if (props.status.type === "idle") {
        await tracker.finalize(props.sessionID)
      }
    }
  }
}
