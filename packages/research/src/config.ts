import { z } from "zod"

export const ResearchConfig = z.object({
  replay: z.object({
    enabled: z.boolean(),
    maxTrajectories: z.number(),
    branchScoreThreshold: z.number(),
  }).partial().optional(),
  metaTools: z.object({
    enabled: z.boolean(),
    minFrequency: z.number(),
  }).partial().optional(),
  experience: z.object({
    enabled: z.boolean(),
    maxPatterns: z.number(),
    pruneThreshold: z.number(),
  }).partial().optional(),
  tracing: z.object({
    enabled: z.boolean(),
    maxLessons: z.number(),
  }).partial().optional(),
  context: z.object({
    enabled: z.boolean(),
    modelTierDetection: z.boolean(),
  }).partial().optional(),
  psychometrics: z.object({
    enabled: z.boolean(),
  }).partial().optional(),
  planning: z.object({
    enabled: z.boolean(),
    lookaheadDepth: z.number(),
  }).partial().optional(),
}).partial().optional()

export type ResearchConfigInput = z.infer<typeof ResearchConfig>

// Resolved config with all defaults applied
export interface ResolvedConfig {
  replay: { enabled: boolean; maxTrajectories: number; branchScoreThreshold: number }
  metaTools: { enabled: boolean; minFrequency: number }
  experience: { enabled: boolean; maxPatterns: number; pruneThreshold: number }
  tracing: { enabled: boolean; maxLessons: number }
  context: { enabled: boolean; modelTierDetection: boolean }
  psychometrics: { enabled: boolean }
  planning: { enabled: boolean; lookaheadDepth: number }
}

const DEFAULTS: ResolvedConfig = {
  replay: { enabled: true, maxTrajectories: 100, branchScoreThreshold: 0.7 },
  metaTools: { enabled: false, minFrequency: 3 },
  experience: { enabled: false, maxPatterns: 500, pruneThreshold: 0.3 },
  tracing: { enabled: false, maxLessons: 200 },
  context: { enabled: true, modelTierDetection: true },
  psychometrics: { enabled: false },
  planning: { enabled: false, lookaheadDepth: 3 },
}

export function resolveConfig(input?: ResearchConfigInput): ResolvedConfig {
  if (!input) return DEFAULTS
  return {
    replay: { ...DEFAULTS.replay, ...input.replay },
    metaTools: { ...DEFAULTS.metaTools, ...input.metaTools },
    experience: { ...DEFAULTS.experience, ...input.experience },
    tracing: { ...DEFAULTS.tracing, ...input.tracing },
    context: { ...DEFAULTS.context, ...input.context },
    psychometrics: { ...DEFAULTS.psychometrics, ...input.psychometrics },
    planning: { ...DEFAULTS.planning, ...input.planning },
  }
}
