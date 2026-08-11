import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { hasClerkCredentials } from "@/lib/clerk/config";

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  const configured = hasClerkCredentials();

  return <div className="portal-shell"><aside className="portal-rail"><Link className="brand" href="/">ajani<i>.</i></Link><p>CLIENT PORTAL</p><nav><Link href="/portal">Overview</Link><Link href="/portal/builds">Build history</Link><Link href="/request">Request a build</Link></nav>{configured ? <div className="portal-user-menu"><UserButton /><span>ACCOUNT MENU</span></div> : <span>DEMO ACCOUNT<br />NORTHLINE STUDIO</span>}</aside><main className="portal-main">{children}</main></div>;
}
