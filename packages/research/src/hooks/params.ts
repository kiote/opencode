import { classifyModelTier, getRecommendedParams } from "../context/optimizer.js"
import type { ResolvedConfig } from "../config.js"

/**
 * chat.params hook — model-tier-aware parameter tuning.
 *
 * Per Structured CE paper: model capability is the dominant factor.
 * We detect the model tier and adjust parameters accordingly.
 */
export function createParamsHook(config: ResolvedConfig) {
  return async (
    input: { sessionID: string; agent: string; model: any; provider: any; message: any },
    output: { temperature: number; topP: number; topK: number; maxOutputTokens: number | undefined; options: Record<string, any> },
  ) => {
    if (!config.context.modelTierDetection) return

    const modelId = input.model?.id ?? input.model?.modelID ?? ""
    const tier = classifyModelTier(modelId)

    if (tier === "unknown") return

    const recommended = getRecommendedParams(tier)

    // Only override if the current value is default (0 or undefined)
    // Don't override user-specified values
    if (output.temperature === 0 || output.temperature === undefined) {
      output.temperature = recommended.temperature
    }

    // Store tier info in options for downstream hooks to use
    output.options["research:modelTier"] = tier
    output.options["research:preferFileContext"] = recommended.preferFileContext
    output.options["research:systemPromptBudget"] = recommended.systemPromptBudget

    console.log(`[research:context] Model ${modelId} → tier: ${tier}`)
  }
}
