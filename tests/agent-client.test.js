import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentClient, runAssignedTask, evidenceDigest } from '../scripts/agent-client.mjs';

test('runtime evidence digest hashes reported UTF-8 bytes without claiming external task truth', async () => {
  assert.equal(await evidenceDigest('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await evidenceDigest(new TextEncoder().encode('abc')), await evidenceDigest('abc'));
});

test('client discovers anonymously and private calls use scoped bearer without owner cookies or redirects', async () => {
  const seen = [], token = `rwa_${'A'.repeat(43)}`;
  const client = createAgentClient({ baseURL: 'https://sample.test', token, fetchImpl: async (url, options) => { seen.push({ url: String(url), options }); return Response.json({ ok: true }); } });
  await client.discover(); await client.tasks(); await client.claim('fictional-task', 'random-claim-id-123456');
  assert.equal(seen[0].options.headers.Authorization, undefined);
  assert.equal(seen[1].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(seen[1].options.credentials, 'omit');
  assert.equal(seen[1].options.redirect, 'error');
  assert.equal(seen[2].options.headers['Idempotency-Key'], 'random-claim-id-123456');
  assert.ok(!JSON.stringify(seen[2].options.body).includes(token));
  assert.throws(() => createAgentClient({ baseURL: 'https://owner:password@sample.test', token }));
  assert.throws(() => createAgentClient({ baseURL: 'http://external.test', token }));
  assert.throws(() => createAgentClient({ baseURL: 'https://sample.test/?token=secret', token }));
});

test('runtime driver is called only after a current claim and only actual returned outcome is reported', async () => {
  const calls = [], task = { id: 'fictional-task', status: 'claimed', taskVersion: 'a'.repeat(64), criteria: 'Produce a fictional draft.' };
  const client = {
    async claim(id, claimId) { calls.push('claim'); assert.ok(claimId.length >= 16); return { task }; },
    async task() { calls.push('read'); return { task, reminder: { id: 'fictional-reminder', title: 'Create sample' }, subtasks: [] }; },
    async heartbeat() {},
    async report(id, result) { calls.push('report'); assert.equal(result.taskVersion, task.taskVersion); assert.equal(result.outcome, 'succeeded'); return { receipt: { taskId: id, outcome: result.outcome } }; },
  };
  const savedArtifact = new Map();
  const result = await runAssignedTask(client, task.id, async ({ reminder, signal }) => {
    calls.push('execute'); assert.equal(signal.aborted, false);
    savedArtifact.set(reminder.id, 'Fictional draft agenda: planning and review.');
    const verified = savedArtifact.get(reminder.id);
    assert.ok(verified.includes('planning'));
    return { outcome: 'succeeded', summary: 'Saved fictional draft.', verification: { passed: true, method: 'Read local sample artifact back.', verifiedAt: new Date().toISOString() }, evidence: [{ kind: 'text', reference: verified, digest: await evidenceDigest(verified) }] };
  });
  assert.deepEqual(calls, ['claim', 'read', 'execute', 'report']);
  assert.equal(result.receipt.outcome, 'succeeded');
});

test('denied claim or changed context prevents tool execution; driver errors never become completion', async () => {
  let ran = false, reported = false;
  const client = { async claim() { throw new Error('Revoked'); } };
  await assert.rejects(runAssignedTask(client, 'task', async () => { ran = true; }), /Revoked/);
  assert.equal(ran, false);
  const changed = { async claim() { return { task: { taskVersion: 'one' } }; }, async task() { return { task: { status: 'superseded', taskVersion: 'two' } }; }, async report() { reported = true; } };
  await assert.rejects(runAssignedTask(changed, 'task', async () => { ran = true; }), /Task changed/);
  assert.equal(ran, false); assert.equal(reported, false);
  const failing = { ...changed, async task() { return { task: { status: 'claimed', taskVersion: 'one' }, reminder: {} }; } };
  await assert.rejects(runAssignedTask(failing, 'task', async () => { throw new Error('Tool failed'); }), /Tool failed/);
  assert.equal(reported, false);
});
