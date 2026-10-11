import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createSubtask } from './subtasks.js';
import './native-subtasks-sheet.css';

export default function NativeSubtasksSheet({ parent, subtasks, theme, portalTarget, onBack }) {
  const [rows, setRows] = useState(() => subtasks.map(row => ({ ...row })));
  const [entry, setEntry] = useState('');
  const [editing, setEditing] = useState(false);
  const sheet = useRef(null), input = useRef(null);
  const current = useRef(null);
  const finish = () => onBack([...rows.filter(row => row.title.trim()), ...(entry.trim() ? [createSubtask(parent, entry)] : [])]);
  current.current = finish;
  const add = () => {
    if (entry.trim()) setRows(previous => [...previous, createSubtask(parent, entry)]);
    setEntry(''); setEditing(true);
    requestAnimationFrame(() => input.current?.focus());
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      sheet.current?.style.setProperty('--nd-vh', `${viewport?.height || innerHeight}px`);
      sheet.current?.style.setProperty('--nd-vtop', `${viewport?.offsetTop || 0}px`);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    sheet.current?.querySelector('button')?.focus({ preventScroll: true });
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); current.current(); }
      if (event.key === 'Tab') {
        const controls = [...sheet.current.querySelectorAll('button, input')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); document.removeEventListener('keydown', keydown, true); };
  }, []);
  return createPortal(<div className="ns-backdrop"><section ref={sheet} className="native-details native-subtasks-sheet" data-theme={theme || 'light'} role="dialog" aria-modal="true" aria-label="Subtasks">
    <header className="nd-header"><button type="button" className="nd-cancel" aria-label="Back to Details" onClick={finish}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4-8 8 8 8" /></svg></button><h2>Subtasks</h2></header>
    <div className="ns-content">
      {rows.map((row, index) => <div className="ns-row" key={row.id}><button type="button" className="ns-circle" role="checkbox" aria-checked={row.completed} aria-label={`Complete subtask ${row.title}`} onClick={() => setRows(previous => previous.map(item => item.id === row.id ? { ...item, completed: !item.completed, completedAt: item.completed ? null : new Date().toISOString() } : item))}>{row.completed ? '✓' : ''}</button><input aria-label={`Subtask ${index + 1}`} value={row.title} onChange={event => setRows(previous => previous.map(item => item.id === row.id ? { ...item, title: event.target.value } : item))} /></div>)}
      {editing && <div className="ns-row"><span className="ns-circle" aria-hidden="true" /><input ref={input} aria-label="New subtask" value={entry} onChange={event => setEntry(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /></div>}
      <button type="button" className="ns-add" onClick={add}>Add Reminder</button>
    </div>
  </section></div>, portalTarget || document.body);
}
