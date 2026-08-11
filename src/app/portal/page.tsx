import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { activeSystems, buildHistory } from "@/lib/portal/mock-data";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const configured = hasClerkCredentials();
  if (configured) await auth.protect();
  const user = configured ? await currentUser() : null;
  const name = user?.fullName || user?.firstName || "Marcus Stone";
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return <><header className="portal-top"><div><span>ACCOUNT / NORTHLINE STUDIO</span><h1>Your systems are <em>holding.</em></h1></div><div className="account-chip"><i>{initials}</i><span>{name}</span></div></header><section className="portal-summary"><article><span>ACTIVE SYSTEMS</span><strong>03</strong><small>Two healthy, one needs a decision</small></article><article><span>MONTHLY AUTOMATION VALUE</span><strong>247</strong><small>leads processed this month</small></article><article><span>YOUR CURRENT RETAINER</span><strong>$350</strong><small>monthly, billed on the 1st</small></article><Link href="/request">REQUEST A BUILD <b>→</b></Link></section><section className="portal-section"><header><div><span>ACTIVE AUTOMATIONS</span><h2>What is running now.</h2></div><Link href="/portal/builds">VIEW BUILD HISTORY →</Link></header><div className="automation-list">{activeSystems.map((system) => <article key={system.name}><div><i className={system.health} /><span>{system.health.toUpperCase()}</span></div><h3>{system.name}</h3><strong>{system.metric}</strong><p>{system.detail}</p><footer>{system.lastRun}</footer></article>)}</div></section><section className="portal-section history-section"><header><div><span>BUILD HISTORY</span><h2>Every request, in one place.</h2></div></header><div className="history-list">{buildHistory.map((build) => <article key={build.title}><div><b>{build.title}</b><span>{build.updated}</span></div><em className={build.status}>{build.status.replace("_", " ")}</em><p>{build.price}</p></article>)}</div></section></>;
}
