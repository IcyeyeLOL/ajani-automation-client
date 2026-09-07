"use client";

import { type AnimationEvent, type ReactNode, useEffect, useRef, useState } from "react";
import homeStyles from "@/app/home.module.css";
import styles from "./system-animation.module.css";

type StationBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type SceneLayout = {
  context: StationBox;
  paths: [string, string, string];
  review: StationBox;
  route: StationBox;
  signal: StationBox;
  viewBox: string;
};

const DESKTOP_LAYOUT: SceneLayout = {
  viewBox: "0 0 730 270",
  signal: { x: 10, y: 124, width: 145, height: 96 },
  context: { x: 185, y: 52, width: 155, height: 150 },
  route: { x: 370, y: 96, width: 160, height: 140 },
  review: { x: 560, y: 51, width: 160, height: 158 },
  paths: [
    "M155 172C171 172 169 127 185 127",
    "M340 127C356 127 354 166 370 166",
    "M530 166C546 166 544 130 560 130",
  ],
};

const MOBILE_LAYOUT: SceneLayout = {
  viewBox: "0 0 360 370",
  signal: { x: 10, y: 18, width: 154, height: 104 },
  context: { x: 196, y: 12, width: 154, height: 132 },
  route: { x: 10, y: 210, width: 164, height: 132 },
  review: { x: 196, y: 194, width: 154, height: 152 },
  paths: [
    "M164 70C177 70 182 78 196 78",
    "M273 144C273 179 92 176 92 210",
    "M174 276C184 276 186 270 196 270",
  ],
};

const WAVE_HEIGHTS = [18, 30, 42, 25, 51, 35, 46, 28, 20];

const SCENES = [
  {
    id: "network",
    label: "lead triage map",
    captionStart: "Signals",
    captionEnd: "qualified next steps",
    statuses: ["Signals arriving", "Finding context", "Routing next steps", "Human review"],
  },
  {
    id: "routing",
    label: "after-hours routing desk",
    captionStart: "Your note",
    captionEnd: "a route your team can review",
    statuses: ["Signal received", "Reading context", "Mapping route", "Human review"],
  },
  {
    id: "mindmap",
    label: "handoff mind map",
    captionStart: "One request",
    captionEnd: "owners, rules, and handoffs",
    statuses: ["Request received", "Mapping dependencies", "Assigning handoffs", "Human review"],
  },
] as const;

type StationProps = StationBox & {
  children: ReactNode;
  label: string;
  stage: number;
};

function Station({ children, height, label, stage, width, x, y }: StationProps) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={styles.station} data-stage={stage}>
        <ellipse
          className={styles.stationShadow}
          cx={width / 2 + 3}
          cy={height + 12}
          rx={width * .34}
          ry="7"
        />
        <rect className={styles.stationBack} height={height} rx="18" width={width} x="6" y="8" />
        <rect
          className={styles.stationFace}
          data-node-surface="true"
          height={height}
          rx="18"
          width={width}
        />
        <text className={styles.stationLabel} data-station-label="true" x="16" y="14">
          <tspan x="16">{label.split(" ")[0]} </tspan>
          <tspan dy="13" x="16">{label.split(" ").slice(1).join(" ")}</tspan>
        </text>
        <text className={styles.stationIndex} data-station-index="true" x={width - 16} y="14">0{stage}</text>
        {children}
      </g>
    </g>
  );
}

function SignalStation({ box }: { box: StationBox }) {
  const centerY = box.height * .59;

  return (
    <Station {...box} label="New input" stage={1}>
      <rect className={styles.noteSheet} height={box.height - 42} rx="10" width={box.width - 28} x="14" y="32" />
      <g className={styles.sourceWave} data-waveform="true">
        {WAVE_HEIGHTS.map((height, index) => (
          <rect
            className={styles.sourceBar}
            height={height * .58}
            key={`${height}-${index}`}
            rx="2"
            width="5"
            x={24 + index * ((box.width - 53) / (WAVE_HEIGHTS.length - 1))}
            y={centerY - height * .29}
          />
        ))}
      </g>
      <path className={styles.noteRule} d={`M22 ${box.height - 17}h${box.width - 44}`} />
    </Station>
  );
}

function ContextStation({ box }: { box: StationBox }) {
  const paperHeight = box.height - 49;

  return (
    <Station {...box} label="Read context" stage={2}>
      <rect className={styles.contextPaper} height={paperHeight} rx="11" width={box.width - 28} x="14" y="34" />
      <g className={styles.contextChips}>
        <rect height="13" rx="6.5" width={box.width - 51} x="25" y="53" />
        <rect height="13" rx="6.5" width={box.width - 68} x="25" y="75" />
        <rect height="13" rx="6.5" width={box.width - 58} x="25" y="97" />
      </g>
      <g className={styles.scanPlane}>
        <rect height="24" rx="8" width={box.width - 34} x="17" y="38" />
        <path d={`M23 57h${box.width - 46}`} />
      </g>
    </Station>
  );
}

function RouteStation({ box }: { box: StationBox }) {
  const centerX = box.width * .42;
  const branchEnd = box.width - 20;

  return (
    <Station {...box} label="Shape route" stage={3}>
      <rect className={styles.routeCanvas} height={box.height - 48} rx="12" width={box.width - 28} x="14" y="34" />
      <g className={styles.routeDiagram}>
        <path className={styles.routeStem} d={`M25 ${box.height * .55}h${centerX - 36}`} />
        <path
          className={styles.routeSelected}
          d={`M${centerX - 11} ${box.height * .55}C${centerX + 10} ${box.height * .55} ${centerX + 7} 53 ${branchEnd} 53`}
          pathLength="100"
        />
        <path
          className={styles.routeAlternate}
          d={`M${centerX - 11} ${box.height * .55}C${centerX + 10} ${box.height * .55} ${centerX + 7} ${box.height - 28} ${branchEnd} ${box.height - 28}`}
          pathLength="100"
        />
        <rect className={styles.decision} height="19" rx="5" transform={`rotate(45 ${centerX - 11} ${box.height * .55})`} width="19" x={centerX - 20.5} y={box.height * .55 - 9.5} />
        <circle className={styles.routeTarget} cx={branchEnd} cy="53" r="6" />
        <circle className={styles.routeTargetMuted} cx={branchEnd} cy={box.height - 28} r="5" />
      </g>
    </Station>
  );
}

function ReviewStation({ box }: { box: StationBox }) {
  const gateX = box.width - 31;

  return (
    <Station {...box} label="Human review" stage={4}>
      <rect className={styles.reviewTray} height={box.height - 45} rx="12" width={box.width - 24} x="12" y="34" />
      <g className={styles.summarySheet}>
        <rect height={box.height - 79} rx="8" width={box.width - 70} x="20" y="45" />
        <path d={`M29 60h${box.width - 92}M29 72h${box.width - 102}M29 84h${box.width - 96}`} />
      </g>
      <g className={styles.reviewer}>
        <circle cx={gateX + 12} cy="55" r="6" />
        <path d={`M${gateX + 3} 73c2-10 16-10 18 0`} />
      </g>
      <path className={styles.reviewGate} d={`M${gateX} 42v${box.height - 65}`} />
      <g className={styles.awaitingPill}>
        <rect height="20" rx="10" width={box.width - 42} x="18" y={box.height - 31} />
        <text x={box.width / 2} y={box.height - 17}>Awaiting review</text>
      </g>
    </Station>
  );
}

function NetworkDiagram({ mobile }: { mobile: boolean }) {
  const viewBox = mobile ? "0 0 360 370" : "0 0 730 270";
  const sources = mobile
    ? [
        { x: 58, y: 50, label: "Call" },
        { x: 180, y: 50, label: "Form" },
        { x: 302, y: 50, label: "Email" },
      ]
    : [
        { x: 70, y: 48, label: "Call" },
        { x: 70, y: 132, label: "Form" },
        { x: 70, y: 216, label: "Email" },
      ];
  const hub = mobile
    ? { x: 83, y: 126, width: 194, height: 108 }
    : { x: 270, y: 80, width: 190, height: 110 };
  const outputs = mobile
    ? [
        { x: 18, y: 292, width: 100, label: "Urgent" },
        { x: 130, y: 292, width: 100, label: "Book" },
        { x: 242, y: 292, width: 100, label: "Follow-up" },
      ]
    : [
        { x: 570, y: 25, width: 125, label: "Urgent" },
        { x: 585, y: 108, width: 110, label: "Book" },
        { x: 555, y: 191, width: 140, label: "Follow-up" },
      ];
  const paths = mobile
    ? [
        "M58 76C58 103 120 101 132 126",
        "M180 76V126",
        "M302 76C302 103 240 101 228 126",
        "M132 234C122 258 68 263 68 292",
        "M180 234V292",
        "M228 234C238 258 292 263 292 292",
      ]
    : [
        "M96 48C181 48 188 106 270 106",
        "M96 132H270",
        "M96 216C181 216 188 164 270 164",
        "M460 106C508 106 522 52 570 52",
        "M460 135H585",
        "M460 164C507 164 511 218 555 218",
      ];

  return (
    <svg className={`${styles.svg} ${mobile ? styles.mobileScene : styles.desktopScene}`} data-scene-canvas="network" role="presentation" viewBox={viewBox}>
      <g className={styles.networkGraphic}>
        {paths.map((path, index) => (
          <path className={styles.networkTrack} d={path} key={`network-track-${index}`} />
        ))}
        {paths.map((path, index) => (
          <path
            className={styles.networkPath}
            data-path-index={index}
            data-lane={index < 3 ? "input" : "output"}
            data-network-path="true"
            d={path}
            key={`network-path-${index}`}
            pathLength="100"
          />
        ))}

        <g className={styles.networkSources}>
          {sources.map((source) => (
            <g key={source.label} transform={`translate(${source.x} ${source.y})`}>
              <ellipse className={styles.networkShadow} cy="29" rx="20" ry="4" />
              <circle className={styles.networkNodeBack} cy="4" r="26" />
              <circle className={styles.networkNodeFace} r="26" />
              <circle className={styles.networkSeed} r="7" />
              <path className={styles.networkSeedMark} d="M-3 0h6M0-3v6" />
              <text className={styles.networkLabel} y="43">{source.label}</text>
            </g>
          ))}
        </g>

        <g className={styles.networkHub} transform={`translate(${hub.x} ${hub.y})`}>
          <ellipse className={styles.networkShadow} cx={hub.width / 2 + 3} cy={hub.height + 12} rx={hub.width * .31} ry="7" />
          <rect className={styles.networkHubBack} height={hub.height} rx="22" width={hub.width} x="7" y="9" />
          <rect className={styles.networkHubFace} height={hub.height} rx="22" width={hub.width} />
          <text className={styles.networkHubLabel} x="18" y="27">Qualify the lead</text>
          <g className={styles.networkMatrix} transform={`translate(${hub.width / 2} ${hub.height * .61})`}>
            <path d="M-48 0h96M0-28v56M-34-20 34 20M-34 20 34-20" />
            <circle cx="-48" r="6" />
            <circle cy="-28" r="6" />
            <circle cx="48" r="6" />
            <circle cy="28" r="6" />
            <circle className={styles.networkCore} r="13" />
          </g>
        </g>

        <g className={styles.networkOutputs}>
          {outputs.map((output) => (
            <g key={output.label} transform={`translate(${output.x} ${output.y})`}>
              <rect className={styles.outputBack} height="54" rx="15" width={output.width} x="5" y="7" />
              <rect className={styles.outputFace} height="54" rx="15" width={output.width} />
              <circle className={styles.outputStatus} cx="18" cy="27" r="6" />
              <text className={styles.outputLabel} x="32" y="31">{output.label}</text>
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}

function NetworkScene() {
  return (
    <>
      <NetworkDiagram mobile={false} />
      <NetworkDiagram mobile />
    </>
  );
}

type MindNode = {
  height: number;
  human?: boolean;
  label: string;
  phase: "early" | "middle" | "late";
  width: number;
  x: number;
  y: number;
};

function MindMapDiagram({ mobile }: { mobile: boolean }) {
  const viewBox = mobile ? "0 0 360 370" : "0 0 730 270";
  const core = mobile
    ? { x: 91, y: 94, width: 178, height: 106 }
    : { x: 276, y: 77, width: 178, height: 116 };
  const nodes: MindNode[] = mobile
    ? [
        { x: 10, y: 10, width: 142, height: 56, label: "Context", phase: "early" },
        { x: 208, y: 10, width: 142, height: 56, label: "Rules", phase: "early" },
        { x: 10, y: 226, width: 142, height: 54, label: "Owner", phase: "middle" },
        { x: 208, y: 226, width: 142, height: 54, label: "Timing", phase: "middle" },
        { x: 100, y: 298, width: 160, height: 58, label: "Human gate", phase: "late", human: true },
      ]
    : [
        { x: 35, y: 25, width: 145, height: 58, label: "Context", phase: "early" },
        { x: 45, y: 187, width: 135, height: 58, label: "Rules", phase: "early" },
        { x: 550, y: 20, width: 135, height: 58, label: "Owner", phase: "middle" },
        { x: 565, y: 105, width: 130, height: 58, label: "Timing", phase: "middle" },
        { x: 535, y: 190, width: 160, height: 62, label: "Human gate", phase: "late", human: true },
      ];
  const paths = mobile
    ? [
        { d: "M122 94C122 77 81 82 81 66", phase: "early" },
        { d: "M238 94C238 77 279 82 279 66", phase: "early" },
        { d: "M122 200C122 217 81 212 81 226", phase: "middle" },
        { d: "M238 200C238 217 279 212 279 226", phase: "middle" },
        { d: "M180 200V298", phase: "late" },
      ]
    : [
        { d: "M276 108C235 108 225 54 180 54", phase: "early" },
        { d: "M276 162C235 162 225 216 180 216", phase: "early" },
        { d: "M454 106C494 106 510 49 550 49", phase: "middle" },
        { d: "M454 135H565", phase: "middle" },
        { d: "M454 163C492 163 500 221 535 221", phase: "late" },
      ];

  return (
    <svg className={`${styles.svg} ${mobile ? styles.mobileScene : styles.desktopScene}`} data-scene-canvas="mindmap" role="presentation" viewBox={viewBox}>
      <g className={styles.mindGraphic}>
        {paths.map((path, index) => (
          <path className={styles.mindTrack} d={path.d} key={`mind-track-${index}`} />
        ))}
        {paths.map((path, index) => (
          <path
            className={styles.mindBranch}
            data-mind-branch="true"
            data-path-index={index}
            data-phase={path.phase}
            d={path.d}
            key={`mind-branch-${index}`}
            pathLength="100"
          />
        ))}

        <g className={styles.mindCore} transform={`translate(${core.x} ${core.y})`}>
          <ellipse className={styles.mindShadow} cx={core.width / 2 + 3} cy={core.height + 12} rx={core.width * .3} ry="7" />
          <rect className={styles.mindCoreBack} height={core.height} rx="28" width={core.width} x="7" y="9" />
          <rect className={styles.mindCoreFace} height={core.height} rx="28" width={core.width} />
          <text className={styles.mindEyebrow} x={core.width / 2} y="30">Request map</text>
          <text className={styles.mindTitle} x={core.width / 2} y="58">The repetitive work</text>
          <g className={styles.mindChips}>
            <rect height="16" rx="8" width="45" x="23" y={core.height - 34} />
            <rect height="16" rx="8" width="35" x="72" y={core.height - 34} />
            <rect height="16" rx="8" width="44" x="111" y={core.height - 34} />
          </g>
        </g>

        {nodes.map((node) => (
          <g
            className={`${styles.mindNode} ${node.human ? styles.mindHuman : ""}`}
            data-mind-node="true"
            data-phase={node.phase}
            key={node.label}
            transform={`translate(${node.x} ${node.y})`}
          >
            <rect className={styles.mindNodeBack} height={node.height} rx="16" width={node.width} x="5" y="7" />
            <rect className={styles.mindNodeFace} height={node.height} rx="16" width={node.width} />
            <circle className={styles.mindNodeMark} cx="21" cy={node.height / 2} r="7" />
            <text className={styles.mindNodeLabel} x="36" y={node.height / 2 + 4}>{node.label}</text>
            {node.human ? <path className={styles.mindGate} d={`M${node.width - 18} 14v${node.height - 28}`} /> : null}
          </g>
        ))}
      </g>
    </svg>
  );
}

function MindMapScene() {
  return (
    <>
      <MindMapDiagram mobile={false} />
      <MindMapDiagram mobile />
    </>
  );
}

function RoutingScene({ className, layout }: { className: string; layout: SceneLayout }) {
  return (
    <svg className={`${styles.svg} ${className}`} role="presentation" viewBox={layout.viewBox}>
      <g className={styles.scene}>
        <g className={styles.routeTracks}>
          {layout.paths.map((path, index) => (
            <path className={styles.trackShadow} d={path} key={`shadow-${index}`} />
          ))}
          {layout.paths.map((path, index) => (
            <path className={styles.track} d={path} key={`track-${index}`} />
          ))}
          {layout.paths.map((path, index) => (
            <path
              className={styles.activeTrack}
              data-route-path="true"
              data-segment={index + 1}
              d={path}
              key={`active-${index}`}
              pathLength="100"
            />
          ))}
        </g>

        <SignalStation box={layout.signal} />
        <ContextStation box={layout.context} />
        <RouteStation box={layout.route} />
        <ReviewStation box={layout.review} />
      </g>
    </svg>
  );
}

function RoutingDeskScene() {
  return (
    <>
      <RoutingScene className={styles.desktopScene} layout={DESKTOP_LAYOUT} />
      <RoutingScene className={styles.mobileScene} layout={MOBILE_LAYOUT} />
    </>
  );
}

function SceneGraphic({ id }: { id: (typeof SCENES)[number]["id"] }) {
  if (id === "network") return <NetworkScene />;
  if (id === "mindmap") return <MindMapScene />;
  return <RoutingDeskScene />;
}

/**
 * Three views of the same work: signals become a pattern, the pattern becomes
 * a route, and the route becomes an inspectable handoff map. CSS owns the 7.2s
 * clock and swaps scenes only at its fully transparent iteration boundary.
 */
export function SystemAnimation() {
  const root = useRef<HTMLDivElement>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [environmentPaused, setEnvironmentPaused] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const activeScene = SCENES[sceneIndex];
  const paused = environmentPaused || manuallyPaused;

  useEffect(() => {
    const element = root.current;
    if (!element) return;

    let inView = true;
    const sync = () => {
      setEnvironmentPaused(document.hidden || !inView);
    };

    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          ([entry]) => {
            inView = entry.isIntersecting;
            sync();
          },
          { threshold: 0.08 },
        )
      : null;

    observer?.observe(element);
    document.addEventListener("visibilitychange", sync);

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const advanceScene = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setSceneIndex((index) => (index + 1) % SCENES.length);
  };

  return (
    <>
      <div className={homeStyles.heroVisualHead}>
        <span className={homeStyles.previewTitle}>
          <i aria-hidden="true">ajani<b>.</b></i>
          <span className={homeStyles.dynamicTitle} data-system-preview-title="true" key={activeScene.id}>
            System / {activeScene.label}
          </span>
          <span className={homeStyles.staticTitle} data-system-preview-title="true">
            System / after-hours routing desk
          </span>
        </span>
        <div className={homeStyles.previewControls}>
          <span aria-hidden="true" className={homeStyles.sceneTicks}>
            {SCENES.map((scene, index) => (
              <i data-active={index === sceneIndex ? "true" : "false"} key={scene.id} />
            ))}
          </span>
          <em aria-label="Illustrative system status">
            <span aria-hidden="true" className={homeStyles.previewStatus} key={activeScene.id}>
              <b className={homeStyles.statusListening}>{activeScene.statuses[0]}</b>
              <b className={homeStyles.statusMapping}>{activeScene.statuses[1]}</b>
              <b className={homeStyles.statusRouting}>{activeScene.statuses[2]}</b>
              <b className={homeStyles.statusReady}>{activeScene.statuses[3]}</b>
            </span>
          </em>
          <button
            aria-label={manuallyPaused ? "Play illustrative systems" : "Pause illustrative systems"}
            className={homeStyles.previewPause}
            onClick={() => setManuallyPaused((value) => !value)}
            type="button"
          >
            {manuallyPaused ? (
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m5 3 8 5-8 5Z" /></svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3h2.5v10H5zm4 0h2.5v10H9z" /></svg>
            )}
          </button>
        </div>
      </div>
      <div className={homeStyles.heroVisualBody}>
        <div
          aria-hidden="true"
          className={styles.wrap}
          data-active-scene={activeScene.id}
          data-hero-carousel="true"
          data-paused={String(paused)}
          ref={root}
        >
          <div
            className={styles.sceneViewport}
            data-scene={activeScene.id}
            data-scene-viewport="true"
            onAnimationIteration={advanceScene}
          >
            <SceneGraphic id={activeScene.id} key={activeScene.id} />
            <p className={styles.caption} data-scene-caption="true">
              <span>{activeScene.captionStart}</span>
              <i aria-hidden="true">→</i>
              <span>{activeScene.captionEnd}</span>
            </p>
          </div>

          <div className={styles.staticFallback} data-static-fallback="true">
            <RoutingDeskScene />
            <p className={styles.caption}>
              <span>Your note</span>
              <i aria-hidden="true">→</i>
              <span>a route your team can review</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
