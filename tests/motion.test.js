import test from 'node:test';
import assert from 'node:assert/strict';
import {moveReminder,previousSibling,rowDropZone,rowDropChange} from '../src/motion.js';
const row=(id,parentId=null,listId='a',sectionId=null)=>({id,title:id,parentId,listId,sectionId});
const data=()=>({lists:[{id:'a'},{id:'b'}],reminders:[row('parent'),row('child','parent'),row('grandchild','child'),row('other'),row('last'),row('foreign',null,'b')]});
test('nest carries subtree intact after destination descendants without mutation',()=>{
  const original=data(), result=moveReminder(original,{id:'parent',parentId:'other'});
  assert.deepEqual(result.reminders.map(r=>r.id),['other','parent','child','grandchild','last','foreign']);
  assert.equal(result.reminders.find(r=>r.id==='parent').parentId,'other');
  assert.equal(result.reminders.find(r=>r.id==='child').parentId,'parent');
  assert.equal(original.reminders[0].parentId,null);
});
test('unnest carries grandchildren after former parent subtree',()=>{
  const result=moveReminder(data(),{id:'child',parentId:null});
  assert.deepEqual(result.reminders.map(r=>r.id),['parent','child','grandchild','other','last','foreign']);
  assert.equal(result.reminders[1].parentId,null); assert.equal(result.reminders[2].parentId,'child');
});
test('reorder root moves whole subtree as one block',()=>{
  const result=moveReminder(data(),{id:'other',parentId:null,beforeId:'parent'});
  assert.deepEqual(result.reminders.map(r=>r.id),['other','parent','child','grandchild','last','foreign']);
  const result2=moveReminder(data(),{id:'parent',parentId:null,beforeId:'last'});
  assert.deepEqual(result2.reminders.map(r=>r.id),['other','parent','child','grandchild','last','foreign']);
});
test('self, descendant, cross-list, unknown target and mismatched sibling guards',()=>{
  for(const change of [{id:'parent',parentId:'parent'},{id:'parent',parentId:'grandchild'},{id:'parent',parentId:'foreign'},{id:'parent',parentId:'missing'},{id:'parent',beforeId:'foreign'},{id:'parent',afterId:'foreign'},{id:'parent',afterId:'child'},{id:'other',parentId:null,beforeId:'child'},{id:'other',beforeId:'parent',afterId:'last'},{id:'missing',parentId:null}]){const original=data();assert.equal(moveReminder(original,change),original);}
});
test('nested target section carries to descendants',()=>{
  const original=data(); original.reminders.find(r=>r.id==='other').sectionId='destination';
  const result=moveReminder(original,{id:'parent',parentId:'other'});
  for(const id of ['parent','child','grandchild'])assert.equal(result.reminders.find(r=>r.id===id).sectionId,'destination');
});
test('previous sibling excludes other lists and other parents',()=>{
  const original=data();assert.equal(previousSibling(original.reminders,original.reminders[3]).id,'parent');assert.equal(previousSibling(original.reminders,original.reminders[1]),null);
});

test('unnesting and sibling reordering keep unrelated lists and child order intact',()=>{
  const original=data();
  original.reminders.splice(3,0,row('second-child','parent'));
  const result=moveReminder(original,{id:'child',parentId:null,beforeId:'other'});
  assert.deepEqual(result.reminders.map(r=>r.id),['parent','second-child','child','grandchild','other','last','foreign']);
  assert.equal(result.reminders.at(-1).listId,'b');
});
test('moving sibling to end inserts before the next list',()=>{
  const result=moveReminder(data(),{id:'other',parentId:null});
  assert.deepEqual(result.reminders.map(r=>r.id),['parent','child','grandchild','last','other','foreign']);
});
test('drop boundaries distinguish insertion before and after from nesting',()=>{
  const bounds={y:100,height:60};
  assert.equal(rowDropZone(101,bounds),'before');
  assert.equal(rowDropZone(130,bounds),'nest');
  assert.equal(rowDropZone(159,bounds),'after');
});
test('All view after-slot ignores dragged subtree and unrelated list rows',()=>{
  const original=data();
  original.reminders.splice(4,0,row('foreign-middle',null,'b'));
  const down=moveReminder(original,rowDropChange(original.reminders,'parent','other','after'));
  assert.deepEqual(down.reminders.filter(r=>r.listId==='a').map(r=>r.id),['other','parent','child','grandchild','last']);
  const up=moveReminder(original,rowDropChange(original.reminders,'last','parent','after'));
  assert.deepEqual(up.reminders.filter(r=>r.listId==='a').map(r=>r.id),['parent','child','grandchild','last','other']);
  assert.equal(original.reminders[0].id,'parent');
  assert.equal(original.reminders[0].parentId,null);
  assert.deepEqual(down.reminders.filter(r=>r.listId==='b'),original.reminders.filter(r=>r.listId==='b'));
  const same=moveReminder(original,rowDropChange(original.reminders,'other','parent','after'));
  assert.deepEqual(same.reminders,original.reminders);
});
