/** Fixed-point CNY arithmetic shared by text usage and versioned media pricing. */

/**
 * Round a nonnegative rational charge to integer micro-yuan.
 * @param numerator Fixed-point amount numerator.
 * @param denominator Positive quantity divisor.
 * @param rounding Snapshot-selected accounting convention.
 * @returns Safe integer micro-yuan.
 */
export function roundMicrosCny(numerator: bigint, denominator: bigint, rounding: 'nearest' | 'up'): number {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid nonnegative CNY charge')
  const amount = (numerator + (rounding === 'up' ? denominator - 1n : denominator / 2n)) / denominator
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw Object.assign(new Error('Calculated model usage cost is outside the supported range'), { code: 'ERR_MODEL_USAGE_COST_RANGE' })
  return Number(amount)
}

/**
 * Public text price measures, expressed in micro-yuan per million tokens.
 * @param model Platform text pricing fields.
 * @returns Public prices and settlement denominators.
 */
export function textPriceDescriptor(model: {
  inputPriceMicrosCnyPerMillion: number
  cachedInputPriceMicrosCnyPerMillion: number
  outputPriceMicrosCnyPerMillion: number
}) {
  return {
    prices: { uncached_input_tokens: String(model.inputPriceMicrosCnyPerMillion),
      cached_input_tokens: String(model.cachedInputPriceMicrosCnyPerMillion), output_tokens: String(model.outputPriceMicrosCnyPerMillion) },
    settlementUnits: { uncached_input_tokens: 'token_million', cached_input_tokens: 'token_million', output_tokens: 'token_million' },
  }
}
