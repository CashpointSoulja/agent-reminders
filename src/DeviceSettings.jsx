import React, { useEffect, useState } from 'react';
import './agent-settings.css';

export default function DeviceSettings({ api }) {
  const [state, setState] = useState({ devices: [], pairings: [] }), [codes, setCodes] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => setState(await api.ownerDevices('GET', '/devices'));
  useEffect(() => { let mounted = true; api.ownerDevices('GET', '/devices').then(result => { if (mounted) setState(result); }).catch(problem => { if (mounted) setError(problem.message); }); return () => { mounted = false; }; }, [api]);
  async function act(action) { if (busy) return; setBusy(true); setError(''); try { await action(); await refresh(); } catch (problem) { setError(problem.message); } finally { setBusy(false); } }
  return <main className="agent-settings"><header className="as-header"><a href="/" className="as-back" aria-label="Back to Reminders">‹</a><h1>Devices</h1></header>
    <p className="as-intro">Use the iPhone companion to choose the Apple Reminders lists you want to sync. Its key stays on the device. This page never asks for your Apple ID or model keys.</p>
    {window.webkit?.messageHandlers?.reaDevice && <button className="as-pill" onClick={() => window.webkit.messageHandlers.reaDevice.postMessage({ action: 'showSettings' })}>Open iPhone Settings</button>}
    <button className="as-pill" disabled={busy} onClick={() => act(async () => {})}>Refresh</button>
    {error && <p role="alert" className="as-error">{error}</p>}
    <h2 className="as-section">Pairing requests</h2>
    {state.pairings.length === 0 && <p>No pending requests. Start pairing in the iPhone companion.</p>}
    {state.pairings.map(pairing => <form key={pairing.id} className="as-card as-key" onSubmit={event => { event.preventDefault(); act(() => api.ownerDevices('POST', `/devices/pairings/${encodeURIComponent(pairing.id)}/approve`, { code: codes[pairing.id] || '' })); }}>
      <h2>{pairing.name}</h2><p>Only approve when the code and selected lists match your device.</p><ul>{pairing.lists.map(list => <li key={list.id}>{list.title}</li>)}</ul>
      <label htmlFor={`pair-${pairing.id}`}>Code shown on device</label><input id={`pair-${pairing.id}`} aria-label={`Pairing code for ${pairing.name}`} autoComplete="off" autoCapitalize="characters" value={codes[pairing.id] || ''} onChange={event => setCodes(value => ({ ...value, [pairing.id]: event.target.value }))} maxLength={9} />
      <button className="as-pill" disabled={busy || !(codes[pairing.id] || '').trim()}>Approve Device</button>
    </form>)}
    <h2 className="as-section">Your devices</h2><ul className="as-card as-list">{state.devices.map(device => <li key={device.id}><span className="as-row-text"><strong>{device.name}</strong><small>{device.revokedAt ? 'Revoked' : `${device.activeListIDs.length} selected lists · ${device.writebackListIDs.length} allow completion writeback`}</small></span>{!device.revokedAt && <button className="as-pill as-destructive" disabled={busy} onClick={() => act(() => api.ownerDevices('DELETE', `/devices/${encodeURIComponent(device.id)}`))}>Revoke</button>}</li>)}</ul>
    <p className="as-footnote">Real access requires Apple’s permission on your device. Completion writeback is off until you enable it for selected lists. Recurring reminders and unsupported Apple fields are not written back.</p>
    <a href="/settings/agents">Agent settings</a>
  </main>;
}
