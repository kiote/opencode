import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { ResearchConfig, resolveConfig } from "./config.js"
import { TrajectoryTracker } from "./replay/trajectory.js"
import { createToolAfterHook } from "./hooks/tool-after.js"
import { createEventHook } from "./hooks/event.js"
import { researchStatsTool } from "./tools/research-stats.js"
import { createReplayCheckTool } from "./tools/replay-check.js"
import { createSystemHook } from "./hooks/system.js"
import { getDb } from "./storage/index.js"

/**
 * OpenCode Research Plugin
 *
 * Layers research-backed enhancements onto OpenCode:
 * - Phase 0: Plugin scaffold + trajectory capture ✅
 * - Phase 2: SWE-Replay (trajectory recycling & branching) ✅
 * - Phase 3: Meta-tools (composite tool discovery) — TODO
 * - Phase 4: Experience extraction (AutoRefine) — TODO
 * - Phase 5: Context engineering — TODO
 * - Phase 6: TraceCoder (trace analysis) — TODO
 * - Phase 7: FLARE planning — TODO
 * - Phase 8: Task psychometrics — TODO
 *
 * Papers: see wikis/agentic-development/ for full documentation.
 */
export const ResearchPlugin: Plugin = async (ctx, options) => {
  const parsed = ResearchConfig.safeParse(options ?? {})
  const config = resolveConfig(parsed.success ? parsed.data : undefined)

  // Initialize database
  getDb()

  // Initialize trajectory tracker
  const tracker = new TrajectoryTracker(ctx.directory)

  console.log(`[research] Plugin loaded for ${ctx.directory}`)
  console.log(`[research] Modules: replay=${config.replay.enabled} metaTools=${config.metaTools.enabled} experience=${config.experience.enabled} tracing=${config.tracing.enabled} context=${config.context.enabled}`)

  const hooks: Hooks = {}

  // --- Always active: trajectory capture ---
  hooks["tool.execute.after"] = createToolAfterHook(tracker)
  hooks["event"] = createEventHook(tracker)

  // --- Custom tools ---
  hooks.tool = {
    research_stats: researchStatsTool,
    ...(config.replay.enabled ? { replay_check: createReplayCheckTool(config) } : {}),
  }

  // --- Phase 2: SWE-Replay auto-injection ---
  if (config.replay.enabled) {
    hooks["experimental.chat.system.transform"] = createSystemHook(config, ctx.directory)
  }

  // --- Phase 3: Meta-tools ---
  if (config.metaTools.enabled) {
    // TODO
  }

  // --- Phase 5: Context engineering ---
  if (config.context.enabled) {
    hooks["chat.params"] = async (_input, _output) => {
      // TODO: model-tier-aware parameter tuning
    }
  }

  // --- Phase 7: FLARE ---
  if (config.planning.enabled) {
    // TODO: requires core patch
  }

  // --- Phase 8: Psychometrics ---
  if (config.psychometrics.enabled) {
    hooks["chat.message"] = async (_input, _output) => {
      // TODO
    }
  }

  return hooks
}

export default { id: "@opencode-ai/research", server: ResearchPlugin }
