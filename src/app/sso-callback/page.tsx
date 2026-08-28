import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import Link from "next/link";
import { AuthSurface } from "@/components/auth-surface";
import { hasClerkCredentials } from "@/lib/clerk/config";

export default function SsoCallbackPage() {
  const configured = hasClerkCredentials();

  return <AuthSurface label="Finish signing in to Ajani Automation">
    {configured
      ? <AuthenticateWithRedirectCallback />
      : <div className="auth-config-card">
        <b>ACCOUNT ACCESS IS NOT CONFIGURED</b>
        <p>This sign-in callback is available when Clerk is connected.</p>
        <Link href="/">RETURN HOME →</Link>
      </div>}
  </AuthSurface>;
}
