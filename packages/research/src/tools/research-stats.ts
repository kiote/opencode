import { tool } from "@opencode-ai/plugin/tool"
import { getDb, trajectories, trajectorySteps, toolPatterns, experiencePatterns, lessons } from "../storage/index.js"
import { sql } from "drizzle-orm"

/**
 * /research-stats tool — query the research database for insights.
 *
 * Shows trajectory counts, most common tool patterns, experience patterns, etc.
 * Useful for understanding what the research layer has learned.
 */
export const researchStatsTool = tool({
  description: "Show research plugin statistics: trajectory count, tool patterns, experience patterns, and lessons learned.",
  args: {
    scope: tool.schema.enum(["all", "trajectories", "patterns", "experience", "lessons"]).default("all")
      .describe("What stats to show"),
  },
  async execute(args) {
    const db = getDb()
    const sections: string[] = []

    if (args.scope === "all" || args.scope === "trajectories") {
      const trajCount = db.select({ count: sql<number>`count(*)` }).from(trajectories).get()
      const stepCount = db.select({ count: sql<number>`count(*)` }).from(trajectorySteps).get()
      const topTools = db
        .select({
          tool: trajectorySteps.toolName,
          count: sql<number>`count(*)`,
        })
        .from(trajectorySteps)
        .groupBy(trajectorySteps.toolName)
        .orderBy(sql`count(*) desc`)
        .limit(10)
        .all()

      sections.push(`## Trajectories\n- Total: ${trajCount?.count ?? 0}\n- Total steps: ${stepCount?.count ?? 0}\n- Top tools: ${topTools.map(t => `${t.tool}(${t.count})`).join(", ") || "none"}`)
    }

    if (args.scope === "all" || args.scope === "patterns") {
      const patCount = db.select({ count: sql<number>`count(*)` }).from(toolPatterns).get()
      sections.push(`## Tool Patterns\n- Discovered: ${patCount?.count ?? 0}`)
    }

    if (args.scope === "all" || args.scope === "experience") {
      const expCount = db.select({ count: sql<number>`count(*)` }).from(experiencePatterns).get()
      sections.push(`## Experience Patterns\n- Extracted: ${expCount?.count ?? 0}`)
    }

    if (args.scope === "all" || args.scope === "lessons") {
      const lessonCount = db.select({ count: sql<number>`count(*)` }).from(lessons).get()
      sections.push(`## Lessons Learned\n- Total: ${lessonCount?.count ?? 0}`)
    }

    return sections.join("\n\n") || "No research data yet."
  },
})
