import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { AuthSurface } from "@/components/auth-surface";
import { ajaniClerkAppearance } from "@/lib/clerk/appearance";
import { hasClerkCredentials } from "@/lib/clerk/config";

export default function SignInPage() {
  const configured = hasClerkCredentials();

  return <AuthSurface label="Sign in to Ajani Automation">{configured ? <SignIn appearance={ajaniClerkAppearance} fallbackRedirectUrl="/portal" path="/sign-in" routing="path" signUpUrl="/sign-up" /> : <div className="auth-config-card"><b>CLERK IS READY TO CONNECT</b><p>Add the Clerk publishable key and secret key to <code>.env.local</code>, then this screen becomes the live sign-in experience.</p><Link href="/sign-up">CREATE YOUR ACCOUNT →</Link></div>}</AuthSurface>;
}
