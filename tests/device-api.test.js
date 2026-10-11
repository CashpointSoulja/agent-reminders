import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../backend/worker.js';
import { deviceHash, deviceCanonical } from '../backend/device-api.js';
function setup(on=true) {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
  if (on) sql.exec(readFileSync(new URL('../backend/device-sync-schema.sql',import.meta.url),'utf8'));
  const stmt = (query,args=[]) => ({sql:query,args,bind(...values){return stmt(query,values)},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}}}});
  const DB={prepare:stmt,async batch(items){sql.exec('BEGIN');try{const out=[];for(const i of items)out.push(/^SELECT/.test(i.sql)?await i.all():await i.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
  return {sql,env:{DB,FILES:{},APP_PASSWORD:'fictional-device-test',SESSION_SECRET:'d'.repeat(40),SAMPLE_DATA:'1',AGENT_API:'1',DEVICE_SYNC:on?'1':'0'}};
}
async function fixture(on=true) {
  const f=setup(on), token='rwd_'+'A'.repeat(43);
  const call=async(path,method='GET',data,opts={})=>{
    const headers={};if(opts.owner){headers.cookie=f.cookie;headers.origin='https://sample.test'}else if(opts.token!==false)headers.authorization=`Bearer ${opts.token||token}`;
    if(data!==undefined)headers['content-type']='application/json';if(opts.revision!==undefined)headers['if-match']=String(opts.revision);if(opts.key)headers['idempotency-key']=opts.key;
    const response=await worker.fetch(new Request(`https://sample.test${path}`,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),f.env);
    const payload=await response.json();return {status:response.status,...payload};
  };
  const login=await worker.fetch(new Request('https://sample.test/api/auth/login',{method:'POST',headers:{origin:'https://sample.test','content-type':'application/json'},body:JSON.stringify({password:f.env.APP_PASSWORD})}),f.env);
  f.cookie=login.headers.get('set-cookie').split(';')[0];
  const state=()=>call('/api/state','GET',undefined,{owner:true});
  const owner=async(path,method,data)=>call(path,method,data,{owner:true,revision:(await state()).revision});
  const list={id:'source-list',title:'Fictional source list',writable:true};
  const pair=async()=>{
    const start=await call('/api/device/v1/pairings','POST',{name:'Synthetic iPhone',tokenHash:await deviceHash(token),lists:[list]},{token:false});assert.equal(start.status,201);
    assert.equal((await call('/api/device/v1/me')).status,202);
    const approved=await owner(`/api/devices/pairings/${start.pairingId}/approve`,'POST',{code:start.code});assert.equal(approved.status,201);
    return approved.device;
  };
  const native={id:'native-one',listID:list.id,title:'Fictional task',notes:'Synthetic content',completed:false,priority:0,recurring:false};
  const snapshot=async(reminders=[native])=>({schemaVersion:1,generatedAt:Date.now(),sample:true,selectedListIDs:[list.id],lists:[list],reminders,revisions:Object.fromEntries(await Promise.all(reminders.map(async r=>[r.id,await deviceHash(deviceCanonical(r))]))),unsupportedFeatures:['tags','subtasks','photos']});
  const imported=async(input,key=crypto.randomUUID())=>call('/api/device/v1/imports','POST',input,{key,revision:(await state()).revision});
  return {...f,token,list,native,call,state,owner,pair,snapshot,imported};
}
test('device feature off makes no device-table queries and does not break ordinary owner state',async()=>{
 const f=await fixture(false);assert.equal((await f.state()).status,200);assert.equal((await f.call('/api/device/v1/me')).status,503);assert.equal((await f.call('/api/device/discovery')).available,false);
});
test('device pairing scopes are owner-approved, hash-only, and distinct from agent/cookie authority',async()=>{
 const f=await fixture(),start=await f.call('/api/device/v1/pairings','POST',{name:'Synthetic iPhone',tokenHash:await deviceHash(f.token),lists:[f.list]},{token:false});assert.equal(start.status,201);
 assert.equal((await f.call('/api/device/v1/imports','POST',await f.snapshot(),{revision:0,key:crypto.randomUUID()})).status,401);
 assert.equal((await f.owner(`/api/devices/pairings/${start.pairingId}/approve`,'POST',{code:'WRONGCODE'})).status,403);
 assert.equal((await f.owner(`/api/devices/pairings/${start.pairingId}/approve`,'POST',{code:start.code})).status,201);
 const metadata=await f.owner('/api/devices');assert.ok(!JSON.stringify(metadata).includes(f.token));assert.ok(!JSON.stringify(metadata).includes(await deviceHash(f.token)));
 assert.equal((await f.call('/api/state')).status,401);assert.equal((await f.call('/api/agent/v1/tasks')).status,401);
 assert.equal((await f.call('/api/device/v1/me','GET',undefined,{token:'rwa_'+'B'.repeat(43)})).status,401);
 assert.equal((await f.call('/api/device/v1/me','GET',undefined,{owner:true})).status,401);
 assert.deepEqual((await f.call('/api/device/v1/me')).device.writebackListIDs,[]);
});
test('imports allocate scoped IDs, preserve other workspace data, replay receipts and reject tampered/source-foreign snapshots',async()=>{
 const f=await fixture();await f.pair();const before=await f.state(),input=await f.snapshot(),key=crypto.randomUUID(),first=await f.imported(input,key);assert.equal(first.status,200);assert.equal(first.created,1);assert.ok(!first.data);assert.ok(!JSON.stringify(first).includes('Book a dentist'));
 const after=await f.state();assert.equal(after.data.reminders.length,before.data.reminders.length+1);assert.ok(first.mappings[0].reminderId!=='native-one');
 const replay=await f.imported(input,key);assert.equal(replay.status,200);assert.equal(replay.replayed,true);assert.equal((await f.state()).revision,after.revision);
 const fresh=await f.imported(await f.snapshot());assert.equal(fresh.noChange,true);assert.equal((await f.state()).revision,after.revision);
 const tampered=structuredClone(input);tampered.reminders[0].title='Tampered';assert.equal((await f.imported(tampered)).status,400);
 const foreign=await f.snapshot([{...f.native,listID:'unselected'}]);assert.equal((await f.imported(foreign)).status,403);
 const reused=await f.snapshot([{...f.native,title:'Other'}]);assert.equal((await f.imported(reused,key)).status,409);
 assert.equal((await f.call('/api/device/v1/config','PATCH',{activeListIDs:['foreign'],writebackListIDs:[]},{revision:after.revision})).status,403);
});
test('native changes preserve web-only fields; simultaneous edits conflict atomically with explicit source resolution',async()=>{
 const f=await fixture();await f.pair();const first=await f.imported(await f.snapshot()),id=first.mappings[0].reminderId;
 assert.equal((await f.owner(`/api/reminders/${id}`,'PATCH',{tags:['sample'],flagged:true})).status,200);
 let result=await f.imported(await f.snapshot([{...f.native,title:'Native edit'}]));assert.equal(result.status,200);let row=(await f.state()).data.reminders.find(x=>x.id===id);assert.equal(row.title,'Native edit');assert.deepEqual(row.tags,['sample']);assert.equal(row.flagged,true);
 await f.owner(`/api/reminders/${id}`,'PATCH',{title:'Web edit'});const input=await f.snapshot([{...f.native,title:'Second native edit'}]),before=(await f.state()).revision;
 result=await f.imported(input);assert.equal(result.status,409);assert.equal((await f.state()).revision,before);assert.equal(result.conflicts[0].cloud.title,'Web edit');
 input.resolutions=[{sourceID:f.native.id,sourceRevision:result.conflicts[0].sourceRevision,webFingerprint:result.conflicts[0].webFingerprint,choice:'useApple'}];result=await f.imported(input);assert.equal(result.status,200);row=(await f.state()).data.reminders.find(x=>x.id===id);assert.equal(row.title,'Second native edit');assert.deepEqual(row.tags,['sample']);
});
async function assigned(f,id){
 const {agent}=await f.owner('/api/agents','POST',{name:'Synthetic runner'});const auth=await f.owner(`/api/agents/${agent.id}/tokens`,'POST',{scopes:['tasks:read','tasks:execute'],expiresInSeconds:3600});
 const task=(await f.owner(`/api/reminders/${id}/delegation`,'POST',{agentId:agent.id,criteria:'Complete synthetic report'})).task;
 const claim=await f.call(`/api/agent/v1/tasks/${task.id}/claim`,'POST',{}, {token:auth.token,key:crypto.randomUUID()});assert.equal(claim.status,200);
 const report=async()=>f.call(`/api/agent/v1/tasks/${task.id}/report`,'POST',{claimId:claim.claimId,taskVersion:task.taskVersion,outcome:'succeeded',summary:'Synthetic report ready',verification:{passed:true,method:'Synthetic read-back',verifiedAt:new Date().toISOString()},evidence:[{kind:'text',reference:'Synthetic report bytes verified',digest:'sha256:'+await deviceHash('Synthetic report bytes verified')}]},{token:auth.token});
 return {task,report};
}
test('successful delegated task queues native completion atomically only when enabled; scoped claim and acknowledgement replay',async()=>{
 const f=await fixture(),device=await f.pair(),first=await f.imported(await f.snapshot()),id=first.mappings[0].reminderId;
 assert.equal((await f.call('/api/device/v1/config','PATCH',{activeListIDs:[f.list.id],writebackListIDs:[f.list.id]},{revision:(await f.state()).revision})).status,200);
 const a=await assigned(f,id);assert.equal((await a.report()).status,200);assert.equal((await f.state()).data.reminders.find(x=>x.id===id).completed,true);
 let commands=(await f.call('/api/device/v1/commands')).commands;assert.equal(commands.length,1);assert.equal(commands[0].reminderID,f.native.id);
 const unchanged=await f.imported(await f.snapshot());assert.equal(unchanged.noChange,true);assert.equal((await f.call('/api/device/v1/commands')).commands.length,1);
 const key=crypto.randomUUID(),command=commands[0],claimed=await f.call(`/api/device/v1/commands/${command.id}/claim`,'POST',{claimID:key},{revision:(await f.state()).revision});assert.equal(claimed.status,200);
 assert.equal((await f.call(`/api/device/v1/commands/${command.id}/claim`,'POST',{claimID:key},{revision:0})).replayed,true);
 const receipt={claimID:key,outcome:'applied',observedRevision:'f'.repeat(64),completed:true};assert.equal((await f.call(`/api/device/v1/commands/${command.id}/ack`,'POST',receipt,{revision:(await f.state()).revision})).status,200);
 assert.equal((await f.call(`/api/device/v1/commands/${command.id}/ack`,'POST',receipt,{revision:0})).replayed,true);assert.deepEqual((await f.call('/api/device/v1/commands')).commands,[]);
 assert.equal(f.sql.prepare('SELECT status FROM device_commands').get().status,'applied');
});
test('writeback off, source deletion, owner reopen, and revocation never cause Apple commands',async()=>{
 const f=await fixture(),device=await f.pair(),first=await f.imported(await f.snapshot()),id=first.mappings[0].reminderId,a=await assigned(f,id);assert.equal((await a.report()).status,200);assert.deepEqual((await f.call('/api/device/v1/commands')).commands,[]);
 await f.owner(`/api/reminders/${id}`,'PATCH',{completed:false,completedAt:null});await f.call('/api/device/v1/config','PATCH',{activeListIDs:[f.list.id],writebackListIDs:[f.list.id]},{revision:(await f.state()).revision});const b=await assigned(f,id);assert.equal((await b.report()).status,200);assert.equal((await f.call('/api/device/v1/commands')).commands.length,1);
 await f.owner(`/api/reminders/${id}`,'PATCH',{completed:false,completedAt:null});assert.deepEqual((await f.call('/api/device/v1/commands')).commands,[]);
 const c=await assigned(f,id),empty=await f.imported(await f.snapshot([]));assert.equal(empty.missing,1);assert.ok((await f.state()).data.reminders.some(x=>x.id===id));assert.equal((await c.report()).status,409);
 await f.owner(`/api/devices/${device.id}`,'DELETE');assert.equal((await f.call('/api/device/v1/me')).status,401);assert.equal((await f.imported(await f.snapshot())).status,401);
});

test('Swift-produced fingerprint v1 preserves Unicode, URL, integer dates and device-resolved timezone on import',async()=>{
 const f=await fixture();await f.pair();const input=JSON.parse(readFileSync(new URL('./fixtures/native-source-v1.json',import.meta.url),'utf8'));input.generatedAt=Date.now();
 // Pair this isolated fixture's selected list; field hashes are produced by Swift, not this test.
 const f2=await fixture();f2.list.id='sample-list';f2.list.title='Sample tasks';await f2.pair();
 for(const r of input.reminders)assert.equal(input.revisions[r.id],await deviceHash(deviceCanonical(r)));
 const result=await f2.imported(input);assert.equal(result.status,200);assert.equal(result.created,2);
 const imported=(await f2.state()).data.reminders.find(x=>x.title==='Synthetic café 🍉');assert.equal(imported.dueTime,'00:00');assert.equal(imported.timeZone,'Europe/London');
});
test('pairing expiry and device credential expiry at transaction time cannot fabricate approval/import',async()=>{
 const f=await fixture(),start=await f.call('/api/device/v1/pairings','POST',{name:'Synthetic iPhone',tokenHash:await deviceHash(f.token),lists:[f.list]},{token:false});
 const batch=f.env.DB.batch;let fired=false;f.env.DB.batch=async statements=>{if(!fired&&statements[0].sql.startsWith('UPDATE state')){fired=true;f.sql.prepare('UPDATE device_pairings SET expires_at=0 WHERE id=?').run(start.pairingId)}return batch(statements)};
 const before=(await f.state()).revision;assert.equal((await f.owner(`/api/devices/pairings/${start.pairingId}/approve`,'POST',{code:start.code})).status,409);assert.equal((await f.state()).revision,before);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM devices').get().n,0);
 const g=await fixture();const device=await g.pair(),batch2=g.env.DB.batch;let fired2=false;g.env.DB.batch=async statements=>{if(!fired2&&statements[0].sql.startsWith('UPDATE state')){fired2=true;g.sql.prepare('UPDATE devices SET expires_at=0 WHERE id=?').run(device.id)}return batch2(statements)};
 const old=(await g.state()).revision;assert.equal((await g.imported(await g.snapshot())).status,409);assert.equal((await g.state()).revision,old);assert.equal(g.sql.prepare('SELECT COUNT(*) AS n FROM device_mappings').get().n,0);
});
test('command expiry at transaction time rejects claim; completion-date convergence does not undo an acknowledged task',async()=>{
 const f=await fixture();await f.pair();const imported=await f.imported(await f.snapshot()),id=imported.mappings[0].reminderId;
 await f.call('/api/device/v1/config','PATCH',{activeListIDs:[f.list.id],writebackListIDs:[f.list.id]},{revision:(await f.state()).revision});const task=await assigned(f,id);assert.equal((await task.report()).status,200);
 const command=(await f.call('/api/device/v1/commands')).commands[0],batch=f.env.DB.batch;let fired=false;f.env.DB.batch=async statements=>{if(!fired&&statements[0].sql.startsWith('UPDATE state')){fired=true;f.sql.prepare('UPDATE device_commands SET expires_at=0 WHERE id=?').run(command.id)}return batch(statements)};
 const before=(await f.state()).revision;assert.equal((await f.call(`/api/device/v1/commands/${command.id}/claim`,'POST',{claimID:crypto.randomUUID()},{revision:before})).status,409);assert.equal((await f.state()).revision,before);assert.equal(f.sql.prepare('SELECT status FROM device_commands WHERE id=?').get(command.id).status,'queued');
 f.env.DB.batch=batch;const done=await f.imported(await f.snapshot([{...f.native,completed:true,completionDate:Date.now()}]));assert.equal(done.status,200);assert.equal((await f.state()).data.reminders.find(x=>x.id===id).completed,true);
});

test('large complete snapshots use constant D1 statement counts, retain moved IDs and mark missing without deletion',async()=>{
 const f=await fixture();await f.pair();const second={id:'source-two',title:'Second fictional list',writable:true};
 // Extend this isolated test grant as if both lists were reviewed at pairing.
 f.sql.prepare('UPDATE devices SET grants=?,active_lists=?').run(JSON.stringify([f.list,second]),JSON.stringify([f.list.id,second.id]));
 const records=Array.from({length:120},(_,i)=>({...f.native,id:`native-${i}`,title:`Fictional task ${i}`})),input=await f.snapshot(records);input.lists.push(second);input.selectedListIDs.push(second.id);
 let statements=0;const prepare=f.env.DB.prepare;f.env.DB.prepare=(...args)=>{statements++;return prepare(...args)};
 const first=await f.imported(input);assert.equal(first.status,200);assert.equal(first.created,120);assert.ok(statements<50,`D1 statements ${statements}`);const initialCount=statements,ids=new Map(first.mappings.map(x=>[x.sourceID,x.reminderId]));
 statements=0;const changed=await f.snapshot(records.slice(0,110).map((x,i)=>({...x,title:`Changed ${i}`,listID:i===0?second.id:f.list.id})));changed.lists.push(second);changed.selectedListIDs.push(second.id);
 const next=await f.imported(changed);assert.equal(next.status,200);assert.equal(next.updated,110);assert.equal(next.missing,10);assert.ok(statements<50,`D1 statements ${statements}`);assert.ok(statements<=initialCount+4);
 assert.equal(next.mappings.find(x=>x.sourceID==='native-0').reminderId,ids.get('native-0'));const cloud=await f.state();assert.equal(cloud.data.reminders.filter(x=>[...ids.values()].includes(x.id)).length,120);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM device_mappings WHERE missing=1').get().n,10);
});

const legacyInitialWebHash = () => deviceHash(deviceCanonical({ title:'Fictional task', notes:'Synthetic content', url:'', completed:false, completedAt:null, dueDate:null, dueTime:null, timeZone:'UTC', priority:'none' }));
async function legacyMapping(f, reminderID) {
 f.sql.prepare("UPDATE device_mappings SET web_hash=?,source_record=? WHERE kind='reminder' AND web_id=?").run(await legacyInitialWebHash(),JSON.stringify({recurring:false}),reminderID);
}
test('native edit after a web-only list move conflicts without undoing that move, including legacy hash baselines',async()=>{
 for(const legacy of [false,true]) {
  const f=await fixture();await f.pair();const first=await f.imported(await f.snapshot()),id=first.mappings[0].reminderId;
  if(legacy)await legacyMapping(f,id);
  const created=await f.owner('/api/lists','POST',{name:'Fictional web destination'});assert.equal(created.status,201);const listID=created.data.lists.at(-1).id;
  assert.equal((await f.owner(`/api/reminders/${id}`,'PATCH',{listId:listID})).status,200);
  const before=await f.state(),next=await f.imported(await f.snapshot([{...f.native,title:'Changed natively'}]));
  assert.equal(next.status,409);assert.equal(next.conflicts[0].reason,'changed_in_both_places');
  const after=await f.state();assert.equal(after.revision,before.revision);assert.deepEqual(after.data,before.data);assert.equal(after.data.reminders.find(x=>x.id===id).listId,listID);
 }
});
test('native-only moves keep the same web reminder and advance supported legacy baselines safely',async()=>{
 for(const legacy of [false,true]) {
  const f=await fixture();await f.pair();const second={id:'source-two',title:'Second fictional native list',writable:true};
  f.sql.prepare('UPDATE devices SET grants=?,active_lists=?').run(JSON.stringify([f.list,second]),JSON.stringify([f.list.id,second.id]));
  const input=await f.snapshot();input.lists.push(second);input.selectedListIDs.push(second.id);const first=await f.imported(input);assert.equal(first.status,200);const id=first.mappings[0].reminderId;
  if(legacy)await legacyMapping(f,id);
  const moved=await f.snapshot([{...f.native,listID:second.id}]);moved.lists.push(second);moved.selectedListIDs.push(second.id);
  const result=await f.imported(moved);assert.equal(result.status,200);assert.equal(result.mappings[0].reminderId,id);
  const destination=f.sql.prepare("SELECT web_id FROM device_mappings WHERE kind='list' AND source_id=?").get(second.id).web_id;
  assert.equal((await f.state()).data.reminders.find(x=>x.id===id).listId,destination);
  const metadata=JSON.parse(f.sql.prepare("SELECT source_record FROM device_mappings WHERE kind='reminder' AND web_id=?").get(id).source_record);assert.equal(metadata.webHashVersion,2);
 }
});
test('legacy reappearance preserves its old conflict baseline instead of blessing subsequent web edits',async()=>{
 const f=await fixture();await f.pair();const first=await f.imported(await f.snapshot()),id=first.mappings[0].reminderId;await legacyMapping(f,id);
 assert.equal((await f.imported(await f.snapshot([]))).status,200);
 const created=await f.owner('/api/lists','POST',{name:'Fictional web move while missing'}),listID=created.data.lists.at(-1).id;
 await f.owner(`/api/reminders/${id}`,'PATCH',{listId:listID});
 assert.equal((await f.imported(await f.snapshot())).status,200);
 const baseline=f.sql.prepare("SELECT web_hash,source_record FROM device_mappings WHERE kind='reminder' AND web_id=?").get(id);
 assert.equal(baseline.web_hash,await legacyInitialWebHash());assert.equal(JSON.parse(baseline.source_record).webHashVersion,1);
 const changed=await f.imported(await f.snapshot([{...f.native,notes:'Changed natively after returning'}]));assert.equal(changed.status,409);
 assert.equal((await f.state()).data.reminders.find(x=>x.id===id).listId,listID);
});
