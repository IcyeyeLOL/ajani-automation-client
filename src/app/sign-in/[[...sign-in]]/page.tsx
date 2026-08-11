import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { hasClerkCredentials } from "@/lib/clerk/config";

const clerkAppearance = {
  variables: {
    colorPrimary: "#790018",
    colorBackground: "#fbfaf7",
    colorInputBackground: "#ffffff",
    colorInputText: "#171515",
    colorText: "#171515",
    borderRadius: "0.7rem",
    fontFamily: '"Aptos", "Segoe UI Variable", "Trebuchet MS", sans-serif',
  },
};

export default function SignInPage() {
  const configured = hasClerkCredentials();

  return <main className="auth-shell"><Link className="brand" href="/">ajani<i>.</i></Link><section><p className="eyebrow">SAVE YOUR BUILD</p><h1>Sign in to track your <em>systems.</em></h1><p>Your request, build history, billing, and active automations live in one private portal.</p>{configured ? <SignIn appearance={clerkAppearance} fallbackRedirectUrl="/portal" signUpUrl="/sign-up" /> : <div className="auth-config-card"><b>CLERK IS READY TO CONNECT</b><p>Add the Clerk publishable key and secret key to <code>.env.local</code>, then this screen becomes the live sign-in experience.</p><Link href="/sign-up">CREATE YOUR ACCOUNT →</Link></div>}</section></main>;
}
