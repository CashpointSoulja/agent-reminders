import React, { useEffect, useRef, useState } from "react";
import NativeDetails, { Calendar, TimeWheel } from "./NativeDetails";
import Icon from "./icons";
import { quickEntryDraft, finishQuickEntry } from "./quick-entry";
import "./native-quick-entry.css";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function QuickIcon({ name }) {
  const shapes = {
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 5v7H7" />
      </>
    ),
    location: <path d="m3 10 18-7-7 18-3-8z" />,
    camera: (
      <>
        <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  };
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
export default function NativeQuickEntry({
  lists,
  existingTags = [],
  onSave,
  onCancel,
}) {
  const [draft, setDraft] = useState(() => quickEntryDraft(lists));
  const [panel, setPanel] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [subtasks, setSubtasks] = useState([]);
  const [files, setFiles] = useState([]),
    sheet = useRef(null),
    photo = useRef(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      sheet.current?.style.setProperty(
        "--nqe-vh",
        `${viewport?.height || window.innerHeight}px`,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    const escape = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (panel) setPanel(null);
        else if (!busy) onCancel();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      viewport?.removeEventListener("resize", update);
      document.removeEventListener("keydown", escape);
    };
  }, [panel, busy, onCancel]);
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(
        finishQuickEntry(draft, lists),
        files.filter((f) =>
          draft.attachments?.some((a) => a.id === f.attachment.id),
        ),
        { subtasks },
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!draft)
    return (
      <section
        className="native-quick-entry"
        role="dialog"
        aria-label="New Reminder"
      >
        <header className="nqe-header">
          <button onClick={onCancel} aria-label="Cancel New Reminder">
            ×
          </button>
          <h2>New Reminder</h2>
        </header>
        <p>Create a list before adding a reminder.</p>
      </section>
    );
  if (panel === "details")
    return (
      <div ref={sheet} className="native-quick-entry-details">
        <NativeDetails
          reminder={draft}
          lists={lists.filter((l) => l.type !== "smart")}
          existingTags={existingTags}
          subtasks={subtasks}
          onCancel={({ addedAttachments = [] } = {}) => {
            setFiles((f) =>
              f.filter(
                (item) =>
                  !addedAttachments.some((a) => a.id === item.attachment.id),
              ),
            );
            setPanel(null);
          }}
          onSave={(d, { subtasks: children = [] } = {}) => {
            setDraft(d);
            setSubtasks(children);
            setPanel(null);
          }}
          onUpload={async (file) => {
            const attachment = {
              id: `pending-${crypto.randomUUID()}`,
              filename: file.name,
              pending: true,
            };
            setFiles((f) => [...f, { attachment, file }]);
            return attachment;
          }}
        />
      </div>
    );
  return (
    <section
      ref={sheet}
      className="native-quick-entry"
      role="dialog"
      aria-modal="true"
      aria-label="New Reminder"
    >
      <header className="nqe-header">
        <button
          type="button"
          aria-label="Cancel New Reminder"
          disabled={busy}
          onClick={onCancel}
        >
          ×
        </button>
        <h2>{panel === "list" ? "List" : "New Reminder"}</h2>
        <button
          type="button"
          className="nqe-done"
          aria-label="Save New Reminder"
          disabled={!draft.title.trim() || busy}
          onClick={save}
        >
          <Icon name="check" size={27} />
        </button>
      </header>
      <div className="nqe-scroll">
        {panel === "list" ? (
          <>
            <button className="nqe-back" onClick={() => setPanel(null)}>
              ‹ New Reminder
            </button>
            <div className="nqe-group">
              {lists
                .filter((l) => l.type !== "smart")
                .map((l) => (
                  <button
                    key={l.id}
                    className="nqe-row"
                    onClick={() => {
                      set("listId", l.id);
                      setPanel(null);
                    }}
                  >
                    <span
                      className="nqe-list-icon"
                      style={{ background: l.color }}
                    >
                      <Icon name={l.icon || "list"} />
                    </span>
                    <span>{l.name}</span>
                    {l.id === draft.listId && <Icon name="check" />}
                  </button>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="nqe-group nqe-text">
              <input
                aria-label="Title"
                placeholder="Title"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
              />
              <textarea
                aria-label="Notes"
                placeholder="Notes"
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
            <h3>Date &amp; Time</h3>
            <div className="nqe-group">
              <div className="nqe-row">
                <Icon name="scheduled" />
                <span>Date</span>
                <button
                  type="button"
                  className={`nqe-switch ${draft.dueDate ? "is-on" : ""}`}
                  role="switch"
                  aria-label="Date"
                  aria-checked={!!draft.dueDate}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      dueDate: d.dueDate ? null : today(),
                      dueTime: d.dueDate ? null : d.dueTime,
                    }))
                  }
                >
                  <span />
                </button>
              </div>
              {draft.dueDate && (
                <Calendar
                  value={draft.dueDate}
                  onChange={(value) => set("dueDate", value)}
                />
              )}
              <div className="nqe-row">
                <QuickIcon name="clock" />
                <span>Time</span>
                <button
                  type="button"
                  className={`nqe-switch ${draft.dueTime ? "is-on" : ""}`}
                  role="switch"
                  aria-label="Time"
                  aria-checked={!!draft.dueTime}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      dueDate: d.dueDate || today(),
                      dueTime: d.dueTime ? null : "09:00",
                    }))
                  }
                >
                  <span />
                </button>
              </div>
              {draft.dueTime && (
                <TimeWheel
                  value={draft.dueTime}
                  onChange={(value) => set("dueTime", value)}
                />
              )}
            </div>
            <h3>More Options</h3>
            <div className="nqe-group">
              <button
                type="button"
                className="nqe-row"
                onClick={() => setPanel("list")}
              >
                <span
                  className="nqe-list-icon"
                  style={{
                    background: lists.find((l) => l.id === draft.listId)?.color,
                  }}
                >
                  <Icon name="list" />
                </span>
                <span>List</span>
                <span className="nqe-value">
                  {lists.find((l) => l.id === draft.listId)?.name}
                </span>
                <span className="nqe-chevron">›</span>
              </button>
            </div>
            <div className="nqe-group nqe-details">
              <button
                type="button"
                className="nqe-row"
                aria-label="Details"
                onClick={() => setPanel("details")}
              >
                <Icon name="info" />
                <span>Details</span>
                <span className="nqe-chevron">›</span>
              </button>
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="nqe-quickbar">
        <button
          aria-label="Date and time"
          onClick={() => {
            set("dueDate", draft.dueDate || today());
            sheet.current
              .querySelector('[role="switch"][aria-label="Date"]')
              ?.focus();
          }}
        >
          <Icon name="scheduled" size={25} />
        </button>
        <button aria-label="Location" onClick={() => setPanel("details")}>
          <QuickIcon name="location" />
        </button>
        <button
          aria-label="Flag"
          aria-pressed={draft.flagged}
          onClick={() => set("flagged", !draft.flagged)}
        >
          <Icon name="flag" size={25} />
        </button>
        <button
          aria-label="Photo Library"
          onClick={() => photo.current.click()}
        >
          <QuickIcon name="camera" />
        </button>
      </div>
      <input
        ref={photo}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const attachment = {
              id: `pending-${crypto.randomUUID()}`,
              pending: true,
              filename: file.name,
            };
            setFiles((f) => [...f, { attachment, file }]);
            setDraft((d) => ({
              ...d,
              attachments: [...(d.attachments || []), attachment],
            }));
          }
          e.target.value = "";
        }}
      />
    </section>
  );
}
