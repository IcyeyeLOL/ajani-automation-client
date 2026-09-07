import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Invoked only by the isolated PostgreSQL harness. No environment credentials,
// Storage API, or provider clients are read here.
export default async function runConcurrencyRegressions(factory) {
  const observer = factory();
  const first = factory();
  const second = factory();
  const prefix = `concurrency-${randomUUID()}`;
  const user = `${prefix}-user`;
  const organization = randomUUID();
  const draftIds = [];
  const clerkIds = [`${prefix}-workspace`, `${prefix}-upsert`];
  try {
    await Promise.all([observer.connect(), first.connect(), second.connect()]);
    for (const client of [observer, first, second]) {
      await client.query("set statement_timeout = '5000'; set lock_timeout = '4000'");
    }
    await observer.query('insert into public.profiles(id) values($1)', [user]);
    await observer.query('insert into public.organizations(id,owner_id,business_name,clerk_organization_id) values($1,$2,$3,$4)',
      [organization, user, 'Synthetic concurrency workspace', clerkIds[0]]);

    async function seedDraft(suffix) {
      const id = randomUUID();
      draftIds.push(id);
      const token = `${prefix}-${suffix}`;
      const brief = 'Synthetic approved route for concurrency regression';
      const payload = {
        title: 'Synthetic concurrency request', extractedContext: { writtenBrief: brief },
        legalAcceptance: { acknowledged: true, acceptedAt: new Date().toISOString(), action: 'request_handoff',
          method: 'affirmative_checkbox', noticeVersion: 'handoff-notice-2026-09-02',
          acceptableUseVersion: '2026-09-02', privacyVersion: '2026-09-02', termsVersion: '2026-09-02' },
      };
      await observer.query('insert into public.request_drafts(id,token_hash,status,payload) values($1,$2,\'ready_to_submit\',$3)', [id, token, payload]);
      await observer.query(`insert into public.request_draft_ai_states(request_draft_id,state,transcript_fingerprint,transcript_revision,
        approved_revision,approved_hash,approved_system_definition,approved_plain_language_scope)
        values($1,'ready_to_submit',encode(extensions.digest($2,'sha256'),'hex'),1,1,'synthetic-hash',
        '[{"id":"handoff","kind":"handoff","title":"Route to owner","detail":"Owner reviews"}]','Owner reviews')`, [id, brief]);
      await observer.query(`insert into public.voice_memos(request_draft_id,storage_path,status)
        values($1,$2,'uploaded')`, [id, `${prefix}/${suffix}.webm`]);
      return { id, token };
    }

    // The first transaction reserves deletion and retains the actual row lock.
    // The second must wait, then observe deletion's winning state after commit.
    const deleted = await seedDraft('delete-wins');
    await first.query('begin');
    await first.query('select * from public.reserve_request_draft_deletion($1,$2,false)', [deleted.id, deleted.token]);
    await second.query('begin');
    const pendingClaim = settled(second.query('select * from public.claim_request_draft($1,$2,$3)', [deleted.token, user, organization]));
    await assertBlockedBy(observer, second.processID, first.processID);
    await first.query('commit');
    assertUnavailable(await pendingClaim, 'claim must lose after deletion reservation commits');
    await second.query('rollback');

    // Reverse the interleaving: submitted ownership wins while deletion waits.
    const submitted = await seedDraft('submit-wins');
    await first.query('begin');
    await first.query('select * from public.claim_request_draft($1,$2,$3)', [submitted.token, user, organization]);
    const receipt = await first.query('select * from public.submit_request_draft($1,$2,$3)', [submitted.id, user, organization]);
    const build = receipt.rows[0].build_request_id;
    await second.query('begin');
    const pendingDeletion = settled(second.query('select * from public.reserve_request_draft_deletion($1,$2,false)', [submitted.id, submitted.token]));
    await assertBlockedBy(observer, second.processID, first.processID);
    await first.query('commit');
    assertUnavailable(await pendingDeletion, 'deletion must lose after submission commits');
    await second.query('rollback');
    const source = await observer.query('select build_request_id,request_draft_id from public.voice_memos where storage_path=$1', [`${prefix}/submit-wins.webm`]);
    assert.equal(source.rows[0].build_request_id, build);
    assert.equal(source.rows[0].request_draft_id, null);
    const receiptReplay = await observer.query('select * from public.submit_request_draft($1,$2,$3)', [submitted.id, user, organization]);
    assert.equal(receiptReplay.rows[0].build_request_id, build);

    // Simultaneous provisioning resolves one organization, with no unique-key
    // error. This uses the provider-identity advisory lock, not an app mutex.
    const upsertSql = 'select public.sync_clerk_organization($1,$2,$3,$4,null,now(),false) as id';
    const upsertArgs = [clerkIds[1], user, 'Atomic workspace', `${prefix}-slug`];
    await first.query('begin');
    const created = await first.query(upsertSql, upsertArgs);
    await second.query('begin');
    const concurrent = settled(second.query(upsertSql, upsertArgs));
    await assertBlockedBy(observer, second.processID, first.processID);
    await first.query('commit');
    const resolved = await concurrent;
    assert.equal(resolved.ok, true, resolved.error?.message);
    assert.equal(resolved.value.rows[0].id, created.rows[0].id);
    await second.query('commit');
    const rows = await observer.query('select count(*)::integer as n from public.organizations where clerk_organization_id=$1', [clerkIds[1]]);
    assert.equal(rows.rows[0].n, 1);
    return { passed: 3, cases: ['delete blocks claim', 'submission blocks deletion and preserves memo ownership', 'concurrent organization upsert resolves one row'] };
  } finally {
    await Promise.allSettled([first.query('rollback'), second.query('rollback')]);
    // Unique fixture identifiers limit cleanup to this run's synthetic rows.
    // Delete builds first so their retained memo and outbox cascades are removed.
    try {
      await observer.query('delete from public.build_requests where created_by=$1', [user]);
      if (draftIds.length) {
        await observer.query('delete from public.request_drafts where id=any($1::uuid[])', [draftIds]);
        await observer.query('delete from public.request_draft_upload_purges where draft_id=any($1::uuid[])', [draftIds]);
      }
      await observer.query('delete from public.organizations where clerk_organization_id=any($1::text[])', [clerkIds]);
      await observer.query('delete from public.profiles where id=$1', [user]);
    } finally {
      await Promise.allSettled([observer.end(), first.end(), second.end()]);
    }
  }
}

function settled(promise) {
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
}
function assertUnavailable(outcome, label) {
  assert.equal(outcome.ok, false, label);
  assert.equal(outcome.error.code, 'P0001', label);
  assert.equal(outcome.error.message, 'draft_unavailable', label);
}
async function assertBlockedBy(observer, waitingPid, blockerPid) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const result = await observer.query('select $2::integer=any(pg_catalog.pg_blocking_pids($1::integer)) as blocked', [waitingPid, blockerPid]);
    if (result.rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Expected database lock was not observed within 2.5 seconds');
}
