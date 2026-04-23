import { tool } from "@opencode-ai/plugin/tool"
import {
  extractFromTrajectory,
  saveExperiencePatterns,
  getRelevantExperience,
  prunePatterns,
  formatExperienceContext,
} from "../experience/extractor.js"
import { getDb } from "../storage/db.js"
import type { ResolvedConfig } from "../config.js"

/**
 * experience tool — extract, query, and manage learned experience patterns.
 */
export function createExperienceTool(config: ResolvedConfig) {
  return tool({
    description: "Manage learned experience from prior sessions. Actions: 'extract' processes recent trajectories; 'query' finds relevant experience; 'prune' removes low-value patterns; 'stats' shows overview.",
    args: {
      action: tool.schema.enum(["extract", "query", "prune", "stats"]).default("stats")
        .describe("extract: learn from recent trajectories; query: find relevant experience; prune: cleanup; stats: overview"),
      type: tool.schema.enum(["procedural", "declarative", "all"]).optional()
        .describe("Filter by pattern type for query action"),
    },
    async execute(args, ctx) {
      const projectDir = ctx.directory

      if (args.action === "extract") {
        const db = getDb()
        // Get recent completed trajectories that haven't been processed
        const trajectories = db.query(`
          SELECT id, project_dir FROM trajectories
          WHERE status = 'completed' AND total_steps >= 2 AND project_dir = ?
          ORDER BY created_at DESC LIMIT 20
        `).all(projectDir) as any[]

        let totalExtracted = 0
        for (const traj of trajectories) {
          const patterns = extractFromTrajectory(traj.id, traj.project_dir)
          const saved = saveExperiencePatterns(patterns)
          totalExtracted += saved
        }

        return `Processed ${trajectories.length} trajectories, extracted ${totalExtracted} new experience patterns.`
      }

      if (args.action === "query") {
        const filterType = args.type === "all" ? undefined : args.type as any
        const patterns = getRelevantExperience(projectDir, filterType, 20)
        if (patterns.length === 0) return "No experience patterns found. Run 'extract' first."
        return formatExperienceContext(patterns)
      }

      if (args.action === "prune") {
        const pruned = prunePatterns(config.experience.pruneThreshold, config.experience.maxPatterns)
        return `Pruned ${pruned} low-value patterns.`
      }

      // stats
      const db = getDb()
      const total = (db.query("SELECT count(*) as cnt FROM experience_patterns").get() as any)?.cnt ?? 0
      const procedural = (db.query("SELECT count(*) as cnt FROM experience_patterns WHERE type = 'procedural'").get() as any)?.cnt ?? 0
      const declarative = (db.query("SELECT count(*) as cnt FROM experience_patterns WHERE type = 'declarative'").get() as any)?.cnt ?? 0
      const avgScore = (db.query("SELECT avg(score) as avg FROM experience_patterns").get() as any)?.avg ?? 0
      const topUsed = db.query("SELECT name, use_count, score FROM experience_patterns ORDER BY use_count DESC LIMIT 5").all() as any[]

      const lines = [
        `## Experience Stats`,
        `- Total patterns: ${total} (${procedural} procedural, ${declarative} declarative)`,
        `- Average score: ${avgScore.toFixed(2)}`,
        ``,
        `### Most Used`,
        ...topUsed.map((p: any) => `- ${p.name} (${p.use_count}× used, score ${p.score.toFixed(1)})`),
      ]
      return lines.join("\n") || "No experience data yet."
    },
  })
}
