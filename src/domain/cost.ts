export interface TokenUsage {
  input: number;
  output: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output };
}

export interface PricePerMillionTokens {
  input: number;
  output: number;
}

export interface Cost {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export function computeCost(usage: TokenUsage, price: PricePerMillionTokens): Cost {
  const usd = (usage.input / 1_000_000) * price.input + (usage.output / 1_000_000) * price.output;

  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    usd: Number(usd.toFixed(6)),
  };
}
