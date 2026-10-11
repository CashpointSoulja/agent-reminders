import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {customRepeatFooter, initialRepeatPattern, monthNames, ordinalNames, repeatFrequencies, weekdayNames} from './repeat-pattern.js';
import './native-repeat.css';

export function NativeChoicePopover({anchor, label, choices, selected, onChoose, onClose, calendar}) {
  const menu = useRef(null), [position, setPosition] = useState(null);
  const portal = anchor?.closest('.server-root') || document.body;
  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.getBoundingClientRect(), viewport = window.visualViewport;
      const topBound = (viewport?.offsetTop || 0) + 62, bottomBound = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - 16;
      const width = Math.min(calendar ? 320 : 248, window.innerWidth - 32), height = Math.min(menu.current?.scrollHeight || 100, bottomBound - topBound);
      setPosition({left:Math.min(window.innerWidth-width-16,Math.max(16,box.right-width)), top:Math.max(topBound,Math.min(box.bottom-height,bottomBound-height)), width, maxHeight:bottomBound-topBound});
    };
    place(); window.addEventListener('resize', place); window.visualViewport?.addEventListener('resize',place);
    return () => {window.removeEventListener('resize',place);window.visualViewport?.removeEventListener('resize',place);};
  }, [anchor, calendar]);
  useEffect(() => {
    const escape = event => {
      if (event.key === 'Escape') {event.preventDefault();event.stopImmediatePropagation();onClose();}
      if (['Tab','ArrowDown','ArrowUp','Home','End'].includes(event.key) && !calendar) {
        const buttons = [...menu.current.querySelectorAll('button')], active = buttons.indexOf(document.activeElement);
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (Math.max(0,active) + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        event.preventDefault(); event.stopImmediatePropagation(); buttons[next]?.focus();
      }
    };
    menu.current?.querySelector('[aria-checked=true],button')?.focus({preventScroll:true});
    document.addEventListener('keydown',escape,true);
    return () => {document.removeEventListener('keydown',escape,true);if(anchor.isConnected)anchor.focus({preventScroll:true});};
  }, [onClose]);
  return createPortal(<div className="nd-popover-layer" data-theme={anchor.closest('[data-theme]')?.dataset.theme || 'light'}>
    <button className="nd-popover-dismiss" aria-label={`Dismiss ${label}`} type="button" onClick={onClose}/>
    <div ref={menu} role={calendar ? 'dialog' : 'menu'} aria-label={label} className={`nd-native-popover ${calendar ? 'nd-calendar-popover' : ''}`} style={position || {visibility:'hidden'}}>
      {calendar || choices.map(([value, text, separator]) => <button type="button" role="menuitemradio" aria-checked={value === selected} className={separator ? 'nd-menu-separated' : ''} key={String(value)} onClick={() => onChoose(value)}><span className="nd-menu-check" aria-hidden="true">{value === selected ? '✓' : ''}</span><span>{text}</span></button>)}
    </div>
  </div>, portal);
}

export default function NativeCustomRepeat({draft, setDraft, Wheel}) {
  const [frequencyMenu, setFrequencyMenu] = useState(null), pattern = draft.repeatPattern;
  const patchPattern = value => setDraft(previous => ({...previous,repeatCustom:true,repeatPattern:value}));
  const toggle = (key, value) => {
    const selected = pattern?.[key] || [], next = selected.includes(value) ? selected.filter(n => n !== value) : [...selected,value].sort((a,b) => a-b);
    if (next.length) patchPattern({...pattern,[key]:next});
  };
  const dueWeekday = new Date(`${draft.dueDate}T12:00:00`).getDay();
  const ordinalWheels = <div className="nd-repeat-wheels nd-native-time-wheel">
    <Wheel label="Ordinal" values={[1,2,3,4,5,-1]} value={pattern?.ordinal || 1} display={n => ordinalNames[n]} cyclic={false} onChange={value => patchPattern({...pattern,ordinal:value})}/>
    <Wheel label="Weekday" values={[0,1,2,3,4,5,6]} value={pattern?.weekday ?? dueWeekday} display={n => weekdayNames[n]} cyclic={false} onChange={value => patchPattern({...pattern,weekday:value})}/>
  </div>;
  return <div className="nd-custom-repeat">
    <div className="nd-group nd-repeat-settings">
      <div className="nd-repeat-setting"><span>Frequency</span><button type="button" aria-label="Frequency" onClick={event => setFrequencyMenu(event.currentTarget)}>{repeatFrequencies.find(([value]) => value === draft.recurrence)?.[1]}<span className="nd-menu-chevron" aria-hidden="true">⌃⌄</span></button></div>
      <div className="nd-repeat-setting"><span>Every</span><span className="nd-repeat-number"><input aria-label="Repeat interval" type="number" inputMode="numeric" min="1" max="1000" value={draft.repeatInterval} onChange={event => setDraft(previous => ({...previous,repeatInterval:Number(event.target.value),repeatCustom:true}))}/></span></div>
    </div>
    <p className="nd-repeat-footer">{customRepeatFooter(draft)}</p>
    {draft.recurrence === 'weekly' && <div className="nd-group nd-repeat-weekdays">{weekdayNames.map((name,day) => <button type="button" className="nd-choice" key={day} aria-pressed={!!pattern?.weekdays?.includes(day)} onClick={() => toggle('weekdays',day)}>{name}<span aria-hidden="true">{pattern?.weekdays?.includes(day) ? '✓' : ''}</span></button>)}</div>}
    {draft.recurrence === 'monthly' && <div className="nd-group nd-repeat-monthly">
      <button type="button" className="nd-choice" aria-pressed={!!pattern?.monthdays} onClick={() => patchPattern(initialRepeatPattern('monthly',draft.dueDate))}>Each<span aria-hidden="true">{pattern?.monthdays ? '✓' : ''}</span></button>
      <button type="button" className="nd-choice" aria-pressed={!!pattern?.ordinal} onClick={() => patchPattern({ordinal:1,weekday:dueWeekday})}>On the…<span aria-hidden="true">{pattern?.ordinal ? '✓' : ''}</span></button>
      {pattern?.ordinal ? ordinalWheels : <div className="nd-repeat-day-grid">{Array.from({length:31}, (_,i) => i+1).map(day => <button type="button" key={day} aria-label={`Day ${day}`} aria-pressed={!!pattern?.monthdays?.includes(day)} onClick={() => toggle('monthdays',day)}>{day}</button>)}</div>}
    </div>}
    {draft.recurrence === 'yearly' && <>
      <div className="nd-group nd-repeat-month-grid">{monthNames.map((name,index) => <button type="button" key={name} aria-label={name} aria-pressed={!!pattern?.months?.includes(index+1)} onClick={() => toggle('months',index+1)}>{name.slice(0,3)}</button>)}</div>
      <div className="nd-group nd-repeat-yearly-days"><div className="nd-repeat-setting"><span>Days of Week</span><button type="button" role="switch" aria-label="Days of Week" aria-checked={!!pattern?.ordinal} className={`nd-switch ${pattern?.ordinal ? 'is-on' : ''}`} onClick={() => patchPattern(pattern?.ordinal ? {months:pattern.months} : {...pattern,ordinal:1,weekday:0})}><span/></button></div>{pattern?.ordinal && ordinalWheels}</div>
    </>}
    {frequencyMenu && <NativeChoicePopover anchor={frequencyMenu} label="Frequency" choices={repeatFrequencies} selected={draft.recurrence} onClose={() => setFrequencyMenu(null)} onChoose={frequency => {setDraft(previous => ({...previous,recurrence:frequency,repeatPattern:initialRepeatPattern(frequency,previous.dueDate),repeatCustom:true}));setFrequencyMenu(null);}}/>}
  </div>;
}
