import type { Metadata } from "next";
import Link from "next/link";
import { AjaniAuthModule } from "@/components/ajani-auth-module";
import { AuthSurface } from "@/components/auth-surface";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { authPageUrl, resolveAuthRedirect } from "@/lib/clerk/redirect";

export const metadata: Metadata = { title: "Sign in | Ajani Automation" };

type SignInPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const configured = hasClerkCredentials();
  const redirectTo = resolveAuthRedirect((await searchParams).redirect_url);

  return <AuthSurface label="Sign in to Ajani Automation">{configured ? <SignedInRedirect to={redirectTo}><AjaniAuthModule mode="sign-in" path="/sign-in" redirectTo={redirectTo} routing="path" /></SignedInRedirect> : <div className="auth-config-card"><b>CLERK IS READY TO CONNECT</b><p>Add the Clerk publishable key and secret key to <code>.env.local</code>, then this screen becomes the live sign-in experience.</p><Link href={authPageUrl("/sign-up", redirectTo)}>CREATE YOUR ACCOUNT →</Link></div>}</AuthSurface>;
}
