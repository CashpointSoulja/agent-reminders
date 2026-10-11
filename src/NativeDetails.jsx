import React, { useEffect, useRef, useState } from "react";
import Icon from "./icons.jsx";
import NativeTagsSheet from "./NativeTagsSheet.jsx";
import NativeSubtasksSheet from "./NativeSubtasksSheet.jsx";
import NativeTimeZoneSheet from "./NativeTimeZoneSheet.jsx";
import NativeCustomRepeat, { NativeChoicePopover } from "./NativeCustomRepeat.jsx";
import { customRepeatSummary, initialRepeatPattern, monthNames, repeatFrequencies, validRepeatPattern } from "./repeat-pattern.js";
import "./native-details.css";
import "./native-date-time.css";
const repeatChoices = [
  ["none", "Never"],
  ["hourly", "Hourly"],
  ["daily", "Daily"],
  ["weekdays", "Weekdays"],
  ["weekends", "Weekends"],
  ["weekly", "Weekly"],
  ["fortnightly", "Fortnightly"],
  ["monthly", "Monthly"],
  ["quarterly", "Every 3 Months"],
  ["halfyearly", "Every 6 Months"],
  ["yearly", "Yearly"],
];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dateLabel = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00`)) &&
  new Date(`${value}T12:00:00`).getDate() === Number(value.slice(-2));
export function validateDetailsDraft(draft) {
  if (!draft.title.trim()) return "Enter a title.";
  if (draft.dueDate && !validDate(draft.dueDate)) return "Choose a valid date.";
  if (
    draft.dueTime &&
    (!draft.dueDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dueTime))
  )
    return "Choose a valid date and time.";
  if (
    draft.repeatEndDate &&
    (!validDate(draft.repeatEndDate) || draft.repeatEndDate < draft.dueDate)
  )
    return "End Repeat must be on or after the reminder date.";
  if (
    !Number.isInteger(draft.repeatInterval) ||
    draft.repeatInterval < 1 ||
    draft.repeatInterval > 1000
  )
    return "Choose a repeat interval from 1 to 1000.";
  if (!validRepeatPattern(draft.repeatPattern, draft.recurrence))
    return "Choose a valid repeat pattern.";
  if (draft.url.trim()) {
    try {
      if (!["https:", "http:"].includes(new URL(draft.url.trim()).protocol))
        return "Use an http or https URL.";
    } catch {
      return "Enter a valid URL.";
    }
  }
  try {
    new Intl.DateTimeFormat("en-GB", {
      timeZone: draft.timeZone,
    });
  } catch {
    return "Choose a valid time zone.";
  }
  return "";
}
function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      className={`nd-switch ${checked ? "is-on" : ""}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Row({ icon, label, children, action, expanded }) {
  return (
    <div className="nd-row">
      <span className="nd-symbol" aria-hidden="true">
        {icon}
      </span>
      {action ? <button type="button" className="nd-row-label nd-row-expand" aria-expanded={expanded} onClick={action}>{label}</button> : <span className="nd-row-label">{label}</span>}
      <div className="nd-value">{children}</div>
    </div>
  );
}
function DetailIcon({name}) {
  const icon = {date: 'scheduled', time: 'clock', 'end-repeat': 'calendar-check', early: 'alarm'}[name] || name;
  return <Icon name={icon} size={26} />;
}
export function Calendar({ value, onChange }) {
  const [month, setMonth] = useState(() => new Date(`${value || today()}T12:00:00`));
  const [pickingMonth, setPickingMonth] = useState(false);
  const year = month.getFullYear(), index = month.getMonth();
  const first = (new Date(year, index, 1).getDay() + 6) % 7;
  const days = new Date(year, index + 1, 0).getDate();
  const chevron = (direction) => <svg viewBox="0 0 12 22" fill="none" aria-hidden="true"><path d={direction === 'left' ? 'M10 2 2 11 10 20' : 'M2 2 10 11 2 20'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <div className="nd-calendar nd-native-calendar">
    <div className="nd-calendar-header">
      <button type="button" className="nd-calendar-month" aria-label="Month and year" aria-expanded={pickingMonth} onClick={() => setPickingMonth(!pickingMonth)}><b>{month.toLocaleDateString('en-GB', {month:'long', year:'numeric'})}</b><span className="nd-calendar-disclosure" aria-hidden="true">{chevron('right')}</span></button>
      {!pickingMonth && <><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(year, index - 1, 1))}>{chevron('left')}</button><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(year, index + 1, 1))}>{chevron('right')}</button></>}
    </div>
    {pickingMonth ? <div className="nd-month-year-wheel">
      <WheelColumn label="Month" values={Array.from({length:12}, (_,i) => i)} value={index} display={i => monthNames[i]} onChange={i => setMonth(new Date(year,i,1))}/>
      <WheelColumn label="Year" values={Array.from({length:9900}, (_,i) => i+100)} value={year} cyclic={false} onChange={next => setMonth(new Date(next,index,1))}/>
    </div> : <div className="nd-calendar-grid">
      {['MON','TUE','WED','THU','FRI','SAT','SUN'].map(day => <span className="nd-weekday" key={day}>{day}</span>)}
      {Array.from({length:first}, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({length:days}, (_, i) => {
        const date = `${String(year).padStart(4,'0')}-${String(index + 1).padStart(2,'0')}-${String(i + 1).padStart(2,'0')}`;
        return <button type="button" key={date} aria-label={dateLabel(date)} aria-pressed={date === value} className={date === value ? 'selected' : ''} onClick={() => onChange(date)}>{i + 1}</button>;
      })}
    </div>}
  </div>;
}
function WheelColumn({ label, values, value, onChange, display = String, cyclic = true }) {
  const index = Math.max(0, values.indexOf(value));
  const drag = useRef(null), wheelDelta = useRef(0), control = useRef(null);
  const current = useRef({index, values, onChange, cyclic});
  current.current = {index, values, onChange, cyclic};
  const step = (amount) => {
    const c = current.current;
    const next = c.cyclic ? ((c.index + amount) % c.values.length + c.values.length) % c.values.length : Math.max(0, Math.min(c.values.length - 1, c.index + amount));
    if (next !== c.index) c.onChange(c.values[next]);
  };
  useEffect(() => {
    const node = control.current;
    const scroll = event => {
      event.preventDefault();
      wheelDelta.current += event.deltaY;
      const steps = Math.trunc(wheelDelta.current / 28);
      if (steps) { wheelDelta.current -= steps * 28; step(steps); }
    };
    node.addEventListener('wheel', scroll, {passive:false});
    return () => node.removeEventListener('wheel', scroll);
  }, []);
  return <div ref={control} className="nd-wheel-column" role="spinbutton" tabIndex={0} aria-label={label} aria-valuemin={typeof value === 'number' ? Math.min(...values) : 0} aria-valuemax={typeof value === 'number' ? Math.max(...values) : values.length - 1} aria-valuenow={typeof value === 'number' ? value : index} aria-valuetext={display(value)}
    onKeyDown={event => {
      const amount = {ArrowDown:1, ArrowUp:-1, PageDown:3, PageUp:-3}[event.key];
      if (amount) { event.preventDefault(); step(amount); }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); onChange(values[event.key === 'Home' ? 0 : values.length - 1]); }
    }}
    onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; drag.current = {y:event.clientY, moved:false}; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!drag.current) return; const amount = Math.trunc((drag.current.y - event.clientY) / 28); if (amount) { drag.current.y -= amount * 28; drag.current.moved = true; step(amount); } }}
    onPointerUp={event => { if (!drag.current) return; const wasDrag = drag.current.moved; drag.current = null; if (!wasDrag) { const box = event.currentTarget.getBoundingClientRect(); step(Math.round((event.clientY - box.top - box.height / 2) / 31)); } }}
    onPointerCancel={() => { drag.current = null; }}>
    {Array.from({length:9}, (_, i) => i - 4).map(offset => {
      const next = cyclic ? (index + offset + values.length * 10) % values.length : index + offset;
      if (next < 0 || next >= values.length) return null;
      return <span key={offset} className="nd-wheel-value" aria-hidden="true" aria-current={offset === 0 ? 'true' : undefined} style={{'--wheel-offset':offset, '--wheel-scale': Math.max(.3, 1 - Math.abs(offset) * .16), '--wheel-opacity':Math.max(0, 1 - Math.abs(offset) * .24)}}>{display(values[next])}</span>;
    })}
  </div>;
}
export function TimeWheel({ value, onChange }) {
  const [hour, minute] = (value || '09:00').split(':').map(Number);
  const change = (key, next) => {
    let h = hour, m = minute;
    if (key === 'hour') h = (Number(next) % 12) + (hour >= 12 ? 12 : 0);
    if (key === 'minute') m = Number(next);
    if (key === 'period') h = hour % 12 + (next === 'pm' ? 12 : 0);
    onChange(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  };
  // Preserve imported non-five-minute times until the user moves the minute wheel.
  const minutes = Array.from({length:12}, (_, i) => i * 5);
  if (!minutes.includes(minute)) minutes.push(minute);
  minutes.sort((a,b) => a-b);
  return <div className="nd-time-wheel nd-native-time-wheel">
    <WheelColumn label="Hour" values={Array.from({length:12}, (_, i) => i + 1)} value={hour % 12 || 12} onChange={next => change('hour',next)} />
    <WheelColumn label="Minute" values={minutes} value={minute} display={next => String(next).padStart(2,'0')} onChange={next => change('minute',next)} />
    <WheelColumn label="Period" values={['am','pm']} value={hour >= 12 ? 'pm' : 'am'} cyclic={false} onChange={next => change('period',next)} />
  </div>;
}
export default function NativeDetails({
  reminder,
  lists,
  existingTags = [],
  onCancel,
  onSave,
  onUpload,
  onDeleteAttachment,
  uploading = false,
  uploadError = "",
  subtasks = [],
}) {
  const sheet = useRef(null),
    photoInput = useRef(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [choiceMenu, setChoiceMenu] = useState(null);
  const [dateExpanded, setDateExpanded] = useState(false);
  const [timeExpanded, setTimeExpanded] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [draftSubtasks, setDraftSubtasks] = useState(() => subtasks.map(row => ({ ...row })));
  const subtasksButton = useRef(null);
  const closeSubtasks = rows => {
    setDraftSubtasks(rows);
    setSubtasksOpen(false);
    requestAnimationFrame(() => subtasksButton.current?.focus({ preventScroll: true }));
  };
  const tagsButton = useRef(null);
  const closeTags = () => {
    setTagsOpen(false);
    requestAnimationFrame(() => tagsButton.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      sheet.current?.style.setProperty(
        "--nd-vh",
        `${viewport?.height || window.innerHeight}px`,
      );
      sheet.current?.style.setProperty(
        "--nd-vtop",
        `${viewport?.offsetTop || 0}px`,
      );
      const app = sheet.current?.closest("[data-ui=app]");
      const color = getComputedStyle(app || document.documentElement)
        .getPropertyValue("--text")
        .trim();
      sheet.current?.setAttribute(
        "data-theme",
        color === "#f5f5f7" ||
          window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      scheme.removeEventListener("change", update);
    };
  }, []);
  const choosePhoto = (camera = false) => {
    setPhotoMenu(false);
    const input = photoInput.current;
    if (camera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };
  const [draft, setDraft] = useState(() => ({
    ...reminder,
    attachments: [...(reminder.attachments || [])],
    tags: [...(reminder.tags || [])],
    url: reminder.url || "",
    timeZone:
      reminder.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    repeatEndDate: reminder.repeatEndDate || null,
  }));
  const [panel, setPanel] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleted, setDeleted] = useState([]),
    [added, setAdded] = useState([]);
  const set = (key, value) =>
    setDraft((prev) => ({
      ...prev,
      [key]: value,
      ...(["dueDate", "dueTime", "timeZone"].includes(key) && prev[key] !== value ? { dueInstant: null } : {}),
    }));
  const cancel = () => {
    if (!busy && !uploading)
      onCancel({
        addedAttachments: added,
      });
  };
  useEffect(() => {
    const handle = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (photoMenu) setPhotoMenu(false);
        else if (panel) setPanel(null);
        else cancel();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [panel, photoMenu, onCancel, added, busy, uploading]);
  async function save(e) {
    e.preventDefault();
    const message = validateDetailsDraft(draft);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    try {
      await onSave(
        {
          ...draft,
          title: draft.title.trim(),
          url: draft.url.trim(),
          location: draft.location.trim(),
          tags: [...new Set(draft.tags.filter(Boolean))],
        },
        {
          deletedAttachments: deleted,
          addedAttachments: added,
          subtasks: draftSubtasks,
        },
      );
    } catch (err) {
      setError(err.message || "Unable to save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUpload) return;
    setBusy(true);
    setError("");
    try {
      const attachment = await onUpload(file);
      if (!attachment?.id)
        throw new Error("Upload did not return an attachment.");
      setDraft((prev) => ({
        ...prev,
        attachments: [...prev.attachments, attachment],
      }));
      setAdded((prev) => [...prev, attachment]);
    } catch (err) {
      setError(err.message || "Unable to upload. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const repeatLabel =
    draft.repeatCustom || draft.repeatPattern || draft.repeatInterval > 1
      ? "Custom"
      : repeatChoices.find(([key]) => key === draft.recurrence)?.[1] || "Never";
  return (
    <>
    <div
      ref={sheet}
      className={`native-details nd-main-details ${panel === "custom" ? "nd-custom-panel" : ""}`}
      role={tagsOpen || subtasksOpen || panel === "zone" ? undefined : "dialog"}
      aria-modal={tagsOpen || subtasksOpen || panel === "zone" ? undefined : "true"}
      aria-hidden={tagsOpen || subtasksOpen || panel === "zone" ? "true" : undefined}
      inert={tagsOpen || subtasksOpen || panel === "zone" ? true : undefined}
      style={{ visibility: tagsOpen || subtasksOpen || panel === "zone" ? "hidden" : undefined }}
      aria-label="Details"
      data-panel={panel || "main"}
    >
      <form onSubmit={save}>
        <header className="nd-header">
          {panel === "custom" ? <span /> : <button
            type="button"
            className="nd-cancel"
            aria-label={panel === "section" ? "Back to Details" : "Cancel"}
            disabled={busy || uploading}
            onClick={panel === "section" ? () => setPanel(null) : cancel}
          >
            {panel === "section" ? "‹" : panel ? "×" : <><span className="nd-cancel-original" aria-hidden="true">×</span><svg className="nd-cancel-measured" aria-hidden="true" width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M1.05 1.05 15.95 15.95M15.95 1.05 1.05 15.95" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/></svg></>}
          </button>}
          <h2>
            {panel === "section" ? "Select a Section" : panel === "repeat"
              ? "Repeat"
              : panel === "end"
                ? "End Repeat"
                : panel === "zone"
                  ? "Time Zone"
                  : panel === "custom"
                    ? "Custom"
                    : "Details"}
          </h2>
          {panel === "section" ? <span /> : panel ? (
            <button
              key={`nested-${panel}`}
              type="button"
              className="nd-done"
              aria-label={panel === "custom" ? "Done" : "Back to Details"}
              onClick={() => setPanel(null)}
            >
              ✓
            </button>
          ) : (
            <button
              key="parent-save"
              type="submit"
              className="nd-done"
              aria-label="Done"
              disabled={busy || uploading}
            >
              ✓
            </button>
          )}
        </header>
        <div className="nd-content">
          {panel === "section" ? (
            <div className="nd-shopping-section">
              <div className="nd-group">
                {[{ id: null, name: "None" }, ...(lists.find(list => list.id === draft.listId)?.sections || [])].map(section => <button type="button" key={section.id || "none"} className="nd-choice" onClick={() => { setDraft(previous => ({ ...previous, sectionId: section.id, shoppingCategoryManual: true, shoppingCategoryChoice: undefined, shoppingNewSectionName: undefined })); setPanel(null); }}><span className="nd-shopping-choice-name">{section.name}</span>{draft.sectionId === section.id && !draft.shoppingNewSectionName && <span aria-label="Selected">✓</span>}</button>)}
              </div>
              <div className="nd-group"><input aria-label="New Section with Selection" placeholder="New Section with Selection" maxLength={200} value={newSectionName} onChange={event => setNewSectionName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && newSectionName.trim()) { event.preventDefault(); setDraft(previous => ({ ...previous, shoppingNewSectionName: newSectionName.trim(), shoppingCategoryManual: true })); setNewSectionName(""); setPanel(null); } }} /></div>
            </div>
          ) : panel === "custom" ? (
            <NativeCustomRepeat draft={draft} setDraft={setDraft} Wheel={WheelColumn}/>
          ) : panel === "zone" ? null : (
            <>
              <div className="nd-group nd-text-group">
                <textarea
                  className="nd-title"
                  rows={1}
                  aria-label="Title"
                  placeholder="Title"
                  value={draft.title}
                  onChange={(e) => { set("title", e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
                  ref={node => { if (node) { node.style.height = "auto"; node.style.height = `${node.scrollHeight}px`; } }}
                />
                <textarea
                  rows={1}
                  aria-label="Notes"
                  placeholder="Notes"
                  value={draft.notes}
                  onChange={(e) => { set("notes", e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
                  ref={node => { if (node) { node.style.height = "auto"; node.style.height = `${node.scrollHeight}px`; } }}
                />
                <input
                  aria-label="URL"
                  placeholder="URL"
                  inputMode="url"
                  value={draft.url}
                  onChange={(e) => set("url", e.target.value)}
                />
              </div>
              <h3>Date &amp; Time</h3>
              <div className="nd-group">
                <Row
                  action={() => { if (!draft.dueDate) set("dueDate", today()); setDateExpanded(!dateExpanded); }}
                  expanded={dateExpanded}
                  icon={<DetailIcon name="date"/>}
                  label={
                    <>
                      <span>Date</span>
                      {draft.dueDate && (
                        <small>{draft.dueDate === today() ? "Today" : dateLabel(draft.dueDate)}</small>
                      )}
                    </>
                  }
                >
                  <Toggle
                    label="Date"
                    checked={!!draft.dueDate}
                    onChange={(enabled) => {
                      setDateExpanded(enabled);
                      setDraft((prev) => ({
                        ...prev,
                        dueDate: enabled ? today() : null,
                        dueTime: enabled ? prev.dueTime : null,
                        dueInstant: null,
                        recurrence: enabled ? prev.recurrence : "none",
                        repeatEndDate: enabled ? prev.repeatEndDate : null,
                        repeatPattern: enabled ? prev.repeatPattern : null,
                        repeatCustom: enabled ? prev.repeatCustom : false,
                      }));
                    }}
                  />
                </Row>
                {draft.dueDate && dateExpanded && (
                  <Calendar
                    value={draft.dueDate}
                    onChange={(value) => set("dueDate", value)}
                  />
                )}
                <Row
                  action={() => { if (!draft.dueTime) set("dueTime", "09:00"); setTimeExpanded(!timeExpanded); }}
                  expanded={timeExpanded}
                  icon={<DetailIcon name="time"/>}
                  label={
                    <>
                      <span>Time</span>
                      {draft.dueTime && (
                        <small>
                          {new Date(
                            `2000-01-01T${draft.dueTime}`,
                          ).toLocaleTimeString("en-GB", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </small>
                      )}
                    </>
                  }
                >
                  <Toggle
                    label="Time"
                    checked={!!draft.dueTime}
                    onChange={(enabled) => {
                      setTimeExpanded(enabled);
                      setDraft((prev) => ({
                        ...prev,
                        dueDate: enabled
                          ? prev.dueDate || today()
                          : prev.dueDate,
                        dueTime: enabled ? "09:00" : null,
                        dueInstant: null,
                      }));
                    }}
                  />
                </Row>
                {draft.dueTime && timeExpanded && (
                  <TimeWheel
                    value={draft.dueTime}
                    onChange={(value) => set("dueTime", value)}
                  />
                )}
                {draft.dueTime && (
                  <Row icon="◎" label="Time Zone">
                    <button type="button" onClick={() => setPanel("zone")}>
                      {draft.timeZone.split("/").pop().replaceAll("_", " ")}{" "}
                      <span>›</span>
                    </button>
                  </Row>
                )}
              </div>
              {draft.dueDate && (
                <div className="nd-group">
                  <Row icon={<DetailIcon name="repeat"/>} label="Repeat">
                    <button type="button" aria-label="Repeat" aria-haspopup="menu" onClick={event => setChoiceMenu({kind:"repeat",anchor:event.currentTarget})}>{repeatLabel}<span className="nd-menu-chevron" aria-hidden="true">⌃⌄</span></button>
                  </Row>
                  {(draft.repeatCustom || draft.repeatPattern || draft.repeatInterval > 1) && <button type="button" className="nd-repeat-summary" aria-label="Custom Repeat" onClick={() => setPanel("custom")}>{customRepeatSummary(draft)} <span>›</span></button>}
                  {draft.recurrence !== "none" && <>
                    <Row icon={<DetailIcon name="end-repeat"/>} label="End Repeat"><button type="button" aria-label="End Repeat" aria-haspopup="menu" onClick={event => setChoiceMenu({kind:"end",anchor:event.currentTarget})}>{draft.repeatEndDate ? "On Date" : "Never"}<span className="nd-menu-chevron" aria-hidden="true">⌃⌄</span></button></Row>
                    {draft.repeatEndDate && <Row label="End Date"><button type="button" className="nd-end-date-pill" aria-label="End Date" onClick={event => setChoiceMenu({kind:"end-date",anchor:event.currentTarget})}>{new Date(`${draft.repeatEndDate}T12:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</button></Row>}
                  </>}
                  <Row icon={<DetailIcon name="early"/>} label="Early Reminder">
                    <select
                      aria-label="Early Reminder"
                      value={draft.earlyMinutes || 0}
                      onChange={(e) =>
                        set("earlyMinutes", Number(e.target.value))
                      }
                    >
                      {[
                        [0, "None"],
                        [5, "5 minutes before"],
                        [15, "15 minutes before"],
                        [30, "30 minutes before"],
                        [60, "1 hour before"],
                        [120, "2 hours before"],
                        [1440, "1 day before"],
                        [2880, "2 days before"],
                        [10080, "1 week before"],
                        [43200, "1 month before"],
                      ].map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Row>
                </div>
              )}
              <h3>Organisation</h3>
              <div className="nd-group">
                <Row icon={<span className="nd-list-badge" style={{background:lists.find(list => list.id===draft.listId)?.color || '#007aff'}}><Icon name={lists.find(list => list.id===draft.listId)?.icon || 'list'} size={18} color="white" nativePicker/></span>} label="List">
                  <span className="nd-select-display nd-select-list">
                  <select
                    aria-label="List"
                    value={draft.listId}
                    onChange={(e) => set("listId", e.target.value)}
                  >
                    {lists.filter(list => list.type !== "smart").map((list) => (
                      <option value={list.id} key={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                  <span className="nd-select-text" aria-hidden="true">{lists.find(list => list.id === draft.listId)?.name || ""}</span>
                  </span>
                </Row>
                {lists.find(list => list.id === draft.listId)?.type === "shopping" && lists.find(list => list.id === draft.listId)?.sections.length > 0 && !draft.parentId && <button type="button" className="nd-row nd-subtasks-row" aria-label="Section" disabled={busy || uploading} onClick={() => setPanel("section")}><span className="nd-symbol" aria-hidden="true">☷</span><span className="nd-row-label">Section</span><span className="nd-value">{draft.shoppingNewSectionName || lists.find(list => list.id === draft.listId)?.sections.find(section => section.id === draft.sectionId)?.name || "None"}<span className="nd-subtasks-chevron" aria-hidden="true">›</span></span></button>}
                <Row icon={<DetailIcon name="tags"/>} label="Tags">
                  <button type="button" ref={tagsButton} aria-label="Tags" disabled={busy || uploading} onClick={() => setTagsOpen(true)}>
                    {draft.tags.length ? draft.tags.map(tag => `#${tag}`).join(" ") : ""}<span className="nd-disclosure" aria-hidden="true">›</span>
                  </button>
                </Row>
                <button type="button" className="nd-row nd-subtasks-row" aria-label="Subtasks" ref={subtasksButton} disabled={busy || uploading} onClick={() => setSubtasksOpen(true)}>
                  <span className="nd-symbol" aria-hidden="true"><DetailIcon name="subtasks"/></span>
                  <span className="nd-row-label">Subtasks</span>
                  <span className="nd-value">{draftSubtasks.filter(row => row.title.trim()).length}<span className="nd-subtasks-chevron nd-disclosure" aria-hidden="true">›</span></span>
                </button>
              </div>
              <div className="nd-group">
                <Row icon={<DetailIcon name="flag"/>} label="Flag">
                  <Toggle
                    label="Flagged"
                    checked={draft.flagged}
                    onChange={(value) => set("flagged", value)}
                  />
                </Row>
                <Row icon={<DetailIcon name="priority"/>} label="Priority">
                  <span className="nd-select-display nd-select-priority">
                  <select
                    aria-label="Priority"
                    value={draft.priority}
                    onChange={(e) => set("priority", e.target.value)}
                  >
                    {["none", "low", "medium", "high"].map((value) => (
                      <option value={value} key={value}>
                        {value[0].toUpperCase() + value.slice(1)}
                      </option>
                    ))}
                  </select>
                  <span className="nd-select-text" aria-hidden="true">{draft.priority[0].toUpperCase() + draft.priority.slice(1)}</span>
                  </span>
                </Row>
              </div>
              <h3>Places &amp; People</h3>
              <div className="nd-group">
                <Row icon={<DetailIcon name="location"/>} label="Location">
                  <Toggle
                    label="Location"
                    checked={!!draft.location}
                    onChange={(enabled) => set("location", enabled ? " " : "")}
                  />
                </Row>
                {!!draft.location && (
                  <input
                    className="nd-location"
                    aria-label="Enter a Location"
                    placeholder="Enter a Location"
                    value={draft.location.trimStart()}
                    onChange={(e) => set("location", e.target.value || " ")}
                  />
                )}
              </div>
              <div className="nd-group nd-attachments">
                {draft.attachments.map((attachment) => (
                  <div className="nd-attachment" key={attachment.id}>
                    {attachment.contentType?.startsWith("image/") &&
                    attachment.downloadUrl?.startsWith("/") ? (
                      <img
                        src={attachment.downloadUrl}
                        alt={attachment.filename}
                      />
                    ) : (
                      <span>{attachment.filename}</span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.filename}`}
                      onClick={() => {
                        setDraft((prev) => ({
                          ...prev,
                          attachments: prev.attachments.filter(
                            (item) => item.id !== attachment.id,
                          ),
                        }));
                        setDeleted((prev) => [...prev, attachment]);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="nd-add-image"
                  aria-haspopup="menu"
                  aria-expanded={photoMenu}
                  disabled={!onUpload || busy || uploading}
                  onClick={() => setPhotoMenu(!photoMenu)}
                >
                  <span aria-hidden="true">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <circle cx="8" cy="9" r="1.5" />
                      <path d="m4 17 5-5 4 4 3-3 5 5" />
                    </svg>
                  </span>{" "}
                  Add Image…
                </button>
                <input
                  ref={photoInput}
                  className="nd-photo-input"
                  type="file"
                  aria-label="Photo Library file"
                  accept="image/*,application/pdf"
                  disabled={!onUpload || busy || uploading}
                  onChange={upload}
                />
                {photoMenu && (
                  <div
                    className="nd-photo-menu"
                    role="menu"
                    aria-label="Add Image"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => choosePhoto(true)}
                    >
                      Take Photo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPhotoMenu(false);
                        setError(
                          "Document scanning is unavailable in this browser. Use Take Photo or Photo Library.",
                        );
                      }}
                    >
                      Scan Document
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => choosePhoto()}
                    >
                      Photo Library
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {(error || uploadError) && (
            <p className="nd-error" role="alert">
              {error || uploadError}
            </p>
          )}
          {(busy || uploading) && <p role="status">Saving…</p>}
        </div>
      </form>
    </div>
    {subtasksOpen && <NativeSubtasksSheet parent={draft} subtasks={draftSubtasks} theme={sheet.current?.getAttribute("data-theme")} portalTarget={sheet.current?.closest(".server-root")} onBack={closeSubtasks} />}
    {tagsOpen && <NativeTagsSheet tags={draft.tags} existingTags={existingTags} theme={sheet.current?.getAttribute("data-theme")} portalTarget={sheet.current?.closest(".server-root")} onCancel={closeTags} onSave={tags => { set("tags", tags); closeTags(); }} />}
    {choiceMenu?.kind === "repeat" && <NativeChoicePopover anchor={choiceMenu.anchor} label="Repeat" selected={draft.repeatCustom || draft.repeatPattern || draft.repeatInterval > 1 ? "custom" : draft.recurrence} choices={[...repeatChoices.map(([value,label],i) => [value,label,i===1]),["custom","Custom",true]]} onClose={() => setChoiceMenu(null)} onChoose={value => {if (value === "custom") {const frequency=repeatFrequencies.some(([key]) => key===draft.recurrence)?draft.recurrence:"daily";setDraft(previous=>({...previous,recurrence:frequency,repeatCustom:true,repeatPattern:previous.repeatPattern || initialRepeatPattern(frequency,previous.dueDate)}));} else setDraft(previous=>({...previous,recurrence:value,repeatInterval:1,repeatCustom:false,repeatPattern:null,repeatEndDate:value === "none" ? null : previous.repeatEndDate}));setChoiceMenu(null);}}/>}
    {choiceMenu?.kind === "end" && <NativeChoicePopover anchor={choiceMenu.anchor} label="End Repeat" choices={[["never","Never"],["date","On Date"]]} selected={draft.repeatEndDate?"date":"never"} onClose={() => setChoiceMenu(null)} onChoose={value => {set("repeatEndDate",value === "date" ? draft.dueDate || today() : null);setChoiceMenu(null);}}/>}
    {choiceMenu?.kind === "end-date" && <NativeChoicePopover anchor={choiceMenu.anchor} label="End Date" calendar={<Calendar value={draft.repeatEndDate} onChange={value => {set("repeatEndDate",value);setChoiceMenu(null);}}/>} onClose={() => setChoiceMenu(null)}/>}
    {panel === "zone" && <NativeTimeZoneSheet value={draft.timeZone} theme={sheet.current?.getAttribute("data-theme")} portalTarget={sheet.current?.closest(".server-root")} onBack={() => setPanel(null)} onCancel={cancel} onSelect={zone => { set("timeZone", zone); setPanel(null); }} />}
    </>
  );
}
