import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

// Isolated local PostgreSQL clients only; the parent harness supplies them.
export default async function runAnalyticsConcurrency(factory) {
  const observer = factory();
  const submission = factory();
  const background = factory();
  const prefix = `analytics-lock-${randomUUID()}`;
  const user = `${prefix}-user`;
  const organization = randomUUID();
  const drafts = [];
  const brief = 'Synthetic approved analytics concurrency request';
  const fingerprint = createHash('sha256').update(brief).digest('hex');
  try {
    await Promise.all([observer.connect(), submission.connect(), background.connect()]);
    for (const client of [observer, submission, background]) {
      await client.query("set statement_timeout='5000'; set lock_timeout='4000'");
    }
    await observer.query('insert into public.profiles(id) values($1)', [user]);
    await observer.query('insert into public.organizations(id,owner_id,business_name,clerk_organization_id) values($1,$2,$3,$4)',
      [organization, user, 'Synthetic analytics workspace', prefix]);
    async function seed() {
      const id = randomUUID();
      drafts.push(id);
      const payload = {
        title: 'Analytics concurrency', extractedContext: { writtenBrief: brief },
        legalAcceptance: { acknowledged: true, acceptedAt: new Date().toISOString(), action: 'request_handoff',
          method: 'affirmative_checkbox', noticeVersion: 'handoff-notice-2026-09-02',
          acceptableUseVersion: '2026-09-02', privacyVersion: '2026-09-02', termsVersion: '2026-09-02' },
      };
      await observer.query("insert into public.request_drafts(id,token_hash,status,payload) values($1,$2,'ready_to_submit',$3)", [id, id, payload]);
      await observer.query(`insert into public.request_draft_ai_states(request_draft_id,state,transcript_fingerprint,
        transcript_revision,approved_revision,approved_hash,approved_system_definition,approved_plain_language_scope)
        values($1,'ready_to_submit',$2,1,1,'approved-hash',
        '[{"id":"handoff","kind":"handoff","title":"Owner receives","detail":"Owner reviews"}]','Owner reviews')`, [id, fingerprint]);
      await observer.query('select * from public.claim_request_draft($1,$2,$3)', [id, user, organization]);
      return id;
    }
    const demandSql = 'select public.persist_request_demand_analysis($1,$2,$3,0.9) as persisted';
    const demand = { demand: { method: 'ai', demandCategory: 'Audit', confidence: 0.9 } };
    const submitSql = 'select * from public.submit_request_draft($1,$2,$3)';

    // Hold the exact lock submission takes first. Enrichment must wait BEFORE
    // acquiring the AI-state row; otherwise submit's AI read forms a deadlock.
    const firstDraft = await seed();
    await submission.query('begin');
    await submission.query('select id from public.request_drafts where id=$1 for update', [firstDraft]);
    await background.query('begin');
    const pendingDemand = settled(background.query(demandSql, [firstDraft, fingerprint, demand]));
    await assertBlockedBy(observer, background.processID, submission.processID);
    const firstReceipt = await submission.query(submitSql, [firstDraft, user, organization]);
    assert.ok(firstReceipt.rows[0].build_request_id);
    await submission.query('commit');
    const completedDemand = await pendingDemand;
    assert.equal(completedDemand.ok, true, completedDemand.error?.message);
    assert.equal(completedDemand.value.rows[0].persisted, true);
    await background.query('commit');

    // Reverse ordering: a completed enrichment transaction owns draft+AI locks,
    // so a concurrent submit waits and then succeeds with the same exact scope.
    const secondDraft = await seed();
    await background.query('begin');
    assert.equal((await background.query(demandSql, [secondDraft, fingerprint, demand])).rows[0].persisted, true);
    await submission.query('begin');
    const pendingSubmission = settled(submission.query(submitSql, [secondDraft, user, organization]));
    await assertBlockedBy(observer, submission.processID, background.processID);
    await background.query('commit');
    const secondReceipt = await pendingSubmission;
    assert.equal(secondReceipt.ok, true, secondReceipt.error?.message);
    assert.ok(secondReceipt.value.rows[0].build_request_id);
    await submission.query('commit');
    const states = await observer.query('select analytics_processed,analytics_submitted from public.request_drafts where id=any($1::uuid[])', [drafts]);
    assert.equal(states.rows.length, 2);
    assert.ok(states.rows.every(row => row.analytics_processed && row.analytics_submitted));
    return { passed: 2, cases: ['submission before background enrichment', 'background enrichment before submission'] };
  } finally {
    await Promise.allSettled([submission.query('rollback'), background.query('rollback')]);
    try {
      await observer.query('delete from public.build_requests where created_by=$1', [user]);
      if (drafts.length) await observer.query('delete from public.request_drafts where id=any($1::uuid[])', [drafts]);
      await observer.query('delete from public.organizations where id=$1', [organization]);
      await observer.query('delete from public.profiles where id=$1', [user]);
    } finally {
      await Promise.allSettled([observer.end(), submission.end(), background.end()]);
    }
  }
}

function settled(promise) {
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
}
async function assertBlockedBy(observer, waitingPid, blockerPid) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const result = await observer.query('select $2::integer=any(pg_catalog.pg_blocking_pids($1::integer)) as blocked', [waitingPid, blockerPid]);
    if (result.rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Expected analytics database lock was not observed within 2.5 seconds');
}
