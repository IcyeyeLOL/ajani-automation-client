import Link from "next/link";
import { MotionReveal } from "@/components/motion-reveal";
import { SiteHeader } from "@/components/site-header";

const systems = [
  ["01", "Lead response", "Reply while intent is still alive."],
  ["02", "Client handoff", "Keep the right context attached to the work."],
  ["03", "Returning clients", "Make follow-up feel timely and considered."],
];

export default function Home() {
  return (
    <main className="marketing-shell">
      <SiteHeader />
      <section className="hero-grid">
        <MotionReveal as="div" className="hero-copy">
          <p className="eyebrow">AUTOMATION, MADE PERSONAL</p>
          <h1>
            Make the work move before it needs <em>your memory.</em>
          </h1>
          <p className="lede">
            Ajani designs the operational systems that keep good leads, client
            handoffs, and repeat work from quietly slipping through the cracks.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/request">
              REQUEST A BUILD <span>→</span>
            </Link>
            <Link className="button button-quiet" href="/demos">
              VIEW DEMOS
            </Link>
          </div>
        </MotionReveal>

        <MotionReveal as="aside" className="operations-panel home-operations" delay={120}>
          <div className="operations-head">
            <span>AJANI / OPERATIONS DESK</span>
            <span className="live-dot">LISTENING</span>
          </div>
          <div className="operations-list">
            {systems.map(([number, title, description]) => (
              <div className="operations-item" key={number}>
                <span>{number}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </div>
                <i>ROUTE</i>
              </div>
            ))}
          </div>
          <div className="operations-result">
            <span>WHAT AJANI BUILDS</span>
            <strong>The handoff your business should have had all along.</strong>
          </div>
        </MotionReveal>
      </section>

      <section className="proof-grid">
        <MotionReveal as="article" className="proof-intro">
          <div className="proof-intro-copy">
            <p className="eyebrow">NOT ANOTHER SOFTWARE LAYER</p>
            <h2>We make the work behind your business feel less dependent on you.</h2>
          </div>
          <div className="proof-intro-route">
            <span>WHAT A USEFUL SYSTEM HOLDS</span>
            <div aria-label="Signal, context, and follow-through">
              <b>SIGNAL</b><i>→</i><b>CONTEXT</b><i>→</i><b>FOLLOW-THROUGH</b>
            </div>
            <small>The detail needed for good work stays with the work.</small>
          </div>
        </MotionReveal>
        {systems.map(([number, title, description], index) => (
          <MotionReveal as="article" className="proof-card" delay={index * 90} key={number}>
            <div className="proof-card-head">
              <p>{title.toUpperCase()}</p>
              <span>{number}</span>
            </div>
            <h3>{description}</h3>
            <small className="proof-route">
              <span>UNDERSTAND</span><i>→</i><span>ROUTE</span><i>→</i><span>RESOLVE</span>
            </small>
          </MotionReveal>
        ))}
      </section>
    </main>
  );
}
