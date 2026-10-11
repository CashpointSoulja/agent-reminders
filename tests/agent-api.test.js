import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../backend/worker.js';
import { agentOpenAPI } from '../backend/agent-openapi.js';
import { createAgentClient, runAssignedTask } from '../scripts/agent-client.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const evidence = reference => ({ kind: 'text', reference, digest: `sha256:${createHash('sha256').update(reference).digest('hex')}` });

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, values = []) => ({
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes }, results: [] }; },
    sql, values,
  });
  const DB = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of statements) results.push(/^SELECT/i.test(stmt.sql) ? await stmt.all() : await stmt.run());
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const files = new Map();
  const FILES = { async put(key, bytes) { files.set(key, new Uint8Array(bytes)); }, async get(key) { return files.has(key) ? { body: files.get(key) } : null; }, async delete(key) { files.delete(key); } };
  return { env: { DB, FILES, APP_PASSWORD: 'fictional-test-password', SESSION_SECRET: 'z'.repeat(40), SAMPLE_DATA: '1', AGENT_API: '1' }, sqlite, files };
}
function request(path, { method = 'GET', cookie, token, data, revision, key, origin = 'https://sample.test', form } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  if (data !== undefined) headers['content-type'] = 'application/json';
  if (revision !== undefined) headers['if-match'] = String(revision);
  if (key) headers['idempotency-key'] = key;
  return new Request(`https://sample.test${path}`, { method, headers, body: form || (data === undefined ? undefined : JSON.stringify(data)) });
}
async function fixture(scopes = ['tasks:read', 'tasks:execute']) {
  const base = setup();
  let response = await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: base.env.APP_PASSWORD } }), base.env);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  let current = await (await worker.fetch(request('/api/state', { cookie }), base.env)).json();
  const owner = async (path, method = 'GET', data, expected = 200, options = {}) => {
    const result = await worker.fetch(request(path, { method, data, cookie, revision: current.revision, ...options }), base.env);
    const payload = await result.json();
    assert.equal(result.status, expected, `${method} ${path}: ${payload.error || ''}`);
    if (payload.data) current = payload;
    return payload;
  };
  const { agent } = await owner('/api/agents', 'POST', { name: 'Fictional runtime' }, 201);
  const credential = await owner(`/api/agents/${agent.id}/tokens`, 'POST', { scopes, expiresInSeconds: 3600 }, 201);
  const agentCall = async (path, method = 'GET', data, expected = 200, options = {}) => {
    const result = await worker.fetch(request(`/api/agent/v1${path}`, { method, data, token: credential.token, origin: null, ...options }), base.env);
    const payload = await result.json();
    assert.equal(result.status, expected, `${method} ${path}: ${payload.error || ''}`);
    return payload;
  };
  const delegate = async (reminderId = current.data.reminders[0].id, values = {}) => (await owner(`/api/reminders/${reminderId}/delegation`, 'POST', { agentId: agent.id, criteria: 'Produce and verify a fictional sample artifact.', ...values }, 201)).task;
  const claim = async task => agentCall(`/tasks/${task.id}/claim`, 'POST', {}, 200, { key: crypto.randomUUID() });
  const report = (task, claimId, outcome = 'succeeded') => ({ claimId, taskVersion: task.taskVersion, outcome, summary: 'Fictional artifact is available.', verification: { passed: true, method: 'Read the saved fictional artifact back.', verifiedAt: new Date().toISOString() }, evidence: [evidence('Fictional result: sample agenda contains the requested items.')] });
  return { ...base, owner, agentCall, delegate, claim, report, agent, credential, cookie, get current() { return current; } };
}

test('public discovery is crawlable without exposing configuration, task data or credentials', async () => {
  for (const path of ['/api/agent/discovery', '/api/agent/openapi.json', '/api/agent/guide', '/.well-known/reminders-agent.json']) {
    const result = await worker.fetch(request(path), {});
    assert.equal(result.status, 200);
    const body = await result.text();
    assert.ok(!body.includes('fictional-test-password'));
    assert.ok(!body.includes('Prepare project update'));
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal(agentOpenAPI.openapi, '3.1.0');
  assert.equal(agentOpenAPI.paths['/api/agent/v1/tasks/{taskId}/report'].post.security[0].agentBearer.length, 0);
  assert.ok(agentOpenAPI.components.schemas.Report.required.includes('taskVersion'));
});

test('owner-only registration, one-time token storage, scope checks and no bearer access to ordinary data', async () => {
  const f = await fixture(['tasks:read']);
  assert.match(f.credential.token, /^rwa_[A-Za-z0-9_-]{43}$/);
  const stored = f.sqlite.prepare('SELECT * FROM agent_credentials').get();
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(stored).includes(f.credential.token));
  const metadata = await f.owner('/api/agents');
  assert.equal(metadata.agents[0].credentials[0].id, f.credential.credential.id);
  assert.ok(!JSON.stringify(metadata).includes(stored.token_hash));
  assert.ok(!JSON.stringify(metadata).includes(f.credential.token));
  for (const path of ['/api/state', '/api/reminders', '/api/lists', '/api/agents']) assert.equal((await worker.fetch(request(path, { token: f.credential.token }), f.env)).status, 401);
  assert.equal((await worker.fetch(request('/api/agent/v1/tasks', { cookie: f.cookie }), f.env)).status, 401);
  assert.deepEqual((await f.agentCall('/tasks')).tasks, []);
  const task = await f.delegate();
  await f.agentCall(`/tasks/${task.id}/claim`, 'POST', {}, 403, { key: crypto.randomUUID() });
  assert.equal((await worker.fetch(request('/api/agents', { method: 'POST', cookie: f.cookie, revision: f.current.revision, origin: null, data: { name: 'Other' } }), f.env)).status, 403);
  assert.equal((await worker.fetch(request('/api/agents', { method: 'POST', cookie: f.cookie, data: { name: 'Other' } }), f.env)).status, 428);
});

test('task queue/detail and event feed isolate named agent and only assigned reminders', async () => {
  const f = await fixture();
  const first = await f.delegate();
  const { agent: other } = await f.owner('/api/agents', 'POST', { name: 'Other fictional runtime' }, 201);
  const second = (await f.owner(`/api/reminders/${f.current.data.reminders[1].id}/delegation`, 'POST', { agentId: other.id, criteria: 'Other private criterion' }, 201)).task;
  const queue = await f.agentCall('/tasks');
  assert.deepEqual(queue.tasks.map(task => task.id), [first.id]);
  const detail = await f.agentCall(`/tasks/${first.id}`);
  assert.equal(detail.reminder.id, first.reminderId);
  assert.ok(!JSON.stringify(detail).includes('Other private criterion'));
  await f.agentCall(`/tasks/${second.id}`, 'GET', undefined, 404);
  const feed = await f.agentCall('/changes?since=0');
  assert.deepEqual(feed.events.map(event => event.taskId), [first.id]);
  assert.ok(!JSON.stringify(feed).includes('Book a dentist'));
});

test('claim is idempotent, bounded and exclusive; heartbeat uses the original active credential', async () => {
  const f = await fixture(), task = await f.delegate(), key = crypto.randomUUID();
  await f.agentCall(`/tasks/${task.id}/claim`, 'POST', { leaseSeconds: 29 }, 400, { key });
  await f.agentCall(`/tasks/${task.id}/claim`, 'POST', {}, 400, { key: 'short' });
  const first = await f.agentCall(`/tasks/${task.id}/claim`, 'POST', { leaseSeconds: 300 }, 200, { key });
  const repeat = await f.agentCall(`/tasks/${task.id}/claim`, 'POST', { leaseSeconds: 900 }, 200, { key });
  assert.equal(first.task.leaseExpiresAt, repeat.task.leaseExpiresAt);
  await f.agentCall(`/tasks/${task.id}/claim`, 'POST', {}, 409, { key: crypto.randomUUID() });
  const pulse = await f.agentCall(`/tasks/${task.id}/heartbeat`, 'POST', { claimId: key, taskVersion: task.taskVersion, leaseSeconds: 900 });
  assert.ok(Date.parse(pulse.task.leaseExpiresAt) > Date.parse(first.task.leaseExpiresAt));
  f.sqlite.prepare('UPDATE agent_tasks SET claim_started_at = ? WHERE id = ?').run(Date.now() - 3600001, task.id);
  await f.agentCall(`/tasks/${task.id}/heartbeat`, 'POST', { claimId: key, taskVersion: task.taskVersion }, 409);
});

test('successful verified report completes only assigned occurrence and exact replay cannot create a second recurrence', async () => {
  const f = await fixture();
  const reminderId = f.current.data.reminders[0].id;
  await f.owner(`/api/reminders/${reminderId}`, 'PATCH', { recurrence: 'daily', dueDate: '2026-10-11', dueTime: null });
  const task = await f.delegate(reminderId), claim = await f.claim(task), report = f.report(task, claim.claimId);
  const result = await f.agentCall(`/tasks/${task.id}/report`, 'POST', report);
  assert.equal(result.task.status, 'succeeded');
  assert.equal(result.receipt.reminderCompleted, true);
  const saved = await f.owner('/api/state');
  assert.equal(saved.data.reminders.find(row => row.id === reminderId).dueDate, '2026-10-12');
  assert.equal(saved.data.reminders.filter(row => row.completed).length, 1);
  assert.equal(result.receipt.completedOccurrenceId, saved.data.reminders.find(row => row.completed).id);
  assert.notEqual(result.receipt.completedOccurrenceId, reminderId);
  const repeat = await f.agentCall(`/tasks/${task.id}/report`, 'POST', report);
  assert.equal(repeat.task.id, result.task.id);
  assert.equal((await f.owner('/api/state')).revision, saved.revision);
  assert.equal((await f.agentCall('/tasks')).tasks.length, 0);
  const detail = await f.agentCall(`/tasks/${task.id}`);
  assert.equal(detail.reminder, undefined);
  const events = await f.agentCall('/changes?since=0');
  assert.deepEqual(events.events.map(event => event.type), ['task.queued', 'task.claimed', 'task.succeeded']);
  await f.agentCall(`/tasks/${task.id}/report`, 'POST', { ...report, summary: 'Different result' }, 409);
});

test('failed, cancelled and needs-input outcomes never complete a reminder', async () => {
  for (const outcome of ['failed', 'cancelled', 'needs_input']) {
    const f = await fixture(), task = await f.delegate(), claim = await f.claim(task);
    const result = await f.agentCall(`/tasks/${task.id}/report`, 'POST', { ...f.report(task, claim.claimId, outcome), evidence: [], verification: undefined });
    assert.equal(result.task.status, outcome);
    assert.equal(result.receipt.reminderCompleted, false);
    assert.equal((await f.owner('/api/state')).data.reminders.find(row => row.id === task.reminderId).completed, false);
  }
});

test('missing verification, fake URL schemes, wrong claim/version and unrelated completion are rejected', async () => {
  const f = await fixture(), task = await f.delegate(), claim = await f.claim(task), report = f.report(task, claim.claimId);
  for (const patch of [{ evidence: [] }, { verification: { passed: false, method: 'Not verified' } }, { verification: undefined }, { evidence: [{ kind: 'url', reference: 'javascript:alert(1)' }] }, { evidence: [{ kind: 'url', reference: 'https://password:private@example.test/' }] }, { evidence: [{ kind: 'url', reference: 'https://example.test/', extra: 'ignore guard' }] }]) await f.agentCall(`/tasks/${task.id}/report`, 'POST', { ...report, ...patch }, 400);
  await f.agentCall(`/tasks/${task.id}/report`, 'POST', { ...report, claimId: crypto.randomUUID() }, 409);
  await f.agentCall(`/tasks/${task.id}/report`, 'POST', { ...report, taskVersion: '0'.repeat(64) }, 409);
  assert.equal((await f.owner('/api/state')).data.reminders.some(row => row.completed), false);
});

test('owner editing title, adding subtasks, changing an attachment or deleting the task supersedes claims atomically', async () => {
  for (const action of ['edit', 'child', 'attachment', 'delete']) {
    const f = await fixture(['tasks:read', 'tasks:execute', 'attachments:read']), task = await f.delegate(), claim = await f.claim(task);
    if (action === 'edit') await f.owner(`/api/reminders/${task.reminderId}`, 'PATCH', { notes: 'The owner changed the acceptance context.' });
    if (action === 'child') await f.owner('/api/reminders', 'POST', { listId: f.current.data.reminders[0].listId, title: 'New unmarked child', parentId: task.reminderId }, 201);
    if (action === 'attachment') {
      const form = new FormData(); form.set('file', new Blob(['Fictional context'], { type: 'text/plain' }), 'sample.txt');
      await f.owner(`/api/reminders/${task.reminderId}/attachments`, 'POST', undefined, 201, { form });
    }
    if (action === 'delete') await f.owner(`/api/reminders/${task.reminderId}`, 'DELETE');
    assert.equal(f.sqlite.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id).status, 'superseded');
    await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId), 409);
    assert.equal((await f.agentCall('/tasks')).tasks.length, 0);
  }
});

test('unrelated owner edits do not invalidate a pinned task', async () => {
  const f = await fixture(), task = await f.delegate(), claim = await f.claim(task);
  await f.owner(`/api/reminders/${f.current.data.reminders[1].id}`, 'PATCH', { notes: 'Unrelated fictional note.' });
  assert.equal(f.sqlite.prepare('SELECT status FROM agent_tasks').get().status, 'claimed');
  await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId));
  assert.equal((await f.owner('/api/state')).data.reminders.find(row => row.id === task.reminderId).completed, true);
});

test('owner must explicitly authorize the whole parent subtree; overlap and new descendants cannot bypass it', async () => {
  const f = await fixture(), parent = f.current.data.reminders[0];
  await f.owner('/api/reminders', 'POST', { listId: parent.listId, title: 'Fictional child', parentId: parent.id }, 201);
  const child = f.current.data.reminders.at(-1);
  await f.owner(`/api/reminders/${parent.id}/delegation`, 'POST', { agentId: f.agent.id, criteria: 'Finish root only' }, 409);
  const task = await f.delegate(parent.id, { includeSubtasks: true });
  assert.deepEqual((await f.agentCall(`/tasks/${task.id}`)).subtasks.map(row => row.id), [child.id]);
  await f.owner(`/api/reminders/${child.id}/delegation`, 'POST', { agentId: f.agent.id, criteria: 'Competing child' }, 409);
  const claim = await f.claim(task);
  await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId));
  const saved = await f.owner('/api/state');
  assert.equal(saved.data.reminders.find(row => row.id === parent.id).completed, true);
  assert.equal(saved.data.reminders.find(row => row.id === child.id).completed, true);
});

test('a repeating parent with children is rejected without mutation; a nonrepeating parent and recurring leaf remain executable', async () => {
  const f = await fixture(), parent = f.current.data.reminders[0];
  await f.owner('/api/reminders', 'POST', { listId: parent.listId, title: 'Fictional recurring child', parentId: parent.id }, 201);
  const childId = f.current.data.reminders.at(-1).id;
  await f.owner(`/api/reminders/${parent.id}`, 'PATCH', { recurrence: 'daily', dueDate: '2026-10-11' });
  const before = structuredClone(await f.owner('/api/state'));
  const denied = await f.owner(`/api/reminders/${parent.id}/delegation`, 'POST', { agentId: f.agent.id, criteria: 'Finish recurring parent and child', includeSubtasks: true }, 409);
  assert.equal(denied.code, 'recurring_parent_unsupported');
  assert.deepEqual(await f.owner('/api/state'), before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM agent_tasks').get().count, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM agent_events').get().count, 0);
  await f.owner(`/api/reminders/${parent.id}`, 'PATCH', { recurrence: 'none' });
  const parentTask = await f.delegate(parent.id, { includeSubtasks: true }), parentClaim = await f.claim(parentTask);
  await f.agentCall(`/tasks/${parentTask.id}/report`, 'POST', f.report(parentTask, parentClaim.claimId));
  const saved = await f.owner('/api/state');
  assert.equal(saved.data.reminders.find(row => row.id === parent.id).completed, true);
  assert.equal(saved.data.reminders.find(row => row.id === childId).completed, true);
  const leafId = saved.data.reminders.find(row => row.id !== parent.id && row.id !== childId).id;
  await f.owner(`/api/reminders/${leafId}`, 'PATCH', { recurrence: 'daily', dueDate: '2026-10-11' });
  const leafTask = await f.delegate(leafId), leafClaim = await f.claim(leafTask);
  await f.agentCall(`/tasks/${leafTask.id}/report`, 'POST', f.report(leafTask, leafClaim.claimId));
  const leaf = (await f.owner('/api/state')).data.reminders.find(row => row.id === leafId);
  assert.equal(leaf.completed, false); assert.equal(leaf.dueDate, '2026-10-12');
});

test('success records a runtime evidence attestation; missing time/digest and inconsistent text never complete', async () => {
  const f = await fixture(), task = await f.delegate(), claim = await f.claim(task), report = f.report(task, claim.claimId);
  const revision = f.current.revision;
  for (const patch of [
    { verification: { passed: true, method: 'Thin claim without a runtime readback time' } },
    { evidence: [{ kind: 'text', reference: 'No digest' }] },
    { evidence: [{ ...report.evidence[0], digest: `sha256:${'0'.repeat(64)}` }] },
    { verification: { ...report.verification, verifiedAt: 'not-a-time' } },
    { verification: { ...report.verification, verifiedAt: '2000-01-01T00:00:00.000Z' } },
    { verification: { ...report.verification, verifiedAt: new Date(Date.now() + 600000).toISOString() } },
  ]) await f.agentCall(`/tasks/${task.id}/report`, 'POST', { ...report, ...patch }, 400);
  const before = await f.owner('/api/state');
  assert.equal(before.revision, revision); assert.equal(before.data.reminders[0].completed, false);
  const result = await f.agentCall(`/tasks/${task.id}/report`, 'POST', report);
  assert.equal(result.receipt.completionBasis, 'agent_attestation');
  assert.equal(result.task.result.completionBasis, 'agent_attestation');
  assert.equal(result.task.result.verification.verifiedAt, report.verification.verifiedAt);
  assert.equal(result.task.result.evidence[0].digest, report.evidence[0].digest);
  const replay = await f.agentCall(`/tasks/${task.id}/report`, 'POST', report);
  assert.equal(replay.receipt.completionBasis, 'agent_attestation');
});

test('expired claim cannot complete or be silently retried; owner re-delegation creates a new task', async () => {
  const f = await fixture(), task = await f.delegate(), claim = await f.claim(task);
  f.sqlite.prepare('UPDATE agent_tasks SET lease_expires_at = ? WHERE id = ?').run(Date.now() - 1, task.id);
  await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId), 409);
  assert.equal(f.sqlite.prepare('SELECT status FROM agent_tasks').get().status, 'timed_out');
  assert.equal((await f.owner('/api/state')).data.reminders[0].completed, false);
  await f.agentCall(`/tasks/${task.id}/claim`, 'POST', {}, 409, { key: crypto.randomUUID() });
  const replacement = await f.delegate(task.reminderId);
  assert.notEqual(replacement.id, task.id);
});

test('credential and agent revocation immediately stop reads/claims/reports without completing reminders', async () => {
  for (const endpoint of ['token', 'agent']) {
    const f = await fixture(), task = await f.delegate(), claim = await f.claim(task);
    await f.owner(endpoint === 'token' ? `/api/agents/${f.agent.id}/tokens/${f.credential.credential.id}` : `/api/agents/${f.agent.id}`, 'DELETE');
    await f.agentCall('/tasks', 'GET', undefined, 401);
    await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId), 401);
    assert.equal(f.sqlite.prepare('SELECT status FROM agent_tasks').get().status, 'cancelled');
    assert.equal((await f.owner('/api/state')).data.reminders[0].completed, false);
  }
  const f = await fixture();
  f.sqlite.prepare('UPDATE agent_credentials SET expires_at = ?').run(Date.now() - 1);
  await f.agentCall('/tasks', 'GET', undefined, 401);
});

test('revocation or owner edit racing completion loses the guarded transaction, preserving open task and no success event', async () => {
  for (const action of ['revoke', 'edit']) {
    const f = await fixture(), task = await f.delegate(), claim = await f.claim(task);
    const batch = f.env.DB.batch;
    let intercepted = false;
    f.env.DB.batch = async statements => {
      if (!intercepted && statements[0].sql.startsWith('UPDATE state')) {
        intercepted = true;
        if (action === 'revoke') f.sqlite.prepare('UPDATE agent_credentials SET revoked_at = ?').run(new Date().toISOString());
        else f.sqlite.prepare('UPDATE state SET revision = revision + 1').run();
      }
      return batch(statements);
    };
    await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId), 409);
    assert.ok(intercepted);
    const saved = JSON.parse(f.sqlite.prepare('SELECT document FROM state').get().document);
    assert.equal(saved.reminders.find(row => row.id === task.reminderId).completed, false);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_events WHERE type = 'task.succeeded'").get().count, 0);
  }
});

test('assigned attachments require separate scope and cannot disclose another reminder file', async () => {
  const f = await fixture(['tasks:read', 'tasks:execute', 'attachments:read']);
  const ids = f.current.data.reminders.slice(0, 2).map(row => row.id), files = [];
  for (const id of ids) {
    const form = new FormData(); form.set('file', new Blob(['Fictional text attachment'], { type: 'text/plain' }), 'sample.txt');
    files.push((await f.owner(`/api/reminders/${id}/attachments`, 'POST', undefined, 201, { form })).attachment);
  }
  const task = await f.delegate(ids[0]);
  assert.deepEqual((await f.agentCall(`/tasks/${task.id}/attachments`)).attachments.map(file => file.id), [files[0].id]);
  const result = await worker.fetch(request(`/api/agent/v1/tasks/${task.id}/attachments/${files[0].id}`, { token: f.credential.token }), f.env);
  assert.equal(result.status, 200); assert.equal(await result.text(), 'Fictional text attachment');
  await f.agentCall(`/tasks/${task.id}/attachments/${files[1].id}`, 'GET', undefined, 404);
  const noFiles = await f.owner(`/api/agents/${f.agent.id}/tokens`, 'POST', { scopes: ['tasks:read'] }, 201);
  await f.agentCall(`/tasks/${task.id}/attachments`, 'GET', undefined, 403, { token: noFiles.token });
});

test('bounded history and credential inputs fail closed and cross-agent management never accepts bearer credentials', async () => {
  const f = await fixture();
  for (const body of [{ scopes: ['tasks:execute'] }, { scopes: ['tasks:read', 'owner:all'] }, { scopes: ['tasks:read'], expiresInSeconds: 2592001 }, { scopes: ['tasks:read'], extra: 'untrusted' }]) await f.owner(`/api/agents/${f.agent.id}/tokens`, 'POST', body, 400);
  assert.equal((await worker.fetch(request(`/api/agents/${f.agent.id}`, { method: 'DELETE', token: f.credential.token }), f.env)).status, 401);
  for (let i = 1; i < 20; i++) await f.owner('/api/agents', 'POST', { name: `Fictional ${i}` }, 201);
  await f.owner('/api/agents', 'POST', { name: 'Over quota' }, 413);
  await f.agentCall('/tasks?after=-1', 'GET', undefined, 400);
  await f.agentCall('/changes?since=NaN', 'GET', undefined, 400);
});

test('plain HTTP client executes a real fictional file tool, verifies readback and completes through the Worker contract', async () => {
  const f = await fixture(), task = await f.delegate(), folder = await mkdtemp(join(tmpdir(), 'reminders-agent-sample-'));
  const client = createAgentClient({ baseURL: 'https://sample.test', token: f.credential.token, fetchImpl: (url, options) => worker.fetch(new Request(url, options), f.env) });
  try {
    const result = await runAssignedTask(client, task.id, async ({ reminder, signal }) => {
      assert.equal(reminder.id, task.reminderId); assert.equal(signal.aborted, false);
      const file = join(folder, 'sample-agenda.txt'), contents = 'Fictional agenda: planning, review and next steps.';
      await writeFile(file, contents, 'utf8');
      const verified = await readFile(file, 'utf8');
      assert.equal(verified, contents);
      return { outcome: 'succeeded', summary: 'Saved and read back a fictional agenda.', verification: { passed: true, method: 'Read the actual temporary file and compare all contents.', verifiedAt: new Date().toISOString() }, evidence: [evidence(verified)] };
    });
    assert.equal(result.receipt.outcome, 'succeeded');
    assert.equal((await f.owner('/api/state')).data.reminders.find(row => row.id === task.reminderId).completed, true);
    assert.equal((await client.tasks()).tasks.length, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('agent API defaults off; an old schema without agent tables still supports owner mutations and public definitions', async () => {
  const { env, sqlite } = setup();
  delete env.AGENT_API;
  sqlite.exec('DROP TABLE agent_events; DROP TABLE agent_tasks; DROP TABLE agent_credentials; DROP TABLE agents;');
  const login = await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env), cookie = login.headers.get('set-cookie').split(';')[0];
  const current = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const saved = await worker.fetch(request('/api/reminders', { method: 'POST', data: { listId: current.data.lists[0].id, title: 'Fictional old-schema task' }, cookie, revision: current.revision }), env);
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).data.reminders.at(-1).title, 'Fictional old-schema task');
  const discovery = await (await worker.fetch(request('/api/agent/discovery'), env)).json();
  assert.equal(discovery.enabled, false);
  assert.equal(discovery.pollAfterSeconds, 60);
  assert.equal((await worker.fetch(request('/api/agents', { cookie }), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/agent/v1/tasks'), env)).status, 404);
  const maintenance = await worker.fetch(request('/api/maintenance', { method: 'POST', cookie }), env);
  assert.equal(maintenance.status, 200);
});

test('expiry at transaction time blocks completion even when credential and lease were valid at request start', async () => {
  for (const boundary of ['credential', 'lease']) {
    const f = await fixture(), task = await f.delegate(), claim = await f.claim(task), batch = f.env.DB.batch;
    let intercepted = false;
    f.env.DB.batch = async statements => {
      if (!intercepted && statements[0].sql.startsWith('UPDATE state')) {
        intercepted = true;
        if (boundary === 'credential') f.sqlite.prepare('UPDATE agent_credentials SET expires_at = ?').run(Date.now() + 10);
        else f.sqlite.prepare('UPDATE agent_tasks SET lease_expires_at = ?').run(Date.now() + 10);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return batch(statements);
    };
    const denied = await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId), 409);
    assert.equal(denied.code, 'completion_conflict');
    assert.equal(denied.retryable, true);
    assert.ok(intercepted);
    assert.equal(JSON.parse(f.sqlite.prepare('SELECT document FROM state').get().document).reminders[0].completed, false);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_events WHERE type = 'task.succeeded'").get().count, 0);
  }
});

test('a lost owner snapshot read after committed success still returns the durable exact occurrence receipt', async () => {
  const f = await fixture(), task = await f.delegate(), claim = await f.claim(task), batch = f.env.DB.batch;
  let failed = false;
  f.env.DB.batch = async statements => {
    if (!failed && statements[0].sql.startsWith('SELECT document, revision FROM state') && f.sqlite.prepare('SELECT status FROM agent_tasks').get().status === 'succeeded') {
      failed = true; throw new Error('Fictional post-commit read outage');
    }
    return batch(statements);
  };
  const result = await f.agentCall(`/tasks/${task.id}/report`, 'POST', f.report(task, claim.claimId));
  assert.ok(failed);
  assert.equal(result.task.status, 'succeeded');
  assert.equal(result.receipt.completedOccurrenceId, task.reminderId);
  assert.equal((await f.owner('/api/state')).data.reminders[0].completed, true);
});

test('queue polling reads only active indexed task metadata and supplies a one-minute interval', async () => {
  const f = await fixture(), task = await f.delegate();
  const prepare = f.env.DB.prepare, statements = [];
  f.env.DB.prepare = sql => { statements.push(sql); return prepare(sql); };
  const result = await f.agentCall('/tasks');
  assert.deepEqual(result.tasks.map(row => row.id), [task.id]);
  assert.equal(result.pollAfterSeconds, 60);
  assert.ok(!statements.some(sql => sql.includes('FROM state') || sql.includes('FROM attachments')));
  const plan = f.sqlite.prepare("EXPLAIN QUERY PLAN SELECT * FROM agent_tasks WHERE agent_id = ? AND status IN ('queued', 'claimed') AND sequence > ? ORDER BY sequence LIMIT 100").all(f.agent.id, 0);
  assert.ok(plan.some(row => row.detail.includes('agent_tasks_active_agent')));
});

test('free-tier work caps reject delegation 51 and a subtree larger than 200 without data mutation', async () => {
  const f = await fixture(), listId = f.current.data.lists[0].id;
  for (let i = f.current.data.reminders.length; i < 51; i++) await f.owner('/api/reminders', 'POST', { listId, title: `Fictional task ${i}` }, 201);
  const ids = f.current.data.reminders.slice(0, 51).map(row => row.id);
  for (const id of ids.slice(0, 50)) await f.delegate(id);
  const revision = f.current.revision;
  const denied = await f.owner(`/api/reminders/${ids[50]}/delegation`, 'POST', { agentId: f.agent.id, criteria: 'Over active cap' }, 413);
  assert.equal(denied.code, 'delegation_limit');
  assert.equal((await f.owner('/api/state')).revision, revision);
  await f.owner(`/api/reminders/${ids[0]}/delegation`, 'DELETE');
  await f.delegate(ids[50]);
  const g = await fixture(), parent = g.current.data.reminders[0], data = structuredClone(g.current.data);
  for (let i = 0; i < 200; i++) data.reminders.push({ ...parent, id: `fictional-child-${i}`, parentId: parent.id, title: `Fictional child ${i}` });
  await g.owner('/api/state', 'PUT', { data });
  const tooBig = await g.owner(`/api/reminders/${parent.id}/delegation`, 'POST', { agentId: g.agent.id, criteria: 'Over subtree cap', includeSubtasks: true }, 413);
  assert.equal(tooBig.code, 'delegation_limit');
  assert.equal(g.sqlite.prepare('SELECT COUNT(*) AS count FROM agent_tasks').get().count, 0);
});
