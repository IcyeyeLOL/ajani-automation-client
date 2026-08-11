import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { buildHistory } from "@/lib/portal/mock-data";

export const dynamic = "force-dynamic";

export default async function BuildsPage() {
  if (hasClerkCredentials()) await auth.protect();

  return <section className="build-history-page"><Link href="/portal" className="back-link">← BACK TO PORTAL</Link><p className="eyebrow">BUILD HISTORY</p><h1>Every system you asked Ajani to <em>hold.</em></h1><div className="build-history-table">{buildHistory.map((build, index) => <article key={build.title}><span>0{index + 1}</span><div><b>{build.title}</b><small>{build.updated}</small></div><em className={build.status}>{build.status.replace("_", " ")}</em><p>{build.price}</p><Link href="/portal">VIEW →</Link></article>)}</div></section>;
}
