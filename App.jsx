import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import Icon from "./src/icons";
import {
  seedData,
  counts,
  selectReminders,
  createReminder,
  completeReminder,
  reopenReminder,
  deleteReminder,
  validateStoredData,
  descendants,
} from "./src/model";
import "./styles.css";
import GestureRow, { SubtaskChevron } from "./src/ReminderGestures";
import { moveReminder } from "./src/motion";
import "./src/motion.css";
import NativeDetails from "./src/NativeDetails";
import { mergeSubtasks } from "./src/subtasks.js";
import { categoriseShopping } from "./src/shopping.js";
import "./src/shopping.css";
import NativeQuickEntry from "./src/NativeQuickEntry";
import TemplateDialog from "./src/TemplateDialog";
import { AgentAssignment } from "./src/AgentSettings.jsx";
import { saveTemplate, useTemplate } from "./src/templates";
import NativeListSheet from "./src/NativeListSheet";
import AccountsSheet from "./src/AccountsSheet.jsx";
import useAccounts from "./src/useAccounts.js";
import "./src/native-details.css";
import "./src/native-parity.css";
const KEY = "reminders-web-v1",
  smart = [
    ["today", "Today", "#007aff", "today"],
    ["scheduled", "Scheduled", "#ff453a", "scheduled"],
    ["all", "All", "#687581", "inbox"],
    ["flagged", "Flagged", "#ff9500", "flag"],
    ["completed", "Completed", "#8e8e93", "check"],
    ["urgent", "Urgent", "#af52de", "urgent"],
  ];
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: seedData(), corrupt: null };
    const data = JSON.parse(raw);
    return validateStoredData(data)
      ? { data, corrupt: null }
      : { data: seedData(), corrupt: raw };
  } catch (e) {
    let raw = "Storage unavailable";
    try {
      raw = localStorage.getItem(KEY) || raw;
    } catch {}
    return { data: seedData(), corrupt: raw };
  }
}
function download(text, name) {
  const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function App({
  initialData,
  incomingData,
  onApiError,
  onDataChange,
  api,
  saveStatus = "",
  agentsEnabled = false,
} = {}) {
  const initial = useRef(null);
  if (!initial.current)
    initial.current = initialData
      ? { data: initialData, corrupt: null }
      : load();
  const [data, setRawData] = useState(initial.current.data),
    [corrupt, setCorrupt] = useState(initial.current.corrupt),
    [storageError, setStorageError] = useState("");
  const { width } = useWindowDimensions(),
    phone = width < 600,
    desktop = width >= 1280;
  const [view, setView] = useState("all"),
    [home, setHome] = useState(true),
    [homeSearch, setHomeSearch] = useState(false),
    [homeEditing, setHomeEditing] = useState(false),
    [selected, setSelected] = useState(null),
    [modal, setModal] = useState(null),
    [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("manual"),
    [group, setGroup] = useState("none"),
    [showCompleted, setShowCompleted] = useState(false),
    [board, setBoard] = useState(false),
    [draft, setDraft] = useState(""),
    [draftNote, setDraftNote] = useState(""),
    [composing, setComposing] = useState(false),
    [composerSection, setComposerSection] = useState(undefined),
    [selecting, setSelecting] = useState(false),
    [selection, setSelection] = useState(new Set()),
    [notice, setNotice] = useState(""),
    [swipe, setSwipe] = useState(null),
    [collapsed, setCollapsed] = useState(new Set()),
    [collapsedSections, setCollapsedSections] = useState(new Set()),
    [editingShoppingSection, setEditingShoppingSection] = useState(null),
    [shoppingSectionName, setShoppingSectionName] = useState(""),
    [cutId, setCutId] = useState(null);
  const composer = useRef(null),
    search = useRef(null),
    pointer = useRef(null),
    list = data.lists.find((l) => l.id === view),
    reminder = data.reminders.find((r) => r.id === selected),
    count = counts(data),
    title = list?.name || smart.find((s) => s[0] === view)?.[1] || "All",
    color = list?.color || smart.find((s) => s[0] === view)?.[2] || "#007aff";
  const rows = selectReminders(data, view, {
    query,
    tag,
    sort,
    group,
    showCompleted,
  });
  function collapsedAncestor(r) {
    let parent = r.parentId;
    while (parent) {
      if (collapsed.has(parent)) return true;
      parent = data.reminders.find((x) => x.id === parent)?.parentId;
    }
    return false;
  }
  function depth(r) {
    let n = 0,
      parent = r.parentId;
    while (parent) {
      n++;
      parent = data.reminders.find((x) => x.id === parent)?.parentId;
    }
    return n;
  }
  function setData(update) {
    setRawData(previous => categoriseShopping(typeof update === "function" ? update(previous) : update, previous));
  }
  const accounts = useAccounts({ enabled: !api && !onDataChange, data, setData, onNotice: setNotice });
  useEffect(() => {
    if (incomingData) setRawData(incomingData);
  }, [incomingData]);
  useEffect(() => {
    if (modal === "agent-assign" && !reminder) {
      setModal(null);
      setNotice("The reminder is no longer available.");
    }
  }, [modal, reminder]);
  useEffect(() => {
    if (corrupt) return;
    if (onDataChange) {
      onDataChange(data);
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      setStorageError("");
    } catch (e) {
      setStorageError(
        "Your changes could not be saved. Export a backup before closing this tab.",
      );
    }
  }, [data, corrupt, onDataChange]);
  function patch(id, values) {
    setData((d) => ({
      ...d,
      reminders: d.reminders.map((r) =>
        r.id === id ? { ...r, ...values } : r,
      ),
    }));
  }
  async function complete(r) {
    if (accounts.enabled && await accounts.completeReminder(r)) return;
    setData((d) =>
      r.completed ? reopenReminder(d, r.id) : completeReminder(d, r.id),
    );
  }
  function contextAction(action, r) {
    setSelected(r.id);
    if (action === "Delete") {
      setData((d) => deleteReminder(d, r.id));
      return;
    }
    if (action === "Mark as Completed" || action === "Mark as Incomplete") {
      complete(r);
      return;
    }
    if (action === "Cut" || action === "Copy") {
      navigator.clipboard
        ?.writeText(r.title)
        .catch(() => setNotice("Clipboard unavailable."));
      if (action === "Cut") setCutId(r.id);
      return;
    }
    if (action === "Tags" || action === "Priority") {
      setModal("detail");
      setTimeout(() => {
        const control = document.querySelector(`[aria-label="${action}"]`);
        control?.focus();
        if (control?.tagName === "BUTTON") control.click();
      }, 40);
    } else if (action === "Assign") setModal("assign");
    else setModal("detail");
  }
  function openView(id) {
    setView(id);
    setHome(false);
    setSelected(null);
    setTag("");
    setSwipe(null);
    setComposing(false);
    setSelecting(false);
    setSelection(new Set());
  }
  function add(continueEntry = false) {
    if (!draft.trim()) return;
    const target =
      (list?.type !== "smart" ? list?.id : null) ||
      data.lists.find((l) => l.type !== "smart")?.id;
    if (!target) {
      setModal("list");
      return;
    }
    const r = {
      ...createReminder(target, draft),
      title: draft.trim(),
      dueDate: null,
      dueTime: null,
      notes: draftNote,
      ...(composerSection !== undefined ? { sectionId: composerSection, shoppingCategoryManual: true } : {}),
    };
    if ((view === "today" || view === "scheduled") && !r.dueDate) {
      const now = new Date();
      r.dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
    if (view === "flagged") r.flagged = true;
    if (view === "urgent") r.urgent = true;
    setData((d) => ({ ...d, reminders: [...d.reminders, r] }));
    setDraft("");
    setDraftNote("");
    const keepEntry = continueEntry && list?.type === "shopping" && phone;
    setComposing(keepEntry);
    if (!keepEntry) setComposerSection(undefined);
    setSelected(keepEntry ? null : r.id);
    if (keepEntry) setTimeout(() => composer.current?.focus(), 20);
    return r;
  }
  function newReminder() {
    setHome(false);
    setSelected(null);
    setComposing(true);
    setComposerSection(undefined);
    setTimeout(() => composer.current?.focus(), 30);
  }
  function addSection() {
    if (!list) {
      setNotice("Open a list to add a section.");
      return;
    }
    if (list.type === "shopping") {
      const id = crypto.randomUUID();
      setData(data => ({ ...data, lists: data.lists.map(item => item.id === list.id ? { ...item, sections: [...item.sections, { id, name: "New Section" }] } : item) }));
      setEditingShoppingSection(id);
      setShoppingSectionName("");
      setModal(null);
    } else setModal("section");
  }
  function saveShoppingSection() {
    const name = shoppingSectionName.trim();
    if (name) setData(data => ({ ...data, lists: data.lists.map(item => item.id === list?.id ? { ...item, sections: item.sections.map(section => section.id === editingShoppingSection ? { ...section, name } : section) } : item) }));
    setEditingShoppingSection(null);
  }
  useEffect(() => {
    function key(e) {
      if (modal === "agent-assign") return;
      if (modal === "accounts") {
        if (e.key === "Escape") { e.preventDefault(); setModal(null); }
        return;
      }
      if (e.key === "Escape") {
        if (["detail", "quick-entry", "templates", "save-template"].includes(modal)) return;
        setModal(null);
        setSelected(null);
        setSwipe(null);
        setComposing(false);
        setDraft("");
        setDraftNote("");
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        if (e.altKey) addSection();
        else if (e.shiftKey) setModal("list");
        else newReminder();
      } else if (k === "f") {
        e.preventDefault();
        if (e.shiftKey && reminder)
          patch(reminder.id, { flagged: !reminder.flagged });
        else search.current?.focus();
      } else if (k === "c" && e.shiftKey && reminder) {
        e.preventDefault();
        complete(reminder);
      } else if (k === "i" && reminder) {
        e.preventDefault();
        setModal("detail");
      } else if (k === "h" && e.shiftKey) {
        e.preventDefault();
        setShowCompleted((x) => !x);
      } else if (k === "u" && e.shiftKey && reminder) {
        e.preventDefault();
        patch(reminder.id, { urgent: !reminder.urgent });
      } else if (k === "]" && reminder) {
        e.preventDefault();
        const previous = data.reminders
          .slice(0, data.reminders.indexOf(reminder))
          .filter(
            (r) =>
              r.listId === reminder.listId && r.parentId === reminder.parentId,
          )
          .at(-1);
        if (previous)
          patch(reminder.id, {
            parentId: previous.id,
            sectionId: previous.sectionId,
          });
      } else if (k === "[" && reminder?.parentId) {
        e.preventDefault();
        patch(reminder.id, {
          parentId:
            data.reminders.find((r) => r.id === reminder.parentId)?.parentId ||
            null,
        });
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!modal || modal === "accounts") return;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const dialog = document.querySelector("[role=dialog]");
      if (!dialog) return;
      const first = dialog?.querySelector(
        'input:not([disabled]),textarea,select,button,[tabindex="0"]',
      );
      first?.focus();
    });
    function trap(e) {
      if (e.key !== "Tab") return;
      const dialog = document.querySelector("[role=dialog]");
      const items = [
        ...dialog.querySelectorAll(
          'input:not([disabled]),textarea,select,button,[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  const button = (label, icon, onPress, extra = {}) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      dataSet={{ ui: "icon-button" }}
      {...extra}
    >
      <Icon name={icon} />
    </Pressable>
  );
  const tags = [...new Set(data.reminders.flatMap((r) => r.tags))];
  const sidebar = (
    <View
      dataSet={{
        ui: "sidebar",
        editing: homeEditing ? "yes" : "no",
        searching: homeSearch ? "yes" : "no",
      }}
    >
      {phone ? (
        <View dataSet={{ ui: "home-toolbar" }}>
          {button("Search", "search", () => {
            setHomeSearch(!homeSearch);
            if (!homeSearch) setTimeout(() => search.current?.focus(), 0);
          })}
          {button("Add List", "plus", () => setModal("list"))}
          {homeEditing
            ? button("Done", "check", () => setHomeEditing(false))
            : button("More", "more", () => setModal("home-menu"))}
        </View>
      ) : (
        <View dataSet={{ ui: "sidebar-heading" }}>
          <Text dataSet={{ ui: "app-name" }}>Reminders</Text>
          {button("More", "more", () => setModal("home-menu"))}
          <Text dataSet={{ ui: "local-label" }}>On this device</Text>
        </View>
      )}
      {(!phone || homeSearch) && (
        <View dataSet={{ ui: "search" }}>
          <Icon name="search" size={17} />
          <input
            aria-label="Search"
            ref={search}
            placeholder="Search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          {phone && (
            <>
              <button
                className="home-dictation"
                aria-label="Dictation"
                disabled
                title="Dictation is not available in this browser build"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4M8 22h8" />
                </svg>
              </button>
              <button
                className="home-search-close"
                aria-label="Close Search"
                onClick={() => {
                  setHomeSearch(false);
                  setQuery("");
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </>
          )}
        </View>
      )}
      <View dataSet={{ ui: "smart-grid" }}>
        {smart.map(([id, name, c, icon]) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={name}
            onPress={() => openView(id)}
            dataSet={{
              ui: "smart-tile",
              active: view === id && (!phone || !home) ? "yes" : "no",
            }}
            style={
              !desktop
                ? { backgroundColor: id === "all" ? "#303033" : c }
                : undefined
            }
          >
            <View dataSet={{ ui: "tile-top" }}>
              <View
                dataSet={{ ui: "tile-icon" }}
                style={{ backgroundColor: c }}
              >
                <Icon name={icon} color="white" />
              </View>
              <Text dataSet={{ ui: "tile-count" }}>{count[id]}</Text>
            </View>
            <Text dataSet={{ ui: "tile-label" }}>{name}</Text>
          </Pressable>
        ))}
      </View>
      <Text dataSet={{ ui: "sidebar-label" }}>My Lists</Text>
      <ScrollView dataSet={{ ui: "lists-scroll" }}>
        {[...new Set(data.lists.map((l) => l.group || ""))].map((g) => (
          <View key={g}>
            {Boolean(g) && <Text dataSet={{ ui: "group-label" }}>{g}</Text>}
            {data.lists
              .filter((l) => (l.group || "") === g)
              .map((l) => (
                <View
                  key={l.id}
                  dataSet={{
                    ui: "list-nav-row",
                    active: view === l.id && (!phone || !home) ? "yes" : "no",
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={l.name}
                    onPress={() => openView(l.id)}
                    dataSet={{ ui: "list-nav" }}
                  >
                    <View
                      dataSet={{ ui: "list-symbol" }}
                      style={{ backgroundColor: l.color }}
                    >
                      <Icon name={l.icon} color="white" size={17} />
                    </View>
                    <Text dataSet={{ ui: "nav-name" }}>{l.name}</Text>
                    <Text dataSet={{ ui: "nav-count" }}>
                      {selectReminders(data, l.id).length}
                    </Text>
                  </Pressable>
                  {button(
                    `Edit ${l.name}`,
                    "more",
                    () => setModal({ type: "list", id: l.id }),
                    { dataSet: { ui: "list-edit" } },
                  )}
                </View>
              ))}
          </View>
        ))}
        {tags.length > 0 && (
          <>
            <Text dataSet={{ ui: "sidebar-label" }}>Tags</Text>
            <View dataSet={{ ui: "tag-cloud" }}>
              {tags.map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter tag ${t}`}
                  onPress={() => {
                    setTag(tag === t ? "" : t);
                    setHome(false);
                    setView("all");
                  }}
                  dataSet={{ ui: "tag-chip", active: tag === t ? "yes" : "no" }}
                >
                  <Text>#{t}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <View dataSet={{ ui: "sidebar-bottom" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={phone ? "New Reminder" : "New List"}
          onPress={
            phone ? () => setModal("quick-entry") : () => setModal("list")
          }
          dataSet={{ ui: "text-button" }}
        >
          <Icon name="plus" size={17} />
          {!phone && <Text>Add List</Text>}
        </Pressable>
      </View>
    </View>
  );

  function dueLabel(r) {
    const date = new Date(`${r.dueDate}T12:00:00`),
      today = new Date();
    const key = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dateText =
      r.dueDate === key(today)
        ? "Today"
        : r.dueDate === key(tomorrow)
          ? "Tomorrow"
          : date.toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
    const time = r.dueTime
      ? new Date(`2000-01-01T${r.dueTime}`).toLocaleTimeString("en-GB", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";
    return dateText + (time ? `, ${time}` : "");
  }
  function row(r) {
    const children = data.reminders.filter((x) => x.parentId === r.id).length;
    return (
      <div
        key={r.id}
        className="subtask-motion"
        data-collapsed={collapsedAncestor(r)}
        aria-hidden={collapsedAncestor(r)}
        inert={collapsedAncestor(r)}
      >
        <div>
          <GestureRow
            reminder={r}
            reminders={data.reminders}
            className={`${selected === r.id ? "selected" : ""} ${r.completed ? "completed" : ""} ${cutId === r.id ? "cut" : ""}`}
            style={{ marginLeft: depth(r) * 28 }}
            onMove={(move) => {
              setData((d) => moveReminder(d, move));
              if (move.parentId)
                setCollapsed((old) => {
                  const next = new Set(old);
                  next.delete(move.parentId);
                  return next;
                });
            }}
            onContextAction={contextAction}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: selecting ? selection.has(r.id) : r.completed,
              }}
              aria-checked={selecting ? selection.has(r.id) : r.completed}
              accessibilityLabel={`${selecting ? "Select" : "Complete"} ${r.title}`}
              onPress={() => {
                if (selecting)
                  setSelection((old) => {
                    const next = new Set(old);
                    next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                    return next;
                  });
                else complete(r);
              }}
              dataSet={{ ui: "checkbox-hit" }}
            >
              <span
                className="checkbox"
                style={{
                  borderColor: (selecting ? selection.has(r.id) : r.completed)
                    ? color
                    : undefined,
                  background: (selecting ? selection.has(r.id) : r.completed)
                    ? color
                    : undefined,
                }}
              >
                {(selecting ? selection.has(r.id) : r.completed) && (
                  <Icon name="check" size={13} color="white" />
                )}
              </span>
            </Pressable>
            {phone && selected === r.id && !selecting ? (
              <div className="inline-edit" data-ui="row-main">
                <input
                  aria-label="Reminder title"
                  defaultValue={r.title}
                  autoFocus
                  onBlur={(e) => {
                    const title = e.target.value.trim();
                    if (title) patch(r.id, { title });
                    else e.target.value = r.title;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                      setSelected(null);
                    }
                  }}
                />
                <textarea
                  aria-label="Reminder notes"
                  placeholder="Add Note"
                  value={r.notes}
                  onChange={(e) => patch(r.id, { notes: e.target.value })}
                  rows={1}
                />
              </div>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select ${r.title}`}
                accessibilityState={{ selected: selection.has(r.id) }}
                onPress={() => {
                  if (selecting)
                    setSelection((old) => {
                      const next = new Set(old);
                      next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                      return next;
                    });
                  else setSelected(r.id);
                }}
                dataSet={{
                  ui: "row-main",
                  selected: selection.has(r.id) ? "yes" : "no",
                }}
              >
                <Text dataSet={{ ui: "row-title" }}>
                  {r.priority !== "none" && (
                    <Text style={{ color }}>
                      {"!".repeat(
                        ["none", "low", "medium", "high"].indexOf(r.priority),
                      )}{" "}
                    </Text>
                  )}
                  {r.title}
                </Text>
                {Boolean(r.notes) && (
                  <Text dataSet={{ ui: "row-note" }} numberOfLines={1}>
                    {r.notes}
                  </Text>
                )}
                <View dataSet={{ ui: "row-meta" }}>
                  {Boolean(r.dueDate) && (
                    <Text style={{ color: "var(--muted)" }}>{dueLabel(r)}</Text>
                  )}
                  {r.recurrence !== "none" && (
                    <Text style={{ color: "var(--muted)" }}>
                      ⇄{" "}
                      {
                        {
                          hourly: "Hourly",
                          daily: "Daily",
                          weekdays: "Weekdays",
                          weekends: "Weekends",
                          weekly: "Weekly",
                          fortnightly: "Fortnightly",
                          monthly: "Monthly",
                          quarterly: "Every 3 Months",
                          halfyearly: "Every 6 Months",
                          yearly: "Yearly",
                        }[r.recurrence]
                      }
                    </Text>
                  )}
                  {r.tags.map((t) => (
                    <Text key={t} style={{ color: "#007aff" }}>
                      #{t}
                    </Text>
                  ))}
                  {Boolean(r.url) && (
                    <a
                      className="reminder-url"
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.url}
                    </a>
                  )}
                  {!list && (
                    <Text>
                      {data.lists.find((l) => l.id === r.listId)?.name}
                    </Text>
                  )}
                </View>
              </Pressable>
            )}
            {children > 0 && (
              <SubtaskChevron
                collapsed={collapsed.has(r.id)}
                count={children}
                onToggle={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                    return next;
                  })
                }
              />
            )}
            {r.urgent && <Icon name="urgent" size={17} color="#af52de" />}
            <div className={`row-actions ${r.flagged ? "flagged" : ""}`}>
              {button(
                `Flag ${r.title}`,
                "flag",
                () => patch(r.id, { flagged: !r.flagged }),
                { style: { color: r.flagged ? "#ff9500" : undefined } },
              )}
              {button(`Details ${r.title}`, "info", () => {
                setSelected(r.id);
                if (!desktop) setModal("detail");
              })}
            </div>
            {swipe === r.id && (
              <div className="swipe-actions">
                {button(`Delete ${r.title}`, "trash", () => {
                  setData((d) => deleteReminder(d, r.id));
                  setSwipe(null);
                })}
                {button(`Swipe flag ${r.title}`, "flag", () => {
                  patch(r.id, { flagged: !r.flagged });
                  setSwipe(null);
                })}
              </div>
            )}
          </GestureRow>
        </div>
      </div>
    );
  }
  const composerForm = (
<form
                  className={`composer ${phone ? "inline-composer" : ""}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    add(true);
                  }}
                  onBlur={(e) => {
                    if (phone && !e.currentTarget.contains(e.relatedTarget)) {
                      if (draft.trim()) add();
                      else {
                        setComposing(false);
                        setDraftNote("");
                      }
                    }
                  }}
                >
                  <span className="checkbox" />
                  <div className="composer-fields">
                    <input
                      aria-label="New reminder title"
                      ref={composer}
                      placeholder={phone ? "" : list?.type === "shopping" ? "New Item" : "New Reminder"}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {phone && (
                      <textarea
                        aria-label="New reminder notes"
                        placeholder="Add Note"
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        rows={1}
                      />
                    )}
                  </div>
                  {phone ? (
                    <button
                      type="button"
                      aria-label="Edit Details"
                      onClick={() => {
                        const r = add();
                        if (r) setModal("detail");
                      }}
                    >
                      <Icon name="info" />
                    </button>
                  ) : (
                    <button type="submit" aria-label="Add Reminder">
                      <Icon name="plus" />
                    </button>
                  )}
                </form>
  );
  const sectionKey = (r) =>
    board || group === "section" || (group === "none" && list?.sections.length)
      ? r.sectionId || ""
      : group === "list"
        ? r.listId
        : group === "date"
          ? r.dueDate || "No Date"
          : group === "priority"
            ? r.priority
            : "";
  const shoppingSections = list?.type === "shopping" && (board || group === "none" || group === "section");
  const buckets = shoppingSections ? [
    ...list.sections.map(section => section.id),
    ...(rows.some(row => !row.sectionId) ? [""] : []),
  ] : [
    ...new Set([
      ...rows.map(sectionKey),
      ...(board ||
      group === "section" ||
      (group === "none" && list?.sections.length)
        ? list?.sections.map((s) => s.id) || []
        : []),
    ]),
  ];
  const headingFor = (k) =>
    list?.sections.find((s) => s.id === k)?.name ||
    data.lists.find((l) => l.id === k)?.name ||
    k ||
    (shoppingSections ? "Others" : "Reminders");
  async function saveDetail(draft, { deletedAttachments = [], subtasks } = {}) {
    const original = data.reminders.find((r) => r.id === draft.id);
    const moved = original?.listId !== draft.listId;
    const descendants = new Set([draft.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of data.reminders)
        if (descendants.has(r.parentId) && !descendants.has(r.id)) {
          descendants.add(r.id);
          changed = true;
        }
    }
    const candidate = categoriseShopping({
      ...data,
      reminders: (subtasks ? mergeSubtasks(data.reminders, moved ? { ...draft, sectionId: null } : draft, subtasks) : data.reminders).map((r) =>
        r.id === draft.id
          ? { ...draft, ...(moved ? { parentId: null, sectionId: null } : {}) }
          : moved && descendants.has(r.id)
            ? { ...r, listId: draft.listId, sectionId: null }
            : r,
      ),
    }, data);
    if (api) {
      await api.saveData(candidate);
      for (const attachment of deletedAttachments)
        await api.deleteAttachment(attachment.id || attachment);
      setRawData(api.snapshot.data);
    } else setRawData(candidate);
    setModal(null);
    setSelected(null);
  }
  async function cancelDetail({ addedAttachments = [] } = {}) {
    setModal(null);
    if (desktop) setSelected(null);
    if (api) {
      try {
        for (const attachment of addedAttachments)
          await api.deleteAttachment(attachment.id || attachment);
        if (addedAttachments.length) setData(api.snapshot.data);
      } catch (error) {
        setNotice(error.message);
      }
    }
  }
  const detail = reminder ? (
    <NativeDetails
      key={reminder.id}
      reminder={reminder}
      lists={data.lists}
      existingTags={tags}
      subtasks={data.reminders.filter((r) => r.parentId === reminder.id)}
      onSave={saveDetail}
      onCancel={cancelDetail}
      onUpload={
        api
          ? async (file) => {
              await api.saveData(data);
              const result = await api.uploadAttachment(reminder.id, file);
              setData(result.data);
              return result.attachment;
            }
          : undefined
      }
    />
  ) : (
    <View dataSet={{ ui: "detail-empty" }}>
      <Icon name="info" size={35} />
      <Text>Select a reminder</Text>
    </View>
  );
  return (
    <View dataSet={{ ui: "app" }}>
      {Boolean(corrupt || storageError) && (
        <View dataSet={{ ui: "recovery" }}>
          <Text>
            {corrupt
              ? "Saved data could not be read. The original is preserved; this is a temporary demo."
              : storageError}
          </Text>
          <button
            onClick={() =>
              download(corrupt || JSON.stringify(data), "reminders-backup.json")
            }
          >
            Export backup
          </button>
          {corrupt && (
            <button
              onClick={() => {
                if (
                  confirm(
                    "Reset saved reminders? Export your original backup first.",
                  )
                )
                  setCorrupt(null);
              }}
            >
              Reset saved data
            </button>
          )}
        </View>
      )}
      {Boolean(notice) && (
        <Pressable onPress={() => setNotice("")} dataSet={{ ui: "notice" }}>
          <Text>{notice} · Dismiss</Text>
        </Pressable>
      )}
      <View dataSet={{ ui: "workspace" }}>
        {(!phone || home) && sidebar}
        {(!phone || !home) && (
          <View dataSet={{ ui: "main" }}>
            <View dataSet={{ ui: "toolbar" }}>
              <View dataSet={{ ui: "toolbar-left" }}>
                {phone &&
                  button("Lists", "back", () => {
                    setHome(true);
                    setSelected(null);
                  })}
                <Text dataSet={{ ui: "toolbar-caption" }}>Reminders</Text>
              </View>
              <View dataSet={{ ui: "toolbar-pill" }}>
                {(!phone || list?.type === "shopping") && button("Share", "share", () => setModal("share"))}
                {selecting && phone ? (
                  <button
                    className="selection-done"
                    onClick={() => {
                      setSelecting(false);
                      setSelection(new Set());
                    }}
                  >
                    Done
                  </button>
                ) : (
                  button("View options", "more", () =>
                    setModal(phone ? "list-menu" : "options"),
                  )
                )}
                {!phone && button("New Reminder", "plus", newReminder)}
              </View>
              {phone && list?.type === "shopping" && composing && <button className="shopping-entry-done" aria-label="Done adding items" onClick={() => { if (draft.trim()) add(); else { setComposing(false); setComposerSection(undefined); } }}><Icon name="check" size={22} color="white" /></button>}
              {!phone && (
                <View dataSet={{ ui: "toolbar-search" }}>
                  <Icon name="search" size={16} />
                  <input
                    aria-label="Search reminders"
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </View>
              )}
            </View>
            <View dataSet={{ ui: "main-heading", shopping: list?.type === "shopping" ? "yes" : "no" }}>
              <Text dataSet={{ ui: "main-title" }} style={{ color }}>
                {query ? "Search Results" : title}
              </Text>
              <Text dataSet={{ ui: "main-count" }} style={{ color }}>
                {view === "completed"
                  ? rows.length
                  : rows.filter((r) => !r.completed).length}
              </Text>
            </View>
            {data.reminders.some(
              (r) => r.completed && (!list || r.listId === list.id),
            ) && (
              <View dataSet={{ ui: "completed-bar" }}>
                <Text>
                  {
                    data.reminders.filter(
                      (r) => r.completed && (!list || r.listId === view),
                    ).length
                  }{" "}
                  Completed{tag ? ` · #${tag}` : ""}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show completed"
                  onPress={() => setShowCompleted((x) => !x)}
                >
                  <Text style={{ color: "#007aff" }}>
                    {showCompleted ? "Hide" : "Show"}
                  </Text>
                </Pressable>
              </View>
            )}
            <ScrollView dataSet={{ ui: "reminders-scroll" }}>
              <div className={board ? "board" : "rows"}>
                {buckets.map((k) => (
                  <section key={k} className={`${board ? "board-column" : ""} ${shoppingSections ? "shopping-section" : ""}`} data-shopping-section={shoppingSections ? k || "others" : undefined}>
                    {(board ||
                      group !== "none" ||
                      list?.sections.length > 0 || shoppingSections) && (shoppingSections ? (editingShoppingSection === k ? <input className="shopping-section-heading shopping-section-name" autoFocus aria-label="Section name" placeholder="New Section" maxLength={200} value={shoppingSectionName} onChange={event => setShoppingSectionName(event.target.value)} onBlur={saveShoppingSection} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); saveShoppingSection(); } if (event.key === "Escape") { event.stopPropagation(); setEditingShoppingSection(null); } }} /> : <button className="shopping-section-heading" aria-expanded={!collapsedSections.has(`${view}:${k}`)} onContextMenu={event => { if (!k) return; event.preventDefault(); setEditingShoppingSection(k); setShoppingSectionName(headingFor(k)); }} onClick={() => setCollapsedSections(previous => { const next = new Set(previous), key = `${view}:${k}`; next.has(key) ? next.delete(key) : next.add(key); return next; })}><span>{headingFor(k)}</span><span className="shopping-section-chevron" data-collapsed={collapsedSections.has(`${view}:${k}`)} aria-hidden="true" /></button>) : <h3>{headingFor(k)}</h3>)}
                    {shoppingSections ? <div className="shopping-section-rows" hidden={collapsedSections.has(`${view}:${k}`)}>{rows.filter((r) => sectionKey(r) === k).map(row)}{composing && composerSection === (k || null) ? composerForm : <button className="shopping-section-add" aria-label={`New item${k ? ` in ${headingFor(k)}` : ""}`} onClick={() => { setSelected(null); setDraft(""); setDraftNote(""); setComposing(true); setComposerSection(k || null); setTimeout(() => composer.current?.focus(), 20); }}><span className="checkbox" /></button>}</div> : rows.filter((r) => sectionKey(r) === k).map(row)}
                  </section>
                ))}
              </div>
              {rows.length === 0 && !composing && !(shoppingSections && list.sections.length) && (
                <View dataSet={{ ui: "empty", shopping: list?.type === "shopping" ? "yes" : "no" }}>
                  {list?.type === "shopping" && <Icon name="carrot" size={64} nativePicker color="var(--muted)" />}
                  <Text>
                    {query
                      ? "No Results"
                        : list?.type === "shopping" ? "Add Shopping Items" : view === "completed"
                        ? "No Completed Reminders"
                        : data.reminders.some(
                              (r) =>
                                r.completed && (!list || r.listId === list.id),
                            )
                          ? "All Reminders Completed"
                          : "No Reminders"}
                  </Text>
                  {list?.type === "shopping" && <Text dataSet={{ ui: "shopping-empty-note" }}>Items added to this list are automatically categorised into sections.</Text>}
                </View>
              )}
              {(!phone || composing) && (!shoppingSections || composerSection === undefined) && composerForm}
            </ScrollView>
            {phone && (
              <button
                className="floating-add"
                aria-label={list?.type === "shopping" ? "New Item" : "New Reminder"}
                onClick={newReminder}
              >
                <Icon name="plus" size={28} />
              </button>
            )}
          </View>
        )}
        {desktop && (
          <ScrollView dataSet={{ ui: "details-pane" }}>{detail}</ScrollView>
        )}
      </View>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !["detail", "templates", "save-template", "agent-assign"].includes(modal))
              setModal(null);
          }}
        >
          <div
            className={`modal ${modal === "accounts" ? "native-accounts-modal" : ""} ${modal === "detail" ? "detail-modal" : ""} ${modal === "quick-entry" ? "native-quick-entry-modal" : ""} ${modal === "agent-assign" || modal === "list" || (typeof modal === "object" && modal.type === "list") ? "native-list-modal" : ""} ${["save-template", "templates"].includes(modal) ? "native-template-modal" : ""} ${phone && ["home-menu", "list-menu", "sort-menu"].includes(modal) ? "native-list-menu" : ""}`}
            role={
              ["accounts", "detail", "quick-entry", "list", "save-template", "templates"].includes(modal) || (typeof modal === "object" && modal.type === "list") ? undefined : "dialog"
            }
            aria-modal={
              ["accounts", "detail", "quick-entry", "list", "save-template", "templates"].includes(modal) || (typeof modal === "object" && modal.type === "list") ? undefined : "true"
            }
            aria-label={
              modal === "detail"
                ? "Reminder details"
                : typeof modal === "object"
                  ? "Edit list"
                  : `${modal} dialog`
            }
          >
            {modal === "accounts" && accounts.enabled ? (
              <AccountsSheet accounts={accounts} onClose={() => setModal(null)} />
            ) : modal === "detail" ? (
              detail
            ) : modal === "quick-entry" ? (
              <NativeQuickEntry
                lists={data.lists}
                existingTags={tags}
                onCancel={() => setModal(null)}
                onSave={async (draft, files, { subtasks = [] } = {}) => {
                  if (!api && files.length)
                    throw new Error(
                      "Photo uploads require a connected server.",
                    );
                  const current = api?.snapshot?.data || data;
                  const existing = current.reminders.find(
                    (r) => r.id === draft.id,
                  );
                  const candidate = {
                    ...current,
                    reminders: [
                      ...current.reminders.filter((r) => r.id !== draft.id),
                      {
                        ...draft,
                        attachments: existing?.attachments || draft.attachments,
                      },
                    ],
                  };
                  candidate.reminders = mergeSubtasks(candidate.reminders, draft, subtasks);
                  const categorised = categoriseShopping(candidate, current);
                  if (api) {
                    await api.saveData(categorised);
                    setRawData(api.snapshot.data);
                    for (const item of files) {
                      if (item.uploaded) continue;
                      await api.uploadAttachment(draft.id, item.file);
                      item.uploaded = true;
                      setRawData(api.snapshot.data);
                    }
                  } else setRawData(categorised);
                  setModal(null);
                }}
              />
            ) : modal === "list" ||
              (typeof modal === "object" && modal.type === "list") ? (
              <NativeListSheet
                key={typeof modal === "object" ? modal.id : "new"}
                list={
                  typeof modal === "object"
                    ? data.lists.find((l) => l.id === modal.id)
                    : null
                }
                templates={data.templates || []}
                data={data}
                onClose={() => setModal(null)}
                onSave={(values) => {
                  if (typeof modal === "object") {
                    setData((d) => ({
                      ...d,
                      lists: d.lists.map((l) =>
                        l.id === modal.id ? { ...l, ...values } : l,
                      ),
                    }));
                  } else {
                    const id = crypto.randomUUID();
                    setData((d) => ({
                      ...d,
                      lists: [...d.lists, { id, ...values, sections: [] }],
                    }));
                    openView(id);
                  }
                  setModal(null);
                }}
                onUseTemplate={async (id, name) => {
                  if (api && JSON.stringify(data) !== JSON.stringify(api.snapshot?.data)) await api.saveData(data);
                  const result = api ? await api.useTemplate(id, name) : useTemplate(data, id, name);
                  setData(result.data);
                  openView(result.listId);
                  setModal(null);
                }}
              />
            ) : modal === "agent-assign" && api && reminder ? (
              <AgentAssignment reminder={reminder} api={api} subtaskCount={descendants(data.reminders, reminder.id).size - 1} onBeforeAssign={async () => { if (JSON.stringify(data) !== JSON.stringify(api.snapshot?.data)) await api.saveData(data); }} onClose={() => setModal(null)} onAssigned={result => { setData(result.data); setModal(null); setNotice("Agent assignment updated."); }} />
            ) : ["save-template", "templates"].includes(modal) ? (
              <TemplateDialog
                key={modal}
                mode={modal}
                list={list}
                templates={data.templates || []}
                data={data}
                api={api}
                onApiError={onApiError}
                onReorder={ids => setData(d => ({ ...d, templates: ids.map(id => d.templates.find(template => template.id === id)) }))}
                onShareAction={async (id, method, options, editedTemplate) => {
                  if (!api) throw new Error("Connect to the server to share templates.");
                  try {
                    return await api.templateShare(id, method, options, editedTemplate);
                  } catch (error) { if (error.status === 401) onApiError?.(error); throw error; }
                }}
                onClose={() => setModal(null)}
                onSave={async (name, include) => {
                  if (api && JSON.stringify(data) !== JSON.stringify(api.snapshot?.data)) await api.saveData(data);
                  const saved = api ? (await api.saveTemplate(list.id, name, include)).data : saveTemplate(data, list.id, name, include);
                  setData(saved);
                  setModal(null);
                }}
                onUse={async (id, name, editedTemplate, deletedAttachmentIds = []) => {
                  const current = editedTemplate ? { ...data, templates: data.templates.map(t => t.id === id ? editedTemplate : t) } : data;
                  if (!validateStoredData(current)) throw new Error("Invalid template details");
                  if (api && JSON.stringify(data) !== JSON.stringify(api.snapshot?.data)) await api.saveData(data);
                  const result = api ? await api.useTemplate(id, name, editedTemplate, deletedAttachmentIds) : useTemplate(current, id, name);
                  setData(result.data);
                  openView(result.listId);
                  setModal(null);
                }}
                onUpdate={async (template, deletedAttachmentIds = []) => {
                  const candidate = {
                    ...data,
                    templates: data.templates.map((t) =>
                      t.id === template.id ? template : t,
                    ),
                  };
                  if (!validateStoredData(candidate))
                    throw new Error("Invalid template details");
                  if (api) {
                    if (JSON.stringify(data) !== JSON.stringify(api.snapshot?.data)) await api.saveData(data);
                    const saved = await api.updateTemplate(template, deletedAttachmentIds);
                    setData(saved.data);
                    return saved.data.templates.find(t => t.id === template.id);
                  }
                  setData(candidate);
                  return template;
                }}
                onDelete={(id) =>
                  setData((d) => ({
                    ...d,
                    templates: d.templates.filter((t) => t.id !== id),
                  }))
                }
              />
            ) : modal === "home-menu" ? (
              <div role="menu" aria-label="Home actions">
                <button
                  role="menuitem"
                  onClick={() => {
                    setHomeEditing(true);
                    setModal(null);
                  }}
                >
                  Edit Lists
                </button>
                <button role="menuitem" onClick={() => setModal("templates")}>
                  Templates
                </button>
                {accounts.enabled && <button role="menuitem" onClick={() => { accounts.clearMessages(); setModal("accounts"); }}>Accounts</button>}
              </div>
            ) : modal === "list-menu" ? (
              <div role="menu" aria-label="List actions">
                {list?.type === "shopping" && <button role="menuitem" onClick={() => { setBoard(value => !value); setModal(null); }}>{board ? "View as List" : "View as Columns"}</button>}
                {list && (
                  <button
                    role="menuitem"
                    onClick={() => setModal("save-template")}
                  >
                    Save as Template
                  </button>
                )}
                <button role="menuitem" onClick={() => setModal("templates")}>
                  Templates
                </button>
                {list && (
                  <button
                    role="menuitem"
                    onClick={() => setModal({ type: "list", id: list.id })}
                  >
                    Show List Info <Icon name="info" />
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setSelecting(true);
                    setSelected(null);
                    setModal(null);
                  }}
                >
                  {list?.type === "shopping" ? "Select Items" : "Select Reminders"} <Icon name="check" />
                </button>
                {list?.type === "shopping" && <button role="menuitem" onClick={addSection}>New Section</button>}
                <button role="menuitem" onClick={() => setModal("sort-menu")}>
                  Sort By <span aria-hidden="true">›</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowCompleted((x) => !x);
                    setModal(null);
                  }}
                >
                  {showCompleted ? "Hide Completed" : "Show Completed"}
                  <Icon name="check" />
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setModal(null);
                    setTimeout(() => window.print(), 0);
                  }}
                >
                  Print <Icon name="share" />
                </button>
                {list && (
                  <button
                    role="menuitem"
                    className="destructive"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete “${list.name}”? All reminders in this list will be deleted.`,
                        )
                      ) {
                        setData((d) => ({
                          ...d,
                          lists: d.lists.filter((l) => l.id !== list.id),
                          reminders: d.reminders.filter(
                            (r) => r.listId !== list.id,
                          ),
                        }));
                        openView("all");
                        setModal(null);
                      }
                    }}
                  >
                    Delete List <Icon name="trash" />
                  </button>
                )}
              </div>
            ) : modal === "sort-menu" ? (
              <div role="menu" aria-label="Sort By">
                {[
                  ["manual", "Manual"],
                  ["dueDate", "Deadline"],
                  ["createdAt", "Creation Date"],
                  ["priority", "Priority"],
                  ["title", "Title"],
                ].map(([value, name]) => (
                  <button
                    role="menuitemradio"
                    aria-checked={sort === value}
                    key={value}
                    onClick={() => {
                      setSort(value);
                      setModal(null);
                    }}
                  >
                    {name}
                    {sort === value && <Icon name="check" />}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <h2>
                    {modal === "share"
                      ? "Share List"
                      : modal === "options"
                        ? "View Options"
                        : modal === "section"
                          ? "New Section"
                          : typeof modal === "object"
                            ? "List Details"
                            : "New List"}
                  </h2>
                  <button onClick={() => setModal(null)}>Done</button>
                </div>
                {modal === "assign" ? (
                  <div className="assign-menu">
                    <p>Assign Reminder</p>
                    {agentsEnabled && <button className="action-button" onClick={() => setModal('agent-assign')}>Assign to Agent…</button>}
                    {[
                      [null, "Nobody"],
                      ["owner", "Me"],
                    ].map(([value, label]) => (
                      <button
                        key={label}
                        className="action-button"
                        onClick={() => {
                          patch(reminder.id, { assignedTo: value });
                          setModal(null);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : modal === "share" ? (
                  <>
                    <p>
                      Local sharing · Export or copy the visible reminders.
                      iCloud invitations and live collaboration are unavailable.
                    </p>
                    <button
                      className="action-button"
                      onClick={() => {
                        const ids = new Set(rows.map((r) => r.id));
                        download(
                          JSON.stringify(
                            {
                              lists: data.lists.filter((l) =>
                                rows.some((r) => r.listId === l.id),
                              ),
                              reminders: rows.map((r) => ({
                                ...r,
                                parentId: ids.has(r.parentId)
                                  ? r.parentId
                                  : null,
                              })),
                            },
                            null,
                            2,
                          ),
                          "reminders.json",
                        );
                      }}
                    >
                      Export JSON
                    </button>
                    <button
                      className="action-button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            rows
                              .map(
                                (r) => `${r.completed ? "✓" : "○"} ${r.title}`,
                              )
                              .join("\n"),
                          );
                          setNotice("Copied to clipboard");
                          setModal(null);
                        } catch (e) {
                          setNotice("Clipboard unavailable. Use Export JSON.");
                        }
                      }}
                    >
                      Copy Text
                    </button>
                    {navigator.share && (
                      <button
                        className="action-button"
                        onClick={async () => {
                          try {
                            await navigator.share({
                              title,
                              text: rows.map((r) => r.title).join("\n"),
                            });
                          } catch (e) {
                            if (e.name !== "AbortError")
                              setNotice(
                                "Sharing unavailable. Use Export JSON.",
                              );
                          }
                        }}
                      >
                        Share…
                      </button>
                    )}
                  </>
                ) : modal === "options" ? (
                  <>
                    <button
                      className="action-button"
                      onClick={() => {
                        setModal(null);
                        setTimeout(() => window.print(), 0);
                      }}
                    >
                      Print
                    </button>
                    {list && (
                      <button
                        className="action-button"
                        onClick={() => setModal("save-template")}
                      >
                        Save as Template
                      </button>
                    )}
                    <button
                      className="action-button"
                      onClick={() => setModal("templates")}
                    >
                      Templates
                    </button>
                    <label>
                      Sort By
                      <select
                        aria-label="Sort By"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        {[
                          ["manual", "Manual"],
                          ["title", "Title"],
                          ["dueDate", "Due Date"],
                          ["priority", "Priority"],
                          ["createdAt", "Creation Date"],
                        ].map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Group By
                      <select
                        aria-label="Group By"
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                      >
                        {["none", "list", "date", "priority", "section"].map(
                          (v) => (
                            <option key={v}>{v}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <button
                      className="action-button"
                      onClick={() => setBoard((x) => !x)}
                    >
                      {board ? "View as List" : "View as Columns"}
                    </button>
                    <button className="action-button" onClick={addSection}>
                      New Section
                    </button>
                    {list && (
                      <button
                        className="action-button"
                        onClick={() => setModal({ type: "list", id: list.id })}
                      >
                        List Details
                      </button>
                    )}
                  </>
                ) : modal === "section" ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = e.currentTarget.elements.name.value.trim();
                      if (name && list) {
                        setData((d) => ({
                          ...d,
                          lists: d.lists.map((l) =>
                            l.id === list.id
                              ? {
                                  ...l,
                                  sections: [
                                    ...l.sections,
                                    { id: crypto.randomUUID(), name },
                                  ],
                                }
                              : l,
                          ),
                        }));
                        setGroup("section");
                        setModal(null);
                      }
                    }}
                  >
                    <label>
                      Name
                      <input
                        name="name"
                        aria-label="Section name"
                        required
                        autoFocus
                      />
                    </label>
                    <button className="action-button">Add Section</button>
                  </form>
                ) : (
                  <form
                    key={typeof modal === "object" ? modal.id : "new"}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fields = e.currentTarget.elements,
                        name = fields.name.value.trim();
                      if (!name) return;
                      const values = {
                        name,
                        color: fields.color.value,
                        icon: fields.icon.value,
                        group: fields.group.value.trim(),
                      };
                      if (typeof modal === "object")
                        setData((d) => ({
                          ...d,
                          lists: d.lists.map((l) =>
                            l.id === modal.id ? { ...l, ...values } : l,
                          ),
                        }));
                      else {
                        const id = crypto.randomUUID();
                        setData((d) => ({
                          ...d,
                          lists: [...d.lists, { id, ...values, sections: [] }],
                        }));
                        openView(id);
                      }
                      setModal(null);
                    }}
                  >
                    <label>
                      Name
                      <input
                        name="name"
                        aria-label="List name"
                        required
                        autoFocus
                        defaultValue={
                          data.lists.find((l) => l.id === modal.id)?.name || ""
                        }
                      />
                    </label>
                    <label>
                      Colour
                      <input
                        name="color"
                        aria-label="List color"
                        type="color"
                        defaultValue={
                          data.lists.find((l) => l.id === modal.id)?.color ||
                          "#007aff"
                        }
                      />
                    </label>
                    <label>
                      Icon
                      <select
                        name="icon"
                        aria-label="List icon"
                        defaultValue={
                          data.lists.find((l) => l.id === modal.id)?.icon ||
                          "list"
                        }
                      >
                        {[
                          "list",
                          "briefcase",
                          "person",
                          "cart",
                          "flag",
                          "today",
                        ].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Group
                      <input
                        name="group"
                        aria-label="List group"
                        placeholder="Optional"
                        defaultValue={
                          data.lists.find((l) => l.id === modal.id)?.group || ""
                        }
                      />
                    </label>
                    <button className="action-button">
                      {typeof modal === "object" ? "Save Changes" : "Add List"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </View>
  );
}
