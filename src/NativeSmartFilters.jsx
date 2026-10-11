import React, { useState } from "react";
import Icon from "./icons";
import { validSmartFilters } from "./smartFilters.js";
import "./native-smart-filters.css";
const fields = [
  ["tags", "Tags", "tag", "#5c7dad"],
  ["date", "Date", "calendar", "#ff3b30"],
  ["time", "Time", "clock", "#007aff"],
  ["location", "Location", "location", "#008aff"],
  ["flag", "Flag", "flag", "#ff9500"],
  ["priority", "Priority", "exclamation", "#ff3b30"],
  ["lists", "Lists", "list", "#00b9d5"],
];
const options = {
  tags: [
    ["Off", null],
    ["Any Tag", "any"],
    ["Any Selected Tags", "selected"],
    ["All Selected Tags", "all"],
    ["No Tags", "none"],
  ],
  date: [
    ["Off", null],
    ["Any", "any"],
    ["Today", "today"],
    ["On a Date", "on"],
    ["Before a Date", "before"],
    ["After a Date", "after"],
    ["Specified Range", "range"],
    ["Relative Range", "relative"],
    ["No Date", "none"],
  ],
  time: [
    ["Off", null],
    ["Any", "any"],
    ["Morning", "morning"],
    ["Afternoon", "afternoon"],
    ["Evening", "evening"],
    ["Night", "night"],
    ["No Time", "none"],
  ],
  location: [
    ["Off", null],
    ["Specific", "selected"],
    ["No Location", "none"],
  ],
  flag: [
    ["Off", null],
    ["Flagged", "flagged"],
    ["Not Flagged", "unflagged"],
  ],
  priority: [
    ["Off", null],
    ["Any", "any"],
    ["Low", "low"],
    ["Medium", "medium"],
    ["High", "high"],
    ["No Priority", "none"],
  ],
  lists: [
    ["Off", null],
    ["Include", "selected"],
    ["Exclude", "exclude"],
  ],
};
export default function NativeSmartFilters({
  filters = { match: "all", rules: [] },
  data = { lists: [], reminders: [] },
  onChange,
  onBack,
}) {
  const [draft, setDraft] = useState(structuredClone(filters));
  const [menu, setMenu] = useState(null);
  const tags = [...new Set(data.reminders.flatMap((r) => r.tags))].sort();
  const update = (field, mode, extra = {}) =>
    setDraft((v) => ({
      ...v,
      rules: [
        ...v.rules.filter((r) => r.field !== field),
        ...(mode ? [{ field, mode, ...extra }] : []),
      ],
    }));
  const edit = (rule, extra) =>
    update(rule.field, rule.mode, { ...rule, ...extra });
  return (
    <section
      className="native-smart-filters native-list-sheet"
      aria-label="Filters"
    >
      <header className="nls-header">
        <button
          className="nls-close"
          type="button"
          aria-label="Cancel Filters"
          onClick={onBack}
        >
          <span aria-hidden="true">×</span>
        </button>
        <h2>Filters</h2>
        <button
          className="nls-done"
          type="button"
          aria-label="Done Filters"
          disabled={!validSmartFilters(draft)}
          onClick={() => {
            onChange(draft);
            onBack();
          }}
        >
          <Icon name="check" size={26} />
        </button>
      </header>
      <div className="nsf-scroll">
        <div className="nsf-match">
          Include reminders matching{" "}
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu === "match"}
            onClick={() => setMenu(menu === "match" ? null : "match")}
          >
            {draft.match} <span aria-hidden="true">↕</span>
          </button>{" "}
          filters.
          {menu === "match" && (
            <div className="nsf-menu" role="menu">
              {["any", "all"].map((value) => (
                <button
                  role="menuitemradio"
                  aria-checked={draft.match === value}
                  type="button"
                  key={value}
                  onClick={() => {
                    setDraft((v) => ({ ...v, match: value }));
                    setMenu(null);
                  }}
                >
                  {value}
                  {draft.match === value && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <h3>{draft.rules.length ? "Enabled Filters" : "Select Filters"}</h3>
        <div className="nsf-group">
          {[...fields]
            .sort(
              (a, b) =>
                Number(draft.rules.some((r) => r.field === b[0])) -
                Number(draft.rules.some((r) => r.field === a[0])),
            )
            .map(([field, label, icon, color], index) => {
              const rule = draft.rules.find((r) => r.field === field);
              return (
                <div key={field} className="nsf-filter">
                  {draft.rules.length > 0 && index === draft.rules.length && (
                    <h3 className="nsf-other">Other Filters</h3>
                  )}
                  <button
                    type="button"
                    className="nsf-row"
                    aria-label={label}
                    aria-haspopup="menu"
                    aria-expanded={menu === field}
                    onClick={() => setMenu(menu === field ? null : field)}
                  >
                    <span
                      className="nsf-icon"
                      style={{ backgroundColor: color }}
                    >
                      <Icon name={icon} size={19} color="white" />
                    </span>
                    <span>{label}</span>
                    <span className="nsf-value">
                      {options[field].find(
                        ([, mode]) => mode === rule?.mode,
                      )?.[0] || "Off"}{" "}
                      <span aria-hidden="true">↕</span>
                    </span>
                  </button>
                  {menu === field && (
                    <div
                      className="nsf-menu"
                      role="menu"
                      aria-label={`${label} filter`}
                    >
                      {options[field].map(([title, mode]) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={(rule?.mode || null) === mode}
                          key={title}
                          onClick={() => {
                            update(
                              field,
                              mode,
                              ["on", "before", "after"].includes(mode)
                                ? {
                                    value: new Date()
                                      .toISOString()
                                      .slice(0, 10),
                                  }
                                : mode === "relative"
                                  ? {
                                      amount: 1,
                                      direction: "next",
                                      unit: "day",
                                      includeOverdue: false,
                                    }
                                  : mode === "range"
                                    ? {
                                        start:
                                          field === "date"
                                            ? new Date()
                                                .toISOString()
                                                .slice(0, 10)
                                            : "09:00",
                                        end:
                                          field === "date"
                                            ? new Date()
                                                .toISOString()
                                                .slice(0, 10)
                                            : "17:00",
                                      }
                                    : ["selected", "all", "exclude"].includes(
                                          mode,
                                        )
                                      ? field === "location"
                                        ? { value: "" }
                                        : { values: [] }
                                      : {},
                            );
                            setMenu(null);
                          }}
                        >
                          {title}
                          {(rule?.mode || null) === mode && (
                            <Icon name="check" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {field === "date" &&
                    rule &&
                    ["on", "before", "after"].includes(rule.mode) && (
                      <div className="nsf-options">
                        <input
                          type="date"
                          aria-label="Filter Date"
                          value={rule.value}
                          onChange={(e) =>
                            edit(rule, { value: e.target.value })
                          }
                        />
                      </div>
                    )}
                  {field === "date" && rule?.mode === "relative" && (
                    <div className="nsf-options">
                      <div className="nsf-relative">
                        <select
                          aria-label="Relative direction"
                          value={rule.direction}
                          onChange={(e) =>
                            edit(rule, { direction: e.target.value })
                          }
                        >
                          <option value="next">In the Next</option>
                          <option value="past">In the Past</option>
                        </select>
                        <input
                          type="number"
                          aria-label="Relative amount"
                          min="1"
                          max="1000"
                          value={rule.amount}
                          onChange={(e) =>
                            edit(rule, { amount: Number(e.target.value) })
                          }
                        />
                        <select
                          aria-label="Relative unit"
                          value={rule.unit}
                          onChange={(e) => edit(rule, { unit: e.target.value })}
                        >
                          {["hour", "day", "week", "month", "year"].map(
                            (unit) => (
                              <option key={unit} value={unit}>
                                {unit[0].toUpperCase() + unit.slice(1)}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                      <label>
                        Include Overdue Reminders
                        <input
                          type="checkbox"
                          role="switch"
                          checked={rule.includeOverdue}
                          onChange={(e) =>
                            edit(rule, { includeOverdue: e.target.checked })
                          }
                        />
                      </label>
                    </div>
                  )}
                  {rule?.mode === "range" && (
                    <div className="nsf-options">
                      {["start", "end"].map((bound) => (
                        <label key={bound}>
                          {bound === "start" ? "From" : "To"}
                          <input
                            aria-label={`${label} ${bound}`}
                            type={field === "date" ? "date" : "time"}
                            value={rule[bound]}
                            onChange={(e) =>
                              edit(rule, { [bound]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {rule &&
                    ["tags", "lists"].includes(field) &&
                    ["selected", "all", "exclude"].includes(rule.mode) && (
                      <div className="nsf-options">
                        {(field === "tags"
                          ? tags
                          : data.lists
                              .filter((l) => l.type !== "smart")
                              .map((l) => l.id)
                        ).map((value) => (
                          <label key={value}>
                            <input
                              type="checkbox"
                              checked={rule.values.includes(value)}
                              onChange={(e) =>
                                edit(rule, {
                                  values: e.target.checked
                                    ? [...rule.values, value]
                                    : rule.values.filter((v) => v !== value),
                                })
                              }
                            />
                            {field === "tags"
                              ? `#${value}`
                              : data.lists.find((l) => l.id === value)?.name}
                          </label>
                        ))}
                        {field === "tags" && !tags.length && <p>No Tags</p>}
                      </div>
                    )}
                  {field === "location" && rule?.mode === "selected" && (
                    <div className="nsf-options">
                      <input
                        aria-label="Location filter"
                        placeholder="Location"
                        value={rule.value}
                        onChange={(e) => edit(rule, { value: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </section>
  );
}
