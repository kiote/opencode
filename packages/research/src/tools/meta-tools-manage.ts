import { tool } from "@opencode-ai/plugin/tool"
import { minePatterns, savePatterns, getSavedPatterns } from "../meta-tools/miner.js"
import type { ResolvedConfig } from "../config.js"

/**
 * meta_tools tool — discover, inspect, and manage tool-call patterns.
 *
 * Per the AWO paper, this tool lets the agent (or user) discover
 * recurring patterns in how tools are used and promote them to
 * composite meta-tools.
 */
export function createMetaToolsTool(config: ResolvedConfig) {
  return tool({
    description: "Discover and manage tool-call patterns. Actions: 'discover' mines patterns from trajectory data; 'list' shows known patterns; 'promote' marks a pattern for composite tool generation.",
    args: {
      action: tool.schema.enum(["discover", "list", "promote"]).default("list")
        .describe("discover: mine new patterns from trajectories; list: show known patterns; promote: mark pattern for meta-tool generation"),
      patternId: tool.schema.string().optional()
        .describe("Pattern ID for 'promote' action"),
    },
    async execute(args) {
      if (args.action === "discover") {
        const candidates = minePatterns(config.metaTools.minFrequency)
        if (candidates.length === 0) {
          return "No recurring patterns found yet. Need more trajectory data — keep using OpenCode and patterns will emerge."
        }

        savePatterns(candidates)

        const lines = ["## Discovered Patterns\n"]
        for (const c of candidates.slice(0, 20)) {
          const seq = c.sequence.join(" → ")
          const avgDur = c.totalDuration / c.frequency
          lines.push(`- **${seq}** — ${c.frequency}× | avg ${Math.round(avgDur)}ms | from ${c.occurrences.length} trajectories`)
        }
        lines.push(`\nTotal: ${candidates.length} patterns found. Use 'promote' with a pattern ID to create a meta-tool.`)
        return lines.join("\n")
      }

      if (args.action === "list") {
        const patterns = getSavedPatterns()
        if (patterns.length === 0) {
          return "No patterns saved yet. Run 'discover' first to mine patterns from trajectory data."
        }

        const lines = ["## Saved Patterns\n"]
        for (const p of patterns) {
          const seq = p.sequence.join(" → ")
          const status = p.metaToolId ? "✅ promoted" : "⏳ candidate"
          lines.push(`- **${p.id.slice(0, 8)}** | ${seq} | ${p.frequency}× | ${status}`)
        }
        return lines.join("\n")
      }

      if (args.action === "promote") {
        if (!args.patternId) return "Please provide a patternId to promote."

        const db = (await import("../storage/db.js")).getDb()
        const pattern = db.query("SELECT id, pattern FROM tool_patterns WHERE id LIKE ?").get(`${args.patternId}%`) as any
        if (!pattern) return `Pattern ${args.patternId} not found.`

        // Mark as promoted (metaToolId = pattern id for now)
        db.run("UPDATE tool_patterns SET meta_tool_id = ? WHERE id = ?", [pattern.id, pattern.id])
        return `Pattern "${pattern.pattern}" promoted to meta-tool. It will be available as a composite tool on next plugin load.`
      }

      return "Unknown action."
    },
  })
}
