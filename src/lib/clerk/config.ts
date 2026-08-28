type ClerkEnvironment = Partial<Record<
  "CLERK_SECRET_KEY" | "NEXT_PHASE" | "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" | "NODE_ENV" | "VERCEL_ENV",
  string
>>;

export function hasClerkCredentials(
  environment: ClerkEnvironment = process.env as ClerkEnvironment,
) {
  const hasPair = Boolean(
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
      && environment.CLERK_SECRET_KEY?.trim(),
  );

  if (!hasPair) return false;
  if (!requiresProductionClerkCredentials(environment)) return true;
  return hasLiveClerkCredentials(environment);
}

export function shouldFailClosedForClerk(
  environment: ClerkEnvironment = process.env as ClerkEnvironment,
) {
  return requiresProductionClerkCredentials(environment)
    && !hasLiveClerkCredentials(environment);
}

function requiresProductionClerkCredentials(environment: ClerkEnvironment) {
  if (environment.VERCEL_ENV) return environment.VERCEL_ENV === "production";
  if (environment.NEXT_PHASE === "phase-production-build") return false;
  return environment.NODE_ENV === "production";
}

function hasLiveClerkCredentials(environment: ClerkEnvironment) {
  return Boolean(
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim().startsWith("pk_live_")
      && environment.CLERK_SECRET_KEY?.trim().startsWith("sk_live_"),
  );
}
