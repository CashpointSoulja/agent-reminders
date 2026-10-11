import React, { useState, useEffect, useRef } from "react";
import Icon from "./icons";
import "./native-list-sheet.css";
import NativeSmartFilters from "./NativeSmartFilters";
import NativeTemplatePicker from "./NativeTemplatePicker.jsx";
import NativeEmojiPicker from "./NativeEmojiPicker";
import { emojiFromIcon } from "./emoji";

export const LIST_COLORS = [
  ["Red", "#ff3b30"],
  ["Orange", "#ff9500"],
  ["Yellow", "#ffcc00"],
  ["Green", "#19c759"],
  ["Light Blue", "#51aaf2"],
  ["Blue", "#007aff"],
  ["Purple", "#5856d6"],
  ["Pink", "#ea426a"],
  ["Violet", "#c077db"],
  ["Brown", "#9d8563"],
  ["Grey", "#5b6770"],
  ["Rose", "#d9a69f"],
];
// Order follows the supplied native New List reference; all rows confirmed by native iCloud simulator audit.
export const LIST_ICONS = [
  "smiley",
  "list",
  "bookmark",
  "key",
  "gift",
  "cake",
  "graduation",
  "backpack",
  "pencil",
  "document",
  "book",
  "inbox",
  "card",
  "money",
  "weights",
  "running",
  "cutlery",
  "wine",
  "medicine",
  "stethoscope",
  "chair",
  "house",
  "building",
  "bank",
  "tent",
  "monitor",
  "music",
  "note-display",
  "gamecontroller",
  "headphones",
  "leaf",
  "carrot",
  "person",
  "twopeople",
  "family",
  "paw",
  "teddybear",
  "fish",
  "basket",
  "cart",
  "shoppingbag",
  "box",
  "football",
  "baseball",
  "basketball",
  "americanfootball",
  "tennis",
  "train",
  "airplane",
  "sailboat",
  "car",
  "umbrella",
  "sun",
  "moon",
  "droplet",
  "snowflake",
  "flame",
  "briefcase",
  "tools",
  "scissors",
  "compass",
  "braces",
  "lightbulb",
  "speechbubble",
  "exclamation",
  "asterisk",
  "square",
  "circle",
  "triangle",
  "diamond",
  "heart",
  "star",
];

export default function NativeListSheet({
  list,
  templateInfo = false,
  templates = [],
  data = { lists: [], reminders: [] },
  onSave,
  onUseTemplate,
  onClose,
}) {
  const sheet = useRef(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const modal = sheet.current?.closest(".modal");
    const update = () => {
      modal?.style.setProperty(
        "--nls-vh",
        `${viewport?.height || window.innerHeight}px`,
      );
      modal?.style.setProperty("--nls-vtop", `${viewport?.offsetTop || 0}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);
  const [name, setName] = useState(list?.name || "");
  const [color, setColor] = useState(list?.color || "#007aff");
  const [icon, setIcon] = useState(list?.icon || "list");
  const [emojiPicker, setEmojiPicker] = useState(false);
  const [tab, setTab] = useState("new");
  const [typeMenu, setTypeMenu] = useState(false);
  const [type, setType] = useState(list?.type || "standard");
  const [filters, setFilters] = useState(
    list?.filters || { match: "all", rules: [] },
  );
  const [editingFilters, setEditingFilters] = useState(false);
  const [error, setError] = useState("");
  function save(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      onSave({
          name: name.trim(),
          color,
          icon,
          group: list?.group || "",
          type,
          ...(type === "smart" ? { filters } : {}),
        });
    } catch (failure) {
      setError(failure.message);
    }
  }
  if (editingFilters)
    return (
      <NativeSmartFilters
        data={data}
        filters={filters}
        onChange={setFilters}
        onBack={() => setEditingFilters(false)}
      />
    );
  return (
    <form
      ref={sheet}
      className={`native-list-sheet ${list ? "nls-edit" : ""} ${templateInfo ? "nls-template-info" : ""}`}
      onSubmit={save}
      aria-label={templateInfo ? "Template Info" : list ? "List Info" : "New List"}
    >
      <header className="nls-header">
        <button
          className="nls-close"
          type="button"
          aria-label="Cancel"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
        <h2>{templateInfo ? "Template Info" : list ? "List Info" : "New List"}</h2>
        <button
          className="nls-done"
          type="submit"
          aria-label="Done"
          disabled={!name.trim() || tab === "templates"}
        >
          <Icon name="check" size={26} />
        </button>
      </header>
      {!list && (
        <div
          className="nls-segment"
          role="tablist"
          aria-label="New list source"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "new"}
            onClick={() => {
              setTab("new");
              setName("");
            }}
          >
            New List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "templates"}
            onClick={() => {
              setTab("templates");
              setName("");
            }}
          >
            Templates
          </button>
        </div>
      )}
      <div className="nls-scroll">
        {error && <p role="alert">{error}</p>}
        {tab === "templates" ? (
          <NativeTemplatePicker templates={templates} onUse={onUseTemplate} />
        ) : (
          <>
            <section className="nls-hero">
              <div className="nls-glow-icon" style={{ "--list-color": color }}>
                <Icon nativePicker name={icon} size={52} color="white" />
              </div>
              <input
                className="nls-name"
                aria-label={templateInfo ? "Template name" : "List Name"}
                placeholder={templateInfo ? "Template Name" : "List Name"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoComplete="off"
                autoFocus={!list}
                style={templateInfo ? { color } : undefined}
              />
            </section>
            {(
              <>
                {!templateInfo && <div className="nls-type-wrap">
                  <button
                    type="button"
                    className="nls-type"
                    aria-haspopup="menu"
                    aria-expanded={typeMenu}
                    onClick={() => setTypeMenu((v) => !v)}
                  >
                    <span className="nls-type-icon">
                      <Icon nativePicker name="list" color="white" />
                    </span>
                    <span>List Type</span>
                    <span className="nls-type-value">
                      {
                        {
                          standard: "Standard",
                          shopping: "Shopping",
                          smart: "Smart List",
                        }[type]
                      }{" "}
                      <svg aria-hidden="true" className="nls-type-chevron" width="10" height="16" viewBox="0 0 10 16">
                        <path d="M1.5 5.5 5 2l3.5 3.5M1.5 10.5 5 14l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  {typeMenu && (
                    <div
                      className="nls-type-menu"
                      role="menu"
                      aria-label="List Type"
                    >
                      {[
                        ["standard", "Standard"],
                        ["shopping", "Shopping"],
                        ["smart", "Smart List"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={type === value}
                          onClick={() => {
                            setType(value);
                            setTypeMenu(false);
                          }}
                        >
                          {label}
                          {type === value && <Icon name="check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>}
                {!templateInfo && type === "smart" && (
                  <>
                    <button
                      className="nls-type nsf-edit"
                      type="button"
                      onClick={() => setEditingFilters(true)}
                    >
                      <span>Edit Filters</span>
                      <span className="nls-type-value">
                        {filters.rules.length || ""} ›
                      </span>
                    </button>
                    <p className="nsf-footnote">
                      Organise using tags and other filters.
                    </p>
                  </>
                )}
                <section
                  className="nls-grid nls-colors"
                  aria-label="List Colour"
                >
                  {LIST_COLORS.map(([label, value]) => (
                    <button
                      type="button"
                      key={value}
                      className="nls-color"
                      aria-label={label}
                      aria-pressed={color.toLowerCase() === value}
                      onClick={() => setColor(value)}
                    >
                      <span style={{ backgroundColor: value }} />
                    </button>
                  ))}
                </section>
                <section className="nls-grid nls-icons" aria-label="List Icon">
                  {LIST_ICONS.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={`nls-icon ${value === "smiley" ? "nls-smiley" : ""}`}
                      aria-label={`Icon ${value}`}
                      aria-pressed={value === "smiley" ? Boolean(emojiFromIcon(icon)) : icon === value}
                      onClick={() => {
                        if (value === "smiley") {
                          document.activeElement?.blur();
                          setEmojiPicker(true);
                          requestAnimationFrame(() => {
                            const scroller = sheet.current?.querySelector(".nls-scroll");
                            const icons = sheet.current?.querySelector(".nls-icons");
                            if (scroller && icons) scroller.scrollTop += Math.max(0, icons.getBoundingClientRect().top - (sheet.current.getBoundingClientRect().bottom - 385 - 66));
                          });
                        } else { setIcon(value); setEmojiPicker(false); }
                      }}
                    >
                      <span>
                        <Icon nativePicker name={value} size={26} />
                      </span>
                    </button>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </div>
      {emojiPicker && <NativeEmojiPicker onClose={() => setEmojiPicker(false)} onSelect={(emoji) => { setIcon(`emoji:${emoji}`); setEmojiPicker(false); }}/>}
    </form>
  );
}
