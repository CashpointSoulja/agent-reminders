import { createReminder } from '../src/model.js';

export class DeviceAPIError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new DeviceAPIError(status, message); };
const enabled = env => env.DEVICE_SYNC === '1';
const CLOCK = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const rows = async statement => (await statement.all()).results;
export const deviceHash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
export const deviceCanonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const obj = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const nullableText = (value, max) => value == null || typeof value === 'string' && value.length <= max;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sid = value => text(value, 500);
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(sid) && new Set(value).size === value.length;
const fromJSON = JSON.parse;
const scopeGuard = device => ({ sql: `AND EXISTS (SELECT 1 FROM devices WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ${CLOCK} AND grant_version = ?)`, values: [device.id, device.token_hash, device.grant_version] });
const guarded = (env, mutation, sql, values) => env.DB.prepare(`${sql} AND EXISTS (SELECT 1 FROM state WHERE id = 1 AND mutation = ?)`).bind(...values, mutation);
const deviceView = row => ({ id: row.id, name: row.name, lists: fromJSON(row.grants), activeListIDs: fromJSON(row.active_lists), writebackListIDs: fromJSON(row.writeback_lists), grantVersion: row.grant_version, expiresAt: row.expires_at, revokedAt: row.revoked_at });
const sourceKeys = ['id','externalID','listID','title','notes','url','completed','completionDate','due','start','priority','modifiedAt','recurring'];
const dateKeys = ['year','month','day','hour','minute','second','timeZone','calendarID','era','isLeapMonth','floating'];
function nativeDate(value) {
  if (value == null) return;
  if (!obj(value, dateKeys) || !Number.isInteger(value.year) || value.year < 1900 || value.year > 9999 || !Number.isInteger(value.month) || value.month < 1 || value.month > 12 || !Number.isInteger(value.day) || value.day < 1 || value.day > 31 || ![null,undefined,'gregorian','iso8601'].includes(value.calendarID) || ![null,undefined,1].includes(value.era) || value.isLeapMonth === true) fail(422,'Unsupported native date components');
  const day = `${value.year}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}`;
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) fail(400,'Invalid native date');
  if ((value.hour != null) !== (value.minute != null) || value.hour != null && (!Number.isInteger(value.hour) || value.hour < 0 || value.hour > 23 || !Number.isInteger(value.minute) || value.minute < 0 || value.minute > 59) || value.second != null && (!Number.isInteger(value.second) || value.second < 0 || value.second > 59)) fail(400,'Invalid native time');
  if (value.floating !== undefined && typeof value.floating !== 'boolean') fail(400,'Invalid floating date metadata');
  if (value.hour != null && !text(value.timeZone,100)) fail(422,'Timed native reminders require an explicit resolved time zone');
  if (value.timeZone != null) { try { new Intl.DateTimeFormat('en',{ timeZone:value.timeZone }); } catch { fail(422,'Unsupported native time zone'); } }
}
function record(value) {
  if (!obj(value,sourceKeys) || !sid(value.id) || !sid(value.listID) || !nullableText(value.externalID,500) || !text(value.title,2000) || !nullableText(value.notes,20000) || !nullableText(value.url,2000) || typeof value.completed !== 'boolean' || typeof value.recurring !== 'boolean' || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > 9 || [value.completionDate,value.modifiedAt].some(x => x != null && (!Number.isFinite(x) || Math.abs(x) > 253402300799999)) || value.completed && value.completionDate == null || !value.completed && value.completionDate != null) fail(400,'Invalid native reminder');
  if (value.url) { try { const url = new URL(value.url); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) fail(422,'Unsupported native URL'); } catch (e) { if (e instanceof DeviceAPIError) throw e; fail(422,'Unsupported native URL'); } }
  nativeDate(value.due); nativeDate(value.start);
}
const mappedFields = row => ({ listId:row.listId, title:row.title, notes:row.notes, url:row.url || '', completed:row.completed, completedAt:row.completedAt, dueDate:row.dueDate, dueTime:row.dueTime, timeZone:row.timeZone, priority:row.priority });
const fieldsFromNative = row => ({ title:row.title, notes:row.notes || '', url:row.url || '', completed:row.completed, completedAt:row.completed ? new Date(row.completionDate).toISOString() : null,
  dueDate:row.due ? `${row.due.year}-${String(row.due.month).padStart(2,'0')}-${String(row.due.day).padStart(2,'0')}` : null,
  dueTime:row.due?.hour != null ? `${String(row.due.hour).padStart(2,'0')}:${String(row.due.minute).padStart(2,'0')}` : null,
  timeZone:row.due?.timeZone || 'UTC', priority:row.priority === 0 ? 'none' : row.priority <= 3 ? 'high' : row.priority <= 6 ? 'medium' : 'low' });
const webHash = row => deviceHash(deviceCanonical(mappedFields(row)));
const legacyWebHash = row => { const {listId,...fields} = mappedFields(row); return deviceHash(deviceCanonical(fields)); };
const completionHash = row => deviceHash(deviceCanonical(Object.fromEntries(Object.entries(row).filter(([key]) => !['createdAt','updatedAt','attachments'].includes(key)))));
function secure(request, env) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !(env.DEV_MODE === '1' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) fail(403,'HTTPS required');
  const origin = request.headers.get('origin');
  if (origin && origin !== (env.APP_ORIGIN || url.origin)) fail(403,'Device origin denied');
}
async function authenticate(request, env, pending = false) {
  secure(request,env);
  const token = request.headers.get('authorization')?.match(/^Bearer (rwd_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) fail(401,'Device bearer credential required');
  const tokenHash = await deviceHash(token);
  const device = await env.DB.prepare('SELECT * FROM devices WHERE token_hash = ?').bind(tokenHash).first();
  if (device && !device.revoked_at && device.expires_at > Date.now()) return device;
  if (!device && pending) {
    const pairing = await env.DB.prepare('SELECT id,expires_at FROM device_pairings WHERE token_hash = ? AND approved_at IS NULL AND expires_at > ?').bind(tokenHash,Date.now()).first();
    if (pairing) return { pending:true, pairingId:pairing.id, expiresAt:pairing.expires_at };
  }
  fail(401,'Device expired, revoked or not approved');
}
export function devicePublicRoute(request, env, json) {
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/device/discovery') return json({ protocolVersion:1, available:enabled(env), authentication:'Native-created device bearer, independently approved by owner', basePath:'/api/device/v1', privacy:'Selected source lists only; no agent credential has device authority', writeback:'Completion only, explicitly enabled per device/list; recurring writeback unavailable' });
  return null;
}
export async function ownerDeviceRoute(request, env, services) {
  const {pathname:path} = new URL(request.url), method = request.method;
  if (!(path === '/api/devices' || path.startsWith('/api/devices/'))) return null;
  if (!enabled(env)) fail(503,'Device sync is disabled');
  const {state,expected,body,json,commit,cleanData} = services, current = await state(env);
  if (method === 'GET' && path === '/api/devices') return json({ revision:current.revision, devices:(await rows(env.DB.prepare('SELECT * FROM devices ORDER BY created_at DESC LIMIT 100'))).map(deviceView), pairings:(await rows(env.DB.prepare('SELECT id,name,manifest,expires_at FROM device_pairings WHERE approved_at IS NULL AND expires_at > ?').bind(Date.now()))).map(row => ({ id:row.id,name:row.name,lists:fromJSON(row.manifest),expiresAt:row.expires_at })) });
  const pairingMatch = path.match(/^\/api\/devices\/pairings\/([^/]+)\/approve$/);
  if (pairingMatch && method === 'POST') {
    const input = await body(request), pairing = await env.DB.prepare('SELECT * FROM device_pairings WHERE id = ? AND approved_at IS NULL AND expires_at > ?').bind(pairingMatch[1],Date.now()).first();
    if (!pairing) fail(404,'Pending pairing not found');
    if (!obj(input,['code']) || typeof input.code !== 'string' || await deviceHash(input.code.toUpperCase().replaceAll('-','')) !== pairing.code_hash) fail(403,'Pairing code does not match');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL AND expires_at > ?').bind(Date.now()).first();
    if (count.n >= 5) fail(413,'Active device limit reached');
    const device = { id:pairing.id,token_hash:pairing.token_hash,name:pairing.name,grants:pairing.manifest,active_lists:JSON.stringify(fromJSON(pairing.manifest).map(x => x.id)),writeback_lists:'[]',grant_version:1,created_at:Date.now(),expires_at:Date.now()+30*86400000,revoked_at:null };
    await commit(env,current,cleanData(current.data,current.data),expected(request),'device.approved',{deviceId:device.id},[
      mutation => env.DB.prepare("INSERT INTO devices (id,token_hash,name,grants,active_lists,created_at,expires_at) SELECT ?,?,?,?,?,?,? FROM state WHERE mutation = ? AND EXISTS (SELECT 1 FROM device_pairings WHERE id = ? AND approved_at IS NULL AND expires_at > ?) AND (SELECT COUNT(*) FROM devices WHERE revoked_at IS NULL AND expires_at > ?) < 5").bind(device.id,device.token_hash,device.name,device.grants,device.active_lists,device.created_at,device.expires_at,mutation,pairing.id,Date.now(),Date.now()),
      mutation => guarded(env,mutation,'UPDATE device_pairings SET approved_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM devices WHERE id = ?)',[Date.now(),pairing.id,device.id]),
    ], {sql:`AND EXISTS (SELECT 1 FROM device_pairings WHERE id = ? AND token_hash = ? AND approved_at IS NULL AND expires_at > ${CLOCK}) AND (SELECT COUNT(*) FROM devices WHERE revoked_at IS NULL AND expires_at > ${CLOCK}) < 5 AND NOT EXISTS (SELECT 1 FROM devices WHERE token_hash = ?)`,values:[pairing.id,pairing.token_hash,pairing.token_hash]});
    return json({ device:deviceView(device),revision:current.revision+1 },201);
  }
  const match = path.match(/^\/api\/devices\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(match[1]).first();
    if (!device) fail(404,'Device not found');
    await commit(env,current,cleanData(current.data,current.data),expected(request),'device.revoked',{deviceId:device.id},[
      mutation => guarded(env,mutation,'UPDATE devices SET revoked_at = ?, grant_version = grant_version + 1, writeback_lists = ? WHERE id = ?',[Date.now(),'[]',device.id]),
      mutation => guarded(env,mutation,"UPDATE device_commands SET status = 'cancelled' WHERE device_id = ? AND status IN ('queued','claimed')",[device.id]),
    ]);
    return json({ deviceId:device.id,revoked:true,revision:current.revision+1 });
  }
  fail(404,'Device management endpoint not found');
}

export async function deviceRoute(request, env, services) {
  const {pathname:path} = new URL(request.url), method = request.method;
  if (!path.startsWith('/api/device/v1/')) return null;
  if (!enabled(env)) fail(503,'Device sync is disabled');
  const {state,expected,body,json,commit,cleanData} = services;
  if (path === '/api/device/v1/pairings' && method === 'POST') {
    secure(request,env);
    const input = await body(request);
    if (!obj(input,['name','tokenHash','lists']) || !text(input.name,100) || !hex(input.tokenHash) || !Array.isArray(input.lists) || !input.lists.length || input.lists.length > 100 || input.lists.some(x => !obj(x,['id','title','writable']) || !sid(x.id) || !text(x.title,200) || typeof x.writable !== 'boolean') || new Set(input.lists.map(x => x.id)).size !== input.lists.length) fail(400,'Invalid device pairing manifest');
    const old = await env.DB.prepare('SELECT * FROM device_pairings WHERE token_hash = ?').bind(input.tokenHash).first();
    if (old) fail(409,'Pairing already exists; poll activation or create a new token');
    const ipHash = await deviceHash(request.headers.get('cf-connecting-ip') || 'unknown'), now = Date.now(), windowStart = Math.floor(now/3600000)*3600000;
    const limits = await env.DB.batch([
      env.DB.prepare('DELETE FROM device_pairing_limits WHERE window_start < ?').bind(windowStart),
      env.DB.prepare('INSERT INTO device_pairing_limits (ip_hash,window_start,attempts) VALUES (?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET attempts = attempts + 1 WHERE window_start = excluded.window_start').bind(ipHash,windowStart),
      env.DB.prepare('SELECT attempts FROM device_pairing_limits WHERE ip_hash = ?').bind(ipHash),
      env.DB.prepare('DELETE FROM device_pairings WHERE approved_at IS NULL AND expires_at <= ?').bind(now),
    ]);
    if (limits[2].results[0].attempts > 10) fail(429,'Pairing rate limit reached');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', random = crypto.getRandomValues(new Uint8Array(8)), code = [...random].map(x => alphabet[x%alphabet.length]).join('');
    const id = crypto.randomUUID(), expiresAt = now+300000;
    const inserted = await env.DB.prepare('INSERT INTO device_pairings (id,token_hash,code_hash,name,manifest,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM device_pairings WHERE approved_at IS NULL AND expires_at > ?) < 20 AND NOT EXISTS (SELECT 1 FROM devices WHERE token_hash = ?)').bind(id,input.tokenHash,await deviceHash(code),input.name.trim(),JSON.stringify(input.lists),now,expiresAt,now,input.tokenHash).run();
    if (inserted.meta.changes !== 1) fail(429,'Pairing capacity reached');
    return json({ pairingId:id,code:`${code.slice(0,4)}-${code.slice(4)}`,expiresAt,pollIntervalSeconds:5 },201);
  }
  const device = await authenticate(request,env,path === '/api/device/v1/me');
  if (device.pending) return json({ state:'pending',pairingId:device.pairingId,expiresAt:device.expiresAt },202);
  const current = await state(env);
  if (path === '/api/device/v1/me' && method === 'GET') return json({ device:deviceView(device),revision:current.revision });
  if (path === '/api/device/v1/config' && method === 'PATCH') {
    const input = await body(request), grants = fromJSON(device.grants);
    if (!obj(input,['activeListIDs','writebackListIDs']) || !strings(input.activeListIDs) || !strings(input.writebackListIDs) || input.activeListIDs.some(id => !grants.some(x => x.id === id)) || input.writebackListIDs.some(id => !input.activeListIDs.includes(id) || !grants.some(x => x.id === id && x.writable))) fail(403,'Device list scope denied');
    if (deviceCanonical([...input.activeListIDs].sort()) === deviceCanonical([...fromJSON(device.active_lists)].sort()) && deviceCanonical([...input.writebackListIDs].sort()) === deviceCanonical([...fromJSON(device.writeback_lists)].sort())) return json({device:deviceView(device),revision:current.revision,noChange:true});
    await commit(env,current,cleanData(current.data,current.data),expected(request),'device.configured',{deviceId:device.id},[
      mutation => guarded(env,mutation,'UPDATE devices SET active_lists = ?, writeback_lists = ?, grant_version = grant_version + 1 WHERE id = ?',[JSON.stringify(input.activeListIDs),JSON.stringify(input.writebackListIDs),device.id]),
      mutation => guarded(env,mutation,"UPDATE device_commands SET status = 'cancelled' WHERE device_id = ? AND status IN ('queued','claimed')",[device.id]),
    ],scopeGuard(device));
    return json({ device:deviceView({...device,active_lists:JSON.stringify(input.activeListIDs),writeback_lists:JSON.stringify(input.writebackListIDs),grant_version:device.grant_version+1}),revision:current.revision+1 });
  }
  if (path === '/api/device/v1/revoke' && method === 'POST') {
    await commit(env,current,cleanData(current.data,current.data),expected(request),'device.revoked',{deviceId:device.id},[
      mutation => guarded(env,mutation,'UPDATE devices SET revoked_at = ?, grant_version = grant_version + 1, writeback_lists = ? WHERE id = ?',[Date.now(),'[]',device.id]),
      mutation => guarded(env,mutation,"UPDATE device_commands SET status = 'cancelled' WHERE device_id = ? AND status IN ('queued','claimed')",[device.id]),
    ],scopeGuard(device));
    return json({ revoked:true,revision:current.revision+1 });
  }
  if (path === '/api/device/v1/imports' && method === 'POST') return importSnapshot(request,env,device,current,services);
  if (path === '/api/device/v1/commands' && method === 'GET') {
    const commands = await rows(env.DB.prepare("SELECT c.*,m.source_id,m.source_list_id FROM device_commands c JOIN device_mappings m ON m.id = c.mapping_id JOIN devices d ON d.id = c.device_id WHERE c.device_id = ? AND c.status IN ('queued','claimed') AND c.expires_at > ? AND c.grant_version = d.grant_version AND m.missing = 0 AND m.source_hash = c.source_hash AND m.source_list_id IN (SELECT value FROM json_each(d.writeback_lists)) ORDER BY c.created_at LIMIT 100").bind(device.id,Date.now()));
    return json({ commands:commands.map(commandView),revision:current.revision });
  }
  const match = path.match(/^\/api\/device\/v1\/commands\/([^/]+)\/(claim|ack)$/);
  if (match && method === 'POST') return commandAction(request,env,device,current,match[1],match[2],services);
  fail(404,'Device endpoint not found');
}
const commandView = row => ({ id:row.id,taskID:row.task_id,reminderID:row.source_id,listID:row.source_list_id,expectedRevision:row.source_hash,expiresAt:row.expires_at,grantVersion:row.grant_version,claimID:row.claim_id,claimExpiresAt:row.claim_expires_at,status:row.status });

async function importSnapshot(request,env,device,current,services) {
  const {body,json,expected,commit,cleanData} = services, revision = expected(request), input = await body(request), key = request.headers.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) fail(400,'Stable import Idempotency-Key required');
  if (!obj(input,['schemaVersion','generatedAt','sample','selectedListIDs','lists','reminders','revisions','unsupportedFeatures','resolutions']) || input.schemaVersion !== 1 || !Number.isFinite(input.generatedAt) || Math.abs(input.generatedAt-Date.now()) > 900000 || typeof input.sample !== 'boolean' || !strings(input.selectedListIDs) || !input.selectedListIDs.length || !Array.isArray(input.lists) || input.lists.length !== input.selectedListIDs.length || !Array.isArray(input.reminders) || input.reminders.length > 1000 || !obj(input.revisions,input.reminders.map(r => r.id)) || !Array.isArray(input.unsupportedFeatures) || input.unsupportedFeatures.length > 20 || input.unsupportedFeatures.some(x => !text(x,100))) fail(400,'Invalid or expired native snapshot v1');
  const active = fromJSON(device.active_lists), grants = fromJSON(device.grants);
  if (input.selectedListIDs.some(id => !active.includes(id) || !grants.some(x => x.id === id))) fail(403,'Source list scope denied');
  if (input.lists.some(list => !obj(list,['id','title','writable']) || !sid(list.id) || !text(list.title,200) || typeof list.writable !== 'boolean' || !input.selectedListIDs.includes(list.id)) || new Set(input.lists.map(x => x.id)).size !== input.lists.length || new Set(input.reminders.map(x => x.id)).size !== input.reminders.length || Object.keys(input.revisions).length !== input.reminders.length) fail(400,'Duplicate or invalid native IDs');
  for (const source of input.reminders) {
    record(source);
    if (!input.selectedListIDs.includes(source.listID)) fail(403,'Unselected reminder refused');
    if (!hex(input.revisions[source.id]) || input.revisions[source.id] !== await deviceHash(deviceCanonical(source))) fail(400,'Native fingerprint v1 mismatch');
  }
  const resolutions = input.resolutions ?? [];
  if (!Array.isArray(resolutions) || resolutions.length > 1000 || new Set(resolutions.map(x => x.sourceID)).size !== resolutions.length || resolutions.some(x => !obj(x,['sourceID','sourceRevision','webFingerprint','choice']) || !sid(x.sourceID) || !hex(x.sourceRevision) || !hex(x.webFingerprint) || !['useApple','keepWeb'].includes(x.choice))) fail(400,'Invalid conflict resolution');
  const requestHash = await deviceHash(deviceCanonical(input));
  const replay = await env.DB.prepare('SELECT * FROM device_import_receipts WHERE device_id = ? AND request_key = ?').bind(device.id,key).first();
  if (replay) { if (replay.request_hash !== requestHash) fail(409,'Import key was reused with different content'); return json({...fromJSON(replay.receipt),replayed:true}); }
  const mappings = await rows(env.DB.prepare('SELECT * FROM device_mappings WHERE device_id = ?').bind(device.id)), data = structuredClone(current.data), updates = [], conflicts = [], changedIDs = [];
  let created = 0, updated = 0, unchanged = 0;
  const listIDs = new Map();
  for (const list of input.lists) {
    const old = mappings.find(x => x.kind === 'list' && x.source_id === list.id), currentList = old && data.lists.find(x => x.id === old.web_id), sourceHash = await deviceHash(deviceCanonical(list));
    if (old && !currentList) { conflicts.push({kind:'list',sourceID:list.id,reason:'cloud_list_missing'}); continue; }
    const destination = currentList || {id:crypto.randomUUID(),name:list.title,color:'#007aff',icon:'list',type:'standard',sections:[]};
    const beforeHash = await deviceHash(deviceCanonical({name:destination.name}));
    if (old && old.source_hash !== sourceHash && old.web_hash !== beforeHash) { conflicts.push({kind:'list',sourceID:list.id,reason:'list_changed_in_both_places'}); continue; }
    if (!old || old.source_hash !== sourceHash) destination.name = list.title;
    if (!old) data.lists.push(destination);
    listIDs.set(list.id,destination.id);
    if (old && old.source_hash === sourceHash) continue;
    updates.push({id:old?.id || crypto.randomUUID(),kind:'list',sourceListID:list.id,sourceID:list.id,webID:destination.id,sourceHash,webHash:await deviceHash(deviceCanonical({name:destination.name})),record:list});
  }
  for (const source of input.reminders) {
    const old = mappings.find(x => x.kind === 'reminder' && x.source_id === source.id), destination = old && data.reminders.find(x => x.id === old.web_id), sourceHash = input.revisions[source.id];
    if (!listIDs.has(source.listID)) continue;
    if (old && old.source_hash === sourceHash && destination) {
      unchanged++;
      if (old.missing) updates.push({id:old.id,kind:'reminder',sourceListID:source.listID,sourceID:source.id,webID:destination.id,sourceHash,webHash:old.web_hash,webHashVersion:fromJSON(old.source_record).webHashVersion ?? 1,record:source});
      continue;
    }
    const beforeHash = destination ? await webHash(destination) : null;
    const previousListID = old && mappings.find(x => x.kind === 'list' && x.source_id === old.source_list_id)?.web_id;
    // Legacy hashes omitted list identity: upgrade only when both their content and recorded list still match.
    const baselineMatches = old && destination && (old.web_hash === beforeHash || fromJSON(old.source_record).webHashVersion !== 2 && destination.listId === previousListID && old.web_hash === await legacyWebHash(destination));
    const resolution = resolutions.find(x => x.sourceID === source.id);
    const targetListID = listIDs.get(source.listID);
    const incomingFields = fieldsFromNative(source);
    // Independently observed completion dates may differ while both stores agree the task is done.
    const incomingHash = await deviceHash(deviceCanonical({...incomingFields,listId:targetListID,...(destination?.completed && source.completed ? {completedAt:destination.completedAt} : {})}));
    const conflict = old && (!destination || !baselineMatches && incomingHash !== beforeHash);
    if (conflict && !(resolution && destination && resolution.webFingerprint === beforeHash && resolution.sourceRevision === sourceHash)) { conflicts.push({kind:'reminder',sourceID:source.id,reason:destination ? 'changed_in_both_places' : 'cloud_reminder_missing',sourceRevision:sourceHash,webFingerprint:beforeHash,apple:fieldsFromNative(source),cloud:destination ? mappedFields(destination) : null}); continue; }
    if (destination && destination.listId !== targetListID && (destination.parentId || destination.sectionId || data.reminders.some(x => x.parentId === destination.id))) { conflicts.push({kind:'reminder',sourceID:source.id,reason:'move_has_web_structure'}); continue; }
    const target = destination || {...createReminder(targetListID,source.title),title:source.title};
    if (resolution?.choice !== 'keepWeb') Object.assign(target,fieldsFromNative(source),{listId:targetListID,dueInstant:null});
    if (!destination) {data.reminders.push(target);created++;} else updated++;
    updates.push({id:old?.id || crypto.randomUUID(),kind:'reminder',sourceListID:source.listID,sourceID:source.id,webID:target.id,sourceHash,webHash:await webHash(target),record:source});
    if (old && old.source_hash !== sourceHash) changedIDs.push(old.id);
  }
  if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM device_mappings').first()).n + updates.filter(x => !mappings.some(m => m.id === x.id)).length > 5000) fail(413,'Native mapping history limit reached');
  if (conflicts.length) return json({error:'Source conflicts require review; nothing imported',conflicts,revision:current.revision},409);
  const missing = mappings.filter(x => x.kind === 'reminder' && input.selectedListIDs.includes(x.source_list_id) && !input.reminders.some(r => r.id === x.source_id) && !x.missing);
  const affected = [...new Set([...changedIDs,...missing.map(x => x.id)])], extra = [];
  if (updates.length) {
    const packed = updates.map(x => ({id:x.id,kind:x.kind,sourceListID:x.sourceListID,sourceID:x.sourceID,webID:x.webID,sourceHash:x.sourceHash,webHash:x.webHash,metadata:x.kind === 'reminder' ? {recurring:x.record.recurring,webHashVersion:x.webHashVersion ?? 2} : {writable:x.record.writable}}));
    extra.push(mutation => env.DB.prepare(`INSERT INTO device_mappings (id,device_id,kind,source_list_id,source_id,web_id,source_hash,web_hash,source_record,missing)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.kind'),json_extract(value,'$.sourceListID'),json_extract(value,'$.sourceID'),json_extract(value,'$.webID'),json_extract(value,'$.sourceHash'),json_extract(value,'$.webHash'),json_extract(value,'$.metadata'),0
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM state WHERE id = 1 AND mutation = ?)
      ON CONFLICT(id) DO UPDATE SET source_list_id=excluded.source_list_id,source_hash=excluded.source_hash,web_hash=excluded.web_hash,source_record=excluded.source_record,missing=0,web_id=excluded.web_id`).bind(device.id,JSON.stringify(packed),mutation));
  }
  if (missing.length) extra.push(mutation => guarded(env,mutation,'UPDATE device_mappings SET missing = 1 WHERE device_id = ? AND id IN (SELECT value FROM json_each(?))',[device.id,JSON.stringify(missing.map(x => x.id))]));
  if (affected.length) {
    extra.push(mutation => guarded(env,mutation,"UPDATE device_commands SET status = 'cancelled' WHERE mapping_id IN (SELECT value FROM json_each(?)) AND status IN ('queued','claimed')",[JSON.stringify(affected)]));
    if (env.AGENT_API === '1') extra.push(mutation => guarded(env,mutation,"UPDATE agent_tasks SET status = 'superseded', mutation = ?, updated_at = ? WHERE id IN (SELECT task_id FROM device_task_bindings WHERE mapping_id IN (SELECT value FROM json_each(?))) AND status IN ('queued','claimed')",[mutation,new Date().toISOString(),JSON.stringify(affected)]));
    if (env.AGENT_API === '1') extra.push(mutation => env.DB.prepare("INSERT INTO agent_events (agent_id,task_id,type,created_at) SELECT agent_id,id,'task.superseded',updated_at FROM agent_tasks WHERE mutation = ? AND status = 'superseded'").bind(mutation));
  }
  const receipt = {deviceId:device.id,created,updated,unchanged,missing:missing.length,revision:current.revision+1,mappings:updates.filter(x => x.kind === 'reminder').map(x => ({sourceID:x.sourceID,reminderId:x.webID,sourceRevision:x.sourceHash}))};
  if (!updates.length && !missing.length && !resolutions.length) return json({...receipt,revision:current.revision,noChange:true});
  extra.push(mutation => env.DB.prepare('INSERT INTO device_import_receipts (device_id,request_key,request_hash,receipt,created_at) SELECT ?,?,?,?,? FROM state WHERE mutation = ?').bind(device.id,key,requestHash,JSON.stringify(receipt),Date.now(),mutation));
  extra.push(mutation => guarded(env,mutation,'DELETE FROM device_import_receipts WHERE device_id = ? AND request_key NOT IN (SELECT request_key FROM device_import_receipts WHERE device_id = ? ORDER BY created_at DESC LIMIT 32)',[device.id,device.id]));
  await commit(env,current,cleanData(data,current.data),revision,'device.imported',{deviceId:device.id,created,updated,missing:missing.length},extra,scopeGuard(device));
  return json(receipt);
}

async function commandAction(request,env,device,current,id,action,services) {
  const {body,json,commit,cleanData,expected} = services;
  const revision = expected(request);
  const row = await env.DB.prepare('SELECT c.*,m.source_id,m.source_list_id,m.source_hash AS current_source_hash,m.missing FROM device_commands c JOIN device_mappings m ON m.id = c.mapping_id WHERE c.id = ? AND c.device_id = ?').bind(id,device.id).first();
  if (!row) fail(404,'Device command not found');
  const input = await body(request);
  if (!obj(input,action === 'claim' ? ['claimID'] : ['claimID','outcome','observedRevision','completed']) || !text(input.claimID,100) || !/^[A-Za-z0-9_-]{16,100}$/.test(input.claimID)) fail(400,'Valid command claim ID required');
  if (row.receipt && action === 'ack') {
    const receipt = fromJSON(row.receipt);
    if (row.claim_id !== input.claimID || receipt.outcome !== input.outcome || receipt.observedRevision !== input.observedRevision || receipt.completed !== input.completed) fail(409,'Acknowledgement replay changed');
    return json({receipt,replayed:true,revision:current.revision});
  }
  if (!['queued','claimed'].includes(row.status) || row.expires_at <= Date.now() || row.grant_version !== device.grant_version || row.missing || row.current_source_hash !== row.source_hash || !fromJSON(device.writeback_lists).includes(row.source_list_id)) fail(409,'Command expired, changed or writeback disabled');
  if (action === 'claim') {
    if (row.status === 'claimed' && row.claim_expires_at > Date.now() && row.claim_id !== input.claimID) fail(409,'Command already claimed; reconcile it');
    if (row.claim_id === input.claimID && row.claim_expires_at > Date.now()) return json({command:commandView(row),revision:current.revision,replayed:true});
    const until = Math.min(row.expires_at,Date.now()+60000);
    const deviceGuard = scopeGuard(device);
    const commandGuard = {sql:`${deviceGuard.sql} AND EXISTS (SELECT 1 FROM device_commands c JOIN device_mappings m ON m.id = c.mapping_id WHERE c.id = ? AND c.device_id = ? AND c.expires_at > ${CLOCK} AND c.grant_version = ? AND (c.status = 'queued' OR (c.status = 'claimed' AND c.claim_expires_at <= ${CLOCK})) AND m.missing = 0 AND m.source_hash = c.source_hash AND m.source_list_id IN (SELECT value FROM json_each((SELECT writeback_lists FROM devices WHERE id = ?))))`,values:[...deviceGuard.values,row.id,device.id,device.grant_version,device.id]};
    await commit(env,current,cleanData(current.data,current.data),expected(request),'device.command.claimed',{deviceId:device.id,commandId:row.id},[
      mutation => guarded(env,mutation,`UPDATE device_commands SET status = 'claimed', claim_id = ?, claim_expires_at = ? WHERE id = ? AND (status = 'queued' OR (status = 'claimed' AND claim_expires_at <= ${CLOCK}))`,[input.claimID,until,row.id]),
    ],commandGuard);
    return json({command:commandView({...row,status:'claimed',claim_id:input.claimID,claim_expires_at:until}),revision:current.revision+1});
  }
  if (row.status !== 'claimed' || row.claim_id !== input.claimID) fail(409,'Claim does not match');
  if (!['applied','conflict','missing','unsupported'].includes(input.outcome) || typeof input.completed !== 'boolean' || !(input.observedRevision == null || hex(input.observedRevision)) || input.outcome === 'applied' && (!input.completed || !hex(input.observedRevision))) fail(400,'Invalid command receipt');
  const receipt = {commandId:row.id,taskId:row.task_id,outcome:input.outcome,observedRevision:input.observedRevision ?? null,completed:input.completed,receivedAt:Date.now()};
  await commit(env,current,cleanData(current.data,current.data),expected(request),'device.command.acknowledged',{deviceId:device.id,commandId:row.id,outcome:input.outcome},[
    mutation => guarded(env,mutation,'UPDATE device_commands SET status = ?, receipt = ? WHERE id = ? AND status = ? AND claim_id = ?',[input.outcome,JSON.stringify(receipt),row.id,'claimed',input.claimID]),
  ],scopeGuard(device));
  return json({receipt,revision:current.revision+1});
}

export async function deviceDelegationStatements(env,task) {
  if (!enabled(env)) return [];
  const mapping = await env.DB.prepare("SELECT m.* FROM device_mappings m JOIN devices d ON d.id = m.device_id WHERE m.kind = 'reminder' AND m.web_id = ? AND m.missing = 0 AND d.revoked_at IS NULL AND d.expires_at > ? AND m.source_list_id IN (SELECT value FROM json_each(d.active_lists))").bind(task.reminder_id,Date.now()).first();
  if (!mapping) return [];
  return [mutation => env.DB.prepare('INSERT INTO device_task_bindings (task_id,mapping_id,source_hash) SELECT ?,?,? FROM state WHERE mutation = ? AND EXISTS (SELECT 1 FROM agent_tasks WHERE id = ? AND mutation = ?) AND EXISTS (SELECT 1 FROM device_mappings WHERE id = ? AND source_hash = ? AND missing = 0)').bind(task.id,mapping.id,mapping.source_hash,mutation,task.id,mutation,mapping.id,mapping.source_hash)];
}
export async function deviceCompletionStatements(env,task,completedOccurrenceId,data) {
  if (!enabled(env)) return [];
  const row = await env.DB.prepare('SELECT b.source_hash AS bound_hash,m.*,d.grant_version,d.writeback_lists,d.revoked_at,d.expires_at FROM device_task_bindings b JOIN device_mappings m ON m.id = b.mapping_id JOIN devices d ON d.id = m.device_id WHERE b.task_id = ?').bind(task.id).first();
  if (!row || row.web_id !== completedOccurrenceId || row.missing || row.revoked_at || row.expires_at <= Date.now() || row.source_hash !== row.bound_hash || !fromJSON(row.writeback_lists).includes(row.source_list_id) || fromJSON(row.source_record).recurring) return [];
  const completed = data?.reminders.find(x => x.id === completedOccurrenceId);
  if (!completed?.completed) return [];
  const afterHash = await completionHash(completed), id = crypto.randomUUID(), now = Date.now();
  return [mutation => env.DB.prepare("INSERT INTO device_commands (id,device_id,task_id,mapping_id,source_hash,grant_version,web_hash,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? FROM state WHERE mutation = ? AND EXISTS (SELECT 1 FROM agent_tasks WHERE id = ? AND status = 'succeeded' AND mutation = ?) AND EXISTS (SELECT 1 FROM device_mappings m JOIN devices d ON d.id = m.device_id WHERE m.id = ? AND m.missing = 0 AND m.source_hash = ? AND d.revoked_at IS NULL AND d.expires_at > ? AND d.grant_version = ? AND m.source_list_id IN (SELECT value FROM json_each(d.writeback_lists)))").bind(id,row.device_id,task.id,row.id,row.source_hash,row.grant_version,afterHash,now,now+86400000,mutation,task.id,mutation,row.id,row.source_hash,now,row.grant_version)];
}
export async function deviceInvalidationStatements(env,data) {
  if (!enabled(env)) return [];
  const commands = await rows(env.DB.prepare("SELECT c.id,c.web_hash,m.web_id FROM device_commands c JOIN device_mappings m ON m.id = c.mapping_id WHERE c.status IN ('queued','claimed')")), invalid = [];
  for (const command of commands) {
    const row = data.reminders.find(x => x.id === command.web_id);
    if (!row?.completed || await completionHash(row) !== command.web_hash) invalid.push(command.id);
  }
  return invalid.length ? [mutation => guarded(env,mutation,"UPDATE device_commands SET status = 'cancelled' WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('queued','claimed')",[JSON.stringify(invalid)])] : [];
}
