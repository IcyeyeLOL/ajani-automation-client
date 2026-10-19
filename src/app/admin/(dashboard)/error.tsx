"use client";

import { renewSignIn } from "@/lib/admin/fresh-session";

// retry() refreshes the desk's data before rendering again; reset() would only
// re-render what already failed. That refresh is a server fetch an expired
// sign-in token reads as signed out, so renew first.
export default function AdminDashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="admin-error-page">
    <span className="admin-wordmark">AJANI<i>.</i></span>
    <section>
      <p>CONTROL DESK INTERRUPTED</p>
      <h1>The live statistics could not be loaded.</h1>
      <span>Your session is still secure. Retry the data connection without leaving the dashboard.</span>
      <button onClick={() => { void renewSignIn().then(() => retry()); }} type="button">RETRY LIVE DATA <b>→</b></button>
    </section>
  </main>;
}
