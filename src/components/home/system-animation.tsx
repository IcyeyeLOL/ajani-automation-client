"use client";

import styles from "./system-animation.module.css";

/**
 * The hero's ambient loop: a voice note condensing into a route, then the route
 * running. Pure CSS keyframes on a fixed SVG skeleton — no timers, no state, and
 * it holds a readable final frame when motion is reduced.
 */

const NODES = [
  { x: 46, label: "Signal" },
  { x: 149, label: "Read" },
  { x: 252, label: "Reply" },
  { x: 355, label: "Handoff" },
];

const CY = 60;
const R = 21;
const WAVE_HEIGHTS = [
  8, 14, 22, 13, 28, 38, 21, 45, 31, 17, 37, 52, 29,
  42, 23, 48, 32, 19, 39, 26, 44, 30, 16, 27, 18, 10,
];

export function SystemAnimation() {
  return (
    <div aria-hidden="true" className={styles.wrap}>
      <svg className={styles.svg} role="presentation" viewBox="0 0 400 116">
        <defs>
          <linearGradient id="ajaniActive" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#f0c9a4" />
            <stop offset="100%" stopColor="#c8865f" />
          </linearGradient>
        </defs>

        {/* beat one — the spoken note */}
        <g className={styles.wave}>
          {WAVE_HEIGHTS.map((height, i) => (
            <rect
              className={styles.bar}
              height={height}
              key={i}
              rx="2"
              width="3.4"
              x={44 + i * 12.6}
              y={CY - height / 2}
            />
          ))}
        </g>

        {/* beat two — the route assembles */}
        {NODES.slice(0, -1).map((node, i) => (
          <line
            className={styles.link}
            data-step={i + 1}
            key={node.label}
            x1={node.x + R + 5}
            x2={NODES[i + 1].x - R - 5}
            y1={CY}
            y2={CY}
          />
        ))}

        {NODES.map((node, i) => (
          <g data-step={i + 1} key={node.label}>
            <circle
              className={styles.node}
              cx={node.x}
              cy={CY}
              r={R}
            />
            <circle
              className={styles.core}
              cx={node.x}
              cy={CY}
              r={5.5}
            />
            <circle
              className={styles.pulse}
              cx={node.x}
              cy={CY}
              r={R}
            />
            <text className={styles.tag} x={node.x} y={CY + 44}>
              {node.label}
            </text>
          </g>
        ))}

        {/* a restrained trail keeps the packet readable without adding glow */}
        <circle className={styles.packetTrail} cx={NODES[0].x} cy={CY} r="2.4" />
        <circle className={styles.packet} cx={NODES[0].x} cy={CY} r="4" />
      </svg>

      <p className={styles.caption}>
        <span>Your voice note</span>
        <i>→</i>
        <span>a system that runs</span>
      </p>
    </div>
  );
}
