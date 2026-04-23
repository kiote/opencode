import {
  findRelevantTrajectories,
  shouldReplay,
  getTrajectorySteps,
  formatTrajectoryAsContext,
} from "../replay/engine.js"
import type { ResolvedConfig } from "../config.js"

/**
 * experimental.chat.system.transform hook — auto-inject replay context.
 *
 * When a new session starts in a project with prior trajectories,
 * this hook checks if replay would be beneficial and injects the
 * prior trajectory as system-level context.
 *
 * This is the automatic version — the agent doesn't need to call
 * replay_check manually. The context appears in the system prompt.
 */
export function createSystemHook(config: ResolvedConfig, projectDir: string) {
  // Track which sessions already got replay context to avoid re-injecting
  const injectedSessions = new Set<string>()

  return async (
    input: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    if (!config.replay.enabled) return

    // Only inject once per session
    const sessionId = input.sessionID
    if (!sessionId || injectedSessions.has(sessionId)) return
    injectedSessions.add(sessionId)

    const trajectories = findRelevantTrajectories(projectDir, 5)
    const decision = shouldReplay(trajectories, config.replay.branchScoreThreshold)

    if (decision.action !== "replay") return

    const steps = getTrajectorySteps(decision.trajectoryId, decision.branchPoint.stepIndex)
    const context = formatTrajectoryAsContext(steps)

    if (context) {
      output.system.push(context)
    }
  }
}
