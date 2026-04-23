import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { ResearchConfig, resolveConfig } from "./config.js"
import { TrajectoryTracker } from "./replay/trajectory.js"
import { createToolAfterHook } from "./hooks/tool-after.js"
import { createEventHook } from "./hooks/event.js"
import { createSystemHook } from "./hooks/system.js"
import { createToolBeforeHook } from "./hooks/tool-before.js"
import { researchStatsTool } from "./tools/research-stats.js"
import { createReplayCheckTool } from "./tools/replay-check.js"
import { createMetaToolsTool } from "./tools/meta-tools-manage.js"
import { getSavedPatterns } from "./meta-tools/miner.js"
import { generateCompositeTools } from "./meta-tools/composite.js"
import { getDb } from "./storage/index.js"

/**
 * OpenCode Research Plugin
 *
 * Research-backed enhancements for OpenCode:
 * - Phase 0: Plugin scaffold + trajectory capture ✅
 * - Phase 2: SWE-Replay (trajectory recycling & branching) ✅
 * - Phase 3: Meta-tools (composite tool discovery) ✅
 * - Phase 4: Experience extraction (AutoRefine) — TODO
 * - Phase 5: Context engineering — TODO
 * - Phase 6: TraceCoder (trace analysis) — TODO
 * - Phase 7: FLARE planning — TODO
 * - Phase 8: Task psychometrics — TODO
 */
export const ResearchPlugin: Plugin = async (ctx, options) => {
  const parsed = ResearchConfig.safeParse(options ?? {})
  const config = resolveConfig(parsed.success ? parsed.data : undefined)

  getDb()

  const tracker = new TrajectoryTracker(ctx.directory)

  console.log(`[research] Plugin loaded for ${ctx.directory}`)
  console.log(`[research] Modules: replay=${config.replay.enabled} metaTools=${config.metaTools.enabled} experience=${config.experience.enabled} tracing=${config.tracing.enabled} context=${config.context.enabled}`)

  const hooks: Hooks = {}

  // --- Always active: trajectory capture ---
  hooks["tool.execute.after"] = createToolAfterHook(tracker)
  hooks["event"] = createEventHook(tracker)

  // --- Custom tools ---
  const customTools: Record<string, any> = {
    research_stats: researchStatsTool,
  }

  if (config.replay.enabled) {
    customTools.replay_check = createReplayCheckTool(config)
  }

  if (config.metaTools.enabled) {
    customTools.meta_tools = createMetaToolsTool(config)

    // Load promoted patterns as composite tools
    const promotedPatterns = getSavedPatterns(config.metaTools.minFrequency)
      .filter(p => p.metaToolId !== null)
    const compositeTools = generateCompositeTools(promotedPatterns)
    Object.assign(customTools, compositeTools)

    if (Object.keys(compositeTools).length > 0) {
      console.log(`[research:meta-tools] Loaded ${Object.keys(compositeTools).length} composite tools`)
    }

    // Pattern detection hook
    hooks["tool.execute.before"] = createToolBeforeHook(config.metaTools.minFrequency)
  }

  hooks.tool = customTools

  // --- Phase 2: SWE-Replay auto-injection ---
  if (config.replay.enabled) {
    hooks["experimental.chat.system.transform"] = createSystemHook(config, ctx.directory)
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
