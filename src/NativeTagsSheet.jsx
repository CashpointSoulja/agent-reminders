import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./native-tags-sheet.css";

export default function NativeTagsSheet({ tags, existingTags = [], theme, portalTarget, onCancel, onSave }) {
  const [selected, setSelected] = useState(() => [...tags]);
  const [created, setCreated] = useState([]);
  const [entry, setEntry] = useState("");
  const sheet = useRef(null);
  const input = useRef(null);
  const clean = value => value.trim().replace(/^#+/, "").replace(/\s+/g, "");
  const choices = [...new Set([...existingTags, ...tags, ...created])].filter(Boolean);
  const add = () => {
    const tag = clean(entry);
    if (!tag || (selected.length >= 50 && !selected.includes(tag))) return;
    setSelected(previous => [...new Set([...previous, tag])]);
    setCreated(previous => [...new Set([...previous, tag])]);
    setEntry("");
  };
  const done = () => {
    const tag = clean(entry);
    if (selected.length >= 50 && tag && !selected.includes(tag)) return;
    onSave([...new Set([...selected, ...(tag ? [tag] : [])])]);
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      sheet.current?.style.setProperty("--nd-vh", `${viewport?.height || innerHeight}px`);
      sheet.current?.style.setProperty("--nd-vtop", `${viewport?.offsetTop || 0}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    // Native opens this sheet without summoning the keyboard.
    sheet.current?.querySelector("button")?.focus({ preventScroll: true });
    const keydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
      }
      if (event.key === "Tab") {
        const controls = [...sheet.current.querySelectorAll("button:not(:disabled), input")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.removeEventListener("keydown", keydown, true);
    };
  }, [onCancel]);
  return createPortal(
    <div className="nt-backdrop">
      <section ref={sheet} className="native-details native-tags-sheet" data-theme={theme || "light"} role="dialog" aria-modal="true" aria-label="Tags">
        <header className="nd-header">
          <button type="button" className="nd-cancel" aria-label="Cancel Tags" onClick={onCancel}>×</button>
          <h2>Tags</h2>
          <button type="button" className="nd-done" aria-label="Done Tags" disabled={selected.length >= 50 && Boolean(clean(entry)) && !selected.includes(clean(entry))} onClick={done}>✓</button>
        </header>
        <div className="nd-content">
          <div className="nt-entry">
            <input ref={input} maxLength={100} aria-label="Add New Tag" placeholder="Add New Tag…" value={entry} autoComplete="off" autoCapitalize="none" onChange={event => setEntry(event.target.value)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); add(); } }} />
          </div>
          {choices.length > 0 && <div className="nt-tags" aria-label="Available tags">
            {choices.map(tag => <button type="button" key={tag} aria-pressed={selected.includes(tag)} disabled={selected.length >= 50 && !selected.includes(tag)} onClick={() => setSelected(previous => previous.includes(tag) ? previous.filter(item => item !== tag) : [...previous, tag])}>#{tag}</button>)}
          </div>}
        </div>
      </section>
    </div>, portalTarget || document.body
  );
}
