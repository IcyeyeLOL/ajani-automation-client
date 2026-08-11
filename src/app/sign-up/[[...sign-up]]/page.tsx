import { SignUp } from "@clerk/nextjs";
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

export default function SignUpPage() {
  const configured = hasClerkCredentials();

  return <main className="auth-shell"><Link className="brand" href="/">ajani<i>.</i></Link><section><p className="eyebrow">PRIVATE BUILD DESK</p><h1>Create your Ajani <em>account.</em></h1><p>Keep your approved systems, active automation health, and billing details in one secure place.</p>{configured ? <SignUp appearance={clerkAppearance} fallbackRedirectUrl="/portal" signInUrl="/sign-in" /> : <div className="auth-config-card"><b>CLERK IS READY TO CONNECT</b><p>Add the Clerk publishable key and secret key to <code>.env.local</code>, then this screen becomes the live account creation experience.</p><Link href="/sign-in">BACK TO SIGN IN →</Link></div>}</section></main>;
}
