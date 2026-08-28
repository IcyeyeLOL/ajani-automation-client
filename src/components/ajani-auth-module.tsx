"use client";

import { SignIn, SignUp, useSignIn, useSignUp } from "@clerk/nextjs";
import { useState } from "react";
import { ajaniClerkAppearance } from "@/lib/clerk/appearance";
import { authPageUrl } from "@/lib/clerk/redirect";

type AuthMode = "sign-in" | "sign-up";
type OAuthProvider = "google" | "github";

type AjaniAuthModuleProps = {
  mode: AuthMode;
  redirectTo: string;
  path?: string;
  routing?: "hash" | "path";
};

function GoogleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.33 2.98-7.42Z" fill="#4285F4" />
    <path d="M12 22c2.7 0 4.98-.9 6.63-2.35l-3.24-2.55c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.63A10 10 0 0 0 12 22Z" fill="#34A853" />
    <path d="M6.39 13.93A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.44H3.04A10 10 0 0 0 2 12c0 1.64.39 3.19 1.04 4.56l3.35-2.63Z" fill="#FBBC05" />
    <path d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.44l3.35 2.63C7.18 7.7 9.39 5.94 12 5.94Z" fill="#EA4335" />
  </svg>;
}

function GitHubIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.54 9.54 0 0 1 12 6.83c.85 0 1.69.11 2.48.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" fill="currentColor" />
  </svg>;
}

function clerkErrorMessage(error: unknown, provider: OAuthProvider) {
  if (typeof error !== "object" || error === null) return "We could not start that sign-in. Please try again.";

  const maybeError = error as { errors?: Array<{ longMessage?: string; message?: string }> };
  const message = maybeError.errors?.[0]?.longMessage ?? maybeError.errors?.[0]?.message;

  if (provider === "github" && message?.includes("allowed values for parameter strategy")) {
    return "GitHub sign-in is not available yet. Please use Google or email for now.";
  }

  return message ?? "We could not start that sign-in. Please try again.";
}

export function AjaniAuthModule({ mode, redirectTo, path, routing = "hash" }: AjaniAuthModuleProps) {
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const [activeProvider, setActiveProvider] = useState<OAuthProvider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";
  const signInUrl = authPageUrl("/sign-in", redirectTo);
  const signUpUrl = authPageUrl("/sign-up", redirectTo);

  const startOAuth = async (provider: OAuthProvider) => {
    setOauthError(null);
    setActiveProvider(provider);

    try {
      const result = isSignUp ? await signUpState.signUp.sso({
        redirectCallbackUrl: "/sso-callback",
        redirectUrl: redirectTo,
        strategy: `oauth_${provider}`,
      }) : await signInState.signIn.sso({
        redirectCallbackUrl: "/sso-callback",
        redirectUrl: redirectTo,
        strategy: `oauth_${provider}`,
      });

      if (result.error) throw result.error;
    } catch (error) {
      setOauthError(clerkErrorMessage(error, provider));
      setActiveProvider(null);
    }
  };

  return <div className="ajani-auth-module">
    <header className="ajani-auth-module-header">
      <div className="ajani-auth-module-brand"><span>ajani<i>.</i></span><small>PRIVATE WORKSPACE</small></div>
      <h2>{isSignUp ? "Create your workspace." : "Welcome back."}</h2>
      <p>{isSignUp ? "Save your requests, recordings, and systems in one secure place." : "Sign in to record a note and keep your systems moving."}</p>
    </header>

    <div aria-label="Social sign in options" className="ajani-auth-socials">
      <button disabled={activeProvider !== null} onClick={() => startOAuth("google")} type="button">
        <GoogleIcon />
        <span>{activeProvider === "google" ? "Connecting to Google…" : "Continue with Google"}</span>
      </button>
      <button disabled={activeProvider !== null} onClick={() => startOAuth("github")} type="button">
        <GitHubIcon />
        <span>{activeProvider === "github" ? "Connecting to GitHub…" : "Continue with GitHub"}</span>
      </button>
    </div>

    {oauthError ? <p className="ajani-auth-oauth-error" role="alert">{oauthError}</p> : null}
    <div className="ajani-auth-divider"><span>or continue with email address</span></div>

    <div className="clerk-in-request">
      {isSignUp ? routing === "path" ? <SignUp
        appearance={ajaniClerkAppearance}
        fallbackRedirectUrl={redirectTo}
        forceRedirectUrl={redirectTo}
        path={path ?? "/sign-up"}
        routing="path"
        signInUrl={signInUrl}
      /> : <SignUp
        appearance={ajaniClerkAppearance}
        fallbackRedirectUrl={redirectTo}
        forceRedirectUrl={redirectTo}
        routing="hash"
        signInUrl={signInUrl}
      /> : routing === "path" ? <SignIn
        appearance={ajaniClerkAppearance}
        fallbackRedirectUrl={redirectTo}
        forceRedirectUrl={redirectTo}
        path={path ?? "/sign-in"}
        routing="path"
        signUpUrl={signUpUrl}
      /> : <SignIn
        appearance={ajaniClerkAppearance}
        fallbackRedirectUrl={redirectTo}
        forceRedirectUrl={redirectTo}
        routing="hash"
        signUpUrl={signUpUrl}
      />}
    </div>
  </div>;
}
