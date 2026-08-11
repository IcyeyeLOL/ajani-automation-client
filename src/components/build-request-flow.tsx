"use client";

import { useState, type DragEvent } from "react";
import { useAccountAccess } from "@/components/account-access-dialog";
import type { SystemBlock } from "@/lib/domain/types";

const initialBlocks: SystemBlock[] = [
  { id: "trigger", kind: "trigger", title: "New lead arrives", detail: "Instagram or website inquiry enters the route." },
  { id: "reply", kind: "reply", title: "Send first reply", detail: "Match the service and answer the first likely question." },
  { id: "qualify", kind: "qualify", title: "Find real intent", detail: "Ask one question about availability, timing, or budget." },
  { id: "handoff", kind: "handoff", title: "Route ready lead", detail: "Alert the owner with the full thread and next action." },
];

const stageNames = ["Brief", "Clarify", "System", "Review", "Launch"];

function moveItem(items: SystemBlock[], id: string, direction: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function BuildRequestFlow() {
  const { openAccountAccess } = useAccountAccess();
  const [stage, setStage] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [answer, setAnswer] = useState("");
  const [blocks, setBlocks] = useState(initialBlocks);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const advance = () => setStage((current) => Math.min(current + 1, stageNames.length - 1));
  const goBack = () => setStage((current) => Math.max(current - 1, 0));
  const updateBlock = (id: string, field: "title" | "detail", value: string) => {
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, [field]: value } : block)));
  };
  const addBlock = () => {
    const id = `custom-${Date.now()}`;
    setBlocks((current) => [...current, { id, kind: "custom", title: "New action", detail: "Describe what should happen here." }]);
  };
  const dropBlock = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    setBlocks((current) => {
      const dragged = current.find((block) => block.id === draggedId);
      if (!dragged) return current;
      const remaining = current.filter((block) => block.id !== draggedId);
      const targetIndex = remaining.findIndex((block) => block.id === targetId);
      return [...remaining.slice(0, targetIndex), dragged, ...remaining.slice(targetIndex)];
    });
    setDraggedId(null);
  };

  return (
    <div className="request-flow">
      <div className="flow-meta"><span>PRIVATE BUILD DESK / NEW REQUEST</span><span className="flow-live">YOUR BUILD IN PROGRESS</span></div>
      <nav className="flow-progress" aria-label="Build request stages">
        {stageNames.map((name, index) => (
          <button disabled={index > stage} className={index === stage ? "active" : index < stage ? "done" : ""} key={name} onClick={() => setStage(index)} type="button">
            <span>0{index + 1}</span><b>{name}</b>
          </button>
        ))}
      </nav>

      {stage === 0 && <section className={`flow-stage stage-${stage}`} key={stage}><FlowHeading eyebrow="01 / YOUR VOICE NOTE" title={<>Start with the work as it <em>actually happens.</em></>} copy="Speak naturally for a minute or two. A useful build starts with your real version of the problem." />
        <div className="brief-grid"><article className={`recorder-card ${recording ? "recording" : ""}`}><div className="recorder-top"><span><i />{recording ? "RECORDING" : recorded ? "VOICE NOTE READY" : "READY TO RECORD"}</span><b>{recording ? "00:18" : recorded ? "01:12" : "00:00"}</b></div><div className="recorder-center"><button aria-label={recording ? "Stop recording" : "Record voice note"} className="record-button" onClick={() => { if (recording) { setRecording(false); setRecorded(true); } else { setRecording(true); } }} type="button"><span /></button><strong>{recording ? "Tap when you are done" : recorded ? "Your note is ready to submit" : "Tap to start your voice note"}</strong><small>Record up to three minutes</small></div><div className="transcript-box"><span>LIVE TRANSCRIPT</span><p>{recording || recorded ? "Most leads come through Instagram and the website. When someone replies after hours, I want the first response to feel personal before the team gets involved." : "When you start recording, the key parts of your note will appear here."}</p></div></article><aside className="note-guide"><p className="eyebrow">A USEFUL NOTE COVERS</p><ol><li><b>01</b><div><strong>What happens today</strong><span>Tell us the moment where work gets stuck.</span></div></li><li><b>02</b><div><strong>Who is involved</strong><span>Name the people, tools, or channels in the route.</span></div></li><li><b>03</b><div><strong>What good looks like</strong><span>Describe the outcome you want to become normal.</span></div></li></ol><p className="guide-callout">The note is source material, not a test.</p></aside></div>
        <FlowActions primary="SUBMIT VOICE NOTE" primaryDisabled={!recorded} onPrimary={advance} />
      </section>}

      {stage === 1 && <section className={`flow-stage stage-${stage}`} key={stage}><FlowHeading eyebrow="02 / CLARIFY THE ROUTE" title={<>One sharp question, not a <em>questionnaire.</em></>} copy="Your note stays visible. Ajani asks only for the detail that changes the system." />
        <div className="clarify-grid"><aside className="source-card"><div><span>YOUR VOICE NOTE</span><b>01:12</b></div><p>“Most leads come through Instagram and the website. If someone replies after hours, I see it, but the follow-up happens the next day if I remember.”</p><footer><span>AFTER HOURS</span><span>INSTAGRAM</span><span>READY TO TALK</span></footer></aside><article className="question-card"><span>THE DETAIL THAT CHANGES THE ROUTE</span><h2>When should a lead move from an automated reply to a person on your team?</h2><p className="why"><b>WHY THIS MATTERS</b> It decides whether your team sees every reply or only the conversations worth their attention.</p><div className="answer-options">{["They ask about availability", "They share timing or budget", "I want to review each thread"].map((option) => <button className={answer === option ? "selected" : ""} key={option} onClick={() => setAnswer(option)} type="button">{option}</button>)}</div><textarea onChange={(event) => setAnswer(event.target.value)} placeholder="Or answer in your own words..." value={answer} /></article></div>
        <FlowActions secondary="BACK TO THE NOTE" primary="SAVE ANSWER" onPrimary={advance} onSecondary={goBack} primaryDisabled={!answer.trim()} />
      </section>}

      {stage === 2 && <section className={`flow-stage stage-${stage}`} key={stage}><FlowHeading eyebrow="03 / SYSTEM EDITOR" title={<>Shape the route before we <em>build it.</em></>} copy="Edit any block, add a step, or move the sequence. This is the system you will approve." />
        <div className="editor-toolbar"><span><i />ALL CHANGES SAVED</span><div><button onClick={addBlock} type="button">+ ADD BLOCK</button><button onClick={() => setBlocks(initialBlocks)} type="button">RESET</button></div></div><div className="system-canvas">{blocks.map((block, index) => <article className={`system-block ${block.kind}`} draggable key={block.id} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()} onDragStart={() => setDraggedId(block.id)} onDrop={(event) => dropBlock(event, block.id)}><span className="grip">⋮⋮</span><small>{block.kind.toUpperCase()}</small><input aria-label="Block title" onChange={(event) => updateBlock(block.id, "title", event.target.value)} value={block.title} /><textarea aria-label="Block description" onChange={(event) => updateBlock(block.id, "detail", event.target.value)} value={block.detail} /><footer><button disabled={index === 0} onClick={() => setBlocks((current) => moveItem(current, block.id, -1))} type="button">← MOVE</button><button disabled={index === blocks.length - 1} onClick={() => setBlocks((current) => moveItem(current, block.id, 1))} type="button">MOVE →</button></footer></article>)}</div><p className="editor-hint">Drag a block to reorder it, use the Move controls, or type directly into the block.</p>
        <FlowActions secondary="BACK TO CLARIFY" primary="READY FOR REVIEW" onPrimary={advance} onSecondary={goBack} />
      </section>}

      {stage === 3 && <section className={`flow-stage stage-${stage}`} key={stage}><FlowHeading eyebrow="04 / REVIEW YOUR SYSTEM" title={<>This is what the build will <em>actually do.</em></>} copy="Review the route, the boundaries, and the delivery plan before you ask Ajani to start the work." />
        <div className="review-grid"><article className="route-review"><header><div><span>YOUR APPROVED ROUTE</span><h2>After-hours lead handoff</h2></div><b>VERSION 01</b></header><div className="review-blocks">{blocks.map((block, index) => <div key={block.id}><b>0{index + 1}</b><p><strong>{block.title}</strong><span>{block.detail}</span></p></div>)}</div><aside><span>WHAT THIS PROTECTS</span><p>Every real lead receives a timely response, while your team sees only the conversations that deserve a human handoff.</p></aside></article><aside className="scope-card"><span>BUILD SCOPE</span>{["Lead capture", "Conversation logic", "Booking handoff", "30-day refinement"].map((item) => <div key={item}><p>{item}</p><b>INCLUDED</b></div>)}<footer><span>STARTING INVESTMENT</span><strong>$3,800</strong><small>Final scope is confirmed before work begins.</small></footer></aside></div>
        <FlowActions secondary="BACK TO EDITOR" primary="APPROVE SYSTEM" onPrimary={advance} onSecondary={goBack} />
      </section>}

      {stage === 4 && <section className={`flow-stage stage-${stage}`} key={stage}><FlowHeading eyebrow="05 / SUBMIT YOUR REQUEST" title={<>Everything is clear. Now send the <em>build request.</em></>} copy="Once submitted, Ajani reviews the approved route and opens your private handoff room." />
        <div className="launch-grid"><article className="submission-card"><span>READY TO REQUEST</span><h2>After-hours lead handoff</h2><div>{[["VOICE NOTE", "01:12 RECEIVED"], ["SYSTEM", `${String(blocks.length).padStart(2, "0")} BLOCKS APPROVED`], ["BUILD WINDOW", "7 TO 10 DAYS"]].map(([label, value]) => <p key={label}><small>{label}</small><b>{value}</b></p>)}</div><p>Request this exact system, then use your private account to follow the build.</p></article><NextTimeline /></div>
        <FlowActions secondary="BACK TO REVIEW" primary="REQUEST BUILD" onPrimary={() => openAccountAccess("request")} onSecondary={goBack} />
      </section>}
    </div>
  );
}

function FlowHeading({ eyebrow, title, copy }: { eyebrow: string; title: React.ReactNode; copy: string }) {
  return <header className="flow-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><p>{copy}</p></header>;
}

function FlowActions({ secondary, primary, onPrimary, onSecondary, primaryDisabled = false }: { secondary?: string; primary: string; onPrimary: () => void; onSecondary?: () => void; primaryDisabled?: boolean }) {
  return <div className="flow-actions">{secondary && onSecondary ? <button onClick={onSecondary} type="button">{secondary}</button> : null}<button disabled={primaryDisabled} onClick={onPrimary} type="button">{primary} <span>→</span></button></div>;
}

function NextTimeline() {
  const next = [["NOW", "Request is received", "Your approved system enters the build desk."], ["1 DAY", "Build plan is checked", "We confirm tools, access, and boundaries."], ["3 DAYS", "First working route", "You see the logic in your real channels."], ["7-10 DAYS", "Launch and refinement", "We test the handoff before it becomes live."]];
  return <aside className="next-timeline"><span>WHAT HAPPENS NEXT</span>{next.map(([time, title, detail]) => <div key={time}><small>{time}</small><i /><p><b>{title}</b><em>{detail}</em></p></div>)}</aside>;
}
