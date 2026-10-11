import React, { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import { EMOJI_CATEGORIES, EMOJI_DATA, EMOJI_PALETTE, emojiVariants, rememberEmoji, searchEmoji } from "./emoji";
import "./native-emoji-picker.css";

const RECENTS_KEY = "reminders-emoji-recents";
function readRecents() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(saved) ? rememberEmoji(saved, "").filter(Boolean) : [];
  } catch { return []; }
}
function CategoryIcon({ index }) {
  const shapes = [
    <><circle cx="12" cy="12" r="9"/><path d="M12 5v7H6"/></>,
    <><circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r=".7"/><circle cx="15.5" cy="9.5" r=".7"/><path d="M6.5 14q5.5 6 11 0Z"/></>,
    <><path d="M6 6C0 0 0 12 4 11a8 8 0 0 0 16 0c4 1 4-11-2-5a10 10 0 0 0-12 0Z"/><path d="M8 12h.1m8 0h.1M10 16q2 3 4 0M11 14h2"/></>,
    <><path d="M3 14h18M3 17h18M4 12q8-9 16 0ZM3 20h18M6 11V3h8l-1 7M12 3l2-2"/></>,
    <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 0 2 5-5 4-5-4Z M9 9 7 4m8 5 3-5m-1 10 4 1m-9 3v3m-5-7-4 1"/></>,
    <><path d="M3 17h18v4M4 16l2-5h12l2 5M7 11V7h10v4M9 7V3h6v4M7 16h.1m10 0h.1M3 19h18"/></>,
    <><path d="M9 17c0-3-4-4-4-8a7 7 0 0 1 14 0c0 4-4 5-4 8M9 18h6M9 21h6M10 15V9m4 6V9"/></>,
    <><path d="M3 5h8M7 3v11M3 10h8M15 4v8c-5-1-4 4 0 3V6l6-2v8c-5-1-4 4 0 3M3 19l7 2M10 19l-7 2M15 20h.1m6 0h.1"/></>,
    <><path d="M5 22V3c5-3 9 3 15 0v11c-6 3-10-3-15 0"/></>,
  ];
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[index]}</svg>;
}

export default function NativeEmojiPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [recents] = useState(readRecents);
  const [category, setCategory] = useState(recents.length ? -1 : 0);
  const [variants, setVariants] = useState([]);
  const [keyboard, setKeyboard] = useState(false);
  const picker = useRef(null), scroller = useRef(null), search = useRef(null), hold = useRef(null), held = useRef(false);
  const groups = [
    ...(recents.length ? [{ index: -1, label: "Frequently Used", items: recents.map((value) => EMOJI_DATA.find(([emoji]) => emoji === value)) }] : []),
    ...EMOJI_CATEGORIES.map((label, index) => ({ index, label, items: EMOJI_PALETTE.filter(([, , group]) => group === index) })),
  ];
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => setKeyboard(Boolean(viewport && window.innerHeight - viewport.height > 150));
    const dismiss = (event) => {
      if (!picker.current?.contains(event.target) && !event.target.closest(".nls-smiley")) onClose();
    };
    viewport?.addEventListener("resize", resize);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      clearTimeout(hold.current);
      viewport?.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [onClose]);
  function select(emoji) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(rememberEmoji(recents, emoji))); } catch { /* Storage disabled; selection still works. */ }
    onSelect(emoji);
  }
  function jump(index) {
    setQuery(""); setVariants([]); search.current?.blur(); setCategory(index);
    const section = scroller.current?.querySelector(`[data-category="${index}"]`);
    if (section) scroller.current.scrollTo({ left: section.offsetLeft - 14, behavior: "auto" });
  }
  function emojiButton([emoji, name]) {
    return <button key={emoji} type="button" className="nep-emoji" aria-label={`${emoji} ${name}`}
      onPointerDown={() => {
        held.current = false;
        hold.current = setTimeout(() => {
          const options = emojiVariants(emoji);
          if (options.length > 1) { held.current = true; setVariants(options); }
        }, 450);
      }}
      onPointerUp={() => clearTimeout(hold.current)} onPointerCancel={() => clearTimeout(hold.current)}
      onPointerLeave={() => clearTimeout(hold.current)}
      onContextMenu={(event) => { event.preventDefault(); const options = emojiVariants(emoji); if (options.length > 1) setVariants(options); }}
      onClick={() => { if (!held.current) select(emoji); }}>
      {emoji}
    </button>;
  }
  return <section ref={picker} className={`native-emoji-picker ${query ? "nep-searching" : ""} ${keyboard ? "nep-keyboard" : ""}`} aria-label="Emoji Picker"
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (variants.length) setVariants([]); else onClose(); }
    }}>
    <label className="nep-search">
      <Icon name="search" size={20}/>
      <input ref={search} type="text" aria-label="Search Emoji" placeholder="Search Emoji" autoComplete="off" autoCorrect="off" spellCheck="false"
        value={query} onChange={(event) => { setQuery(event.target.value); setVariants([]); }}/>
      {query && <button type="button" aria-label="Clear text" onClick={() => { setQuery(""); search.current?.focus(); }}>×</button>}
    </label>
    {query ? <div className="nep-results" aria-label="Emoji search results">{searchEmoji(query).map(emojiButton)}</div> :
      <div ref={scroller} className="nep-scroller" onScroll={() => {
        const sections = [...scroller.current.querySelectorAll("[data-category]")];
        const active = sections.findLast((section) => section.offsetLeft <= scroller.current.scrollLeft + 20);
        if (active) setCategory(Number(active.dataset.category));
      }}>
        {groups.map(({ index, label, items }) => <div key={index} className="nep-group" data-category={index}>
          <h3>{label}</h3><div className="nep-grid">{items.map(emojiButton)}</div>
        </div>)}
      </div>}
    {!keyboard && <nav className="nep-categories" aria-label="Emoji categories">
      {[-1, ...EMOJI_CATEGORIES.map((_, index) => index)].map((index) =>
        <button key={index} type="button" aria-label={`${index < 0 ? "Frequently Used" : EMOJI_CATEGORIES[index]} category`} aria-pressed={category === index}
          onClick={() => jump(index)} disabled={index < 0 && !recents.length}><CategoryIcon index={index + 1}/></button>)}
      <button type="button" aria-label="delete" onClick={() => { setQuery([...query].slice(0, -1).join("")); setVariants([]); }}>
        <svg width="26" height="23" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3h15v18H10L2 12Z M13 8l8 8m0-8-8 8"/></svg>
      </button>
    </nav>}
    {variants.length > 0 && <div className="nep-variants" role="group" aria-label="Skin tone variants">
      {variants.map(([emoji, name]) => <button key={emoji} type="button" aria-label={`${emoji} ${name}`} onClick={() => select(emoji)}>{emoji}</button>)}
    </div>}
  </section>;
}
