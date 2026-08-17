import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/home/reveal";
import { VoiceRecorder } from "@/components/home/voice-recorder";
import styles from "./record.module.css";

export const metadata: Metadata = {
  title: "Record a note · Ajani Automation",
  description: "Two minutes about the work that keeps slipping. We turn it into a system.",
};

const covers = [
  { n: "01", title: "What happens today", detail: "Walk through the moment where the work gets stuck." },
  { n: "02", title: "Who is involved", detail: "Name the people, tools, or channels already in the route." },
  { n: "03", title: "What good looks like", detail: "Describe the outcome you want to become normal." },
];

const next = [
  { when: "Within a day", title: "We listen and ask one question", detail: "Only the detail that changes the shape of the system." },
  { when: "Around day three", title: "You see the system and the price", detail: "In plain language, before any work starts." },
  { when: "Day seven to ten", title: "It goes live", detail: "Running in your real channels, then tuned for a month." },
];

export default function RecordPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/">ajani<i>.</i></Link>
          <Link className={styles.back} href="/">← Back to home</Link>
        </div>
      </header>

      <section className={styles.stage}>
        <div className={styles.stageInner}>
          <Reveal className={styles.intro}>
            <p className={styles.label}>Step one of one</p>
            <h1>Start with the work as it <em>actually happens.</em></h1>
            <p className={styles.lede}>
              Speak naturally for a minute or two. You do not need to know what the
              automation should be — that is the part we work out. Nothing is charged,
              and no account is needed to send this.
            </p>
            <ul className={styles.covers}>
              {covers.map((cover) => (
                <li key={cover.n}>
                  <b>{cover.n}</b>
                  <div>
                    <strong>{cover.title}</strong>
                    <span>{cover.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.reassure}>
              Would rather type it? <Link href="/portal">Send it in writing instead.</Link>
            </p>
          </Reveal>

          <Reveal className={styles.recorderColumn} delay={130}>
            <VoiceRecorder id="record" />
          </Reveal>
        </div>
      </section>

      <section className={styles.after}>
        <div className={styles.afterInner}>
          <Reveal as="p" className={styles.label}>What happens after you send it</Reveal>
          <div className={styles.timeline}>
            {next.map((step, index) => (
              <Reveal as="article" delay={index * 90} key={step.title}>
                <p className={styles.when}>{step.when}</p>
                <h2>{step.title}</h2>
                <p>{step.detail}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} Ajani Automation</span>
          <div className={styles.footerLinks}>
            <Link href="/">Home</Link>
            <Link href="/stories">Stories</Link>
            <Link href="/portal">Client portal</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
