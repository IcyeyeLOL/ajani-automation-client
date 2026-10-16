"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  axisDateLabel,
  axisLabels,
  axisTicks,
  bucketLabel,
  bucketRangeLabel,
  formatMetricValue,
  missingValueLabel,
  shortBucketLabel,
  shortMetricLabel,
  sourceLabel,
  trendChange,
} from "@/lib/admin/metric-query";
import type { MetricDefinition, MetricSeries, MetricSeriesResult } from "@/lib/admin/metric-types";

type CardAction = { label: string; run: () => void } | null;

export function TrendCard({ definition, basis, eyebrow, lifetime, result, series, notSplit, period, action, onRemove }: {
  definition: MetricDefinition;
  /** What the data rests on: the metric itself, or a rate's denominator. */
  basis: MetricDefinition;
  eyebrow: string | null;
  lifetime: boolean;
  result: MetricSeriesResult | null;
  series: MetricSeries | null;
  /** The account filter's wording when this number is not split by the chosen account. */
  notSplit: { noun: string; all: string } | null;
  period: string;
  action: CardAction;
  onRemove: () => void;
}) {
  const title = shortMetricLabel(definition.label);
  const change = series && !notSplit ? trendChange(definition, series.current, series.previous) : null;
  const hasData = Boolean(series?.values.some((value) => value !== null));
  // A rate over nothing but true zeros had no activity; any unknown base means not logged.
  const zeroBase = definition.aggregation === "ratio" && Boolean(series?.denominators?.length) && Boolean(series?.denominators?.every((value) => value === 0));
  const countingSince = series?.coverageFrom && result && series.coverageFrom > result.from ? series.coverageFrom : null;
  return <article className="admin-panel admin-trend-card" data-metric={definition.key}>
    <header>
      <div>
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h3>{title}{lifetime ? <small className="admin-trend-tag" title="Each campaign's whole life">All time</small> : null}</h3>
      </div>
      <button aria-label={`Remove ${title} from this view`} className="admin-trend-remove" onClick={onRemove} title="Remove from this view" type="button">✕</button>
    </header>
    <div className="admin-trend-headline">
      <strong>{formatMetricValue(notSplit ? null : series?.current ?? null, definition.unit, "compact")}</strong>
      {change ? <span className={`admin-trend-change ${change.tone}`}>{change.label}{change.direction === "same" ? null : <span className="sr-only"> vs previous</span>}</span> : null}
    </div>
    {notSplit ? null : <div className="admin-trend-context">
      <span>{contextLabel(definition, series, lifetime)}{countingSince ? ` · Counting since ${bucketLabel(countingSince, "day")}` : ""}</span>
      {change && change.direction !== "same" ? <span aria-hidden="true">vs previous</span> : null}
    </div>}
    {notSplit ? <EmptyChart message={`Not split by ${notSplit.noun}. Pick “${notSplit.all}” to see it.`} />
      : !result || !series ? <div aria-hidden="true" className="admin-trend-skeleton" />
        : hasData ? <TrendChart basis={basis} definition={definition} label={title} period={period} result={result} series={series} />
          : zeroBase ? <EmptyChart message="No activity in this period." /> : <EmptyChart action={action} message={emptyMessage(basis)} />}
  </article>;
}

function EmptyChart({ message, action = null }: { message: string; action?: CardAction }) {
  return <div className="admin-trend-empty"><p>{message}</p>{action ? <button onClick={action.run} type="button">{action.label}</button> : null}</div>;
}

function TrendChart({ definition, basis, label, period, result, series }: { definition: MetricDefinition; basis: MetricDefinition; label: string; period: string; result: MetricSeriesResult; series: MetricSeries }) {
  const [active, setActive] = useState<number | null>(null);
  const count = result.buckets.length;
  const values = series.values;
  const asBars = definition.aggregation === "sum";
  const present = values.filter((value): value is number => value !== null);
  const ticks = axisTicks(present, { fromZero: asBars || definition.unit === "ratio", whole: definition.unit === "count" });
  const scale = (value: number) => ((value - ticks[0]) / (ticks[2] - ticks[0])) * 100;
  const lastIndex = values.findLastIndex((value) => value !== null);
  const lastBucket = result.buckets[count - 1];
  const activeBucket = active === null ? null : result.buckets[active] ?? null;
  const grainNoun = ({ day: "day", week: "week", month: "month", quarter: "quarter", year: "year" } as const)[result.grain];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setActive(Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * count))));
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((current) => {
        const start = current ?? (event.key === "ArrowRight" ? -1 : count);
        return Math.min(count - 1, Math.max(0, start + (event.key === "ArrowRight" ? 1 : -1)));
      });
    }
    if (event.key === "Escape") setActive(null);
  };
  // Bars sit in the middle of their slot; line points span edge to edge.
  const position = (bucket: number) => asBars ? ((bucket + 0.5) / count) * 100 : count === 1 ? 50 : (bucket / (count - 1)) * 100;
  const points = values.map((value, bucket) => value === null ? null : { x: position(bucket), y: 100 - scale(value) });
  const middle = Math.floor((count - 1) / 2);
  const firstStart = result.buckets[0]?.start ?? result.from;
  const lastStart = lastBucket?.start ?? result.to;
  const withYear = firstStart.slice(0, 4) !== lastStart.slice(0, 4);
  const latest = lastIndex < 0 ? "Nothing logged yet" : `Latest ${grainNoun}${result.buckets[lastIndex]?.partial ? " so far" : ""}: ${formatMetricValue(values[lastIndex], definition.unit)}`;

  return <figure className="admin-trend-figure">
    <div aria-hidden="true" className="admin-trend-axis-y">{axisLabels([...ticks].reverse(), definition.unit).map((tick, index) => <span key={index}>{tick}</span>)}</div>
    <div
      aria-label={`${label}, ${period.toLowerCase()} by ${grainNoun}. ${latest}. Use the arrow keys to read each ${grainNoun}.`}
      className="admin-trend-plot"
      onBlur={() => setActive(null)}
      onKeyDown={step}
      onPointerDown={pick}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") setActive(null); }}
      onPointerMove={pick}
      role="img"
      tabIndex={0}
    >
      {asBars ? <div className="admin-trend-bars">{values.map((value, bucket) => <span className={`${result.buckets[bucket]?.partial ? "partial" : ""}${active === bucket ? " active" : ""}`} key={result.buckets[bucket]?.start ?? bucket}>
        {value === null ? null : value === 0 ? <i className="zero" /> : <i style={{ height: `${scale(value)}%` }} />}
      </span>)}</div> : <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
        {segments(points).map((segment, index) => segment.length > 1 ? <path className="line" d={segment.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x},${point.y}`).join(" ")} key={index} /> : null)}
      </svg>}
      {/* Dots mark the latest value, the one being read, and any value with no neighbour to draw a line to. */}
      {!asBars ? points.map((point, bucket) => {
        if (!point) return null;
        const lone = !points[bucket - 1] && !points[bucket + 1];
        if (!lone && bucket !== lastIndex && bucket !== active) return null;
        const hollow = bucket === lastIndex && result.buckets[bucket]?.partial;
        return <i className={`admin-trend-dot${bucket === active ? " active" : ""}${hollow ? " hollow" : ""}`} key={bucket} style={{ left: `${point.x}%`, top: `${point.y}%` }} />;
      }) : null}
      {active !== null && !asBars ? <b className="admin-trend-crosshair" style={{ left: `${position(active)}%` }} /> : null}
      {/* Inside the plot, beside the period being read, so the card's big number stays visible. */}
      {activeBucket && active !== null ? <div className={`admin-trend-tooltip ${position(active) > 50 ? "before" : "after"}`} role="status" style={{ left: `${position(active)}%` }}>
        <strong>{formatMetricValue(values[active] ?? null, definition.unit)}</strong>
        <span>{bucketRangeLabel(activeBucket.start, activeBucket.end, result.grain)}{activeBucket.partial ? " · so far" : ""}</span>
        {series.numerators && series.denominators && values[active] !== null ? <small>{formatMetricValue(series.numerators[active] ?? null, "count")} of {formatMetricValue(series.denominators[active] ?? null, "count")}</small> : null}
        {values[active] === null ? <small>{series.coverageFrom && activeBucket.end < series.coverageFrom ? "Before counting started" : missingValueLabel(definition, basis, series.denominators?.[active] ?? null)}</small> : null}
      </div> : null}
    </div>
    <figcaption aria-hidden="true" className="admin-trend-axis-x">
      <span>{axisDateLabel(firstStart, result.grain, withYear)}</span>
      {count > 2 ? <span className="mid" style={{ left: `${position(middle)}%` }}>{axisDateLabel(result.buckets[middle].start, result.grain, withYear)}</span> : null}
      {count > 1 ? <span className="end">{axisDateLabel(lastStart, result.grain, withYear)}{lastBucket?.partial ? " (so far)" : ""}</span> : null}
    </figcaption>
    {!asBars && present.length === 1 ? <p className="admin-trend-one">Only one number so far. The line starts with the next one.</p> : null}
  </figure>;
}

export function TrendTable({ definitions, result, selected, eyebrows = false }: {
  definitions: Map<string, MetricDefinition>;
  result: MetricSeriesResult;
  selected: string[];
  /** Key numbers mixes sources, so each column also says where it comes from. */
  eyebrows?: boolean;
}) {
  const seriesByKey = new Map(result.series.map((item) => [item.metricKey, item]));
  const columns = selected.filter((key) => definitions.has(key));
  const first = result.buckets[0]?.start ?? result.from;
  const last = result.buckets[result.buckets.length - 1]?.end ?? result.to;
  const withYear = first.slice(0, 4) !== last.slice(0, 4);
  return <article className="admin-panel admin-trend-table-panel"><div className="admin-metric-table-wrap" role="region" aria-label="Numbers table" tabIndex={0}><table className="admin-trend-table">
    <caption className="sr-only">Each number by {result.grain}</caption>
    <thead><tr><th scope="col">Period</th>{columns.map((key) => {
      const definition = definitions.get(key);
      return <th key={key} scope="col" title={definition?.label}>{eyebrows && definition ? <small>{sourceLabel(definition.source)}</small> : null}{shortMetricLabel(definition?.label ?? key)}</th>;
    })}</tr></thead>
    <tbody>{result.buckets.map((bucket, position) => <tr key={bucket.start}>
      <th scope="row">{shortBucketLabel(bucket.start, bucket.end, result.grain, withYear)}{bucket.partial ? " (so far)" : ""}</th>
      {columns.map((key) => <td key={key}>{formatMetricValue(seriesByKey.get(key)?.values[position] ?? null, definitions.get(key)?.unit ?? "count")}</td>)}
    </tr>)}</tbody>
    <tfoot><tr><th scope="row">Whole period</th>{columns.map((key) => <td key={key}>{formatMetricValue(seriesByKey.get(key)?.current ?? null, definitions.get(key)?.unit ?? "count")}</td>)}</tr></tfoot>
  </table></div></article>;
}

function contextLabel(definition: MetricDefinition, series: MetricSeries | null, lifetime: boolean) {
  if (definition.aggregation === "ratio") {
    const scope = lifetime ? "since each campaign started" : "this period";
    return series?.currentDenominator ? `${formatMetricValue(series.currentNumerator, "count")} of ${formatMetricValue(series.currentDenominator, "count")} ${scope}` : `Rate ${scope}`;
  }
  if (definition.aggregation === "last") {
    if (!definition.lastDate || definition.entryMode === "derived") return "Latest";
    return `Latest · ${definition.entryMode === "connector" ? "synced" : "logged"} ${bucketLabel(definition.lastDate, "day", "axis")}`;
  }
  return "Total for this period";
}

function emptyMessage(definition: MetricDefinition) {
  if (definition.entryMode === "derived") return "No activity in this period.";
  if (definition.entryMode === "connector") return "Nothing synced for this period yet.";
  return "No numbers logged for this period.";
}

function segments(points: Array<{ x: number; y: number } | null>) {
  const result: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  points.forEach((point) => {
    if (point) current.push(point);
    else if (current.length) { result.push(current); current = []; }
  });
  if (current.length) result.push(current);
  return result;
}
