const highRiskPatterns = [
  /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/i,
  /\b(?:password|passcode|api[ _-]?key|access[ _-]?token|secret)[\s:=]+\S+/i,
  /\b(?:card number|credit card|debit card|cvv|cvc)[\s:=#-]*\d/i,
  /\b(?:medical record|patient id|member id|insurance id|diagnos(?:is|ed)|prescription|protected health information|\bphi\b)\b/i,
  /\b(?:passport|driver'?s license|national id|government id)[\s:=#-]+[a-z0-9-]{4,}\b/i,
  /\b(?:fingerprint|faceprint|voiceprint|biometric template)\b/i,
] as const;

export function containsHighRiskSensitiveInput(input: unknown) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return highRiskPatterns.some((pattern) => pattern.test(text));
}
