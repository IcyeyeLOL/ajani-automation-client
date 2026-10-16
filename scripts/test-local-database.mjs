// This harness deliberately accepts NO database URL and does not load .env files.
// Every run creates its own native PostgreSQL cluster bound only to loopback.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import runConcurrencyRegressions from "./db-concurrency-regressions.mjs";
import runAnalyticsConcurrency from "./db-analytics-concurrency.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sandbox = path.join(root, ".tmp", "database-tests");
await mkdir(sandbox, { recursive: true });
const databaseDir = await mkdtemp(path.join(sandbox, "run-"));
assert(path.resolve(databaseDir).startsWith(`${path.resolve(sandbox)}${path.sep}`));
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", resolve);
});
const port = socket.address().port;
await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
const database = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: randomBytes(24).toString("hex"),
  authMethod: "scram-sha-256",
  persistent: true,
  createPostgresUser: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "fsync=off"],
  onLog: () => {},
  onError: () => {},
});
let client;
let started = false;
try {
  await database.initialise();
  await database.start();
  started = true;
  client = database.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  await client.query("set statement_timeout = '30s'");
  // Minimal Supabase-owned schema contracts, not application schema substitutes.
  // Storage HTTP uploads/JWT verification still require a separate sandbox E2E.
  await client.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
    create table storage.buckets (
      id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
  `);
  const migrations = (await readdir(path.join(root, "supabase", "migrations")))
    .filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    console.log(`Apply ${name}`);
    await client.query(await readFile(path.join(root, "supabase", "migrations", name), "utf8"));
  }
  console.log(`PASS: ${migrations.length} migrations applied to a new local PostgreSQL cluster.`);
  for (const name of ["db-regressions.sql", "db-analytics-regressions.sql", "db-webhook-regressions.sql", "db-metrics-regressions.sql", "db-connector-regressions.sql", "db-goals-regressions.sql", "db-platform-regressions.sql", "db-dripify-parity-regressions.sql"]) {
    await client.query(await readFile(path.join(root, "scripts", name), "utf8"));
    console.log(`PASS: ${name}`);
  }
  await runConcurrencyRegressions(() => database.getPgClient("postgres", "127.0.0.1"));
  console.log("PASS: concurrent deletion/submission and organization provisioning.");
  await runAnalyticsConcurrency(() => database.getPgClient("postgres", "127.0.0.1"));
  console.log("PASS: analytics enrichment/submission lock-order concurrency.");
} catch (error) {
  console.error("Local database verification failed:", error);
  process.exitCode = 1;
} finally {
  await client?.end();
  if (started) await database.stop();
  console.log(`Stopped isolated database. Synthetic test data retained at ${databaseDir}`);
}
