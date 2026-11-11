import type { Metadata } from "next";
import { MotionReveal } from "@/components/motion-reveal";
import { SiteFoot, SiteTop } from "@/components/site/chrome";

// Nothing links here yet and the copy is still a working draft, so search
// engines are asked to leave it out.
export const metadata: Metadata = {
  title: "Our approach · Ajani Automation",
  description: "How Ajani makes sure a business problem is understood before any automation is built.",
  robots: { index: false, follow: false },
};

const stages = [
  ["01 / LISTEN", "Start where the work gets heavy.", "A voice brief makes room for the real version of the problem."],
  ["02 / CLARIFY", "Ask only the question that changes the route.", "Context stays visible, so the next question proves Ajani is paying attention."],
  ["03 / REFLECT", "Make the hidden system plain.", "The visitor sees their vague idea become a coherent handoff."],
  ["04 / BUILD", "Define the work before the price appears.", "Scope, delivery, and boundaries stay visible together."],
];

export default function ApproachPage() {
  return (
    <div className="marketing-shell">
      <SiteTop active="approach" />
      <main id="main-content" tabIndex={-1}>
        <section className="page-intro"><MotionReveal as="div"><p className="eyebrow">THE AJANI METHOD</p><h1>No automation until the business problem is <em>actually understood.</em></h1></MotionReveal><MotionReveal as="div" delay={110}><p className="lede">The point is not to add software. The point is to return a business to the right operational rhythm.</p></MotionReveal></section>
        <section className="approach-grid">
          <MotionReveal as="aside"><p className="eyebrow">A TRUST-FIRST BUILD</p><h2>Every stage should either capture the client&apos;s words or return them in clearer operational form.</h2><div aria-hidden="true" className="method-signal"><span /><span /><span /><span /></div></MotionReveal>
          <div className="approach-cards">{stages.map(([number, title, copy], index) => <MotionReveal as="article" delay={index * 90} key={number}><p>{number}</p><h3>{title}</h3><span>{copy}</span></MotionReveal>)}</div>
        </section>
      </main>
      <SiteFoot />
    </div>
  );
}
