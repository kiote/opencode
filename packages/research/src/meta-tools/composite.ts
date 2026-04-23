import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { ToolPattern } from "./miner.js"

/**
 * Generate composite tool definitions from discovered patterns.
 *
 * Per the AWO paper: "Meta-tools bypass unnecessary intermediate LLM
 * reasoning steps and reduce operational cost while also shortening
 * execution paths, leading to fewer failures."
 *
 * A composite tool encapsulates a recurring sequence (e.g., grep → read → edit)
 * as a single tool call. The LLM calls the composite tool once instead of
 * making 3 separate tool calls with reasoning between each.
 *
 * IMPORTANT: True composite execution (running the sub-steps deterministically)
 * requires intercepting tool calls at the scaffold level. For now, composite
 * tools act as "advisor" tools — they tell the agent the known good sequence
 * and let it execute the steps. This still saves LLM reasoning tokens by
 * providing the plan upfront.
 *
 * Full deterministic execution (Phase 3b) requires a tool.execute.before hook
 * that intercepts the first tool in a known sequence and runs the rest.
 */
export function generateCompositeTools(
  patterns: ToolPattern[],
  maxTools: number = 10,
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {}

  for (const pattern of patterns.slice(0, maxTools)) {
    if (!pattern.metaToolId) continue // Only promote patterns that have been approved

    const name = `meta_${pattern.sequence.join("_")}`
    const seqStr = pattern.sequence.join(" → ")

    tools[name] = tool({
      description: `Composite tool: executes the sequence [${seqStr}] which has been observed ${pattern.frequency} times in prior sessions. Use this when you need to perform this exact sequence — it provides the known-good execution plan.`,
      args: {
        context: tool.schema.string()
          .describe("Describe what you're trying to accomplish with this sequence"),
      },
      async execute(args) {
        return [
          `## Composite Tool: ${seqStr}`,
          `This sequence has been executed ${pattern.frequency} times before.`,
          `Average duration: ${pattern.avgDuration ? Math.round(pattern.avgDuration) + "ms" : "unknown"}`,
          ``,
          `### Recommended execution plan:`,
          ...pattern.sequence.map((step, i) => `${i + 1}. **${step}** — execute this tool next`),
          ``,
          `Proceed with the above steps in order for: ${args.context}`,
        ].join("\n")
      },
    })
  }

  return tools
}

/**
 * Check if a tool call is the start of a known pattern.
 *
 * Used by the tool.execute.before hook to detect when the agent
 * is about to start a known sequence. In the future (Phase 3b),
 * this could trigger deterministic execution of the full sequence.
 */
export function detectPatternStart(
  toolName: string,
  patterns: ToolPattern[],
): ToolPattern | null {
  for (const pattern of patterns) {
    if (pattern.sequence[0] === toolName && pattern.frequency >= 3) {
      return pattern
    }
  }
  return null
}
