import {
  findRelevantTrajectories,
  shouldReplay,
  getTrajectorySteps,
  formatTrajectoryAsContext,
} from "../replay/engine.js"
import { getRelevantExperience, formatExperienceContext, markUsed } from "../experience/extractor.js"
import type { ResolvedConfig } from "../config.js"

/**
 * experimental.chat.system.transform hook
 *
 * Injects two types of context:
 * 1. SWE-Replay: prior trajectory context when replay is beneficial
 * 2. AutoRefine: learned experience patterns relevant to the project
 */
export function createSystemHook(config: ResolvedConfig, projectDir: string) {
  const injectedSessions = new Set<string>()

  return async (
    input: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    const sessionId = input.sessionID
    if (!sessionId || injectedSessions.has(sessionId)) return
    injectedSessions.add(sessionId)

    // --- SWE-Replay context ---
    if (config.replay.enabled) {
      const trajectories = findRelevantTrajectories(projectDir, 5)
      const decision = shouldReplay(trajectories, config.replay.branchScoreThreshold)

      if (decision.action === "replay") {
        const steps = getTrajectorySteps(decision.trajectoryId, decision.branchPoint.stepIndex)
        const context = formatTrajectoryAsContext(steps)
        if (context) output.system.push(context)
      }
    }

    // --- AutoRefine experience context ---
    if (config.experience.enabled) {
      const patterns = getRelevantExperience(projectDir, undefined, 15)
      const context = formatExperienceContext(patterns)
      if (context) {
        output.system.push(context)
        // Mark patterns as used
        for (const p of patterns) {
          markUsed(p.id)
        }
      }
    }
  }
}
