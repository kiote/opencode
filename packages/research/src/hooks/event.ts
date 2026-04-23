import type { Event } from "@opencode-ai/sdk"
import type { TrajectoryTracker } from "../replay/trajectory.js"
import { extractFromTrajectory, saveExperiencePatterns } from "../experience/extractor.js"
import { getDb } from "../storage/db.js"

/**
 * event hook — listens to Bus events for session lifecycle tracking
 * and auto-extracts experience when sessions complete.
 */
export function createEventHook(tracker: TrajectoryTracker, experienceEnabled: boolean) {
  return async (input: { event: Event }) => {
    const event = input.event
    if (!event) return

    if (event.type === "session.status") {
      const props = event.properties as { sessionID: string; status: { type: string } }
      if (props.status.type === "idle") {
        // Finalize trajectory
        await tracker.finalize(props.sessionID)

        // Auto-extract experience from just-completed trajectory
        if (experienceEnabled) {
          try {
            const db = getDb()
            const traj = db.query(
              "SELECT id, project_dir FROM trajectories WHERE session_id = ? AND status = 'completed' AND total_steps >= 3 ORDER BY created_at DESC LIMIT 1"
            ).get(props.sessionID) as any

            if (traj) {
              const patterns = extractFromTrajectory(traj.id, traj.project_dir)
              const saved = saveExperiencePatterns(patterns)
              if (saved > 0) {
                console.log(`[research:experience] Extracted ${saved} patterns from session ${props.sessionID}`)
              }
            }
          } catch (e) {
            console.error("[research:experience] Auto-extraction failed:", e)
          }
        }
      }
    }
  }
}
