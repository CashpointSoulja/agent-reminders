const choices = {
  tags: ["any", "all", "none", "selected"],
  date: ["any", "none", "today", "on", "before", "after", "range", "relative"],
  time: ["any", "none", "morning", "afternoon", "evening", "night", "range"],
  location: ["any", "none", "selected"],
  flag: ["flagged", "unflagged"],
  priority: ["any", "none", "low", "medium", "high"],
  lists: ["selected", "exclude"],
};
const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const validTime = (value) =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validSmartFilters(filters) {
  if (
    !filters ||
    !["all", "any"].includes(filters.match) ||
    !Array.isArray(filters.rules) ||
    filters.rules.length > 7
  )
    return false;
  const fields = new Set();
  return filters.rules.every((rule) => {
    if (
      !rule ||
      !choices[rule.field]?.includes(rule.mode) ||
      fields.has(rule.field)
    )
      return false;
    fields.add(rule.field);
    if (
      ["tags", "lists"].includes(rule.field) &&
      ["selected", "all", "exclude"].includes(rule.mode)
    ) {
      if (
        !Array.isArray(rule.values) ||
        rule.values.length > 100 ||
        !rule.values.every(
          (v) => typeof v === "string" && v.length > 0 && v.length <= 100,
        ) ||
        new Set(rule.values).size !== rule.values.length
      )
        return false;
    }
    if (
      rule.field === "date" &&
      ["on", "before", "after"].includes(rule.mode) &&
      !validDate(rule.value)
    )
      return false;
    if (
      rule.field === "date" &&
      rule.mode === "relative" &&
      (!Number.isInteger(rule.amount) ||
        rule.amount < 1 ||
        rule.amount > 1000 ||
        !["next", "past"].includes(rule.direction) ||
        !["hour", "day", "week", "month", "year"].includes(rule.unit) ||
        typeof rule.includeOverdue !== "boolean")
    )
      return false;
    if (
      rule.field === "date" &&
      rule.mode === "range" &&
      (!validDate(rule.start) || !validDate(rule.end) || rule.start > rule.end)
    )
      return false;
    if (
      rule.field === "time" &&
      rule.mode === "range" &&
      (!validTime(rule.start) || !validTime(rule.end))
    )
      return false;
    if (
      rule.field === "location" &&
      rule.mode === "selected" &&
      (typeof rule.value !== "string" ||
        !rule.value.trim() ||
        rule.value.length > 1000)
    )
      return false;
    return true;
  });
}
export function matchesSmartFilters(reminder, filters, now = new Date()) {
  if (!validSmartFilters(filters)) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const matches = filters.rules.map((rule) => {
    const mode = rule.mode;
    switch (rule.field) {
      case "tags":
        return mode === "any"
          ? reminder.tags.length > 0
          : mode === "none"
            ? reminder.tags.length === 0
            : mode === "all"
              ? rule.values.every((v) => reminder.tags.includes(v))
              : rule.values.some((v) => reminder.tags.includes(v));
      case "date": {
        const date = reminder.dueDate;
        if (mode === "any") return Boolean(date);
        if (mode === "none") return !date;
        if (!date) return false;
        if (mode === "today") return date === today;
        if (mode === "on") return date === rule.value;
        if (mode === "before") return date < rule.value;
        if (mode === "after") return date > rule.value;
        if (mode === "relative") {
          const end = new Date(now),
            sign = rule.direction === "past" ? -1 : 1;
          if (rule.unit === "month")
            end.setMonth(end.getMonth() + sign * rule.amount);
          else if (rule.unit === "year")
            end.setFullYear(end.getFullYear() + sign * rule.amount);
          else if (rule.unit === "hour")
            end.setHours(end.getHours() + sign * rule.amount);
          else
            end.setDate(
              end.getDate() +
                sign * rule.amount * (rule.unit === "week" ? 7 : 1),
            );
          const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
          return (
            (rule.includeOverdue && date < today) ||
            (rule.direction === "past"
              ? date >= endKey && date <= today
              : date >= today && date <= endKey)
          );
        }
        return date >= rule.start && date <= rule.end;
      }
      case "time": {
        const time = reminder.dueTime;
        if (mode === "any") return Boolean(time);
        if (mode === "none") return !time;
        if (!time) return false;
        const periods = {
          morning: ["06:00", "11:59"],
          afternoon: ["12:00", "16:59"],
          evening: ["17:00", "20:59"],
          night: ["21:00", "05:59"],
        };
        const [start, end] = periods[mode] || [rule.start, rule.end];
        return start <= end
          ? time >= start && time <= end
          : time >= start || time <= end;
      }
      case "location":
        return mode === "any"
          ? Boolean(reminder.location)
          : mode === "none"
            ? !reminder.location
            : reminder.location === rule.value;
      case "flag":
        return reminder.flagged === (mode === "flagged");
      case "priority":
        return mode === "any"
          ? reminder.priority !== "none"
          : reminder.priority === mode;
      case "lists":
        return mode === "exclude"
          ? !rule.values.includes(reminder.listId)
          : rule.values.includes(reminder.listId);
      default:
        return false;
    }
  });
  return (
    matches.length === 0 ||
    (filters.match === "any" ? matches.some(Boolean) : matches.every(Boolean))
  );
}
