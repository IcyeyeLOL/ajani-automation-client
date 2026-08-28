export function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

export function relativeGrowth(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : null;
}

export function weightedRate(points: Array<{ numerator: number; denominator: number }>) {
  const totals = points.reduce((sum, point) => ({ numerator: sum.numerator + point.numerator, denominator: sum.denominator + point.denominator }), { numerator: 0, denominator: 0 });
  return safeRate(totals.numerator, totals.denominator);
}

export function relativeLift(rateA: number | null, rateB: number | null) {
  return rateA !== null && rateB !== null && rateB > 0 ? (rateA - rateB) / rateB : null;
}

export function twoProportionZScore(successA: number, totalA: number, successB: number, totalB: number) {
  if (totalA <= 0 || totalB <= 0) return null;
  const pooled = (successA + successB) / (totalA + totalB);
  const standardError = Math.sqrt(pooled * (1 - pooled) * ((1 / totalA) + (1 / totalB)));
  if (standardError === 0) return null;
  return ((successA / totalA) - (successB / totalB)) / standardError;
}

export function hasAdequateProportionSample(successes: number, total: number) {
  return successes >= 5 && total - successes >= 5;
}

// Two-sided 95% family-wise thresholds using a Bonferroni correction across
// every pair of variants. Experiment creation currently caps variants at eight.
export function multipleComparisonCriticalZ(variantCount: number) {
  const thresholds = [1.96, 1.96, 1.96, 2.394, 2.638, 2.807, 2.935, 3.038, 3.124];
  return thresholds[Math.min(8, Math.max(2, Math.trunc(variantCount)))] ?? 3.124;
}
