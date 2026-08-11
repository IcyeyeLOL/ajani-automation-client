import { DemoGrid } from "@/components/demo-grid";
import { SiteHeader } from "@/components/site-header";

export default function DemosPage() {
  return (
    <main className="marketing-shell">
      <SiteHeader />
      <section className="page-intro">
        <div>
          <p className="eyebrow">DEMO DESK / THREE COMMON GAPS</p>
          <h1>See the system before you ask it to hold your <em>business together.</em></h1>
        </div>
        <p className="lede">Step into a live automation and watch the signal, decisions, and handoff unfold in real time.</p>
      </section>
      <DemoGrid />
    </main>
  );
}
