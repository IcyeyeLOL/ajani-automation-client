"use client";

import Link from "next/link";
import { type DragEvent, type ReactNode, useState } from "react";
import { useAccountAccess } from "@/components/account-access-dialog";
import { VoiceRecorder } from "@/components/home/voice-recorder";
import type { SystemBlock } from "@/lib/domain/types";
import { saveWebsiteRequestDraft } from "@/lib/request-drafts/client";
import styles from "./record-flow.module.css";

const stages = ["Your note", "One question", "The system", "Review", "Send"];

const initialBlocks: SystemBlock[] = [
  { id: "trigger", kind: "trigger", title: "A message arrives", detail: "An enquiry lands in your inbox, website form, or socials." },
  { id: "reply", kind: "reply", title: "Send the first reply", detail: "Answer the obvious question in your own tone, straight away." },
  { id: "qualify", kind: "qualify", title: "Ask the one question", detail: "The detail that decides the price, the timing, or the fit." },
  { id: "handoff", kind: "handoff", title: "Hand it to a person", detail: "You get the thread and the next action, already written down." },
];

const covers = [
  { n: "01", title: "What happens today", detail: "Walk through the moment where the work gets stuck." },
  { n: "02", title: "Who is involved", detail: "Name the people, tools, or channels already in the route." },
  { n: "03", title: "What good looks like", detail: "Describe the outcome you want to become normal." },
];

const answers = [
  "When they ask about price or availability",
  "When they give a real date or budget",
  "I want to see every thread myself",
];

const scope = ["Intake from your real channels", "The reply and the question", "Handoff into your inbox", "30 days of tuning after launch"];

const next = [
  { when: "Now", title: "Your request arrives", detail: "The note and the route you approved land on the build desk together." },
  { when: "1 day", title: "We check the plan", detail: "Tools, access, and the boundaries of what it is allowed to do." },
  { when: "3 days", title: "First working route", detail: "You see the logic running against your own channels." },
  { when: "7–10 days", title: "Live, then tuned", detail: "It goes live, and we adjust it for a month afterwards." },
];

function move(items: SystemBlock[], id: string, direction: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RecordFlow() {
  const { openAccountAccess } = useAccountAccess();
  const [stage, setStage] = useState(0);
  const [reached, setReached] = useState(0);

  const [capture, setCapture] = useState<{ seconds: number; bytes: number } | null>(null);
  const [written, setWritten] = useState("");
  const [typing, setTyping] = useState(false);
  const [answer, setAnswer] = useState("");
  const [blocks, setBlocks] = useState(initialBlocks);
  const [dragged, setDragged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const noteReady = capture !== null || written.trim().length > 20;

  const go = (index: number) => {
    const target = Math.max(0, Math.min(index, stages.length - 1));
    setStage(target);
    setReached((high) => Math.max(high, target));
  };

  const updateBlock = (id: string, field: "title" | "detail", value: string) => {
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, [field]: value } : block)));
  };

  const drop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (!dragged || dragged === targetId) return;
    setBlocks((current) => {
      const item = current.find((block) => block.id === dragged);
      if (!item) return current;
      const rest = current.filter((block) => block.id !== dragged);
      const at = rest.findIndex((block) => block.id === targetId);
      return [...rest.slice(0, at), item, ...rest.slice(at)];
    });
    setDragged(null);
  };

  const sendRequest = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    try {
      const firstStep = blocks[0]?.title ?? "Your request";
      const finalStep = blocks.at(-1)?.title ?? "handoff";
      await saveWebsiteRequestDraft({
        title: `${firstStep} → ${finalStep}`.slice(0, 120),
        transcript: written.trim(),
        clarificationAnswer: answer.trim(),
        systemBlocks: blocks,
        voiceMemo: capture ? { durationSeconds: capture.seconds, byteLength: capture.bytes } : null,
      });
      openAccountAccess("request");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Your request could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.flow}>
      <nav aria-label="Build request stages" className={styles.steps}>
        <ol>
          {stages.map((name, index) => {
            const state = index === stage ? "current" : index <= reached ? "done" : "locked";
            return (
              <li data-rail={index < reached ? "on" : "off"} data-state={state} key={name}>
                <button
                  aria-current={index === stage ? "step" : undefined}
                  disabled={index > reached}
                  onClick={() => go(index)}
                  type="button"
                >
                  <i aria-hidden="true" />
                  <span>0{index + 1}</span>
                  <b>{name}</b>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {stage === 0 ? (
        <Stage
          copy="Speak naturally for a minute or two. You do not need to know what the automation should be — that is the part we work out."
          eyebrow="01 / Your voice note"
          key="s0"
          title={<>Start with the work as it <em>actually happens.</em></>}
        >
          <div className={styles.split}>
            <div>
              <VoiceRecorder embedded id="record" onCaptured={setCapture} />
              <div className={styles.fallback}>
                <button aria-expanded={typing} onClick={() => setTyping((open) => !open)} type="button">
                  {typing ? "Hide the written version" : "Rather type it than say it?"}
                </button>
                {typing ? (
                  <textarea
                    aria-label="Describe the work in writing"
                    onChange={(event) => setWritten(event.target.value)}
                    placeholder="Describe the moment that keeps slipping, in your own words…"
                    rows={5}
                    value={written}
                  />
                ) : null}
              </div>
            </div>

            <aside className={styles.guide}>
              <p className={styles.label}>A useful note covers</p>
              <ol>
                {covers.map((cover) => (
                  <li key={cover.n}>
                    <b>{cover.n}</b>
                    <div>
                      <strong>{cover.title}</strong>
                      <span>{cover.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className={styles.callout}>The note is source material, not a test. Rambling is fine.</p>
            </aside>
          </div>

          <Actions
            hint={noteReady ? undefined : "Record a note, or type it, to continue"}
            onPrimary={() => go(1)}
            primary="Continue"
            primaryDisabled={!noteReady}
          />
        </Stage>
      ) : null}

      {stage === 1 ? (
        <Stage
          copy="Your note stays attached to everything that follows. We ask for the one detail that changes the shape of the system."
          eyebrow="02 / One question"
          key="s1"
          title={<>One question, not a <em>questionnaire.</em></>}
        >
          <div className={styles.split}>
            <aside className={styles.noteCard}>
              <p className={styles.label}>What you sent</p>
              {capture ? (
                <p className={styles.noteMeta}>
                  <b>Voice note</b>
                  <span>{clock(capture.seconds)} · {Math.max(1, Math.round(capture.bytes / 1024))} KB</span>
                </p>
              ) : null}
              {written.trim() ? (
                <blockquote>{written.trim()}</blockquote>
              ) : (
                <p className={styles.noteHint}>
                  Your recording is attached. A person listens to it before anything gets
                  built — nothing here is transcribed automatically.
                </p>
              )}

              <div className={styles.noteTerms}>
                <p className={styles.label}>What happens to it</p>
                <ul>
                  <li>It is attached to this request and nothing else.</li>
                  <li>It is never published, and it is not used as a testimonial.</li>
                  <li>Ask us to delete it at any point and it goes.</li>
                </ul>
              </div>
            </aside>

            <article className={styles.question}>
              <p className={styles.label}>The detail that changes the route</p>
              <h3>When should a message stop being handled automatically and reach a person?</h3>
              <p className={styles.why}>
                It decides whether your team sees every reply, or only the conversations
                that are worth their attention.
              </p>
              <div className={styles.options}>
                {answers.map((option) => (
                  <button
                    aria-pressed={answer === option}
                    key={option}
                    onClick={() => setAnswer(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <textarea
                aria-label="Answer in your own words"
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Or answer in your own words…"
                rows={3}
                value={answer}
              />
            </article>
          </div>

          <Actions
            onPrimary={() => go(2)}
            onSecondary={() => go(0)}
            primary="Save answer"
            primaryDisabled={!answer.trim()}
            secondary="Back to the note"
          />
        </Stage>
      ) : null}

      {stage === 2 ? (
        <Stage
          copy="Edit any step, add one, or change the order. This is a draft of the route, and it is the thing you will approve."
          eyebrow="03 / The system"
          key="s2"
          title={<>Shape the route before we <em>build it.</em></>}
        >
          <div className={styles.editorBar}>
            <span><i aria-hidden="true" />Draft saved as you type</span>
            <div>
              <button
                onClick={() => setBlocks((current) => [...current, {
                  id: `step-${Date.now()}`,
                  kind: "custom",
                  title: "New step",
                  detail: "Describe what should happen here.",
                }])}
                type="button"
              >
                Add a step
              </button>
              <button onClick={() => setBlocks(initialBlocks)} type="button">Reset</button>
            </div>
          </div>

          <ol className={styles.canvas}>
            {blocks.map((block, index) => (
              <li
                draggable
                key={block.id}
                onDragEnd={() => setDragged(null)}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDragged(block.id)}
                onDrop={(event) => drop(event, block.id)}
              >
                <div className={styles.blockTop}>
                  <span className={styles.blockKind}>{block.kind}</span>
                  <b>0{index + 1}</b>
                </div>
                <input
                  aria-label={`Step ${index + 1} title`}
                  onChange={(event) => updateBlock(block.id, "title", event.target.value)}
                  value={block.title}
                />
                <textarea
                  aria-label={`Step ${index + 1} detail`}
                  onChange={(event) => updateBlock(block.id, "detail", event.target.value)}
                  rows={3}
                  value={block.detail}
                />
                <div className={styles.blockActions}>
                  <button
                    aria-label={`Move ${block.title} earlier`}
                    disabled={index === 0}
                    onClick={() => setBlocks((current) => move(current, block.id, -1))}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${block.title} later`}
                    disabled={index === blocks.length - 1}
                    onClick={() => setBlocks((current) => move(current, block.id, 1))}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`Remove ${block.title}`}
                    disabled={blocks.length <= 2}
                    onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.hint}>Drag a step to reorder it, use the arrows, or type straight into it.</p>

          <Actions onPrimary={() => go(3)} onSecondary={() => go(1)} primary="Ready for review" secondary="Back to the question" />
        </Stage>
      ) : null}

      {stage === 3 ? (
        <Stage
          copy="The route, what it protects, and what the build includes — before you ask for anything to be made."
          eyebrow="04 / Review"
          key="s3"
          title={<>This is what the build will <em>actually do.</em></>}
        >
          <div className={styles.split}>
            <article className={styles.review}>
              <header>
                <p className={styles.label}>Your route</p>
                <b>Draft 01</b>
              </header>
              <ol>
                {blocks.map((block, index) => (
                  <li key={block.id}>
                    <b>0{index + 1}</b>
                    <div>
                      <strong>{block.title}</strong>
                      <span>{block.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <footer>
                <p className={styles.label}>What this protects</p>
                <p>
                  Every real enquiry gets a timely answer, and your team only sees the
                  conversations that deserve a person.
                </p>
              </footer>
            </article>

            <aside className={styles.scope}>
              <p className={styles.label}>What a build includes</p>
              <ul>
                {scope.map((item) => (
                  <li key={item}><i aria-hidden="true">✓</i>{item}</li>
                ))}
              </ul>
              <div className={styles.price}>
                <span>Typical build</span>
                <b>$2,400 – $3,800</b>
              </div>
              <small>An estimate, not a quote. The scope and the final price are agreed in writing before any work starts.</small>
            </aside>
          </div>

          <Actions onPrimary={() => go(4)} onSecondary={() => go(2)} primary="Approve this route" secondary="Back to the system" />
        </Stage>
      ) : null}

      {stage === 4 ? (
        <Stage
          copy="Sending this opens a private space for the build, so you can follow it without chasing anyone by email."
          eyebrow="05 / Send"
          key="s4"
          title={<>Everything is clear. <em>Send the request.</em></>}
        >
          <div className={styles.split}>
            <article className={styles.summary}>
              <p className={styles.label}>Ready to send</p>
              <h3>{blocks[0]?.title ?? "Your route"} → {blocks[blocks.length - 1]?.title ?? "handoff"}</h3>
              <dl>
                <div>
                  <dt>Your note</dt>
                  <dd>{capture ? `Voice, ${clock(capture.seconds)}` : "Written"}</dd>
                </div>
                <div>
                  <dt>Route</dt>
                  <dd>{String(blocks.length).padStart(2, "0")} steps approved</dd>
                </div>
                <div>
                  <dt>Build window</dt>
                  <dd>7–10 days</dd>
                </div>
              </dl>
              <p className={styles.summaryFoot}>
                Nothing is charged now. You will see the scope and the price in writing
                before any work begins.
              </p>
            </article>

            <aside className={styles.timeline}>
              <p className={styles.label}>What happens next</p>
              <ol>
                {next.map((step) => (
                  <li key={step.title}>
                    <b>{step.when}</b>
                    <div>
                      <strong>{step.title}</strong>
                      <span>{step.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>

          <Actions
            hint={saveError ?? "Creating an account is how you get back to the build later."}
            onPrimary={sendRequest}
            onSecondary={() => go(3)}
            primary={saving ? "Saving request…" : "Send the request"}
            primaryDisabled={saving}
            secondary="Back to review"
          />
        </Stage>
      ) : null}

      <p className={styles.escape}>
        Not ready for all this? <Link href="/">Go back to the homepage</Link> — nothing is sent until you send it.
      </p>
    </div>
  );
}

function Stage({ eyebrow, title, copy, children }: { eyebrow: string; title: ReactNode; copy: string; children: ReactNode }) {
  return (
    <section className={styles.stage}>
      <header className={styles.stageHead}>
        <div>
          <p className={styles.label}>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <p>{copy}</p>
      </header>
      {children}
    </section>
  );
}

function Actions({ primary, secondary, onPrimary, onSecondary, primaryDisabled = false, hint }: {
  primary: string;
  secondary?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
  hint?: string;
}) {
  return (
    <div className={styles.actions}>
      {secondary && onSecondary ? (
        <button className={styles.back} onClick={onSecondary} type="button">
          <span aria-hidden="true">←</span> {secondary}
        </button>
      ) : <span />}
      <div className={styles.forward}>
        {hint ? <small>{hint}</small> : null}
        <button className={styles.next} disabled={primaryDisabled} onClick={onPrimary} type="button">
          {primary} <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
