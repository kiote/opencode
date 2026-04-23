import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { ResearchConfig, resolveConfig } from "./config.js"
import { TrajectoryTracker } from "./replay/trajectory.js"
import { createToolAfterHook } from "./hooks/tool-after.js"
import { createEventHook } from "./hooks/event.js"
import { createSystemHook } from "./hooks/system.js"
import { createToolBeforeHook } from "./hooks/tool-before.js"
import { createParamsHook } from "./hooks/params.js"
import { researchStatsTool } from "./tools/research-stats.js"
import { createReplayCheckTool } from "./tools/replay-check.js"
import { createMetaToolsTool } from "./tools/meta-tools-manage.js"
import { createExperienceTool } from "./tools/experience-manage.js"
import { getSavedPatterns } from "./meta-tools/miner.js"
import { generateCompositeTools } from "./meta-tools/composite.js"
import { getDb } from "./storage/index.js"

/**
 * OpenCode Research Plugin
 *
 * Research-backed enhancements for OpenCode:
 * - Phase 0: Trajectory capture ✅
 * - Phase 2: SWE-Replay ✅
 * - Phase 3: Meta-tools / AWO ✅
 * - Phase 4: AutoRefine experience ✅
 * - Phase 5: Context engineering ✅
 * - Phase 6: TraceCoder ✅
 * - Phase 7: FLARE planning — TODO (needs core patch)
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

  // --- Trajectory capture + TraceCoder failure analysis ---
  hooks["tool.execute.after"] = createToolAfterHook(tracker, config.tracing.enabled)
  hooks["event"] = createEventHook(tracker, config.experience.enabled)

  // --- Custom tools ---
  const customTools: Record<string, any> = {
    research_stats: researchStatsTool,
  }

  if (config.replay.enabled) {
    customTools.replay_check = createReplayCheckTool(config)
  }

  if (config.metaTools.enabled) {
    customTools.meta_tools = createMetaToolsTool(config)
    const promotedPatterns = getSavedPatterns(config.metaTools.minFrequency).filter(p => p.metaToolId !== null)
    const compositeTools = generateCompositeTools(promotedPatterns)
    Object.assign(customTools, compositeTools)
    if (Object.keys(compositeTools).length > 0) {
      console.log(`[research:meta-tools] Loaded ${Object.keys(compositeTools).length} composite tools`)
    }
    hooks["tool.execute.before"] = createToolBeforeHook(config.metaTools.minFrequency)
  }

  if (config.experience.enabled) {
    customTools.experience = createExperienceTool(config)
  }

  hooks.tool = customTools

  // --- System prompt injection (replay + experience) ---
  if (config.replay.enabled || config.experience.enabled) {
    hooks["experimental.chat.system.transform"] = createSystemHook(config, ctx.directory)
  }

  // --- Context engineering: model-tier-aware params ---
  if (config.context.enabled) {
    hooks["chat.params"] = createParamsHook(config)
  }

  // --- Phase 7: FLARE (future) ---
  if (config.planning.enabled) {
    // Requires mid-generation hook — core patch needed
  }

  // --- Phase 8: Psychometrics (future) ---
  if (config.psychometrics.enabled) {
    hooks["chat.message"] = async (_input, _output) => {}
  }

  return hooks
}

export default { id: "@opencode-ai/research", server: ResearchPlugin }
