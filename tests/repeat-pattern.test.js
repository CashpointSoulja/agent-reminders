import test from 'node:test';
import assert from 'node:assert/strict';
import {customRepeatFooter, initialRepeatPattern, nextPatternDate, validRepeatPattern} from '../src/repeat-pattern.js';
import {completeReminder, createReminder, seedData, validateStoredData} from '../src/model.js';

test('custom repeat patterns validate bounded frequency-specific selections', () => {
  assert.equal(validRepeatPattern({weekdays:[1,3,5]},'weekly'),true);
  assert.equal(validRepeatPattern({monthdays:[1,15,31]},'monthly'),true);
  assert.equal(validRepeatPattern({ordinal:-1,weekday:5},'monthly'),true);
  assert.equal(validRepeatPattern({months:[1,10],ordinal:2,weekday:0},'yearly'),true);
  for (const [pattern,frequency] of [[{weekdays:[]},'weekly'],[{weekdays:[1,1]},'weekly'],[{weekdays:[7]},'weekly'],[{monthdays:[32]},'monthly'],[{monthdays:[1],ordinal:1,weekday:0},'monthly'],[{months:[0]},'yearly'],[{ordinal:1,weekday:7},'monthly'],[{weekdays:[1]},'daily'],[{months:[1],secret:'bad'},'yearly']]) assert.equal(validRepeatPattern(pattern,frequency),false,JSON.stringify(pattern));
});
test('weekly selected days advance within a week and honour multi-week gaps', () => {
  const repeat = {dueDate:'2026-10-05',recurrence:'weekly',repeatInterval:2,repeatPattern:{weekdays:[1,3]}};
  assert.equal(nextPatternDate(repeat),'2026-10-07');
  assert.equal(nextPatternDate({...repeat,dueDate:'2026-10-07'}),'2026-10-19');
  assert.equal(nextPatternDate({...repeat,dueDate:'2026-10-19'}),'2026-10-21');
});
test('monthly selected dates and ordinal weekdays skip impossible calendar occurrences', () => {
  const repeat = {dueDate:'2026-01-15',recurrence:'monthly',repeatInterval:1,repeatPattern:{monthdays:[1,15,31]}};
  assert.equal(nextPatternDate(repeat),'2026-01-31');
  assert.equal(nextPatternDate({...repeat,dueDate:'2026-01-31'}),'2026-02-01');
  assert.equal(nextPatternDate({...repeat,repeatPattern:{monthdays:[31]},dueDate:'2026-01-31'}),'2026-03-31');
  assert.equal(nextPatternDate({...repeat,repeatPattern:{ordinal:-1,weekday:5},dueDate:'2026-10-10'}),'2026-10-30');
  assert.equal(nextPatternDate({...repeat,repeatPattern:{ordinal:5,weekday:1},dueDate:'2026-02-01'}),'2026-03-30');
});
test('yearly selected months preserve multiple occurrences and leap-day validity', () => {
  const repeat = {dueDate:'2026-10-10',recurrence:'yearly',repeatInterval:2,repeatPattern:{months:[1,10,12]}};
  assert.equal(nextPatternDate(repeat),'2026-12-10');
  assert.equal(nextPatternDate({...repeat,dueDate:'2026-12-10'}),'2028-01-10');
  assert.equal(nextPatternDate({...repeat,dueDate:'2024-02-29',repeatInterval:1,repeatPattern:{months:[2]}}),'2028-02-29');
  assert.equal(nextPatternDate({...repeat,repeatInterval:1,repeatPattern:{months:[10],ordinal:1,weekday:0}}),'2027-10-03');
  assert.equal(nextPatternDate({...repeat,dueDate:'0100-10-10',repeatInterval:1,repeatPattern:{months:[10]}}),'0101-10-10');
  assert.throws(()=>nextPatternDate({...repeat,dueDate:'9999-12-10'}),/supported calendar range/);
});
test('native initial choices and explanatory custom repeat copy', () => {
  assert.deepEqual(initialRepeatPattern('weekly','2026-10-10'),{weekdays:[6]});
  assert.deepEqual(initialRepeatPattern('monthly','2026-10-10'),{monthdays:[10]});
  assert.deepEqual(initialRepeatPattern('yearly','2026-10-10'),{months:[10]});
  assert.equal(customRepeatFooter({recurrence:'daily',repeatInterval:1}),'Event will occur every day.');
  assert.equal(customRepeatFooter({recurrence:'monthly',repeatInterval:1,repeatPattern:{ordinal:1,weekday:6}}),'Event will occur every month on the 1st Saturday.');
});
test('stored pattern validation and actual recurring-parent completion preserve children and metadata', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const parent = {...createReminder('work','Sample recurring parent',now),dueDate:'2026-10-10',dueTime:'14:35',recurrence:'weekly',repeatCustom:true,repeatInterval:1,repeatPattern:{weekdays:[1,6]},tags:['sample'],notes:'Preserved sample note'};
  const child = {...createReminder('work','Sample preserved child',now),parentId:parent.id};
  const data = {...seedData(now),reminders:[parent,child]};
  assert.equal(validateStoredData(data),true);
  const next = completeReminder(data,parent.id,now);
  const active = next.reminders.find(row=>row.id===parent.id);
  assert.equal(active.dueDate,'2026-10-12');
  assert.equal(active.dueTime,'14:35');
  assert.deepEqual(active.repeatPattern,{weekdays:[1,6]});
  assert.deepEqual(active.tags,['sample']);
  assert.equal(active.notes,'Preserved sample note');
  assert.deepEqual(next.reminders.find(row=>row.id===child.id),child);
  assert.equal(next.reminders.filter(row=>row.completed).length,1);
  assert.equal(validateStoredData(next),true);
  for (const patch of [{repeatPattern:{weekdays:[]}},{repeatPattern:{monthdays:[10]}},{repeatPattern:{weekdays:[1,6],extra:'bad'}},{repeatCustom:'yes'},{dueDate:null,dueTime:null}]) assert.equal(validateStoredData({...data,reminders:[{...parent,...patch},child]}),false);
});
test('custom monthly series honours inclusive end date and final descendant cascade', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const parent = {...createReminder('work','Sample end rule',now),dueDate:'2026-10-10',recurrence:'monthly',repeatCustom:true,repeatPattern:{monthdays:[10,15]},repeatEndDate:'2026-10-15'};
  const child = {...createReminder('work','Sample child',now),parentId:parent.id};
  const first = completeReminder({...seedData(now),reminders:[parent,child]},parent.id,now);
  assert.equal(first.reminders.find(row=>row.id===parent.id).dueDate,'2026-10-15');
  assert.equal(first.reminders.find(row=>row.id===child.id).completed,false);
  const final = completeReminder(first,parent.id,now);
  assert.equal(final.reminders.find(row=>row.id===parent.id).completed,true);
  assert.equal(final.reminders.find(row=>row.id===child.id).completed,true);
  assert.equal(validateStoredData(final),true);
});
