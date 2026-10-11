import zoneRows from './time-zone-data.js';

const countries = new Intl.DisplayNames(['en-GB'], { type: 'region' });
const valid = zone => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); return true; }
  catch { return false; }
};
export const timeZoneCities = zoneRows.filter(([, zone]) => valid(zone)).map(([country, zone]) => ({
  zone, city: zone.split('/').at(-1).replaceAll('_', ' '), country: countries.of(country),
}));
// London, Canada is directly observed in the native search capture; Ontario uses Toronto time.
timeZoneCities.push({ zone: 'America/Toronto', city: 'London', country: 'Canada' });
timeZoneCities.sort((a, b) => a.city.localeCompare(b.city) || (a.country === 'United Kingdom' ? -1 : b.country === 'United Kingdom' ? 1 : a.country.localeCompare(b.country)));

export function searchTimeZoneCities(query, selectedZone) {
  const words = query.toLocaleLowerCase('en-GB').trim().split(/\s+/).filter(Boolean);
  const matches = timeZoneCities.filter(row => words.every(word => `${row.city} ${row.country} ${row.zone}`.toLocaleLowerCase('en-GB').includes(word)));
  if (!words.length && selectedZone && valid(selectedZone) && !matches.some(row => row.zone === selectedZone)) {
    return [{ zone: selectedZone, city: selectedZone.split('/').at(-1).replaceAll('_', ' '), country: '' }, ...matches];
  }
  return matches;
}

export function timeZoneSubtitle(zone, date = new Date()) {
  const name = kind => new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: kind }).formatToParts(date).find(part => part.type === 'timeZoneName').value;
  return `${name('longGeneric')} (${name('short')})`;
}
