import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { previousSibling, subtreeIds, rowDropZone, rowDropChange } from "./motion.js";

export default function GestureRow({
  reminder,
  reminders,
  children,
  onMove,
  onContextAction,
  allowNesting = true,
  contextActions,
  className = "",
  style,
  ...props
}) {
  const row = useRef(null),
    pending = useRef(null),
    target = useRef(null),
    suppressClick = useRef(false);
  const [ghost, setGhost] = useState(null),
    [menu, setMenu] = useState(null),
    [announcement, setAnnouncement] = useState("");
  const prior = previousSibling(reminders, reminder);
  const cleanup = () => {
    const previous = pending.current;
    clearTimeout(previous?.timer);
    pending.current = null;
    if (previous?.active) {
      suppressClick.current = true;
      if (row.current?.hasPointerCapture(previous.pointerId))
        row.current.releasePointerCapture(previous.pointerId);
    }
    pending.current = null;
    target.current?.removeAttribute("data-drop-target");
    target.current = null;
    row.current?.removeAttribute("data-dragging");
    row.current?.removeAttribute("data-drag-mode");
    setGhost(null);
  };
  useEffect(() => {
    // Pointer capture alone cannot stop Safari taking over an active touch scroll.
    const touchMove = (event) => {
      if (pending.current?.active) event.preventDefault();
    };
    const cancel = () => cleanup();
    document.addEventListener("touchmove", touchMove, { passive: false });
    window.addEventListener("blur", cancel);
    return () => {
      clearTimeout(pending.current?.timer);
      target.current?.removeAttribute("data-drop-target");
      document.removeEventListener("touchmove", touchMove);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event) => {
      if (!event.target.closest?.("[data-reminder-menu]")) setMenu(null);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
        row.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  function start(event) {
    if (
      event.button !== 0 ||
      event.target.closest(
        'input,textarea,select,a,button:not([data-ui="row-main"]),[role="checkbox"],[data-ui="subtask-toggle"],.row-actions',
      )
    )
      return;
    suppressClick.current = false;
    const rect = row.current.getBoundingClientRect();
    pending.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.x,
      offsetY: event.clientY - rect.y,
      rect,
      active: false,
    };
    // shortcut: hold and spring values approximate the observed gesture; calibrate against an owner recording.
    pending.current.timer = setTimeout(() => {
      const p = pending.current;
      if (!p) return;
      p.active = true;
      row.current.setPointerCapture(p.pointerId);
      row.current.dataset.dragging = "true";
      setGhost({ x: p.x - p.offsetX, y: p.y - p.offsetY, width: p.rect.width, height: p.rect.height });
      setAnnouncement(
        allowNesting ? `Moving ${reminder.title}. Drop on a reminder to make a subtask; move left to remove its parent.` : `Moving ${reminder.title}. Drop between items to reorder.`,
      );
    }, 380);
  }
  function move(event) {
    const p = pending.current;
    if (!p || p.pointerId !== event.pointerId) return;
    if (!p.active) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > 10) cleanup();
      return;
    }
    event.preventDefault();
    p.moved ||= Math.hypot(event.clientX - p.x, event.clientY - p.y) > 6;
    setGhost({
      x: event.clientX - p.offsetX,
      y: event.clientY - p.offsetY,
      width: p.rect.width,
      height: p.rect.height,
    });
    target.current?.removeAttribute("data-drop-target");
    target.current = null;
    const candidate = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-reminder-id]");
    const item = reminders.find((r) => r.id === candidate?.dataset.reminderId);
    if (
      item &&
      item.listId === reminder.listId &&
      !subtreeIds(reminders, reminder.id).has(item.id)
    ) {
      target.current = candidate;
      const bounds = candidate.getBoundingClientRect();
      const zone = rowDropZone(event.clientY, bounds);
      candidate.dataset.dropTarget = !allowNesting && zone === "nest" ? event.clientY < bounds.y + bounds.height / 2 ? "before" : "after" : zone;
    }
    row.current.dataset.dragMode =
      reminder.parentId && event.clientX < p.x - 40 ? "outdent" : "move";
  }
  function finish(event) {
    const p = pending.current;
    if (!p || p.pointerId !== event.pointerId) return;
    if (p.active && !p.moved) {
      context(event);
      return;
    }
    if (p.active) {
      let change;
      if (reminder.parentId && event.clientX < p.x - 40)
        change = { id: reminder.id, parentId: null };
      else if (target.current) {
        const item = reminders.find(
          (r) => r.id === target.current.dataset.reminderId,
        );
        change = rowDropChange(reminders, reminder.id, item.id, target.current.dataset.dropTarget);
      } else {
        const rows = [...document.querySelectorAll("[data-reminder-id]")];
        const before = rows.find((el) => {
          const r = reminders.find((r) => r.id === el.dataset.reminderId);
          return (
            r?.listId === reminder.listId &&
            r.parentId === reminder.parentId &&
            !subtreeIds(reminders, reminder.id).has(r.id) &&
            el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2 > event.clientY
          );
        });
        change = {
          id: reminder.id,
          parentId: reminder.parentId,
          beforeId: before?.dataset.reminderId || null,
        };
      }
      if (change) {
        onMove(change);
        setAnnouncement(`Moved ${reminder.title}.`);
      }
    }
    cleanup();
  }
  function context(event) {
    event.preventDefault();
    cleanup();
    const bounds = row.current.getBoundingClientRect();
    setMenu({
      x: Math.min(
        event.clientX || bounds.x + 25,
        Math.max(0, innerWidth - 235),
      ),
      y: Math.min(event.clientY || bounds.y, Math.max(0, innerHeight - 360)),
    });
  }
  function action(label) {
    if (label === "Indent Reminder" && prior)
      onMove({ id: reminder.id, parentId: prior.id });
    else if (label === "Outdent Reminder" && reminder.parentId)
      onMove({ id: reminder.id, parentId: null });
    else onContextAction?.(label, reminder);
    setMenu(null);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-reminder-id="${CSS.escape(reminder.id)}"]`)
        ?.focus(),
    );
  }
  function keyboard(event) {
    if (event.target.closest("input,textarea,select")) return;
    if (event.key === "F10" && event.shiftKey) {
      event.stopPropagation();
      context(event);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
      event.preventDefault();
      event.stopPropagation();
      action("Cut");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "]" && prior) {
      event.preventDefault();
      event.stopPropagation();
      action("Indent Reminder");
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "[" &&
      reminder.parentId
    ) {
      event.preventDefault();
      event.stopPropagation();
      action("Outdent Reminder");
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      ["ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const siblings = reminders.filter(
          (r) =>
            r.listId === reminder.listId && r.parentId === reminder.parentId,
        ),
        index = siblings.findIndex((r) => r.id === reminder.id);
      if (event.key === "ArrowUp" && index > 0)
        onMove({
          id: reminder.id,
          parentId: reminder.parentId,
          beforeId: siblings[index - 1].id,
        });
      if (event.key === "ArrowDown" && index < siblings.length - 1)
        onMove({
          id: reminder.id,
          parentId: reminder.parentId,
          beforeId: siblings[index + 2]?.id || null,
        });
    }
  }
  return (
    <>
      <div
        {...props}
        ref={row}
        className={`reminder-row ${className.replace(/\breminder-row\b/g, "")}`}
        style={style}
        data-reminder-id={reminder.id}
        data-parent-id={reminder.parentId || ""}
        tabIndex={0}
        role="group"
        aria-label={`Reminder ${reminder.title}`}
        aria-description="Long press to move. Use Control or Command plus brackets to indent or outdent, and arrow keys to reorder. Shift F10 opens actions."
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cleanup}
        onLostPointerCapture={() => {
          if (pending.current) cleanup();
        }}
        onContextMenu={(event) => {
          if (pending.current?.active) event.preventDefault();
          else context(event);
        }}
        onKeyDown={keyboard}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {children}
        <span className="motion-sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
      </div>
      {ghost &&
        createPortal(
          <div
            className="reminder-drag-ghost"
            style={{ left: ghost.x, top: ghost.y, width: ghost.width, minHeight: ghost.height }}
            aria-hidden="true"
          >
            {children}
          </div>,
          row.current?.closest(".server-root") || document.body,
        )}
      {menu &&
        createPortal(
          <div
            data-reminder-menu
            className="reminder-context-menu"
            role="menu"
            aria-label={`Actions for ${reminder.title}`}
            style={{ left: menu.x, top: menu.y }}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const buttons = [
                    ...event.currentTarget.querySelectorAll(
                      "button:not(:disabled)",
                    ),
                  ],
                  i = buttons.indexOf(document.activeElement);
                buttons[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (i +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ]?.focus();
              }
            }}
          >
            {(contextActions || [
              reminder.completed ? "Mark as Incomplete" : "Mark as Completed",
              "Indent Reminder",
              ...(reminder.parentId ? ["Outdent Reminder"] : []),
              "Tags",
              "Assign",
              "Priority",
              "Cut",
              "Details",
              "Delete",
            ]).map((label, i) => (
              <button
                key={label}
                role="menuitem"
                autoFocus={i === 0}
                disabled={label === "Indent Reminder" && !prior}
                onClick={() => action(label)}
              >
                {label}
              </button>
            ))}
          </div>,
          row.current?.closest(".server-root") || document.body,
        )}
    </>
  );
}

export function SubtaskChevron({ collapsed, count, onToggle }) {
  return (
    <button
      type="button"
      className="subtask-chevron"
      data-ui="subtask-toggle"
      aria-label={`${collapsed ? "Show" : "Hide"} subtasks`}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      {collapsed && <span className="subtask-count">{count}</span>}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
      >
        <path
          d="M2 4L6 8L10 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
