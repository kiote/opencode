import { getSavedPatterns, type ToolPattern } from "../meta-tools/miner.js"
import { detectPatternStart } from "../meta-tools/composite.js"

/**
 * tool.execute.before hook — detect when the agent starts a known pattern.
 *
 * Currently advisory: adds a hint to the tool args metadata indicating
 * that this tool call is the start of a known sequence. The agent can
 * use this to plan ahead.
 *
 * Phase 3b (future): deterministic execution of the remaining steps
 * without going back to the LLM for each intermediate decision.
 */
export function createToolBeforeHook(minFrequency: number) {
  let cachedPatterns: ToolPattern[] | null = null
  let lastRefresh = 0
  const REFRESH_INTERVAL = 60_000 // Refresh patterns every 60s

  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => {
    // Refresh pattern cache periodically
    const now = Date.now()
    if (!cachedPatterns || now - lastRefresh > REFRESH_INTERVAL) {
      cachedPatterns = getSavedPatterns(minFrequency)
      lastRefresh = now
    }

    const match = detectPatternStart(input.tool, cachedPatterns)
    if (match) {
      // For now, just log — Phase 3b will add deterministic execution
      console.log(
        `[research:meta-tools] Detected start of known pattern: ${match.sequence.join(" → ")} (${match.frequency}×)`
      )
    }
  }
}
