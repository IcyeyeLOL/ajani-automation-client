type ProviderEnvironment = {
  AI_PRIMARY_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
};

export function shouldPreferDirectAnthropic(environment: ProviderEnvironment) {
  const hasDirectAnthropicKey = Boolean(environment.ANTHROPIC_API_KEY?.trim());
  const directProviderSelected = environment.AI_PRIMARY_PROVIDER?.trim().toLowerCase() === "anthropic";

  return hasDirectAnthropicKey && directProviderSelected;
}
