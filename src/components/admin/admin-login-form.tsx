"use client";

import { useActionState } from "react";
import { unlockAdminAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { withRenewedSignIn } from "@/lib/admin/fresh-session";

// Unlocking checks the Clerk sign-in too, so it renews it first (see fresh-session.ts).
const unlock = withRenewedSignIn(unlockAdminAction);

export function AdminLoginForm({ next = null }: { next?: string | null }) {
  const [state, action, pending] = useActionState(unlock, initialAdminActionState);
  return <form action={action} className="admin-login-form">
    {next ? <input name="next" type="hidden" value={next} /> : null}
    <label htmlFor="admin-access-key">TEAM ACCESS KEY</label>
    <input autoComplete="current-password" autoFocus id="admin-access-key" maxLength={256} name="accessKey" placeholder="Enter the private key" required type="password" />
    {state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : null}
    <button disabled={pending} type="submit">{pending ? "VERIFYING ACCESS" : "OPEN CONTROL DESK"}<span>→</span></button>
  </form>;
}
