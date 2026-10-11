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
    async delete(key) { files.delete(key); },
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
async function authenticated(env) {
  const response = await worker.fetch(request('/api/auth/login', { method: 'POST', data: { password: env.APP_PASSWORD } }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  return response.headers.get('set-cookie').split(';')[0];
}

test('configuration, forged/expired/deleted sessions and transport fail closed', async () => {
  const { env, sqlite } = setup();
  for (const delta of [{ SESSION_SECRET: 'short' }, { DB: null }, { APP_PASSWORD: '' }]) {
    assert.equal((await worker.fetch(request('/api/state'), { ...env, ...delta })).status, 503);
  }
  const cookie = await authenticated(env);
  for (const token of ['unsigned', cookie + '.extra', cookie.replace(/.$/, 'X')]) {
    assert.equal((await worker.fetch(request('/api/state', { cookie: token.startsWith('reminders_') ? token : `reminders_session=${token}` }), env)).status, 401);
  }
  sqlite.exec('DELETE FROM sessions');
  assert.equal((await worker.fetch(request('/api/state', { cookie }), env)).status, 401);
  const headers = { origin: 'http://sample.test', 'content-type': 'application/json' };
  const insecure = () => new Request('http://sample.test/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ password: env.APP_PASSWORD }) });
  assert.equal((await worker.fetch(insecure(), env)).status, 503);
  const development = await worker.fetch(insecure(), { ...env, DEV_MODE: '1' });
  assert.equal(development.status, 200);
  assert.doesNotMatch(development.headers.get('set-cookie'), /; Secure/);
  assert.equal((await worker.fetch(request('/api/state'), { ...env, DEV_MODE: '1' })).status, 401);
});

test('all write routes reject absent/foreign origin and body limit is enforced without Content-Length', async () => {
  const { env } = setup(), cookie = await authenticated(env);
  for (const origin of ['', 'https://foreign.test']) {
    const response = await worker.fetch(request('/api/state', { method: 'PUT', cookie, origin, revision: 0, data: { data: {} } }), env);
    assert.equal(response.status, 403);
  }
  const oversized = request('/api/state', { method: 'PUT', cookie, revision: 0, data: { text: 'x'.repeat(1024 * 1024) } });
  assert.equal(oversized.headers.get('content-length'), null);
  assert.equal((await worker.fetch(oversized, env)).status, 413);
  const wrongType = new Request('https://sample.test/api/auth/login', { method: 'POST', headers: { origin: 'https://sample.test', 'content-type': 'text/plain' }, body: '{}' });
  assert.equal((await worker.fetch(wrongType, env)).status, 415);
});

test('invalid mutations do not change revision/events and client attachment metadata is discarded', async () => {
  const { env, sqlite } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  for (const corrupt of [data => data.reminders.push({ ...data.reminders[0] }), data => { data.reminders[0].listId = 'missing'; }, data => { data.reminders[0].url = 'data:text/html,hello'; }]) {
    const data = structuredClone(initial.data); corrupt(data);
    assert.equal((await worker.fetch(request('/api/state', { method: 'PUT', cookie, revision: 0, data: { data } }), env)).status, 400);
  }
  assert.equal(sqlite.prepare('SELECT revision FROM state').get().revision, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0);
  initial.data.reminders[0].attachments = [{ id: 'forged', downloadUrl: '/private' }];
  const saved = await (await worker.fetch(request('/api/state', { method: 'PUT', cookie, revision: 0, data: { data: initial.data } }), env)).json();
  assert.deepEqual(saved.data.reminders[0].attachments, []);
});

test('attachment signatures, size and filename are guarded; downloads cannot execute supplied text', async () => {
  const { env, files } = setup(), cookie = await authenticated(env);
  const { data } = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const path = `/api/reminders/${data.reminders[0].id}/attachments`;
  for (const [type, content, status] of [['image/png', 'fake', 415], ['image/jpeg', 'fake', 415], ['image/webp', 'fake', 415], ['application/pdf', 'fake', 415], ['text/plain', new Uint8Array([0, 1]), 415], ['text/html', '<script/>', 415], ['text/plain', '', 413], ['text/plain', 'x'.repeat(5 * 1024 * 1024 + 1), 413]]) {
    const form = new FormData(); form.set('file', new Blob([content], { type }), 'sample.bin');
    assert.equal((await worker.fetch(request(path, { method: 'POST', cookie, revision: 0, form }), env)).status, status);
    assert.equal(files.size, 0);
  }
  const form = new FormData(); form.set('file', new Blob(['<script>alert(1)</script>'], { type: 'text/plain' }), '../sample".html');
  const response = await worker.fetch(request(path, { method: 'POST', cookie, revision: 0, form }), env);
  assert.equal(response.status, 201);
  const { attachment } = await response.json();
  assert.match(attachment.filename, /^[a-zA-Z0-9._ -]+$/);
  const downloaded = await worker.fetch(request(attachment.downloadUrl, { cookie }), env);
  assert.equal(downloaded.headers.get('content-type'), 'text/plain');
  assert.match(downloaded.headers.get('content-disposition'), /^attachment; filename="[a-zA-Z0-9._ -]+"$/);
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.match(downloaded.headers.get('content-security-policy'), /sandbox/);
  assert.equal(downloaded.headers.get('cache-control'), 'no-store');
});

test('CAS race cannot persist attachment metadata/event and rolls back the uploaded object', async () => {
  const { env, sqlite, files } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const batch = env.DB.batch;
  env.DB.batch = async statements => {
    if (statements[0].sql.startsWith('UPDATE state')) sqlite.exec('UPDATE state SET revision = revision + 1');
    return batch(statements);
  };
  const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
  const response = await worker.fetch(request(`/api/reminders/${initial.data.reminders[0].id}/attachments`, { method: 'POST', cookie, revision: 0, form }), env);
  assert.equal(response.status, 409);
  assert.equal(files.size, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0);
});

test('R2 put failure cannot change D1; D1 commit failure cleans up R2 object', async () => {
  for (const failure of ['put', 'commit']) {
    const { env, sqlite, files } = setup(), cookie = await authenticated(env);
    const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
    if (failure === 'put') env.FILES.put = async () => { throw new Error('injected R2 failure'); };
    else {
      const batch = env.DB.batch;
      env.DB.batch = statements => statements[0].sql.startsWith('UPDATE state') ? Promise.reject(new Error('injected D1 failure')) : batch(statements);
    }
    const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
    assert.equal((await worker.fetch(request(`/api/reminders/${initial.data.reminders[0].id}/attachments`, { method: 'POST', cookie, revision: 0, form }), env)).status, 500);
    assert.equal(files.size, 0);
    assert.equal(sqlite.prepare('SELECT revision FROM state').get().revision, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 0);
  }
});

test('deleting parent subtree removes file metadata and R2 data, cleanup failures report inaccessible orphan', async () => {
  for (const failDelete of [false, true]) {
    const { env, sqlite, files } = setup(), cookie = await authenticated(env);
    const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
    const reminderId = initial.data.reminders[0].id;
    const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
    const uploaded = await (await worker.fetch(request(`/api/reminders/${reminderId}/attachments`, { method: 'POST', cookie, revision: 0, form }), env)).json();
    if (failDelete) env.FILES.delete = async () => { throw new Error('injected deletion failure'); };
    const deleted = await worker.fetch(request(`/api/reminders/${reminderId}`, { method: 'DELETE', cookie, revision: 1 }), env);
    assert.equal(deleted.status, 200);
    const result = await deleted.json();
    assert.equal(Boolean(result.warning), failDelete);
    assert.equal(files.size, failDelete ? 1 : 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 0);
    assert.equal((await worker.fetch(request(uploaded.attachment.downloadUrl, { cookie }), env)).status, 404);
  }
});

test('failed R2 deletion persists a private durable job and scheduled retry completes it', async () => {
  const { env, sqlite, files } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
  const uploaded = await (await worker.fetch(request(`/api/reminders/${initial.data.reminders[0].id}/attachments`, { method: 'POST', cookie, revision: 0, form }), env)).json();
  const originalDelete = env.FILES.delete;
  env.FILES.delete = async () => { throw new Error('sample R2 failure'); };
  const response = await worker.fetch(request(uploaded.attachment.downloadUrl, { method: 'DELETE', cookie, revision: 1 }), env);
  assert.equal(response.status, 200); assert.ok((await response.json()).warning);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 1);
  assert.equal((await worker.fetch(request(uploaded.attachment.downloadUrl, { cookie }), env)).status, 404);
  await worker.scheduled({}, env);
  assert.equal(files.size, 1);
  env.FILES.delete = originalDelete;
  await worker.scheduled({}, env);
  assert.equal(files.size, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 0);
  await worker.scheduled({}, env); // Idempotent subsequent maintenance.
  assert.equal((await worker.fetch(request('/api/maintenance', { method: 'POST', cookie }), env)).status, 200);
});

test('crashed pre-put reservation waits for expiry, then storage maintenance deletes its orphan', async () => {
  const { env, sqlite, files } = setup();
  const ready = Date.now() + 3600000;
  sqlite.prepare('INSERT INTO pending_file_cleanup VALUES (?, ?, ?, ?)').run('attachments/sample-crashed', 'sample', 6, ready);
  files.set('attachments/sample-crashed', new Uint8Array([1, 2, 3]));
  await worker.scheduled({}, env);
  assert.equal(files.size, 1);
  sqlite.exec('UPDATE pending_file_cleanup SET ready_at = 0');
  await worker.scheduled({}, env);
  assert.equal(files.size, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 0);
});

test('concurrent uploads reserve per-reminder quota atomically before R2 put', async () => {
  const { env, sqlite, files } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const id = initial.data.reminders[0].id;
  const insert = sqlite.prepare('INSERT INTO pending_file_cleanup VALUES (?, ?, 6, ?)');
  for (let i = 0; i < 19; i++) insert.run(`sample-${i}`, id, Date.now() + 3600000);
  let release, started;
  const wait = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const put = env.FILES.put;
  env.FILES.put = async (...args) => { started(); await wait; return put(...args); };
  const form = () => { const value = new FormData(); value.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt'); return value; };
  const first = worker.fetch(request(`/api/reminders/${id}/attachments`, { method: 'POST', cookie, revision: 0, form: form() }), env);
  await ready;
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 20);
  const second = await worker.fetch(request(`/api/reminders/${id}/attachments`, { method: 'POST', cookie, revision: 0, form: form() }), env);
  assert.equal(second.status, 413);
  release();
  assert.equal((await first).status, 201);
  assert.equal(files.size, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 19);
});

test('upload CAS rollback failure retains its reservation until maintenance recovers', async () => {
  const { env, sqlite, files } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const batch = env.DB.batch;
  env.DB.batch = async statements => {
    if (statements[0].sql.startsWith('UPDATE state')) sqlite.exec('UPDATE state SET revision = revision + 1');
    return batch(statements);
  };
  const originalDelete = env.FILES.delete;
  env.FILES.delete = async () => { throw new Error('sample deletion failure'); };
  const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
  const response = await worker.fetch(request(`/api/reminders/${initial.data.reminders[0].id}/attachments`, { method: 'POST', cookie, revision: 0, form }), env);
  assert.equal(response.status, 503);
  assert.equal(files.size, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 1);
  env.FILES.delete = originalDelete;
  await worker.scheduled({}, env);
  assert.equal(files.size, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 0);
});

test('snapshot read failure after upload commit does not delete committed object', async () => {
  const { env, sqlite, files } = setup(), cookie = await authenticated(env);
  const initial = await (await worker.fetch(request('/api/state', { cookie }), env)).json();
  const batch = env.DB.batch;
  let committed = false;
  env.DB.batch = async statements => {
    if (committed && statements[0].sql.startsWith('SELECT document')) throw new Error('sample response read failure');
    const result = await batch(statements);
    if (statements[0].sql.startsWith('UPDATE state')) committed = true;
    return result;
  };
  const form = new FormData(); form.set('file', new Blob(['sample'], { type: 'text/plain' }), 'sample.txt');
  const response = await worker.fetch(request(`/api/reminders/${initial.data.reminders[0].id}/attachments`, { method: 'POST', cookie, revision: 0, form }), env);
  assert.equal(response.status, 503);
  assert.equal(files.size, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pending_file_cleanup').get().count, 0);
});
