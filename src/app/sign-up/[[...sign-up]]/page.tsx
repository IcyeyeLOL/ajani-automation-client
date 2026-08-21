import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { AuthSurface } from "@/components/auth-surface";
import { ajaniClerkAppearance } from "@/lib/clerk/appearance";
import { hasClerkCredentials } from "@/lib/clerk/config";

export default function SignUpPage() {
  const configured = hasClerkCredentials();

  return <AuthSurface label="Create an Ajani Automation account">{configured ? <SignUp appearance={ajaniClerkAppearance} fallbackRedirectUrl="/portal" path="/sign-up" routing="path" signInUrl="/sign-in" /> : <div className="auth-config-card"><b>CLERK IS READY TO CONNECT</b><p>Add the Clerk publishable key and secret key to <code>.env.local</code>, then this screen becomes the live account creation experience.</p><Link href="/sign-in">BACK TO SIGN IN →</Link></div>}</AuthSurface>;
}
