import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { sessionToken, validSession } from '../backend/worker.js';

// Exercise real SQL and transactions while matching the small D1 API used by the Worker.
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, values = []) => ({
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes }, results: [] }; },
    sql, values,
  });
  const DB = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of statements) {
          if (/^SELECT/i.test(stmt.sql)) results.push(await stmt.all());
          else results.push(await stmt.run());
        }
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const files = new Map();
  const FILES = {
    async put(key, bytes) { files.set(key, new Uint8Array(bytes)); },
    async get(key) { return files.has(key) ? { body: files.get(key) } : null; },
    async delete(key) { for (const item of Array.isArray(key) ? key : [key]) files.delete(item); },
  };
  return { env: { DB, FILES, APP_PASSWORD: 'fictional-test-password', SESSION_SECRET: 'a'.repeat(40), SAMPLE_DATA: '1' }, sqlite, files };
}
function request(path, { method = 'GET', data, cookie, revision, origin = 'https://sample.test', form } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (revision !== undefined) headers['if-match'] = String(revision);
  if (data !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://sample.test${path}`, { method, headers, body: form || (data === undefined ? undefined : JSON.stringify(data)) });
}

test('Shopping POST, PATCH and state PUT persist automatic sections and remembered choices with validated boundaries', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  let current = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const call = async (path, method, data, status = 200) => {
    const response = await worker.fetch(request(path, { method, data, cookie, revision: current.revision }), env);
    assert.equal(response.status, status);
    const result = await response.json();
    if (response.ok) current = result;
    return result;
  };
  await call('/api/lists', 'POST', { name: 'REA SAMPLE Shopping API', type: 'shopping' }, 201);
  const shop = current.data.lists.at(-1);
  await call('/api/reminders', 'POST', { listId: shop.id, title: 'Milk' }, 201);
  const milk = current.data.reminders.at(-1);
  assert.equal(current.data.lists.at(-1).sections.find(section => section.id === milk.sectionId).name, 'Dairy, Eggs & Cheese');
  assert.equal(milk.shoppingCategoryManual, false);
  await call(`/api/reminders/${milk.id}`, 'PATCH', { title: 'Bananas' });
  const banana = current.data.reminders.find(row => row.id === milk.id);
  assert.equal(current.data.lists.at(-1).sections.find(section => section.id === banana.sectionId).name, 'Produce');
  await call(`/api/reminders/${milk.id}`, 'PATCH', { sectionId: null, shoppingCategoryManual: true });
  await call('/api/reminders', 'POST', { listId: shop.id, title: 'bananas' }, 201);
  assert.equal(current.data.reminders.at(-1).sectionId, null);
  const before = structuredClone(current.data);
  await call('/api/state', 'PUT', { data: current.data });
  assert.deepEqual(current.data.lists.at(-1).shoppingOverrides, [{ title: 'bananas', sectionId: null }]);
  assert.deepEqual(current.data.reminders.map(row => row.id), before.reminders.map(row => row.id));
  const invalid = structuredClone(current.data);
  invalid.lists.at(-1).shoppingOverrides[0].sectionId = 'foreign-section';
  await call('/api/state', 'PUT', { data: invalid }, 400);
  assert.equal((await (await worker.fetch(request('/api/state', { cookie }), env)).json()).revision, current.revision);
});

test('Shopping REST correction survives older duplicate rows, reversed order, reload and a new NFKC-equivalent item', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  let current = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const call = async (path, method, data) => {
    const response = await worker.fetch(request(path, { method, data, cookie, revision: current.revision }), env);
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    current = await response.json();
  };
  await call('/api/lists', 'POST', { name: 'REA SAMPLE correction history', type: 'shopping' });
  const shopId = current.data.lists.at(-1).id;
  for (const title of ['Milk', 'Bananas', 'Salmon']) await call('/api/reminders', 'POST', { listId: shopId, title });
  const rows = current.data.reminders.filter(row => row.listId === shopId), first = rows[0], produce = rows[1].sectionId, seafood = rows[2].sectionId;
  await call(`/api/reminders/${first.id}`, 'PATCH', { sectionId: produce, shoppingCategoryManual: true });
  await call('/api/reminders', 'POST', { listId: shopId, title: 'milk' });
  const duplicateId = current.data.reminders.at(-1).id;
  await call(`/api/reminders/${first.id}`, 'PATCH', { sectionId: seafood, shoppingCategoryManual: true });
  const choice = () => current.data.lists.find(list => list.id === shopId).shoppingOverrides.find(choice => choice.title === 'milk').sectionId;
  assert.equal(choice(), seafood);
  assert.equal(current.data.reminders.find(row => row.id === duplicateId).sectionId, produce);
  await call('/api/state', 'PUT', { data: { ...current.data, reminders: [...current.data.reminders].reverse() } });
  current = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  assert.equal(choice(), seafood);
  assert.equal(current.data.reminders.find(row => row.id === duplicateId).sectionId, produce);
  await call('/api/reminders', 'POST', { listId: shopId, title: 'ＭＩＬＫ' });
  assert.equal(current.data.reminders.at(-1).sectionId, seafood);
  assert.equal(choice(), seafood);
});
async function authenticated(env) {
  const response = await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  return response.headers.get('set-cookie').split(';')[0];
}

test('auth denies private data; validates passwords, session expiry, origin and revokes logout', async () => {
  const { env } = setup();
  assert.equal((await worker.fetch(request('/api/state'), env)).status, 401);
  assert.equal((await worker.fetch(request('/api/health'), env)).status, 200);
  assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: 'wrong' } }), env)).status, 401);
  const cookie = await authenticated(env);
  assert.equal((await worker.fetch(request('/api/state', { cookie }), env)).status, 200);
  assert.equal((await worker.fetch(request('/api/auth/logout', { method: 'POST', cookie, origin: 'https://evil.test' }), env)).status, 403);
  const now = Date.now(), token = await sessionToken(env, now - 9 * 60 * 60 * 1000);
  assert.equal(await validSession(request('/api/state', { cookie: `reminders_session=${token}` }), env, now), false);
  assert.equal((await worker.fetch(request('/api/auth/logout', { method: 'POST', cookie }), env)).status, 200);
  assert.equal((await worker.fetch(request('/api/state', { cookie }), env)).status, 401);
});

test('durable login rate limit denies attempt eleven and configuration fails closed', async () => {
  const { env, sqlite } = setup();
  for (let i = 0; i < 10; i++) assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: 'wrong' } }), env)).status, 401);
  const started = sqlite.prepare('SELECT window_start FROM login_attempts').get().window_start;
  assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env)).status, 429);
  assert.equal(sqlite.prepare('SELECT window_start FROM login_attempts').get().window_start, started);
  sqlite.prepare('UPDATE login_attempts SET window_start = ?').run(Date.now() - 900001);
  assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env)).status, 200);
  assert.equal(sqlite.prepare('SELECT count FROM login_attempts').get().count, 1);
  assert.equal((await worker.fetch(request('/api/state'), { ...env, APP_PASSWORD: '' })).status, 503);
});

test('state CAS rejects stale updates and invalid graphs; timestamps and tombstone feed persist', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  assert.equal(initial.data.reminders.length, 3);
  const item = initial.data.reminders[0];
  const response = await worker.fetch(request(`/api/reminders/${item.id}`, { method: 'PATCH', cookie, revision: 0, data: { notes: 'Fictional test note', flagged: false } }), env);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.revision, 1);
  assert.ok(saved.data.reminders[0].updatedAt);
  assert.equal(saved.data.reminders[0].notes, 'Fictional test note');
  assert.equal((await worker.fetch(request('/api/state', { method: 'PUT', cookie, revision: 0, data: { data: initial.data } }), env)).status, 409);
  const bad = structuredClone(saved.data); bad.reminders[0].parentId = bad.reminders[0].id;
  assert.equal((await worker.fetch(request('/api/state', { method: 'PUT', cookie, revision: 1, data: { data: bad } }), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/state', { method: 'PUT', cookie, data: { data: saved.data } }), env)).status, 428);
  const removed = await worker.fetch(request(`/api/reminders/${item.id}`, { method: 'DELETE', cookie, revision: 1 }), env);
  assert.equal(removed.status, 200);
  const feed = await (await worker.fetch(request('/api/changes?since=0', { cookie }), env)).json();
  assert.equal(feed.events.length, 2); assert.equal(feed.nextCursor, 2);
  assert.equal(feed.events[1].deletedReminderIds[0], item.id);
});

test('attachment upload/download/delete is authenticated, type checked and CAS guarded', async () => {
  const { env, files } = setup(), cookie = await authenticated(env);
  const state = await (await worker.fetch(request('/api/state', { cookie }), env)).json(), reminderId = state.data.reminders[0].id;
  const form = new FormData(); form.set('file', new Blob(['Sample attachment'], { type: 'text/plain' }), 'sample.txt');
  const upload = await worker.fetch(request(`/api/reminders/${reminderId}/attachments`, { method: 'POST', cookie, revision: 0, form }), env);
  assert.equal(upload.status, 201);
  const result = await upload.json(), attachment = result.attachment;
  assert.equal(attachment.filename, 'sample.txt'); assert.equal(files.size, 1);
  assert.equal((await worker.fetch(request(attachment.downloadUrl), env)).status, 401);
  const download = await worker.fetch(request(attachment.downloadUrl, { cookie }), env);
  assert.equal(await download.text(), 'Sample attachment');
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  const bad = new FormData(); bad.set('file', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'unsafe.svg');
  assert.equal((await worker.fetch(request(`/api/reminders/${reminderId}/attachments`, { method: 'POST', cookie, revision: 1, form: bad }), env)).status, 415);
  assert.equal((await worker.fetch(request(attachment.downloadUrl, { method: 'DELETE', cookie, revision: 0 }), env)).status, 409);
  assert.equal(files.size, 1);
  assert.equal((await worker.fetch(request(attachment.downloadUrl, { method: 'DELETE', cookie, revision: 1 }), env)).status, 200);
  assert.equal(files.size, 0);
  assert.equal((await worker.fetch(request(attachment.downloadUrl, { cookie }), env)).status, 404);
});

test('resource routes create lists and reminders, complete recurrence and reject invalid URLs', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  let response = await worker.fetch(request('/api/lists', { method: 'POST', cookie, revision: 0, data: { name: 'Sample API list' } }), env);
  assert.equal(response.status, 201);
  const state = await response.json(), list = state.data.lists.at(-1);
  response = await worker.fetch(request('/api/reminders', { method: 'POST', cookie, revision: 1, data: { title: 'Sample repeat', listId: list.id, dueDate: '2026-10-10', recurrence: 'daily' } }), env);
  assert.equal(response.status, 201);
  const created = await response.json(), reminder = created.data.reminders.at(-1);
  response = await worker.fetch(request(`/api/reminders/${reminder.id}`, { method: 'PATCH', cookie, revision: 2, data: { completed: true } }), env);
  assert.equal(response.status, 200);
  const completed = await response.json();
  assert.equal(completed.data.reminders.find(r => r.id === reminder.id).completed, false);
  assert.equal(completed.data.reminders.find(r => r.id === reminder.id).dueDate, '2026-10-11');
  assert.equal(completed.data.reminders.at(-1).completed, true);
  assert.equal(completed.data.reminders.at(-1).dueDate, '2026-10-10');
  assert.equal((await worker.fetch(request(`/api/reminders/${reminder.id}`, { method: 'PATCH', cookie, revision: 3, data: { url: 'javascript:alert(1)' } }), env)).status, 400);
});

test('REST capture keeps literal date tokens and completion validates recurrence before execution', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const listId = initial.data.lists[0].id;
  const response = await worker.fetch(request('/api/reminders', { method: 'POST', cookie, revision: 0, data: { title: 'Call sample tomorrow at 9am', listId } }), env);
  assert.equal(response.status, 201);
  const created = await response.json(), reminder = created.data.reminders.at(-1);
  assert.equal(reminder.title, 'Call sample tomorrow at 9am');
  assert.equal(reminder.dueDate, null);
  assert.equal(reminder.dueTime, null);
  for (const patch of [
    { completed: true, recurrence: 'weekdays', repeatInterval: Number.MAX_SAFE_INTEGER },
    { completed: true, recurrence: 'daily', dueDate: 'not-a-date' },
    { completed: true, recurrence: 'daily', repeatInterval: 0 },
  ]) {
    assert.equal((await worker.fetch(request(`/api/reminders/${reminder.id}`, { method: 'PATCH', cookie, revision: 1, data: patch }), env)).status, 400);
    const unchanged = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
    assert.equal(unchanged.revision, 1);
    assert.deepEqual(unchanged.data, created.data);
  }
});

test('REST hourly completion persists its UTC occurrence through repeated DST clock times', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const response = await worker.fetch(request('/api/reminders', { method: 'POST', cookie, revision: 0, data: {
    title: 'Sample DST repeat', listId: initial.data.lists[0].id,
    dueDate: '2026-10-25', dueTime: '00:30', timeZone: 'Europe/London', recurrence: 'hourly',
  } }), env);
  assert.equal(response.status, 201);
  const created = await response.json(), id = created.data.reminders.at(-1).id;
  for (const [index, dueTime, dueInstant] of [
    [1, '01:30', '2026-10-25T00:30:00.000Z'],
    [2, '01:30', '2026-10-25T01:30:00.000Z'],
    [3, '02:30', '2026-10-25T02:30:00.000Z'],
  ]) {
    const completed = await worker.fetch(request(`/api/reminders/${id}`, { method: 'PATCH', cookie, revision: index, data: { completed: true } }), env);
    assert.equal(completed.status, 200);
    const state = await completed.json(), active = state.data.reminders.find(r => r.id === id);
    assert.equal(active.dueTime, dueTime);
    assert.equal(active.dueInstant, dueInstant);
    assert.equal(state.revision, index + 1);
  }
});


test('operation IDs cannot be overwritten by entity IDs; retention expires cursors without sequence reuse', async () => {
  const { env, sqlite } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const id = initial.data.reminders[0].id;
  assert.equal((await worker.fetch(request(`/api/reminders/${id}`, { method: 'PATCH', cookie, revision: 0, data: { notes: 'Sample' } }), env)).status, 200);
  const first = await (await worker.fetch(request('/api/changes', { cookie }), env)).json();
  assert.equal(first.events[0].id, id);
  assert.match(first.events[0].operationId, /^[a-f0-9-]{36}$/);
  assert.notEqual(first.events[0].operationId, id);
  const insert = sqlite.prepare("INSERT INTO events (operation_id, type, payload, created_at) VALUES (?, 'sample', '{}', '2026-10-10')");
  sqlite.exec('BEGIN');
  for (let i = 0; i < 10000; i++) insert.run(`sample-${i}`);
  sqlite.exec('COMMIT');
  assert.equal((await worker.fetch(request(`/api/reminders/${id}`, { method: 'PATCH', cookie, revision: 1, data: { notes: 'Sample 2' } }), env)).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM events').get().count, 10000);
  const expired = await worker.fetch(request('/api/changes?since=0', { cookie }), env);
  assert.equal(expired.status, 410); assert.equal((await expired.json()).resync, true);
  const oldest = sqlite.prepare('SELECT MIN(sequence) AS oldest FROM events').get().oldest;
  assert.equal((await worker.fetch(request(`/api/changes?since=${oldest - 1}`, { cookie }), env)).status, 200);
  const latest = (await (await worker.fetch(request('/api/state', { cookie }), env)).json()).sequence;
  sqlite.exec('DELETE FROM events');
  assert.equal((await (await worker.fetch(request('/api/state', { cookie }), env)).json()).sequence, latest);
  assert.equal((await worker.fetch(request(`/api/changes?since=${latest - 1}`, { cookie }), env)).status, 410);
  assert.equal((await worker.fetch(request(`/api/reminders/${id}`, { method: 'PATCH', cookie, revision: 2, data: { notes: 'Sample 3' } }), env)).status, 200);
  assert.equal(sqlite.prepare('SELECT sequence FROM events').get().sequence, latest + 1);
});

test('persistent reservations cap bytes, objects and per-reminder files before any R2 put', async () => {
  for (const bound of ['objects', 'bytes', 'reminder']) {
    const { env, sqlite, files } = setup(), cookie = await authenticated(env);
    const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
    const id = initial.data.reminders[0].id;
    const insert = sqlite.prepare('INSERT INTO pending_file_cleanup VALUES (?, ?, ?, ?)');
    const count = bound === 'objects' ? 200 : bound === 'reminder' ? 20 : 1;
    for (let i = 0; i < count; i++) insert.run(`reserved-${i}`, bound === 'reminder' ? id : 'other', bound === 'bytes' ? 100 * 1024 * 1024 : 1, Date.now() + 3600000);
    const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
    assert.equal((await worker.fetch(request(`/api/reminders/${id}/attachments`, { method: 'POST', cookie, revision: 0, form }), env)).status, 413);
    assert.equal(files.size, 0); assert.equal(sqlite.prepare('SELECT revision FROM state').get().revision, 0);
  }
});

test('auth storage bounds reject growth and expired records prune on login and scheduled maintenance', async () => {
  const { env, sqlite } = setup();
  const now = Date.now(), session = sqlite.prepare('INSERT INTO sessions VALUES (?, ?)');
  for (let i = 0; i < 200; i++) session.run(`sample-${i}`, Math.floor(now / 1000) + 1000);
  assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env)).status, 429);
  sqlite.exec('UPDATE sessions SET expires = 0');
  const attempts = sqlite.prepare('INSERT INTO login_attempts VALUES (?, 1, ?)');
  sqlite.exec('DELETE FROM login_attempts');
  for (let i = 0; i < 2000; i++) attempts.run(`client-${i}`, now);
  assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env)).status, 429);
  sqlite.exec('UPDATE login_attempts SET window_start = 0');
  const cookie = await authenticated(env);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM login_attempts').get().count, 1);
  sqlite.exec('UPDATE sessions SET expires = 0; UPDATE login_attempts SET window_start = 0');
  await worker.scheduled({}, env);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM login_attempts').get().count, 0);
  assert.equal((await worker.fetch(request('/api/maintenance', { method: 'POST', cookie }), env)).status, 401);
});

test('API reopening completed parents also reopens their descendants', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const parent = initial.data.reminders[0];
  const created = await (await worker.fetch(request('/api/reminders', { method: 'POST', cookie, revision: 0, data: { title: 'Sample child', listId: parent.listId, parentId: parent.id } }), env)).json();
  const child = created.data.reminders.at(-1);
  assert.equal((await worker.fetch(request(`/api/reminders/${parent.id}`, { method: 'PATCH', cookie, revision: 1, data: { completed: true } }), env)).status, 200);
  const reopened = await (await worker.fetch(request(`/api/reminders/${parent.id}`, { method: 'PATCH', cookie, revision: 2, data: { completed: false } }), env)).json();
  assert.equal(reopened.data.reminders.find(r => r.id === child.id).completed, false);
  assert.equal(reopened.data.reminders.find(r => r.id === child.id).completedAt, null);
});


test('outbox payload storage is bounded independently of event count', async () => {
  const { env, sqlite } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const insert = sqlite.prepare("INSERT INTO events (operation_id, type, payload, created_at) VALUES (?, 'sample', ?, '2026-10-10')");
  const payload = JSON.stringify({ sample: 'x'.repeat(100000) });
  for (let i = 0; i < 180; i++) insert.run(`sample-${i}`, payload);
  assert.equal((await worker.fetch(request(`/api/reminders/${initial.data.reminders[0].id}`, { method: 'PATCH', cookie, revision: 0, data: { notes: 'Sample' } }), env)).status, 200);
  assert.ok(sqlite.prepare('SELECT SUM(length(CAST(payload AS BLOB))) AS bytes FROM events').get().bytes <= 16 * 1024 * 1024);
  assert.equal((await worker.fetch(request('/api/changes?since=0', { cookie }), env)).status, 410);
});

test('templates persist across state and REST deletion without trusting file references', async () => {
  const { saveTemplate } = await import('../src/templates.js');
  const { env } = setup(), cookie = await authenticated(env);
  let initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const data = saveTemplate(initial.data, 'work', 'Sample packing');
  assert.equal((await worker.fetch(request('/api/state', { method:'PUT',cookie,revision:initial.revision,data:{data} }),env)).status,200);
  initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  assert.equal(initial.data.templates[0].name,'Sample packing');
  const invalid = structuredClone(initial.data); invalid.templates[0].reminders[0].attachments = [{id:'forged'}];
  assert.equal((await worker.fetch(request('/api/state', { method:'PUT',cookie,revision:initial.revision,data:{data:invalid} }),env)).status,400);
  assert.equal((await worker.fetch(request('/api/lists/work',{method:'DELETE',cookie,revision:initial.revision}),env)).status,200);
  const final = await (await worker.fetch(request('/api/state',{cookie}),env)).json();
  assert.equal(final.data.lists.some(l=>l.id==='work'),false);
  assert.equal(final.data.templates[0].reminders.length,1);
  assert.equal(final.revision,initial.revision+1);
});

test('template share REST routes require owner session and CAS; bearer only reads one sanitized snapshot and deletion revokes it', async () => {
  const { env, sqlite } = setup(), cookie = await authenticated(env);
  let current = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const { saveTemplate } = await import('../src/templates.js');
  const saved = saveTemplate(current.data, 'work', 'Sample REST share');
  current = await (await worker.fetch(request('/api/state', { method: 'PUT', data: { data: saved }, cookie, revision: current.revision }), env)).json();
  const id = current.data.templates[0].id, path = `/api/templates/${id}/share`;
  assert.equal((await worker.fetch(request(path, { method: 'POST', data: {}, revision: current.revision }), env)).status, 401);
  assert.equal((await worker.fetch(request(path, { method: 'POST', data: {}, cookie, revision: current.revision, origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await worker.fetch(request(path, { method: 'POST', data: { template: saved.templates[0] }, cookie, revision: current.revision }), env)).status, 400);
  assert.equal((await worker.fetch(request(path, { method: 'POST', data: {}, cookie, revision: current.revision - 1 }), env)).status, 409);
  const createdResponse = await worker.fetch(request(path, { method: 'POST', data: {}, cookie, revision: current.revision }), env);
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  const capabilityRequest = new Request('https://sample.test/api/templates/shared', { headers: { authorization: `Bearer ${created.token}` } });
  const read = await worker.fetch(capabilityRequest, env);
  assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal(read.headers.get('referrer-policy'), 'no-referrer');
  const preview = await read.json(); assert.equal(preview.data, undefined); assert.equal(preview.template.name, 'Sample REST share'); assert.equal(preview.template.reminders[0].attachments, undefined);
  assert.equal((await worker.fetch(request('/api/templates/shares'), env)).status, 401);
  const statuses = await (await worker.fetch(request('/api/templates/shares', { cookie }), env)).json();
  assert.equal(statuses.statuses[id].shared, true); assert.equal(statuses.statuses[id].token, undefined);
  const stale = await worker.fetch(request('/api/state', { method: 'PUT', data: { data: { ...current.data, templates: [] } }, cookie, revision: current.revision - 1 }), env);
  assert.equal(stale.status, 409); assert.equal((await worker.fetch(capabilityRequest, env)).status, 200);
  const removed = await worker.fetch(request('/api/state', { method: 'PUT', data: { data: { ...current.data, templates: [] } }, cookie, revision: current.revision }), env);
  assert.equal(removed.status, 200); assert.equal((await worker.fetch(capabilityRequest, env)).status, 404);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM template_shares').get().count, 0);
});
