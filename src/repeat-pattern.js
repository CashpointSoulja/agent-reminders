export const repeatFrequencies = [['hourly', 'Hourly'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
export const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const ordinalNames = {1:'first', 2:'second', 3:'third', 4:'fourth', 5:'fifth', '-1':'last'};
export const monthNames = Array.from({length:12}, (_, index) => new Date(2000, index, 1).toLocaleDateString('en-GB', {month:'long'}));
const dateParts = value => { const [year, month, day] = (value || '2000-01-01').split('-').map(Number); return new Date(year, month - 1, day, 12); };
const dateKey = date => `${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const numberList = (value, min, max, size) => Array.isArray(value) && value.length > 0 && value.length <= size && new Set(value).size === value.length && value.every(n => Number.isInteger(n) && n >= min && n <= max);

export function validRepeatPattern(pattern, frequency) {
  if (pattern === undefined || pattern === null) return true;
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return false;
  if (Object.keys(pattern).some(key => !['weekdays','monthdays','months','ordinal','weekday'].includes(key))) return false;
  const ordinal = [1,2,3,4,5,-1].includes(pattern.ordinal) && Number.isInteger(pattern.weekday) && pattern.weekday >= 0 && pattern.weekday <= 6;
  if (frequency === 'weekly') return Object.keys(pattern).length === 1 && numberList(pattern.weekdays, 0, 6, 7);
  if (frequency === 'monthly') return pattern.monthdays ? Object.keys(pattern).length === 1 && numberList(pattern.monthdays, 1, 31, 31) : ordinal && Object.keys(pattern).length === 2;
  if (frequency === 'yearly') return numberList(pattern.months, 1, 12, 12) && (Object.keys(pattern).length === 1 || (ordinal && Object.keys(pattern).length === 3));
  return false;
}

export function initialRepeatPattern(frequency, dueDate) {
  const date = dateParts(dueDate);
  if (frequency === 'weekly') return {weekdays:[date.getDay()]};
  if (frequency === 'monthly') return {monthdays:[date.getDate()]};
  if (frequency === 'yearly') return {months:[date.getMonth()+1]};
  return null;
}

function ordinalDay(year, month, ordinal, weekday) {
  if (ordinal === -1) {
    const last = new Date(year, month + 1, 0, 12);
    return last.getDate() - (last.getDay() - weekday + 7) % 7;
  }
  const first = new Date(year, month, 1, 12);
  const day = 1 + (weekday - first.getDay() + 7) % 7 + (ordinal - 1) * 7;
  return day <= new Date(year, month + 1, 0, 12).getDate() ? day : null;
}

// Pattern scheduling is tested web policy; Apple's skipped-date and week-anchor semantics need native recurrence observation.
export function nextPatternDate(reminder) {
  const pattern = reminder.repeatPattern;
  if (!pattern) return null;
  if (!validRepeatPattern(pattern, reminder.recurrence)) throw new Error('Invalid repeat pattern');
  const start = dateParts(reminder.dueDate), interval = reminder.repeatInterval;
  if (reminder.recurrence === 'weekly') {
    const mondayOffset = (start.getDay()+6)%7;
    for (let days = 1; days <= interval * 7 + 7; days++) {
      const candidate = new Date(start); candidate.setDate(start.getDate()+days);
      if (Math.floor((mondayOffset + days)/7) % interval === 0 && pattern.weekdays.includes(candidate.getDay())) return dateKey(candidate);
    }
  } else {
    const yearly = reminder.recurrence === 'yearly';
    for (let cycle = 0; cycle <= 400; cycle++) {
      const year = yearly ? start.getFullYear() + cycle * interval : start.getFullYear();
      const months = yearly ? [...pattern.months].sort((a,b) => a-b).map(n => n-1) : [start.getMonth() + cycle * interval];
      for (const month of months) {
        const first = new Date(year, month, 1, 12), y = first.getFullYear(), m = first.getMonth();
        if (y > 9999) throw new Error('Repeat exceeds the supported calendar range');
        const days = pattern.ordinal ? [ordinalDay(y,m,pattern.ordinal,pattern.weekday)] : yearly ? [start.getDate()] : [...pattern.monthdays].sort((a,b) => a-b);
        for (const day of days) {
          if (!day || day > new Date(y,m+1,0,12).getDate()) continue;
          const candidate = new Date(y,m,day,12);
          if (candidate > start) return dateKey(candidate);
        }
      }
    }
  }
  throw new Error('Repeat pattern has no future occurrence in the supported calendar range');
}

export function customRepeatFooter(draft) {
  const unit = {hourly:'hour',daily:'day',weekly:'week',monthly:'month',yearly:'year'}[draft.recurrence] || 'day';
  const interval = draft.repeatInterval || 1;
  let text = `Event will occur every ${interval === 1 ? unit : `${interval} ${unit}s`}`;
  const pattern = draft.repeatPattern;
  if (pattern?.ordinal) {
    const suffix = pattern.ordinal === -1 ? 'last' : `${pattern.ordinal}${['','st','nd','rd','th','th'][pattern.ordinal]}`;
    text += ` on the ${suffix} ${weekdayNames[pattern.weekday]}`;
    if (draft.recurrence === 'yearly') text += ` in ${pattern.months.map(month => monthNames[month-1]).join(', ')}`;
  }
  return text + '.';
}

export function customRepeatSummary(draft) {
  const unit = {hourly:'hour',daily:'day',weekly:'week',monthly:'month',yearly:'year'}[draft.recurrence] || 'day';
  const interval = draft.repeatInterval || 1;
  if (interval === 1 && (!draft.repeatPattern || JSON.stringify(draft.repeatPattern) === JSON.stringify(initialRepeatPattern(draft.recurrence,draft.dueDate)))) return repeatFrequencies.find(([frequency])=>frequency===draft.recurrence)?.[1] || 'Daily';
  let text = `Every ${interval === 1 ? unit : `${interval} ${unit}s`}`;
  const pattern = draft.repeatPattern;
  if (pattern?.ordinal) text += ` on the ${ordinalNames[pattern.ordinal]} ${weekdayNames[pattern.weekday]}${draft.recurrence === 'yearly' ? ` of ${pattern.months.map(month => monthNames[month-1]).join(', ')}` : ''}`;
  else if (pattern?.weekdays?.length) text += ` on ${pattern.weekdays.map(day => weekdayNames[day]).join(', ')}`;
  else if (pattern?.monthdays?.length) text += ` on ${pattern.monthdays.join(', ')}`;
  else if (pattern?.months?.length) text += ` in ${pattern.months.map(month => monthNames[month-1]).join(', ')}`;
  return text;
}
