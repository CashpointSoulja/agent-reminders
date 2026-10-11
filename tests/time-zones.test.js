import test from 'node:test';
import assert from 'node:assert/strict';
import { timeZoneCities, searchTimeZoneCities, timeZoneSubtitle } from '../src/time-zones.js';

test('native London search includes UK and Ontario with valid persisted IANA zones', () => {
  assert.deepEqual(searchTimeZoneCities('London').map(({ city, country, zone }) => [city, country, zone]), [
    ['London', 'United Kingdom', 'Europe/London'], ['London', 'Canada', 'America/Toronto'],
  ]);
  assert.equal(timeZoneSubtitle('Europe/London', new Date('2026-10-10T12:00:00Z')), 'United Kingdom Time (BST)');
  assert.equal(timeZoneSubtitle('America/Toronto', new Date('2026-10-10T12:00:00Z')), 'Eastern Time (GMT-4)');
});
test('city/country/IANA search and seasonal subtitles remain valid', () => {
  assert.ok(timeZoneCities.length > 400);
  assert.equal(searchTimeZoneCities('london canada')[0].zone, 'America/Toronto');
  assert.ok(searchTimeZoneCities('Europe/Paris').some(row => row.city === 'Paris' && row.country === 'France'));
  assert.equal(searchTimeZoneCities('nonexistent city xyz').length, 0);
  assert.equal(searchTimeZoneCities('', 'UTC')[0].zone, 'UTC');
  assert.equal(timeZoneSubtitle('Europe/London', new Date('2026-01-10T12:00:00Z')), 'United Kingdom Time (GMT)');
  for (const row of timeZoneCities) assert.doesNotThrow(() => new Intl.DateTimeFormat('en-GB', { timeZone: row.zone }));
});
