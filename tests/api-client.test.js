import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/api.js';
const data = { lists: [{ id: 'sample-list', name: 'Sample', color: '#007aff', icon: 'list', sections: [] }], reminders: [] };
const snapshot = (revision) => ({ data, revision, sequence: revision });
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

test('all requests use relative same-origin cookie auth with no cached responses', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => { calls.push(args); return response(snapshot(0)); } });
  await api.session(); await api.getState(); await api.getChanges(0);
  await api.login('fixture-only'); await api.logout();
  for (const [path, options] of calls) {
    assert.ok(path.startsWith('/api/'));
    assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store');
  }
  assert.equal(calls[3][0], '/api/auth/login');
  assert.equal(api.snapshot, null);
});

test('serialized writes use returned revisions and capture their original data', async () => {
  let revision = 4; const writes = []; let inFlight = 0;
  const api = createApiClient({ fetchImpl: async (path, options) => {
    if (options.method !== 'PUT') return response(snapshot(revision));
    assert.equal(inFlight++, 0); assert.equal(options.headers['If-Match'], String(revision));
    writes.push(JSON.parse(options.body)); await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--; return response(snapshot(++revision));
  } });
  await api.getState();
  const draft = { ...data, reminders: [{ id: 'sample-a' }] };
  const first = api.saveData(draft); draft.reminders.push({ id: 'sample-b' });
  const second = api.saveData(draft); await Promise.all([first, second]);
  assert.equal(writes[0].data.reminders.length, 1); assert.equal(writes[1].data.reminders.length, 2);
  assert.equal(api.snapshot.revision, 6);
});

test('a CAS conflict stops queued mutations without retrying or discarding the old snapshot', async () => {
  let writes = 0;
  const api = createApiClient({ fetchImpl: async (path, options) => {
    if (options.method === 'PUT') { writes++; return response({ error: 'Workspace changed' }, 409); }
    return response(snapshot(writes ? 8 : 2));
  } });
  await api.getState();
  const results = await Promise.allSettled([api.saveData(data), api.saveData(data)]);
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.status === 409));
  assert.equal(writes, 1); assert.equal(api.snapshot.revision, 2);
  await api.getState(); assert.equal(api.snapshot.revision, 8);
});

test('a draft edited during refresh blocks writes instead of adopting a newer server revision', async () => {
  let calls = 0;
  const api = createApiClient({ fetchImpl: async () => response(snapshot(calls++)) });
  await api.getState();
  await assert.rejects(api.getState({ accept: () => false }), e => e.status === 409);
  assert.equal(api.snapshot.revision, 0);
  await assert.rejects(api.saveData(data), e => e.status === 409);
  assert.equal(calls, 2);
});

test('expired change cursors signal explicit clean resync without automatic retry', async () => {
  let calls = 0;
  const api = createApiClient({ fetchImpl: async () => { calls++; return response({ error: 'Expired', resync: true }, 410); } });
  await assert.rejects(api.getChanges(4), e => e instanceof ApiError && e.status === 410 && e.resync);
  assert.equal(calls, 1);
});

test('attachment mutations share CAS ordering and update the snapshot', async () => {
  const paths = []; let revision = 0;
  const api = createApiClient({ fetchImpl: async (path, options) => {
    paths.push(path);
    if (options.method) {
      assert.equal(options.headers['If-Match'], String(revision)); revision++;
      if (options.method === 'POST') { assert.ok(options.body instanceof FormData); assert.equal(options.body.get('file').size, 3); }
    }
    return response({ ...snapshot(revision), attachment: { id: 'sample-photo' } });
  } });
  await api.getState();
  await api.uploadAttachment('sample/id', new Blob(['abc'], { type: 'image/png' }));
  await api.deleteAttachment('sample/photo');
  assert.equal(paths[1], '/api/reminders/sample%2Fid/attachments');
  assert.equal(paths[2], '/api/attachments/sample%2Fphoto'); assert.equal(api.snapshot.revision, 2);
});

test('unavailable and ambiguous writes fail closed without a seed-data fallback or queued retry', async () => {
  let calls = 0;
  const api = createApiClient({ fetchImpl: async (path, options) => {
    calls++;
    if (options.method) throw new Error('network failure');
    return response(snapshot(0));
  } });
  await api.getState();
  await assert.rejects(api.saveData(data), e => e.status === 0);
  await assert.rejects(api.saveData(data), e => e.status === 0);
  assert.equal(calls, 2); assert.equal(api.snapshot.revision, 0);
  const unavailable = createApiClient({ fetchImpl: async () => response({ error: 'Storage unavailable' }, 503) });
  await assert.rejects(unavailable.getState(), e => e.status === 503);
  assert.equal(unavailable.snapshot, null);
});

test('invalid server documents never reach the application', async () => {
  const api = createApiClient({ fetchImpl: async () => response({ data: { lists: [], reminders: [{ id: 'bad' }] }, revision: 0, sequence: 0 }) });
  await assert.rejects(api.getState(), e => e.status === 502);
  assert.equal(api.snapshot, null);
});

test('template sharing uses owner CAS and fragment-free Bearer reads without workspace cookies', async () => {
  const calls = [], token = 's'.repeat(43), template = { id: 'sample-template', name: 'Sample', list: data.lists[0], reminders: [] };
  const api = createApiClient({ fetchImpl: async (path, options) => { calls.push([path, options]); if (path === '/api/templates/shared') return response({ template }); if (path.endsWith('/share')) return response({ shared: true }); return response(snapshot(4)); } });
  await api.getState(); await api.templateShare(template.id, 'POST', { dates: false, tags: false, locations: false }); await api.readSharedTemplate(token);
  assert.equal(calls[1][1].headers['If-Match'], '4'); assert.equal(calls[1][1].credentials, 'include');
  assert.equal(calls[2][0], '/api/templates/shared'); assert.equal(calls[2][1].credentials, 'omit'); assert.equal(calls[2][1].referrerPolicy, 'no-referrer'); assert.ok(calls[2][1].headers.Authorization === `Bearer ${token}`);
  assert.ok(!calls.some(([path]) => path.includes(token)), 'Capability never appears in a request URL');
});

test('template share mutations respect the existing conflict latch and never bypass an unresolved workspace write', async () => {
  let shareCalls = 0;
  const api = createApiClient({ fetchImpl: async (path, options) => { if (path.endsWith('/share')) { shareCalls++; return response({ shared: true }); } if (options.method === 'PUT') return response({ error: 'Sample conflict' }, 409); return response(snapshot(1)); } });
  await api.getState(); await assert.rejects(api.saveData(data), error => error.status === 409); await assert.rejects(api.templateShare('sample-template', 'POST', {}), error => error.status === 409); assert.equal(shareCalls, 0);
});

test('queued template Share captures the draft before later edits and never saves private state or sends file authority', async () => {
  const calls = [], draft = { id: 'sample-template', name: 'Sample draft', list: structuredClone(data.lists[0]), reminders: [], files: [{ id: 'sample-private-file' }] };
  const api = createApiClient({ fetchImpl: async (path, options) => { calls.push([path, options]); return response(path.endsWith('/share') ? { shared: true } : snapshot(4)); } });
  await api.getState();
  const include = { dates: false }, publication = api.templateShare(draft.id, 'POST', include, draft);
  draft.name = 'Later unsaved edit'; draft.list.name = 'Later unsaved list'; include.dates = true;
  await publication;
  const envelope = JSON.parse(calls[1][1].body);
  assert.equal(envelope.draft.name, 'Sample draft'); assert.equal(envelope.draft.list.name, 'Sample'); assert.equal(envelope.dates, false); assert.equal(envelope.draft.files, undefined);
  assert.equal(calls.length, 2); assert.equal(calls[1][0], '/api/templates/sample-template/share'); assert.equal(api.snapshot.revision, 4);
  await api.templateShare(draft.id, 'GET', include, draft); await api.templateShare(draft.id, 'DELETE', include, draft);
  assert.equal(calls[2][1].body, undefined); assert.equal(calls[3][1].body, undefined);
});

test('owner agent management uses the same CAS queue and preserves one-time secret outside workspace data', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (path, options) => {
    calls.push([path, options]);
    return response(path === '/api/agents/sample-agent/tokens' ? { ...snapshot(5), token: 'sample-once', credential: { id: 'sample-credential' } } : snapshot(4));
  } });
  await api.getState();
  const payload = { scopes: ['tasks:read', 'tasks:execute'] };
  const issued = api.ownerAgents('POST', '/agents/sample-agent/tokens', payload);
  payload.scopes.push('attachments:read');
  assert.equal((await issued).token, 'sample-once');
  assert.equal(calls[1][1].headers['If-Match'], '4');
  assert.deepEqual(JSON.parse(calls[1][1].body).scopes, ['tasks:read', 'tasks:execute']);
  assert.equal(api.snapshot.revision, 5);
  assert.equal(api.snapshot.data.token, undefined);
  assert.equal(api.snapshot.token, undefined);
  assert.deepEqual(Object.keys(api.snapshot).sort(), ['data', 'revision', 'sequence']);
  assert.throws(() => api.ownerAgents('POST', '/templates/sample/share', {}), error => error.status === 400);
});

test('device approval sends no native key and refreshes owner revision after a scoped receipt', async () => {
  const calls = []; let reads = 0;
  const api = createApiClient({ fetchImpl: async (path, options) => {
    calls.push([path, options]);
    if (path === '/api/state') return response(reads++ ? { ...snapshot(2), token: 'fictional-extra-state-token' } : snapshot(1));
    return response({ device: { id: 'sample-device' }, revision: 2, token: 'fictional-native-once' });
  } });
  await api.getState();
  const payload = { code: 'ABCD-EFGH' };
  const approved = api.ownerDevices('POST', '/devices/pairings/sample-device/approve', payload);
  payload.code = 'LATER';
  assert.equal((await approved).token, 'fictional-native-once');
  assert.equal(calls[1][1].headers['If-Match'], '1');
  assert.deepEqual(JSON.parse(calls[1][1].body), { code: 'ABCD-EFGH' });
  assert.equal(api.snapshot.revision, 2);
  assert.equal(api.snapshot.token, undefined);
  assert.deepEqual(Object.keys(api.snapshot).sort(), ['data', 'revision', 'sequence']);
  assert.equal(calls.length, 3);
  assert.throws(() => api.ownerDevices('POST', '/device/v1/imports', {}), error => error.status === 400);
});
