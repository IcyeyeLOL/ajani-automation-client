import Link from "next/link";
import { MotionReveal } from "@/components/motion-reveal";
import { SiteHeader } from "@/components/site-header";
import styles from "./stories.module.css";

const storyShapes: Array<[string, string, string, string[]]> = [
  ["01 / THE SIGNAL", "The lead that would have waited until tomorrow.", "A useful first response goes out while the client still has the question open.", ["IN", "READ", "ROUTE"]],
  ["02 / THE HANDOFF", "The context that arrives before the meeting starts.", "A scattered conversation becomes a concise brief with the one decision the team still needs.", ["GATHER", "CLARIFY", "BRIEF"]],
  ["03 / THE RETURN", "The client moment that does not disappear quietly.", "A relevant change in behavior gives the owner a timely reason to reconnect with care.", ["NOTICE", "NUDGE", "FOLLOW UP"]],
];

export default function StoriesPage() {
  return (
    <main className="marketing-shell">
      <SiteHeader />
      <section className={styles.storyShell}>
        <div className={styles.hero}>
          <MotionReveal as="div">
            <p className="eyebrow">STORIES / WORK THAT HOLDS</p>
            <h1>Proof feels better when it sounds like the <em>work itself.</em></h1>
            <p className={styles.lede}>Not polished case-study theater. These are the small operational moments that a thoughtful system makes easier to see and act on.</p>
          </MotionReveal>
          <MotionReveal as="aside" className={styles.signalCard} delay={130}>
            <span>THE STORY IS IN THE HANDOFF</span>
            <strong>Every useful route leaves a clearer next step behind.</strong>
            <p>See the kind of work Ajani turns into dependable rhythm.</p>
            <i />
          </MotionReveal>
        </div>
        <div className={styles.storyIntro}>
          <MotionReveal as="div"><p className="eyebrow">THREE MOMENTS / ONE OPERATING RHYTHM</p><h2>Systems worth keeping are felt in the space between a signal and a response.</h2></MotionReveal>
          <MotionReveal as="div" delay={100}><p>Each story is a visual sketch of the work before client-specific case studies are ready to share.</p></MotionReveal>
        </div>
        <div className={styles.storyList}>
          {storyShapes.map(([number, title, copy, route], index) => <MotionReveal as="article" className={styles.storyCard} delay={index * 100} key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
            <div aria-label={`${title} route`} className={styles.route}>{route.map((step) => <span key={step}>{step}</span>)}</div>
          </MotionReveal>)}
        </div>
        <MotionReveal as="section" className={styles.closing}>
          <div><p className="eyebrow">YOUR OPERATIONS / NEXT STORY</p><h2>The most convincing proof is a business that feels less dependent on <em>memory.</em></h2></div>
          <Link href="/request">TELL US WHERE WORK STICKS <span>→</span></Link>
        </MotionReveal>
      </section>
    </main>
  );
}
