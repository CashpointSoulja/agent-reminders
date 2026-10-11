import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerIcons } from '../src/picker-icons.js';

test('every list picker and Details symbol resolves to a licensed SVG component', () => {
  const names = 'smiley list bookmark key gift cake graduation backpack pencil document book inbox card money weights running cutlery wine medicine stethoscope chair house building bank tent monitor music note-display gamecontroller headphones leaf carrot person twopeople family paw teddybear fish basket cart shoppingbag box football baseball basketball americanfootball tennis train airplane sailboat car umbrella sun moon droplet snowflake flame briefcase tools scissors compass braces lightbulb speechbubble exclamation asterisk square circle triangle diamond heart star list-hero clock repeat calendar-check tags subtasks location alarm priority'.split(' ');
  assert.equal(Object.keys(pickerIcons).length, names.length);
  for (const name of names) assert.ok(pickerIcons[name], name);
});
