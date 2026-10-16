"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncConnectorAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import type { ConnectionBoard, ConnectionCard, ConnectionSetting } from "@/lib/admin/connection-types";

const synced: Record<ConnectionCard["id"], { always: string; analytics?: string; steps: string[] }> = {
  youtube: {
    always: "Subscribers, all-time views and videos published.",
    analytics: "With Google sign-in, also daily views, watch hours, likes, comments, shares, Shorts views and subscribers gained or lost (YouTube reports these 2–3 days late).",
    steps: [
      "In Google Cloud, create a project and enable YouTube Data API v3 (and YouTube Analytics API for the private numbers).",
      "Create an API key and add it as YOUTUBE_API_KEY, with YOUTUBE_CHANNEL_ID set to your UC… ID or @handle.",
      "For private numbers, add the OAuth client ID, secret and a refresh token, and set the app to “In production”.",
    ],
  },
  instagram: {
    always: "Followers, posts published, reach, views, interactions, likes, comments, shares, saves and link taps.",
    steps: [
      "Switch the account to Business or Creator.",
      "In Meta's App Dashboard, open Instagram → API setup with Instagram business login and generate a token.",
      "Add it as INSTAGRAM_ACCESS_TOKEN, and add CONNECTOR_ENCRYPTION_KEY so it renews itself before its 60 days run out.",
    ],
  },
};

export function Connections({ board }: { board: ConnectionBoard }) {
  return <div className="admin-section-stack">
    {board.status === "unavailable" ? <p className="admin-data-notice" role="status">Sync history is unavailable until the platform connectors migration is applied. Settings below are still accurate.</p> : null}
    <section className="admin-connection-grid">
      {board.connectors.map((connector) => <ConnectorCard connector={connector} key={connector.id} />)}
      <RedditCard />
      <IngestCard enabled={board.ingest.enabled} keyTooShort={board.ingest.keyTooShort} path={board.ingest.path} />
    </section>
    <article className="admin-panel admin-ops-note">
      <p>PRIVACY</p>
      <h2>Keys stay on the server. Only daily totals are stored.</h2>
      <span>This page shows setting names, never their values. Provider errors are reduced to a reason like “token expired” before they are saved, and no follower, commenter or prospect details are read or kept.</span>
    </article>
  </div>;
}

function ConnectorCard({ connector }: { connector: ConnectionCard }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(syncConnectorAction, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  const copy = synced[connector.id];
  const outcome = state.message ? { status: state.status, message: state.message } : connector.lastOutcome;

  return <article className="admin-panel admin-connection-card">
    <header className="admin-panel-head">
      <div><p>{connector.label.toUpperCase()}</p><h2>{connector.configured ? levelTitle(connector) : "Not connected yet."}</h2></div>
      <span><i className={connector.configured ? "online" : "offline"} />{connector.lastSyncedAt ? `SYNCED ${relativeDay(connector.lastSyncedAt)}` : "NOT SYNCED YET"}</span>
    </header>
    <div className="admin-connection-body">
      <p>{copy.always}{copy.analytics ? <> {copy.analytics}</> : null}</p>
      <SettingList label="Settings" settings={connector.settings} />
      {connector.optional.length ? <SettingList label={connector.id === "youtube" ? "Google sign-in (optional)" : "Token renewal"} settings={connector.optional} /> : null}
      {!connector.configured ? <ol>{copy.steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
    </div>
    <form action={action}>
      <input name="connector" type="hidden" value={connector.id} />
      <div className="admin-form-footer">
        <div>{outcome ? <p className={`admin-form-message ${outcome.status}`} role="status">{outcome.message}</p>
          : <p>{connector.configured ? "Syncs every night. Sync now to read the last few days again." : "Add the settings in Vercel, redeploy, then sync."}</p>}</div>
        <button disabled={pending || !connector.configured} type="submit">{pending ? "SYNCING" : "SYNC NOW"}<b>→</b></button>
      </div>
    </form>
  </article>;
}

function RedditCard() {
  return <article className="admin-panel admin-connection-card">
    <header className="admin-panel-head">
      <div><p>REDDIT</p><h2>Logged by hand, by design.</h2></div>
      <span><i className="manual" />MANUAL</span>
    </header>
    <div className="admin-connection-body">
      <p>Reddit stops approving new API access after October 31, 2026 and is retiring its public API, and Reddit chat (where DMs now live) never had one. Post views are not in the API either. Reddit numbers are therefore logged, not synced.</p>
      <ul>
        <li><b>Content:</b> views, posts published, upvotes, comments and karma under Trends → Log numbers → Reddit.</li>
        <li><b>Outreach:</b> DMs sent, DM replies and calls booked from DMs, in the same form. The DM reply rate is worked out for you.</li>
        <li><b>Automations:</b> a tool that already counts these can send daily totals to the private endpoint.</li>
      </ul>
    </div>
  </article>;
}

function IngestCard({ enabled, keyTooShort, path }: { enabled: boolean; keyTooShort: boolean; path: string }) {
  const example = `POST ${path}\nAuthorization: Bearer <AJANI_METRICS_INGEST_KEY>\nContent-Type: application/json\n\n{ "values": [{ "metricKey": "reddit.dms_sent",\n    "date": "2026-10-15", "value": 12 }] }`;
  return <article className="admin-panel admin-connection-card">
    <header className="admin-panel-head">
      <div><p>PRIVATE ENDPOINT</p><h2>{enabled ? "Automations can send totals." : "Switched off."}</h2></div>
      <span><i className={enabled ? "online" : "offline"} />{enabled ? "ON" : "OFF"}</span>
    </header>
    <div className="admin-connection-body">
      <p>{enabled ? "Accepts daily totals for YouTube, Instagram, Reddit, TikTok and LinkedIn from tools you run, such as Zapier or a script. It cannot read anything back, and it rejects names, links and any metric it does not know."
        : keyTooShort ? "AJANI_METRICS_INGEST_KEY is set but shorter than 32 characters, so the endpoint stays off. Replace it with a longer random value."
        : "Add AJANI_METRICS_INGEST_KEY (at least 32 random characters) in Vercel to let your own automations send daily totals. Until then the endpoint answers “not found”."}</p>
      <pre>{example}</pre>
    </div>
  </article>;
}

function SettingList({ label, settings }: { label: string; settings: ConnectionSetting[] }) {
  return <dl className="admin-setting-list">
    <dt>{label}</dt>
    {settings.map((setting) => <dd key={setting.name}><code>{setting.name}</code><span className={setting.present ? "present" : "missing"}>{setting.present ? "SET" : setting.invalid ? "CHECK FORMAT" : "MISSING"}</span></dd>)}
  </dl>;
}

function levelTitle(connector: ConnectionCard) {
  if (connector.level === "analytics") return "Connected with full analytics.";
  if (connector.level === "public") return "Connected with public numbers.";
  return "Connected.";
}

function relativeDay(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)).toUpperCase();
}
