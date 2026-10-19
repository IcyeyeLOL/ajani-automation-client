import type { Metadata } from "next";
import Link from "next/link";
import { AjaniAuthModule } from "@/components/ajani-auth-module";
import { AuthSurface } from "@/components/auth-surface";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { authPageUrl, resolveAuthRedirect } from "@/lib/clerk/redirect";

export const metadata: Metadata = { title: "Create an account | Ajani Automation" };

type SignUpPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const configured = hasClerkCredentials();
  const redirectTo = resolveAuthRedirect((await searchParams).redirect_url);

  return <AuthSurface label="Create an Ajani Automation account">{configured ? <SignedInRedirect to={redirectTo}><AjaniAuthModule mode="sign-up" path="/sign-up" redirectTo={redirectTo} routing="path" /></SignedInRedirect> : <div className="auth-config-card"><b>CLERK IS READY TO CONNECT</b><p>Add the Clerk publishable key and secret key to <code>.env.local</code>, then this screen becomes the live account creation experience.</p><Link href={authPageUrl("/sign-in", redirectTo)}>BACK TO SIGN IN →</Link></div>}</AuthSurface>;
}
