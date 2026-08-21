"use client";

export default function AdminDashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="admin-error-page">
    <span className="admin-wordmark">AJANI<i>.</i></span>
    <section>
      <p>CONTROL DESK INTERRUPTED</p>
      <h1>The live statistics could not be loaded.</h1>
      <span>Your session is still secure. Retry the data connection without leaving the dashboard.</span>
      <button onClick={reset} type="button">RETRY LIVE DATA <b>→</b></button>
    </section>
  </main>;
}
