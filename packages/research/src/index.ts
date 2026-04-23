import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { ResearchConfig, resolveConfig } from "./config.js"
import { TrajectoryTracker } from "./replay/trajectory.js"
import { createToolAfterHook } from "./hooks/tool-after.js"
import { createEventHook } from "./hooks/event.js"
import { researchStatsTool } from "./tools/research-stats.js"
import { getDb } from "./storage/index.js"

/**
 * OpenCode Research Plugin
 *
 * Layers research-backed enhancements onto OpenCode:
 * - Phase 1: Trajectory capture (tool calls, session lifecycle)
 * - Phase 2: SWE-Replay (trajectory recycling & branching)
 * - Phase 3: Meta-tools (composite tool discovery)
 * - Phase 4: Experience extraction (AutoRefine patterns)
 * - Phase 5: Context engineering (model-tier-aware optimization)
 * - Phase 6: TraceCoder (runtime trace analysis)
 * - Phase 7: FLARE planning (future-aware lookahead)
 * - Phase 8: Task psychometrics (difficulty prediction)
 *
 * All features are independently toggleable via config.
 *
 * Papers: see wikis/agentic-development/ for full documentation.
 */
export const ResearchPlugin: Plugin = async (ctx, options) => {
  // Parse and resolve config with defaults
  const parsed = ResearchConfig.safeParse(options ?? {})
  const config = resolveConfig(parsed.success ? parsed.data : undefined)

  // Initialize database
  getDb()

  // Initialize trajectory tracker
  const tracker = new TrajectoryTracker(ctx.directory)

  console.log(`[research] Plugin loaded for ${ctx.directory}`)
  console.log(`[research] Modules: replay=${config.replay.enabled} metaTools=${config.metaTools.enabled} experience=${config.experience.enabled} tracing=${config.tracing.enabled} context=${config.context.enabled}`)

  // Build hooks based on enabled modules
  const hooks: Hooks = {}

  // --- Always active: trajectory capture (foundation for everything) ---
  hooks["tool.execute.after"] = createToolAfterHook(tracker)
  hooks["event"] = createEventHook(tracker)

  // --- Custom tools ---
  hooks.tool = {
    research_stats: researchStatsTool,
  }

  // --- Phase 3: Meta-tools (when enabled) ---
  if (config.metaTools.enabled) {
    // TODO: Phase 3 — pattern mining + composite tool registration
  }

  // --- Phase 4: Experience injection (when enabled) ---
  if (config.experience.enabled) {
    hooks["experimental.chat.system.transform"] = async (_input, output) => {
      // TODO: Phase 4 — inject relevant experience patterns into system prompt
      output.system.push("<!-- research:experience module active -->")
    }
  }

  // --- Phase 5: Context engineering (when enabled) ---
  if (config.context.enabled) {
    hooks["chat.params"] = async (_input, _output) => {
      // TODO: Phase 5 — model-tier-aware parameter tuning
    }
  }

  // --- Phase 7: FLARE planning (when enabled) ---
  if (config.planning.enabled) {
    // TODO: Phase 7 — requires core patch for mid-generation hook
  }

  // --- Phase 8: Task psychometrics (when enabled) ---
  if (config.psychometrics.enabled) {
    hooks["chat.message"] = async (_input, _output) => {
      // TODO: Phase 8 — analyze task difficulty from message content
    }
  }

  return hooks
}

// Default export for OpenCode plugin loader
export default { id: "@opencode-ai/research", server: ResearchPlugin }
