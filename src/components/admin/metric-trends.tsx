"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { MetricLog, entryGroups, type LogRequest } from "@/components/admin/metric-log";
import { TrendCard, TrendTable } from "@/components/admin/trend-card";
import {
  LEGACY_TREND_STORAGE_KEY,
  MAX_TREND_PICKS,
  TREND_GRAINS,
  TREND_STORAGE_KEY,
  bucketLabel,
  channelLabel,
  dayCount,
  grainForPeriod,
  inView,
  isLifetimeRate,
  metricSeriesSearch,
  rangeLabel,
  readTrendPreferences,
  shortMetricLabel,
  sourceLabel,
  trendPeriod,
  trendPeriods,
  trendRange,
  trendBasis,
  trendViews,
  viewPicks,
  type TrendGrain,
  type TrendPeriod,
  type TrendPreferences,
  type TrendView,
  type TrendViewId,
} from "@/lib/admin/metric-query";
import type { MetricCatalog, MetricDefinition, MetricSeriesResult } from "@/lib/admin/metric-types";
// Types only: the generator itself is loaded on demand, and only while sample data is on.
import type { sampleMetricSeries } from "@/lib/admin/sample-data";

type SampleSeries = typeof sampleMetricSeries;
type SeriesError = { message: string; refresh: boolean };
type SeriesState = {
  results: Record<string, MetricSeriesResult>;
  errors: Record<string, SeriesError>;
  latest: { search: string; data: MetricSeriesResult } | null;
};

const LOAD_FAILED = "Trends couldn't load just now.";
const grainNames: Record<TrendGrain, string> = { day: "Day", week: "Week", month: "Month" };

export function MetricTrends({ catalog, refreshToken, sampleMode = false, openLog = false, onNavigate }: {
  catalog: MetricCatalog;
  refreshToken: string;
  sampleMode?: boolean;
  /** Open "Log numbers" and scroll to it on arrival, as the Overview button does. */
  openLog?: boolean;
  onNavigate?: (section: "connections" | "outreach") => void;
}) {
  const router = useRouter();
  // After a card is removed, where keyboard focus goes next: the following card's ✕, or "Add".
  const focusAfterRemove = useRef<string | null | undefined>(undefined);
  const chartable = useMemo(() => catalog.metrics.filter((metric) => metric.chartable), [catalog.metrics]);
  const known = useMemo(() => new Set(chartable.map((metric) => metric.key)), [chartable]);
  const definitions = useMemo(() => new Map(catalog.metrics.map((metric) => [metric.key, metric])), [catalog.metrics]);
  // A view is offered only when its sources have something to chart.
  const views = useMemo(() => trendViews.filter((view) => chartable.some((metric) => inView(view, metric.source))), [chartable]);
  const [preferences, setPreferences] = useState<TrendPreferences>(initialPreferences);
  const view = views.find((item) => item.id === preferences.view) ?? views[0] ?? trendViews[0];
  const picks = useMemo(() => viewPicks(preferences, view, known), [known, preferences, view]);
  const [dimension, setDimension] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [seriesState, setSeriesState] = useState<SeriesState>({ results: {}, errors: {}, latest: null });
  const [sampleSeries, setSampleSeries] = useState<SampleSeries | null>(null);
  const [sampleFailed, setSampleFailed] = useState(false);
  const [logRequest, setLogRequest] = useState<LogRequest>({ token: openLog ? 1 : 0, sources: null });
  const [seenOpenLog, setSeenOpenLog] = useState(openLog);
  if (openLog !== seenOpenLog) {
    setSeenOpenLog(openLog);
    if (openLog) setLogRequest((current) => ({ token: current.token + 1, sources: null }));
  }

  const dimensions = useMemo(() => view.account
    ? [...new Set(picks.flatMap((key) => definitions.get(key)?.dimensions ?? []))]
      // Campaigns only: Dripify's team inboxes are not campaigns.
      .filter((key) => view.id !== "dripify" || key.startsWith("dripify:"))
      .sort((left, right) => dimensionName(view, catalog.dimensionLabels, left).localeCompare(dimensionName(view, catalog.dimensionLabels, right)))
    : [], [catalog.dimensionLabels, definitions, picks, view]);
  const activeDimension = dimensions.includes(dimension) ? dimension : "";
  const { grain, from, to } = trendRange(preferences.period, preferences.grain, catalog.today);
  const search = picks.length ? metricSeriesSearch({ metrics: picks, grain, from, to, dimension: activeDimension || null }) : "";
  // The dashboard refresh token is part of the key, so every live refresh or
  // saved entry refetches instead of serving a stale cached trend.
  const cacheKey = search ? `${refreshToken}|${search}` : "";

  useEffect(() => {
    if (!sampleMode || sampleSeries || sampleFailed) return;
    let live = true;
    // Real-mode browsers never download the sample generator.
    import("@/lib/admin/sample-data")
      .then((sample) => { if (live) setSampleSeries(() => sample.sampleMetricSeries); })
      .catch(() => { if (live) setSampleFailed(true); });
    return () => { live = false; };
  }, [sampleFailed, sampleMode, sampleSeries]);
  // Sample data is generated here, in the browser, so no request is made.
  const sampleResult = useMemo(
    () => sampleMode && sampleSeries && picks.length
      ? sampleSeries({ metrics: picks, grain, from, to, dimension: activeDimension || null }, catalog.metrics, catalog.today)
      : null,
    [activeDimension, catalog.metrics, catalog.today, from, grain, picks, sampleMode, sampleSeries, to],
  );
  const result = sampleMode ? sampleResult : cacheKey ? seriesState.results[cacheKey] ?? null : null;
  const error = sampleMode ? sampleFailed && search ? { message: LOAD_FAILED, refresh: false } : null : cacheKey ? seriesState.errors[cacheKey] ?? null : null;
  const loading = Boolean(cacheKey) && !result && !error;
  // Refetches keep the previous frame, but a failed query never shows charts
  // from a different range or filter as if they were current, and real
  // numbers never stand in under the sample banner while the sample loads.
  const shown = result ?? (loading && !sampleMode ? seriesState.latest?.data ?? null : null);
  const dimmed = loading && seriesState.latest?.search !== search;

  useEffect(() => {
    // Only a loaded catalog can confirm the view; an outage must not overwrite it.
    if (catalog.status !== "available") return;
    try {
      window.localStorage.setItem(TREND_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Storage is a convenience only; private windows may refuse it.
    }
  }, [catalog.status, preferences]);

  useEffect(() => {
    if (sampleMode || !cacheKey || seriesState.results[cacheKey] || seriesState.errors[cacheKey]) return;
    const controller = new AbortController();
    const fail = (failure: SeriesError) => setSeriesState((current) => ({ ...current, errors: pruned({ ...current.errors, [cacheKey]: failure }) }));
    fetch(`/admin/analytics/series?${search}`, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          // The server's own words when it can explain (sample data switched on
          // in another tab, a bad query); a calm generic line for outages.
          fail({ message: response.status < 500 && typeof body.error === "string" ? body.error : LOAD_FAILED, refresh: response.status === 409 });
          return;
        }
        const data = body as MetricSeriesResult;
        setSeriesState((current) => ({ results: pruned({ ...current.results, [cacheKey]: data }), errors: current.errors, latest: { search, data } }));
      })
      .catch(() => { if (!controller.signal.aborted) fail({ message: LOAD_FAILED, refresh: false }); });
    return () => controller.abort();
  }, [cacheKey, sampleMode, search, seriesState.errors, seriesState.results]);

  useEffect(() => {
    if (!pickerOpen) return;
    // Focus the picker itself (not its search box, which would pop up a phone keyboard) so Tab goes through it next.
    const picker = document.getElementById("trend-picker");
    picker?.focus({ preventScroll: true });
    picker?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pickerOpen]);

  useEffect(() => {
    if (focusAfterRemove.current === undefined) return;
    const next = focusAfterRemove.current;
    focusAfterRemove.current = undefined;
    const target = next ? document.querySelector<HTMLElement>(`.admin-trend-card[data-metric="${CSS.escape(next)}"] .admin-trend-remove`) : null;
    (target ?? document.getElementById("trend-add"))?.focus();
  }, [picks]);

  if (catalog.status === "unavailable") {
    return <div className="admin-section-stack admin-trends">
      <p className="admin-trend-notice" role="status">Trends can&apos;t load yet. Ask your developer to apply the latest analytics update. Nothing is shown as zero meanwhile.</p>
    </div>;
  }

  const chooseView = (id: TrendViewId) => {
    setPreferences((current) => ({ ...current, view: id }));
    setDimension("");
    setPickerOpen(false);
  };
  const choosePeriod = (period: TrendPeriod) => setPreferences((current) => ({ ...current, period, grain: grainForPeriod(period, current.grain) }));
  const setPicks = (next: string[] | null) => setPreferences((current) => {
    const saved = { ...current.picks };
    if (next) saved[view.id] = next;
    else delete saved[view.id];
    return { ...current, picks: saved };
  });
  const togglePick = (key: string) => setPicks(picks.includes(key) ? picks.filter((item) => item !== key) : picks.length >= MAX_TREND_PICKS ? picks : [...picks, key]);
  const removePick = (key: string) => {
    const shownKeys = picks.filter((item) => definitions.has(item));
    focusAfterRemove.current = shownKeys[shownKeys.indexOf(key) + 1] ?? null;
    setPicks(picks.filter((item) => item !== key));
  };
  const retry = () => {
    setSampleFailed(false);
    setSeriesState((current) => {
      const errors = { ...current.errors };
      delete errors[cacheKey];
      return { ...current, errors };
    });
  };
  const requestLog = (sources: string[] | null) => setLogRequest((current) => ({ token: current.token + 1, sources }));
  const closePicker = () => {
    setPickerOpen(false);
    document.getElementById("trend-add")?.focus();
  };
  const cardAction = (definition: MetricDefinition) => {
    const group = definition.entryMode === "manual" ? entryGroups.find((item) => item.sources.includes(definition.source)) : null;
    if (group) return { label: `Log ${group.label} numbers`, run: () => requestLog([definition.source]) };
    if (definition.entryMode === "connector" && onNavigate) return { label: "Check the connection", run: () => onNavigate("connections") };
    return null;
  };

  const seriesByKey = new Map((shown?.series ?? []).map((item) => [item.metricKey, item]));
  const span = result ? { from: result.from, to: result.to, days: dayCount(result.previousFrom, result.previousTo) } : { from, to, days: dayCount(from, to) };
  const period = trendPeriod(preferences.period);
  const lookup = (key: string) => definitions.get(key);
  const addButton = (className: string, label = "Add or remove numbers") => <button aria-controls="trend-picker" aria-expanded={pickerOpen} className={className} id="trend-add" onClick={() => setPickerOpen((value) => !value)} type="button">
    {className === "admin-trend-add" ? <i aria-hidden="true">+</i> : null}{label}
  </button>;

  return <div className="admin-section-stack admin-trends">
    <section aria-label="Trend filters" className="admin-trend-filters">
      <div aria-label="Show" className="admin-trend-chips admin-trend-views" role="group">
        {views.map((item) => <button aria-pressed={item.id === view.id} key={item.id} onClick={() => chooseView(item.id)} type="button">{item.label}</button>)}
      </div>
      <div className="admin-trend-controls">
        <label className="admin-trend-field admin-trend-show"><span>Show</span>
          <select onChange={(event) => chooseView(event.target.value as TrendViewId)} value={view.id}>{views.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <label className="admin-trend-field"><span>Period</span>
          <select onChange={(event) => choosePeriod(event.target.value as TrendPeriod)} value={period.id}>{trendPeriods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <div aria-label="Show by" className="admin-trend-field" role="group"><span aria-hidden="true">Show by</span>
          <div className="admin-trend-segmented">{TREND_GRAINS.map((item) => {
            const offered = Boolean(period.counts[item]);
            return <button aria-pressed={grain === item} disabled={!offered} key={item} onClick={() => setPreferences((current) => ({ ...current, grain: item }))} title={offered ? undefined : "Not available for this period"} type="button">{grainNames[item]}</button>;
          })}</div>
        </div>
        {view.account && dimensions.length ? <label className="admin-trend-field"><span>{view.account.label}</span>
          <select onChange={(event) => setDimension(event.target.value)} value={activeDimension}>
            <option value="">{view.account.all}</option>
            {dimensions.map((item) => <option key={item} value={item}>{dimensionName(view, catalog.dimensionLabels, item)}</option>)}
          </select>
        </label> : null}
      </div>
      <p className="admin-trend-range">{rangeLabel(span.from, span.to)} · <span className="long">compared with</span><span className="short">vs</span> the {span.days} days before</p>
    </section>

    {view.id === "dripify" ? <DripifyNote catalog={catalog} onNavigate={onNavigate} /> : null}

    {error ? <div className="admin-trend-notice" role="alert">
      <p>{error.message}</p>
      {error.refresh ? <button className="admin-trend-button" onClick={() => { retry(); router.refresh(); }} type="button">Refresh the page</button>
        : <button className="admin-trend-button" onClick={retry} type="button">Try again</button>}
    </div> : null}

    {!picks.length ? <div className="admin-panel admin-trend-empty-view">
      <p>No numbers picked for this view.</p>
      <div>
        {addButton("admin-trend-button primary", "Add a number")}
        {view.suggested.some((key) => known.has(key)) ? <button className="admin-trend-button" onClick={() => setPicks(null)} type="button">Use suggested</button> : null}
      </div>
    </div> : error ? null : showTable && shown ? <TrendTable definitions={definitions} eyebrows={view.id === "key"} result={shown} selected={picks} /> : <section aria-busy={loading} aria-label="Charts" className={`admin-trend-grid${dimmed && shown ? " is-loading" : ""}`}>
      {picks.map((key) => {
        const definition = definitions.get(key);
        if (!definition) return null;
        const notSplit = activeDimension && view.account && !definition.dimensions.includes(activeDimension) ? view.account : null;
        // A rate with nothing to show is fixed by logging (or syncing) what it divides by.
        const basis = trendBasis(definition, lookup);
        return <TrendCard
          action={cardAction(basis)}
          basis={basis}
          definition={definition}
          eyebrow={view.id === "key" ? sourceLabel(definition.source) : null}
          key={key}
          lifetime={isLifetimeRate(definition, lookup)}
          notSplit={notSplit}
          onRemove={() => removePick(key)}
          period={period.label}
          result={shown}
          series={seriesByKey.get(key) ?? null}
        />;
      })}
      {addButton("admin-trend-add")}
    </section>}

    {/* Right after "Add", so Tab reaches the picker before the links below it. */}
    {pickerOpen ? <MetricPicker lookup={lookup} metrics={chartable} onDone={closePicker} onReset={() => setPicks(null)} onToggle={togglePick} picks={picks} view={view} /> : null}

    {picks.length ? <div className="admin-trend-foot">
      {showTable || error ? addButton("admin-trend-link") : null}
      {shown && !error ? <button aria-pressed={showTable} className="admin-trend-link" onClick={() => setShowTable((value) => !value)} type="button">{showTable ? "Back to charts" : "See as a table"}</button> : null}
    </div> : null}

    <MetricLog catalog={catalog} definitions={definitions} onNavigate={onNavigate} request={logRequest} sampleMode={sampleMode} viewId={view.id} viewSources={view.sources} />
  </div>;
}

function MetricPicker({ view, metrics, picks, lookup, onToggle, onReset, onDone }: {
  view: TrendView;
  metrics: MetricDefinition[];
  picks: string[];
  lookup: (key: string) => MetricDefinition | undefined;
  onToggle: (key: string) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const atCap = picks.length >= MAX_TREND_PICKS;
  const needle = query.trim().toLowerCase();
  const escape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onDone();
  };
  const heading = view.id === "key" ? "Your key numbers" : `Numbers in ${view.label}`;
  const matches = metrics.filter((metric) => inView(view, metric.source) && (!needle || `${metric.label} ${metric.description}`.toLowerCase().includes(needle)));
  // Key numbers can hold anything, so its list is grouped the way the views are.
  const groups = view.sources === null
    ? [
      ...trendViews.filter((item) => item.sources).map((item) => ({ label: item.label, items: matches.filter((metric) => item.sources?.includes(metric.source)) })),
      { label: "Other", items: matches.filter((metric) => !trendViews.some((item) => item.sources?.includes(metric.source))) },
    ].filter((group) => group.items.length)
    : [{ label: null, items: matches }];
  return <section aria-label={heading} className="admin-panel admin-trend-picker" id="trend-picker" onKeyDown={escape} tabIndex={-1}>
    <header>
      <div><h2>{heading}</h2><p>Pick up to {MAX_TREND_PICKS}. Each gets its own chart.</p></div>
      <span>{picks.length} of {MAX_TREND_PICKS} picked</span>
    </header>
    {view.id === "key" ? <label className="admin-trend-search"><span>Find a number</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Followers, replies, cash…" type="search" value={query} /></label> : null}
    <div className="admin-trend-options">
      {groups.length ? groups.map((group) => <fieldset key={group.label ?? "all"}>
        <legend className={group.label ? undefined : "sr-only"}>{group.label ?? heading}</legend>
        <div>{group.items.map((metric) => {
          const checked = picks.includes(metric.key);
          return <label className="admin-trend-option" key={metric.key}>
            <input checked={checked} disabled={!checked && atCap} onChange={() => onToggle(metric.key)} type="checkbox" />
            <span>
              <b>{view.id === "key" ? metric.label.replace(/ \((lifetime|of contacted)\)$/, "") : shortMetricLabel(metric.label)}
                {isLifetimeRate(metric, lookup) ? <em>All time</em> : null}
                {metric.entryMode !== "derived" && !metric.lastDate ? <em>{metric.entryMode === "connector" ? "Not synced yet" : "Not logged yet"}</em> : null}
              </b>
              <small>{metric.description}</small>
            </span>
          </label>;
        })}</div>
      </fieldset>) : <p className="admin-trend-picker-none">No number matches “{query.trim()}”.</p>}
    </div>
    <footer>
      <p role="status">{atCap ? `${MAX_TREND_PICKS} is the most for one view. Remove one to add another.` : ""}</p>
      <div>
        <button className="admin-trend-button" onClick={onReset} type="button">Reset to suggested</button>
        <button className="admin-trend-button primary" onClick={onDone} type="button">Done</button>
      </div>
    </footer>
  </section>;
}

/** Dripify is managed under Connections; Trends only says when it last synced. */
function DripifyNote({ catalog, onNavigate }: { catalog: MetricCatalog; onNavigate?: (section: "connections") => void }) {
  const configured = catalog.connectors.dripify;
  const lastSynced = catalog.metrics.reduce<string | null>((latest, metric) => metric.source === "dripify" && metric.lastDate && (!latest || metric.lastDate > latest) ? metric.lastDate : latest, null);
  return <p className="admin-trend-note">
    <span>{configured ? `Synced from Dripify every night. ${lastSynced ? `Last synced ${bucketLabel(lastSynced, "day", "axis")}.` : "Not synced yet."}` : "Dripify isn't connected yet."}</span>
    {onNavigate ? <button className="admin-trend-link" onClick={() => onNavigate("connections")} type="button">{configured ? "Manage in Connections" : "Set it up in Connections"}</button> : null}
  </p>;
}

/**
 * Outreach splits by channel and method; connector accounts (Dripify
 * campaigns) show their names; handles are already readable. Own keys only:
 * an account named "constructor" must not resolve to Object.prototype.
 */
function dimensionName(view: TrendView, labels: Record<string, string>, key: string) {
  if (view.id === "outreach") return channelLabel(key);
  return Object.hasOwn(labels, key) ? labels[key] : key;
}

function pruned<T>(record: Record<string, T>) {
  const keys = Object.keys(record);
  return keys.length <= 24 ? record : Object.fromEntries(keys.slice(-24).map((key) => [key, record[key]]));
}

function initialPreferences() {
  const read = (key: string): unknown => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "null");
    } catch {
      // Storage may be unavailable or corrupt; fall back to defaults.
      return null;
    }
  };
  return readTrendPreferences(read(TREND_STORAGE_KEY), read(LEGACY_TREND_STORAGE_KEY));
}
