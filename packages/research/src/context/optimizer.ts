/**
 * Context Engineering module
 *
 * Based on the Structured Context Engineering paper (Feb 2026):
 * - Model capability is the dominant factor (21pp gap frontier vs OSS)
 * - Format (YAML/JSON/Markdown) doesn't significantly affect aggregate accuracy
 * - File-based context retrieval helps frontier models (+2.7%) but hurts OSS (-7.7%)
 * - Compact formats can incur token overhead from grep output density
 *
 * And Meta Context Engineering (MCE) paper (Jan 2026):
 * - Context should be treated as a first-class optimization target
 * - Flexible files/code representations beat rigid schemas
 */

export type ModelTier = "frontier" | "mid" | "open-source" | "unknown"

// Known model patterns for tier classification
const FRONTIER_PATTERNS = [
  /claude-(opus|sonnet)-[4-9]/i,
  /gpt-4o/i,
  /gpt-4-turbo/i,
  /gemini.*(pro|ultra|2\.5)/i,
  /o[1-9]-/i,  // o1, o3, etc.
]

const MID_PATTERNS = [
  /claude-(haiku|sonnet)-3/i,
  /gpt-4-mini/i,
  /gpt-3\.5/i,
  /gemini.*(flash)/i,
]

const OSS_PATTERNS = [
  /llama/i,
  /mistral/i,
  /devstral/i,
  /gemma/i,
  /qwen/i,
  /phi/i,
  /deepseek/i,
  /codestral/i,
]

/**
 * Classify a model into a capability tier.
 */
export function classifyModelTier(modelId: string): ModelTier {
  for (const pattern of FRONTIER_PATTERNS) {
    if (pattern.test(modelId)) return "frontier"
  }
  for (const pattern of MID_PATTERNS) {
    if (pattern.test(modelId)) return "mid"
  }
  for (const pattern of OSS_PATTERNS) {
    if (pattern.test(modelId)) return "open-source"
  }
  return "unknown"
}

/**
 * Get recommended parameters based on model tier.
 *
 * Structured CE findings applied:
 * - Frontier: can handle more context, file-based retrieval beneficial
 * - Mid: moderate context, standard approach
 * - OSS: less context, inline preferred, format-sensitive
 */
export function getRecommendedParams(tier: ModelTier): ContextParams {
  switch (tier) {
    case "frontier":
      return {
        temperature: 0,
        maxContextTokens: 128_000,
        preferFileContext: true,
        aggressiveTruncation: false,
        systemPromptBudget: 8_000,
      }
    case "mid":
      return {
        temperature: 0,
        maxContextTokens: 64_000,
        preferFileContext: true,
        aggressiveTruncation: false,
        systemPromptBudget: 4_000,
      }
    case "open-source":
      return {
        temperature: 0,
        maxContextTokens: 16_000,
        preferFileContext: false,  // paper: mixed/negative for OSS
        aggressiveTruncation: true,
        systemPromptBudget: 2_000,
      }
    default:
      return {
        temperature: 0,
        maxContextTokens: 64_000,
        preferFileContext: true,
        aggressiveTruncation: false,
        systemPromptBudget: 4_000,
      }
  }
}

/**
 * Estimate token count from text (rough: 1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Truncate system context to fit within budget for the model tier.
 * Preserves the most important sections (first and last).
 */
export function truncateContext(
  sections: string[],
  maxTokens: number,
): string[] {
  let total = 0
  const result: string[] = []

  for (const section of sections) {
    const tokens = estimateTokens(section)
    if (total + tokens > maxTokens) {
      // Try to fit a truncated version
      const remaining = maxTokens - total
      if (remaining > 100) {
        const chars = remaining * 4
        result.push(section.slice(0, chars) + "\n... [truncated for model context budget]")
      }
      break
    }
    result.push(section)
    total += tokens
  }

  return result
}

export interface ContextParams {
  temperature: number
  maxContextTokens: number
  preferFileContext: boolean
  aggressiveTruncation: boolean
  systemPromptBudget: number
}
