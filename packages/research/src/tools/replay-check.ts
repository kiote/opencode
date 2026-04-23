import { tool } from "@opencode-ai/plugin/tool"
import {
  findRelevantTrajectories,
  getBranchPoints,
  getTrajectorySteps,
  formatTrajectoryAsContext,
  shouldReplay,
} from "../replay/engine.js"
import type { ResolvedConfig } from "../config.js"

/**
 * replay_check tool — analyze prior trajectories and suggest replay strategy.
 *
 * The agent can call this to see what prior work exists and decide
 * whether to branch from a checkpoint or start fresh.
 */
export function createReplayCheckTool(config: ResolvedConfig) {
  return tool({
    description: "Check prior execution trajectories for the current project. Shows whether replaying from a previous checkpoint would be more efficient than starting fresh. Use this when retrying a failed task or when working on similar problems to previous sessions.",
    args: {
      action: tool.schema.enum(["check", "list", "detail"]).default("check")
        .describe("check: recommend replay/explore; list: show recent trajectories; detail: show steps for a trajectory"),
      trajectoryId: tool.schema.string().optional()
        .describe("Trajectory ID for 'detail' action"),
    },
    async execute(args, ctx) {
      const projectDir = ctx.directory

      if (args.action === "list") {
        const trajectories = findRelevantTrajectories(projectDir, 10)
        if (trajectories.length === 0) return "No prior trajectories found for this project."

        const lines = ["## Recent Trajectories\n"]
        for (const t of trajectories) {
          const date = new Date(t.createdAt).toISOString().slice(0, 19)
          const branchPoints = getBranchPoints(t.id, config.replay.branchScoreThreshold)
          lines.push(`- **${t.id.slice(0, 8)}** | ${date} | ${t.totalSteps} steps | ${branchPoints.length} branch points | ${t.status}`)
        }
        return lines.join("\n")
      }

      if (args.action === "detail") {
        if (!args.trajectoryId) return "Please provide a trajectoryId for the detail action."
        const steps = getTrajectorySteps(args.trajectoryId)
        if (steps.length === 0) return "No steps found for this trajectory."
        return formatTrajectoryAsContext(steps)
      }

      // Default: "check" — recommend replay or explore
      const trajectories = findRelevantTrajectories(projectDir, 5)
      const decision = shouldReplay(trajectories, config.replay.branchScoreThreshold)

      if (decision.action === "explore") {
        return `**Recommendation: Start fresh**\nReason: ${decision.reason}\n\nNo useful prior trajectory to branch from. Proceed normally.`
      }

      const steps = getTrajectorySteps(decision.trajectoryId, decision.branchPoint.stepIndex)
      const context = formatTrajectoryAsContext(steps)

      return [
        `**Recommendation: Replay from checkpoint**`,
        `Reason: ${decision.reason}`,
        `Steps saved: ${decision.stepsSkipped}`,
        ``,
        context,
        ``,
        `Continue from here — the above steps have already been executed. Don't repeat them.`,
      ].join("\n")
    },
  })
}
