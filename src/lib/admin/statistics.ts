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
