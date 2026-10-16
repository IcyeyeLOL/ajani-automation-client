"use client";

import { startTransition, useActionState, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { deleteMetricValueAction, recordMetricValuesAction, syncDripifyAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import {
  DEFAULT_TREND_METRICS,
  bucketLabel,
  bucketRangeLabel,
  dayCount,
  defaultRangeCount,
  formatMetricValue,
  grainLabel,
  metricChange,
  metricGrains,
  metricSeriesSearch,
  presetLabel,
  rangeForPreset,
  rangePresets,
} from "@/lib/admin/metric-query";
import type {
  MetricCatalog, MetricCategory, MetricDefinition, MetricGrain, MetricSeries, MetricSeriesResult,
} from "@/lib/admin/metric-types";

const MAX_SELECTED = 8;
const STORAGE_KEY = "ajani_admin_trends_v1";

const categoryLabels: Record<MetricCategory, string> = {
  business: "Ajani Flow",
  outreach: "Outreach",
  content: "Content platforms",
  revenue: "Sales & revenue",
};

const entryGroups: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "youtube", label: "YouTube", sources: ["youtube"] },
  { id: "tiktok", label: "TikTok", sources: ["tiktok"] },
  { id: "instagram", label: "Instagram", sources: ["instagram"] },
  { id: "linkedin", label: "LinkedIn", sources: ["linkedin"] },
  { id: "x", label: "X", sources: ["x"] },
  { id: "revenue", label: "Sales & revenue", sources: ["sales", "revenue"] },
];

type Preferences = { grain: MetricGrain; count: number; metrics: string[] };
type SeriesState = {
  results: Record<string, MetricSeriesResult>;
  errors: Record<string, string>;
  latest: { search: string; data: MetricSeriesResult } | null;
};

export function MetricTrends({ catalog, refreshToken }: { catalog: MetricCatalog; refreshToken: string }) {
  const chartable = useMemo(() => catalog.metrics.filter((metric) => metric.chartable), [catalog.metrics]);
  const definitions = useMemo(() => new Map(catalog.metrics.map((metric) => [metric.key, metric])), [catalog.metrics]);
  const [preferences, setPreferences] = useState<Preferences>(() => initialPreferences(chartable));
  const [dimension, setDimension] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [seriesState, setSeriesState] = useState<SeriesState>({ results: {}, errors: {}, latest: null });

  const selected = useMemo(
    () => preferences.metrics.filter((key) => definitions.get(key)?.chartable),
    [definitions, preferences.metrics],
  );
  const dimensionLabel = (key: string) => accountLabel(catalog.dimensionLabels, key);
  const dimensions = useMemo(
    () => [...new Set(selected.flatMap((key) => definitions.get(key)?.dimensions ?? []))]
      .sort((left, right) => accountLabel(catalog.dimensionLabels, left).localeCompare(accountLabel(catalog.dimensionLabels, right))),
    [catalog.dimensionLabels, definitions, selected],
  );
  const activeDimension = dimensions.includes(dimension) ? dimension : "";
  const range = rangeForPreset(preferences.grain, preferences.count, catalog.today);
  const search = selected.length ? metricSeriesSearch({ metrics: selected, grain: preferences.grain, ...range, dimension: activeDimension || null }) : "";
  // The dashboard refresh token is part of the key, so every live refresh or
  // saved entry refetches instead of serving a stale cached trend.
  const cacheKey = search ? `${refreshToken}|${search}` : "";
  const result = cacheKey ? seriesState.results[cacheKey] ?? null : null;
  const error = cacheKey ? seriesState.errors[cacheKey] ?? null : null;
  const loading = Boolean(cacheKey) && !result && !error;
  // Refetches keep the previous frame, but a failed query never shows charts
  // from a different range or filter as if they were current.
  const shown = result ?? (loading ? seriesState.latest?.data ?? null : null);
  const dimmed = loading && seriesState.latest?.search !== search;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Storage is a convenience only; private windows may refuse it.
    }
  }, [preferences]);

  useEffect(() => {
    if (!cacheKey || seriesState.results[cacheKey] || seriesState.errors[cacheKey]) return;
    const controller = new AbortController();
    fetch(`/admin/analytics/series?${search}`, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Trends could not be loaded.");
        const data = body as MetricSeriesResult;
        setSeriesState((current) => ({
          results: pruned({ ...current.results, [cacheKey]: data }),
          errors: current.errors,
          latest: { search, data },
        }));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setSeriesState((current) => ({
          ...current,
          errors: pruned({ ...current.errors, [cacheKey]: reason instanceof Error ? reason.message : "Trends could not be loaded." }),
        }));
      });
    return () => controller.abort();
  }, [cacheKey, search, seriesState.errors, seriesState.results]);

  const setGrain = (grain: MetricGrain) => setPreferences((current) => ({ ...current, grain, count: defaultRangeCount[grain] }));
  const toggleMetric = (key: string) => setPreferences((current) => {
    if (current.metrics.includes(key)) return { ...current, metrics: current.metrics.filter((item) => item !== key) };
    if (current.metrics.length >= MAX_SELECTED) return current;
    return { ...current, metrics: [...current.metrics, key] };
  });

  if (catalog.status === "unavailable") {
    return <div className="admin-section-stack"><aside className="admin-setup-banner">
      <div><span>TRENDS UNAVAILABLE</span><b>Apply the 20261016 analytics migrations to this database, then refresh. No zero totals are implied.</b></div>
    </aside></div>;
  }

  const seriesByKey = new Map((shown?.series ?? []).map((item) => [item.metricKey, item]));
  const comparisonDays = shown ? dayCount(shown.previousFrom, shown.previousTo) : 0;

  return <div className="admin-section-stack">
    <section aria-label="Trend filters" className="admin-trend-filters">
      <div className="admin-segmented" role="group" aria-label="Period size">
        {metricGrains.map((grain) => <button aria-pressed={preferences.grain === grain} key={grain} onClick={() => setGrain(grain)} type="button">{grainLabel(grain).toUpperCase()}</button>)}
      </div>
      <div className="admin-segmented" role="group" aria-label="Range">
        {rangePresets[preferences.grain].map((count) => <button aria-pressed={preferences.count === count} key={count} onClick={() => setPreferences((current) => ({ ...current, count }))} type="button">{presetLabel(preferences.grain, count)}</button>)}
      </div>
      {dimensions.length ? <label className="admin-trend-select"><span>Account or channel</span><select onChange={(event) => setDimension(event.target.value)} value={activeDimension}><option value="">All combined</option>{dimensions.map((item) => <option key={item} value={item}>{dimensionLabel(item)}</option>)}</select></label> : null}
      <p className="admin-trend-range">{formatRange(range.from, range.to)}{comparisonDays ? ` · compared with the previous ${comparisonDays} days` : ""}</p>
      <button aria-pressed={showTable} className="admin-trend-table-toggle" onClick={() => setShowTable((value) => !value)} type="button">{showTable ? "SHOW CHARTS" : "SHOW TABLE"}</button>
    </section>

    {error ? <p className="admin-form-message error" role="alert">{error}</p> : null}

    {!selected.length ? <article className="admin-panel"><EmptyTrends /></article> : showTable && shown ? <TrendTable definitions={definitions} result={shown} selected={selected} /> : <section aria-busy={loading} className={`admin-trend-grid${dimmed && shown ? " is-loading" : ""}`}>
      {selected.map((key) => {
        const definition = definitions.get(key);
        if (!definition) return null;
        const series = seriesByKey.get(key) ?? null;
        return <TrendCard definition={definition} key={key} result={shown} series={series} activeDimension={activeDimension} activeDimensionLabel={dimensionLabel(activeDimension)} />;
      })}
    </section>}

    <MetricPicker metrics={chartable} onToggle={toggleMetric} selected={selected} />
    {catalog.metrics.some((metric) => metric.source === "dripify") ? <DripifySyncPanel catalog={catalog} /> : null}
    <MetricEntryPanel catalog={catalog} definitions={definitions} />
  </div>;
}

function TrendCard({ definition, result, series, activeDimension, activeDimensionLabel }: { definition: MetricDefinition; result: MetricSeriesResult | null; series: MetricSeries | null; activeDimension: string; activeDimensionLabel: string }) {
  const notTracked = Boolean(activeDimension) && !definition.dimensions.includes(activeDimension);
  const change = series && !notTracked ? metricChange(definition, series.current, series.previous) : null;
  const hasData = Boolean(series?.values.some((value) => value !== null));
  const trackedSince = series?.coverageFrom && result && series.coverageFrom > result.from ? series.coverageFrom : null;
  return <article className="admin-panel admin-trend-card">
    <header>
      <div><p>{definition.source.toUpperCase()}</p><h3>{definition.label}</h3></div>
      {change ? <small className={`admin-trend-change ${change.tone}`}>{change.label}</small> : null}
    </header>
    <div className="admin-trend-headline">
      <strong>{formatMetricValue(notTracked ? null : series?.current ?? null, definition.unit, "compact")}</strong>
      <span>{summaryLabel(definition, series)}{trackedSince ? ` · tracked since ${bucketLabel(trackedSince, "day")}` : ""}</span>
    </div>
    {notTracked ? <p className="admin-trend-empty">Not tracked for {activeDimensionLabel}.</p>
      : !result || !series ? <div className="admin-trend-skeleton" aria-hidden="true" />
        : hasData ? <TrendChart definition={definition} result={result} series={series} />
          : <p className="admin-trend-empty">{emptyMessage(definition)}</p>}
  </article>;
}

function TrendChart({ definition, result, series }: { definition: MetricDefinition; result: MetricSeriesResult; series: MetricSeries }) {
  const [active, setActive] = useState<number | null>(null);
  const count = result.buckets.length;
  const values = series.values;
  const asBars = definition.aggregation === "sum";
  const present = values.filter((value): value is number => value !== null);
  const domain = chartDomain(present, asBars || definition.unit === "ratio");
  const scale = (value: number) => domain.max === domain.min ? 50 : ((value - domain.min) / (domain.max - domain.min)) * 100;
  const index = active ?? null;
  const activeBucket = index === null ? null : result.buckets[index];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * count)));
    setActive(position);
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
  const lineSegments = asBars ? [] : segments(values.map((value, bucket) => value === null ? null : { x: position(bucket), y: 100 - scale(value) }));

  return <figure className="admin-trend-figure">
    <div className="admin-trend-axis-y" aria-hidden="true"><span>{formatMetricValue(domain.max, definition.unit, "compact")}</span><span>{formatMetricValue(domain.min, definition.unit, "compact")}</span></div>
    <div
      aria-label={`${definition.label}, ${grainLabel(result.grain).toLowerCase()}. Use the arrow keys to read each period.`}
      className="admin-trend-plot"
      onBlur={() => setActive(null)}
      onKeyDown={step}
      onPointerLeave={() => setActive(null)}
      onPointerMove={pick}
      role="img"
      tabIndex={0}
    >
      {asBars ? <div className="admin-trend-bars">{values.map((value, bucket) => <span className={`${result.buckets[bucket]?.partial ? "partial" : ""}${index === bucket ? " active" : ""}`} key={result.buckets[bucket]?.start ?? bucket}>
        {value !== null && value > 0 ? <i style={{ height: `${Math.max(2, scale(value))}%` }} /> : null}
      </span>)}</div> : <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
        {lineSegments.map((segment, position) => <g key={position}>
          {segment.length > 1 ? <path className="area" d={`M${segment[0].x},100 ${segment.map((point) => `L${point.x},${point.y}`).join(" ")} L${segment[segment.length - 1].x},100 Z`} /> : null}
          <path className="line" d={segment.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x},${point.y}`).join(" ")} />
        </g>)}
      </svg>}
      {!asBars ? values.map((value, bucket) => value === null || (bucket !== count - 1 && bucket !== index) ? null : <i className={`admin-trend-dot${bucket === index ? " active" : ""}`} key={bucket} style={{ left: `${position(bucket)}%`, top: `${100 - scale(value)}%` }} />) : null}
      {index !== null && !asBars ? <b className="admin-trend-crosshair" style={{ left: `${position(index)}%` }} /> : null}
      {activeBucket && index !== null ? <div className={`admin-trend-tooltip ${tooltipEdge(position(index))}`} role="status" style={{ left: `${position(index)}%` }}>
        <strong>{formatMetricValue(values[index] ?? null, definition.unit)}</strong>
        <span>{bucketRangeLabel(activeBucket.start, activeBucket.end, result.grain)}{activeBucket.partial ? " · so far" : ""}</span>
        {series.numerators && series.denominators ? <small>{formatMetricValue(series.numerators[index] ?? null, "count")} of {formatMetricValue(series.denominators[index] ?? null, "count")}</small> : null}
        {values[index] === null ? <small>{definition.entryMode === "derived" ? "No activity" : "Not recorded"}</small> : null}
      </div> : null}
    </div>
    <figcaption className="admin-trend-axis-x" aria-hidden="true">
      <span>{bucketLabel(result.buckets[0]?.start ?? result.from, result.grain, "axis")}</span>
      <span>{bucketLabel(result.buckets[count - 1]?.start ?? result.to, result.grain, "axis")}{result.buckets[count - 1]?.partial ? " (so far)" : ""}</span>
    </figcaption>
  </figure>;
}

function TrendTable({ definitions, result, selected }: { definitions: Map<string, MetricDefinition>; result: MetricSeriesResult; selected: string[] }) {
  const seriesByKey = new Map(result.series.map((item) => [item.metricKey, item]));
  const columns = selected.filter((key) => definitions.has(key));
  return <article className="admin-panel admin-trend-table-panel"><div className="admin-metric-table-wrap"><table className="admin-trend-table">
    <caption className="sr-only">{grainLabel(result.grain)} values for the selected metrics</caption>
    <thead><tr><th scope="col">PERIOD</th>{columns.map((key) => <th key={key} scope="col">{definitions.get(key)?.label}</th>)}</tr></thead>
    <tbody>{result.buckets.map((bucket, position) => <tr key={bucket.start}>
      <th scope="row">{bucketRangeLabel(bucket.start, bucket.end, result.grain)}{bucket.partial ? " (so far)" : ""}</th>
      {columns.map((key) => <td key={key}>{formatMetricValue(seriesByKey.get(key)?.values[position] ?? null, definitions.get(key)?.unit ?? "count")}</td>)}
    </tr>)}</tbody>
    <tfoot><tr><th scope="row">WHOLE RANGE</th>{columns.map((key) => <td key={key}>{formatMetricValue(seriesByKey.get(key)?.current ?? null, definitions.get(key)?.unit ?? "count")}</td>)}</tr></tfoot>
  </table></div></article>;
}

function MetricPicker({ metrics, selected, onToggle }: { metrics: MetricDefinition[]; selected: string[]; onToggle: (key: string) => void }) {
  const groups = (Object.keys(categoryLabels) as MetricCategory[]).map((category) => ({ category, items: metrics.filter((metric) => metric.category === category) })).filter((group) => group.items.length);
  return <article className="admin-panel admin-trend-picker">
    <header className="admin-panel-head"><div><p>CHOOSE WHAT TO TRACK</p><h2>Pick up to {MAX_SELECTED} numbers.</h2></div><span>{selected.length}/{MAX_SELECTED} SELECTED</span></header>
    <div>{groups.map((group) => <section key={group.category}>
      <h3>{categoryLabels[group.category]}</h3>
      <div>{group.items.map((metric) => {
        const isSelected = selected.includes(metric.key);
        const recorded = metric.entryMode === "derived" || Boolean(metric.lastDate);
        return <button aria-pressed={isSelected} disabled={!isSelected && selected.length >= MAX_SELECTED} key={metric.key} onClick={() => onToggle(metric.key)} title={metric.description} type="button">
          {metric.label}{recorded ? null : <small> · no data yet</small>}
        </button>;
      })}</div>
    </section>)}</div>
  </article>;
}

function DripifySyncPanel({ catalog }: { catalog: MetricCatalog }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(syncDripifyAction, initialAdminActionState);
  const configured = catalog.connectors.dripify;
  const lastSynced = catalog.metrics.reduce<string | null>((latest, metric) => metric.source === "dripify" && metric.lastDate && (!latest || metric.lastDate > latest) ? metric.lastDate : latest, null);

  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);

  return <article className="admin-panel admin-trend-connector">
    <header className="admin-panel-head"><div><p>DRIPIFY SYNC</p><h2>{configured ? "Campaign numbers arrive every night." : "Connect Dripify to chart every campaign."}</h2></div><span>{lastSynced ? `LAST SYNCED ${bucketLabel(lastSynced, "day").toUpperCase()}` : "NOT SYNCED YET"}</span></header>
    <form action={action}>
      <div className="admin-form-footer">
        <div>{state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p>
          : <p>{configured ? "Each campaign's totals are saved once a day and charted per campaign under “Account or channel”. Sync now to refresh today's numbers." : "Add DRIPIFY_API_KEY in Vercel's environment variables, then redeploy. The key stays on the server."}</p>}</div>
        <button disabled={pending || !configured} type="submit">{pending ? "SYNCING" : "SYNC NOW"}<b>→</b></button>
      </div>
    </form>
  </article>;
}

function MetricEntryPanel({ catalog, definitions }: { catalog: MetricCatalog; definitions: Map<string, MetricDefinition> }) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(entryGroups[0].id);
  const [state, action, pending] = useActionState(recordMetricValuesAction, initialAdminActionState);
  const group = entryGroups.find((item) => item.id === groupId) ?? entryGroups[0];
  const fields = catalog.metrics.filter((metric) => metric.entryMode === "manual" && group.sources.includes(metric.source));

  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);

  return <article className="admin-panel admin-trend-entry" id="log-platform-numbers">
    <header className="admin-panel-head"><div><p>LOG PLATFORM NUMBERS</p><h2>Add what the platforms show you.</h2></div><span>RE-ENTERING A DAY REPLACES IT</span></header>
    <div className="admin-segmented admin-trend-entry-tabs" role="group" aria-label="Platform">
      {entryGroups.map((item) => <button aria-pressed={item.id === group.id} key={item.id} onClick={() => setGroupId(item.id)} type="button">{item.label.toUpperCase()}</button>)}
    </div>
    <EntryForm action={action} entityId={state.entityId} fields={fields} key={group.id} message={state.message} pending={pending} status={state.status} today={catalog.today} />
    <RecentEntries definitions={definitions} entries={catalog.recentEntries} />
  </article>;
}

function EntryForm({ action, entityId, fields, today, pending, status, message }: { action: (formData: FormData) => void; entityId?: string; fields: MetricDefinition[]; today: string; pending: boolean; status: string; message: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [clearedFor, setClearedFor] = useState(entityId);
  // After a successful save, clear the numbers but keep the date and account
  // so the next platform for the same day is quick to log.
  if (status === "success" && entityId !== clearedFor) {
    setClearedFor(entityId);
    setValues({});
  }
  // Submitting through onSubmit (not the form action prop) stops React from
  // resetting the date and account after a rejected save; a corrected retry
  // must never land on today's date or the main account by accident.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
  const payload = fields.flatMap((field) => {
    const raw = values[field.key]?.trim().replaceAll(",", "");
    if (!raw) return [];
    const number = Number(raw);
    if (!Number.isFinite(number)) return [];
    return [{ metricKey: field.key, value: field.unit === "currency_cents" ? Math.round(number * 100) : number }];
  });
  return <form onSubmit={submit}>
    <input name="values" type="hidden" value={JSON.stringify(payload)} />
    <div className="admin-trend-entry-context">
      <label className="admin-field"><span>Date</span><input defaultValue={today} max={today} name="date" required type="date" /></label>
      <label className="admin-field"><span>Account, optional</span><input maxLength={80} name="dimension" placeholder="Leave blank for your main account" /><small>Use a handle like @ajaniflow to track more than one account.</small></label>
    </div>
    <div className="admin-trend-entry-grid">{fields.map((field) => <label className="admin-field" key={field.key}>
      <span>{field.label.replace(/^(YouTube|TikTok|Instagram|LinkedIn|X) /, "")}{field.unit === "currency_cents" ? " ($)" : ""}</span>
      <input inputMode="decimal" min="0" onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} step={field.unit === "hours" || field.unit === "currency_cents" ? "0.01" : "1"} type="number" value={values[field.key] ?? ""} />
      <small>{field.aggregation === "last" ? "Total on this date" : "Amount for this date (or a period ending on it)"}</small>
    </label>)}</div>
    <div className="admin-form-footer"><div>{message ? <p className={`admin-form-message ${status}`} role="status">{message}</p> : <p>Leave a field blank to skip it. Totals such as followers are carried forward until you record a newer number.</p>}</div><button disabled={pending || !payload.length} type="submit">{pending ? "SAVING" : "SAVE NUMBERS"}<b>→</b></button></div>
  </form>;
}

function RecentEntries({ entries, definitions }: { entries: MetricCatalog["recentEntries"]; definitions: Map<string, MetricDefinition> }) {
  if (!entries.length) return null;
  return <div className="admin-trend-recent">
    <h3>Recently recorded</h3>
    <ul>{entries.slice(0, 12).map((entry) => {
      const definition = definitions.get(entry.metricKey);
      return <li key={`${entry.metricKey}:${entry.date}:${entry.dimension}`}>
        <time>{bucketLabel(entry.date, "day")}</time>
        <p><b>{definition?.label ?? entry.metricKey}</b><span>{entry.dimension || "Main account"}</span></p>
        <strong>{formatMetricValue(entry.value, definition?.unit ?? "count")}</strong>
        <DeleteEntryButton date={entry.date} dimension={entry.dimension} metricKey={entry.metricKey} />
      </li>;
    })}</ul>
  </div>;
}

function DeleteEntryButton({ metricKey, date, dimension }: { metricKey: string; date: string; dimension: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(deleteMetricValueAction, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  return <form action={action}>
    <input name="metricKey" type="hidden" value={metricKey} />
    <input name="date" type="hidden" value={date} />
    <input name="dimension" type="hidden" value={dimension} />
    <button aria-label={`Remove ${metricKey} for ${date}`} disabled={pending} type="submit">{pending ? "…" : state.status === "error" ? "RETRY" : "REMOVE"}</button>
  </form>;
}

function EmptyTrends() {
  return <div className="admin-empty"><i>+</i><b>Pick a number to chart</b><p>Choose up to {MAX_SELECTED} numbers below. Each gets its own chart so different units never share an axis.</p></div>;
}

/**
 * Connector accounts (Dripify campaigns) show their names; handles and
 * channel/method keys are already readable. Own keys only: an account named
 * "constructor" must not resolve to Object.prototype.
 */
function accountLabel(labels: Record<string, string>, key: string) {
  return Object.hasOwn(labels, key) ? labels[key] : key;
}

function emptyMessage(definition: MetricDefinition) {
  if (definition.entryMode === "derived") return "No activity in this range.";
  if (definition.entryMode === "connector") return "Nothing synced in this range yet.";
  return "Nothing recorded in this range yet. Log numbers below.";
}

function summaryLabel(definition: MetricDefinition, series: MetricSeries | null) {
  if (definition.aggregation === "ratio") {
    return series?.currentDenominator ? `${formatMetricValue(series.currentNumerator, "count")} of ${formatMetricValue(series.currentDenominator, "count")} in range` : "Rate across the range";
  }
  return definition.aggregation === "last" ? "Latest total" : "Total in range";
}

function tooltipEdge(left: number) {
  return left < 18 ? "start" : left > 82 ? "end" : "";
}

function chartDomain(values: number[], fromZero: boolean) {
  if (!values.length) return { min: 0, max: 1 };
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (fromZero || min === max) return { min: fromZero ? 0 : Math.max(0, min - Math.abs(min) * 0.1), max: niceCeiling(max || 1) };
  // Stocks (followers, MRR) zoom to their range, snapped to round axis values.
  const step = niceCeiling((max - min) / 2);
  return { min: Math.max(0, Math.floor(min / step) * step), max: Math.ceil(max / step) * step };
}

function niceCeiling(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
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

function pruned<T>(record: Record<string, T>) {
  const keys = Object.keys(record);
  return keys.length <= 24 ? record : Object.fromEntries(keys.slice(-24).map((key) => [key, record[key]]));
}

function initialPreferences(metrics: MetricDefinition[]): Preferences {
  const known = new Set(metrics.map((metric) => metric.key));
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Preferences> | null;
    if (stored && metricGrains.includes(stored.grain as MetricGrain) && Array.isArray(stored.metrics)) {
      const grain = stored.grain as MetricGrain;
      return {
        grain,
        count: rangePresets[grain].includes(Number(stored.count)) ? Number(stored.count) : defaultRangeCount[grain],
        metrics: stored.metrics.filter((key): key is string => typeof key === "string" && known.has(key)).slice(0, MAX_SELECTED),
      };
    }
  } catch {
    // Fall through to defaults when storage is unavailable or corrupt.
  }
  const recorded = metrics.filter((metric) => metric.entryMode !== "derived" && metric.lastDate).map((metric) => metric.key);
  return {
    grain: "week",
    count: defaultRangeCount.week,
    metrics: [...DEFAULT_TREND_METRICS.filter((key) => known.has(key)), ...recorded].slice(0, MAX_SELECTED),
  };
}

function formatRange(from: string, to: string) {
  return `${bucketLabel(from, "day")} – ${bucketLabel(to, "day")} (UTC)`;
}
