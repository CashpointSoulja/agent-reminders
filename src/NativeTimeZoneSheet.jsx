import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { searchTimeZoneCities, timeZoneSubtitle } from './time-zones.js';
import './native-time-zone-sheet.css';

const glyph = kind => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={{ back:'M15 4 7 12l8 8', close:'m5 5 14 14M19 5 5 19', search:'M16 16 22 22M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', mic:'M9 5a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0ZM6 11v2a6 6 0 0 0 12 0v-2M12 19v3M8 22h8' }[kind]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export default function NativeTimeZoneSheet({ value, theme, portalTarget, onBack, onCancel, onSelect }) {
  const [query, setQuery] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const sheet = useRef(null), search = useRef(null), recognition = useRef(null);
  const callbacks = useRef({ onBack });
  callbacks.current = { onBack };
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const results = searchTimeZoneCities(query, value);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      sheet.current?.style.setProperty('--nd-vh', `${viewport?.height || innerHeight}px`);
      sheet.current?.style.setProperty('--nd-vtop', `${viewport?.offsetTop || 0}px`);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    sheet.current?.querySelector('button')?.focus({ preventScroll: true });
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); callbacks.current.onBack(); }
      if (event.key === 'Tab') {
        const controls = [...sheet.current.querySelectorAll('button:not(:disabled),input')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
      document.removeEventListener('keydown', key, true); recognition.current?.abort();
    };
  }, []);
  const dictate = () => {
    if (!SpeechRecognition) return;
    if (listening) { recognition.current?.stop(); return; }
    const voice = new SpeechRecognition(); recognition.current = voice;
    voice.lang = 'en-GB'; voice.interimResults = false;
    voice.onresult = event => setQuery(event.results[0][0].transcript);
    voice.onerror = () => { setVoiceError('Dictation is unavailable. Search by typing.'); setListening(false); };
    voice.onend = () => setListening(false);
    setVoiceError('');
    try { voice.start(); setListening(true); } catch { setVoiceError('Dictation is unavailable. Search by typing.'); }
  };
  return createPortal(<div className="ntz-backdrop">
    <section ref={sheet} className="native-details native-time-zone-sheet" data-theme={theme || 'light'} role="dialog" aria-modal="true" aria-label="Time Zone">
      <header className="nd-header">
        <button type="button" className="ntz-glass" aria-label="Back to Details" onClick={onBack}>{glyph('back')}</button>
        <h2>Time Zone</h2>
        <button type="button" className="ntz-glass" aria-label="Cancel Time Zone" onClick={onCancel}>{glyph('close')}</button>
      </header>
      <div className="ntz-results">
        {results.map(row => <button type="button" className="ntz-city" key={`${row.zone}:${row.city}`} onClick={() => onSelect(row.zone)}>
          <span>{row.city}{row.country ? `, ${row.country}` : ''}</span>
          <small>{timeZoneSubtitle(row.zone)}</small>
        </button>)}
        {!results.length && <p className="ntz-empty">No Results</p>}
      </div>
      {voiceError && <p role="status" className="ntz-voice-error">{voiceError}</p>}
      <footer className="ntz-search-footer">
        <div className="ntz-search ntz-glass">{glyph('search')}
          <input ref={search} type="search" aria-label="Search time zones" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" autoCapitalize="none" />
          <button type="button" aria-label="Dictate search" title={SpeechRecognition ? 'Dictate search' : 'Dictation unavailable in this browser'} disabled={!SpeechRecognition} aria-pressed={listening} onClick={dictate}>{glyph('mic')}</button>
        </div>
        <button type="button" className="ntz-glass ntz-search-close" aria-label={query ? 'Clear search' : 'Close search'} onClick={() => { if (query) { setQuery(''); search.current?.focus(); } else onBack(); }}>{glyph('close')}</button>
      </footer>
    </section>
  </div>, portalTarget || document.body);
}
