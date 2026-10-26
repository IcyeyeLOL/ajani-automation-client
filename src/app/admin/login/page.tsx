import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { ResumeOpenDesk } from "@/components/admin/resume-open-desk";
import { requireAdminClerkUser } from "@/lib/admin/clerk";
import { adminReturnPath } from "@/lib/admin/return-path";
import { getAdminConfiguration, hasAdminSession } from "@/lib/admin/session";
import "../admin.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team Access | Ajani Control Desk", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  // ?next= is where an email's desk link was headed; only desk build pages are allowed.
  const next = adminReturnPath((await searchParams).next);
  const here = next ? `/admin/login?next=${encodeURIComponent(next)}` : "/admin/login";
  await requireAdminClerkUser(here);
  if (await hasAdminSession()) redirect(next ?? "/admin");
  const configured = Boolean(getAdminConfiguration());
  return <main className="admin-login-page">
    <section className="admin-login-brand">
      <Link href="/" className="admin-wordmark">AJANI<i>.</i></Link>
      <div>
        <p>INTERNAL OPERATIONS / RESTRICTED</p>
        <h1>The business, held in one <em>control desk.</em></h1>
        <span>Website demand, outreach, experiments, delivery, and system health stay visible without exposing client data to the public site.</span>
      </div>
      <footer><b>SERVER VERIFIED</b><b>HTTP-ONLY SESSION</b><b>AUDITED WRITES</b></footer>
    </section>
    <section className="admin-login-panel">
      <div className="admin-security-mark"><span /><span /><b>01</b></div>
      <p className="admin-kicker">AJANI TEAM ACCESS</p>
      <h2>Enter the operations key.</h2>
      <p>Your Clerk identity has been verified. The operations key is checked on the server and never stored in the browser.</p>
      {next ? <ResumeOpenDesk next={next} /> : null}
      {configured ? <AdminLoginForm next={next} /> : <div className="admin-config-warning"><b>ADMIN ACCESS IS NOT CONFIGURED</b><span>Add the two private admin environment values before this desk can be opened.</span></div>}
      <small>Clerk sign-in and the team key are both required. Failed attempts are rate-limited, and desk sessions expire after eight hours.</small>
    </section>
  </main>;
}
