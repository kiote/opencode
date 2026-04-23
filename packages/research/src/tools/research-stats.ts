import { tool } from "@opencode-ai/plugin/tool"
import { getDb } from "../storage/db.js"

/**
 * research_stats tool — query the research database for insights.
 */
export const researchStatsTool = tool({
  description: "Show research plugin statistics: trajectory count, tool patterns, experience patterns, and lessons learned.",
  args: {
    scope: tool.schema.enum(["all", "trajectories", "patterns", "experience", "lessons"]).default("all")
      .describe("What stats to show: all, trajectories, patterns, experience, or lessons"),
  },
  async execute(args) {
    const db = getDb()
    const sections: string[] = []

    if (args.scope === "all" || args.scope === "trajectories") {
      const trajCount = db.query("SELECT count(*) as count FROM trajectories").get() as any
      const stepCount = db.query("SELECT count(*) as count FROM trajectory_steps").get() as any
      const topTools = db.query(
        "SELECT tool_name, count(*) as cnt FROM trajectory_steps GROUP BY tool_name ORDER BY cnt DESC LIMIT 10"
      ).all() as any[]

      const toolStr = topTools.map((t: any) => `${t.tool_name}(${t.cnt})`).join(", ") || "none"
      sections.push(`## Trajectories\n- Total: ${trajCount?.count ?? 0}\n- Total steps: ${stepCount?.count ?? 0}\n- Top tools: ${toolStr}`)
    }

    if (args.scope === "all" || args.scope === "patterns") {
      const patCount = db.query("SELECT count(*) as count FROM tool_patterns").get() as any
      sections.push(`## Tool Patterns\n- Discovered: ${patCount?.count ?? 0}`)
    }

    if (args.scope === "all" || args.scope === "experience") {
      const expCount = db.query("SELECT count(*) as count FROM experience_patterns").get() as any
      sections.push(`## Experience Patterns\n- Extracted: ${expCount?.count ?? 0}`)
    }

    if (args.scope === "all" || args.scope === "lessons") {
      const lessonCount = db.query("SELECT count(*) as count FROM lessons").get() as any
      sections.push(`## Lessons Learned\n- Total: ${lessonCount?.count ?? 0}`)
    }

    return sections.join("\n\n") || "No research data yet."
  },
})
