import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubtask, mergeSubtasks } from '../src/subtasks.js';
const parent = { id: 'p', listId: 'a', sectionId: 's' };
test('subtask title is literal and no parsed date leaks', () => {
 const row = createSubtask(parent, 'Buy tomorrow #sample');
 assert.equal(row.title, 'Buy tomorrow #sample'); assert.equal(row.dueDate, null); assert.deepEqual(row.tags, []); assert.equal(row.parentId, 'p');
});
test('merge preserves metadata, descendants, unrelated rows and sibling order', () => {
 const child = { ...createSubtask(parent, 'one'), id: 'c', dueDate: '2026-10-20', tags: ['sample'] };
 const grandchild = { ...createSubtask(child, 'grandchild'), id: 'g' };
 const other = { ...createSubtask({ id: 'other', listId: 'b' }, 'untouched'), id: 'u' };
 const newChild = createSubtask(parent, 'new');
 const result = mergeSubtasks([parent, child, grandchild, other], parent, [{ ...child, title: 'edited' }, newChild]);
 assert.deepEqual(result.map(row => row.id), ['p', 'c', 'g', 'u', newChild.id]); assert.deepEqual(result[1].tags, ['sample']); assert.equal(result[1].dueDate, '2026-10-20'); assert.strictEqual(result[2], grandchild); assert.strictEqual(result[3], other);
});
test('blank children and their descendants are discarded without touching foreign rows', () => {
 const c = { ...createSubtask(parent, 'one'), id: 'c' }, g = { ...createSubtask(c, 'nested'), id: 'g' };
 assert.deepEqual(mergeSubtasks([parent, c, g], parent, [{ ...c, title: ' ' }]), [parent]);
});
test('duplicate, parent identity and reparented foreign IDs cannot enter draft', () => {
 const c = { ...createSubtask(parent, 'one'), id: 'c' };
 assert.throws(() => mergeSubtasks([parent, c], parent, [c, c]));
 assert.throws(() => mergeSubtasks([parent], parent, [{ ...c, id: 'p' }]));
 assert.throws(() => mergeSubtasks([parent, { ...c, parentId: 'foreign' }], parent, [c]));
});

test('moved parent normalizes new and existing direct child sections', () => {
 const child = { ...createSubtask(parent, 'existing'), id: 'c' };
 const destination = { ...parent, listId: 'b', sectionId: null };
 const newChild = createSubtask(parent, 'new child');
 const merged = mergeSubtasks([parent, child], destination, [child, newChild]);
 for (const row of merged.filter(row => row.parentId === parent.id)) { assert.equal(row.listId, 'b'); assert.equal(row.sectionId, null); }
});
