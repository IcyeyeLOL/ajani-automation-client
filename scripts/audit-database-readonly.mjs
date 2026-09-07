// Read-only engineering evidence. No RPC invocation, row bodies, or secrets are printed.
import { resolve } from 'node:path';
const strict = process.argv.includes('--check');

try { process.loadEnvFile(resolve('.env.local')); } catch { /* Environment may be injected. */ }

const names = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'DEEPGRAM_API_KEY', 'ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN',
  'RESEND_API_KEY', 'RESEND_FROM', 'INTERNAL_NOTIFICATION_TO',
  'TRANSCRIPTION_WORKER_SECRET', 'CRON_SECRET', 'AJANI_ADMIN_ACCESS_KEY', 'AJANI_ADMIN_SESSION_SECRET',
];
console.log(JSON.stringify({ environment: Object.fromEntries(names.map(name => [name, Boolean(process.env[name])])) }));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log(JSON.stringify({ database: 'not configured' }));
  process.exit(strict ? 1 : 0);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };
try {
  const response = await fetch(`${url}/rest/v1/`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    console.log(JSON.stringify({ databaseOpenApiStatus: response.status }));
    if (strict) process.exitCode = 1;
  } else {
    const schema = await response.json();
    const paths = schema.paths ?? {};
    const functions = ['acknowledge_request_draft', 'update_request_draft_voice_memo_metadata',
      'submit_request_draft', 'claim_request_draft', 'claim_voice_memo_transcription_job',
      'claim_clerk_webhook_delivery_v2', 'finish_clerk_webhook_delivery_v2', 'record_clerk_deletion', 'sync_clerk_organization', 'sync_clerk_membership',
      'reserve_request_draft_deletion', 'finish_request_draft_deletion', 'complete_request_draft_voice_memo',
      'claim_request_draft_upload_purges', 'finish_request_draft_upload_purge', 'persist_request_demand_analysis',
      'finish_voice_memo_transcription', 'queue_recovery_health', 'load_admin_analytics', 'consume_public_request_allowance'];
    console.log(JSON.stringify({ databaseOpenApiStatus: response.status,
      rpcSchemaPresence: Object.fromEntries(functions.map(name => [name, Boolean(paths[`/rpc/${name}`])])) }));
    if (strict && functions.some(name => !paths[`/rpc/${name}`])) process.exitCode = 1;
  }
  for (const table of strict ? [] : ['request_drafts', 'build_requests', 'voice_memo_transcription_jobs', 'build_request_notification_jobs']) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*`, {
      method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' }, signal: AbortSignal.timeout(15000),
    });
    console.log(JSON.stringify({ table, status: response.status, count: response.headers.get('content-range') }));
  }
} catch (error) {
  console.log(JSON.stringify({ database: 'read failed', error: error instanceof Error ? error.name : 'UnknownError' }));
  process.exitCode = 1;
}
