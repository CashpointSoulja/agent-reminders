import React, { useEffect, useState } from 'react';
import Icon from './icons';
import './native-list-sheet.css';
import './agent-settings.css';

// Intentional extension: Apple Reminders has no agent settings or agent assignment.
// Reuses native sheet chrome (glass header, X/check, grouped cards) without claiming pixel parity.
const KEY_DAYS = 7;
const ACTIVE = ['queued', 'claimed'];
const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export default function AgentSettings({ api, active = true }) {
  const [agents, setAgents] = useState([]), [name, setName] = useState(''), [files, setFiles] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState(null), [reveal, setReveal] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => { if (!active) { setSecret(null); setReveal(false); } }, [active]);
  const refresh = async () => setAgents((await api.ownerAgents('GET', '/agents')).agents);
  useEffect(() => { refresh().catch(problem => setError(problem.message)); }, [api]);
  // The key lives only in component state: never stored, dropped on Done, unmount or page hide.
  useEffect(() => {
    if (!secret) return;
    const drop = () => setSecret(null);
    window.addEventListener('pagehide', drop);
    return () => window.removeEventListener('pagehide', drop);
  }, [secret]);
  async function act(action) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await refresh(); } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  const issue = agent => act(async () => {
    const result = await api.ownerAgents('POST', `/agents/${encodeURIComponent(agent.id)}/tokens`, { scopes: ['tasks:read', 'tasks:execute', ...(files ? ['attachments:read'] : [])], expiresInSeconds: KEY_DAYS * 86400 });
    setReveal(false); setCopied(false);
    setSecret({ name: agent.name, value: result.token, expiresAt: result.credential.expiresAt });
  });
  const revoke = agent => act(() => api.ownerAgents('DELETE', `/agents/${encodeURIComponent(agent.id)}`));
  async function copy() {
    try { await navigator.clipboard.writeText(secret.value); setCopied(true); } catch { setError('Clipboard unavailable. Tap Show, then select and copy the key.'); }
  }
  const forget = () => { setSecret(null); setReveal(false); setCopied(false); };
  return <main className="agent-settings" data-extension="agents" data-no-screenshot={secret ? 'true' : undefined}>
    <header className="as-header">
      <a className="as-back" href="/" aria-label="Back to Reminders"><svg aria-hidden="true" width="12" height="20" viewBox="0 0 12 20"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
      <h1>Agents</h1>
    </header>
    <p className="as-intro">Optional. Connect an agent you run yourself, such as OpenClaw, Hermes or Grok. Its model keys and tools stay in its own runtime; this app never sees them.</p>
    {error && <p className="as-error" role="alert">{error}</p>}
    {secret && <section className="as-card as-key" aria-labelledby="as-key-title">
      <h2 id="as-key-title">Key for {secret.name}</h2>
      <p>Shown once. Save it in your agent’s secret store now — it can’t be shown again. It opens only reminders assigned to {secret.name} and expires {shortDate(secret.expiresAt)}.</p>
      <input type={reveal ? 'text' : 'password'} readOnly value={secret.value} aria-label="Agent key" autoComplete="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" onFocus={event => event.target.select()} />
      <div className="as-actions">
        <button type="button" className="as-pill" onClick={copy}>{copied ? 'Copied' : 'Copy Key'}</button>
        <button type="button" className="as-pill" aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? 'Hide' : 'Show'}</button>
        <button type="button" className="as-pill" onClick={forget}>Done</button>
      </div>
    </section>}
    <h2 className="as-section">What an agent can do</h2>
    <ul className="as-card as-rules">
      <li>See only reminders you assign to it.</li>
      <li>Work on an assigned reminder without asking you again.</li>
      <li>Cross it off only after reporting that your “Done means” note was met.</li>
      <li>Stop when its key expires after {KEY_DAYS} days, or when you revoke it.</li>
    </ul>
    <h2 className="as-section"><label htmlFor="as-name">Add Agent</label></h2>
    <form className="as-card as-add" onSubmit={event => { event.preventDefault(); if (name.trim()) act(async () => { await api.ownerAgents('POST', '/agents', { name: name.trim() }); setName(''); }); }}>
      <input id="as-name" value={name} maxLength={100} autoComplete="off" placeholder="Name, e.g. My OpenClaw" onChange={event => setName(event.target.value)} />
      <button type="submit" className="as-round" aria-label="Add Agent" disabled={busy || !name.trim()}><Icon name="plus" size={22} /></button>
    </form>
    {agents.length > 0 && <>
      <h2 className="as-section">Your Agents</h2>
      <ul className="as-card as-list">{agents.map(agent => {
        const keys = (agent.credentials || []).filter(key => !key.revokedAt && Date.parse(key.expiresAt) > Date.now());
        return <li key={agent.id}>
          <span className="as-row-text"><strong>{agent.name}</strong><small>{agent.revokedAt ? 'Revoked' : keys.length ? `${plural(keys.length, 'active key')} · until ${shortDate(keys.at(-1).expiresAt)}` : 'No active key'}</small></span>
          {!agent.revokedAt && <>
            <button type="button" className="as-pill" disabled={busy} onClick={() => issue(agent)}>New Key</button>
            <button type="button" className="as-pill as-destructive" disabled={busy} onClick={() => revoke(agent)}>Revoke</button>
          </>}
        </li>;
      })}</ul>
      <label className="as-card as-toggle"><span>New keys can open files attached to assigned reminders</span><input type="checkbox" role="switch" checked={files} onChange={event => setFiles(event.target.checked)} /></label>
    </>}
    <h2 className="as-section">For your agent</h2>
    <a href="/settings/devices">Connect your iPhone</a>
    <nav className="as-card as-links" aria-label="Public agent API">
      <a href="/api/agent/guide">Setup guide</a>
      <a href="/api/agent/openapi.json">OpenAPI contract</a>
      <a href="/api/agent/discovery">Service discovery</a>
    </nav>
    <p className="as-footnote">These definitions are public. Your reminders are not — every request needs a key. To give an agent work, open a reminder’s menu and choose Assign. Personal instance only; shared hosting is off.</p>
  </main>;
}

export function AgentAssignment({ reminder, api, subtaskCount = 0, onBeforeAssign = async () => {}, onAssigned, onClose }) {
  const connected = Boolean(api?.ownerAgents), path = `/reminders/${encodeURIComponent(reminder.id)}/delegation`;
  const [agents, setAgents] = useState([]), [task, setTask] = useState(null), [agentId, setAgentId] = useState(''), [criteria, setCriteria] = useState(''), [includeSubtasks, setIncludeSubtasks] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!connected) return;
    let live = true;
    Promise.all([api.ownerAgents('GET', '/agents'), api.ownerAgents('GET', path)])
      .then(([list, current]) => { if (live) { setAgents(list.agents.filter(agent => !agent.revokedAt)); setTask(current.task); } })
      .catch(problem => { if (live) setError(problem.message); });
    return () => { live = false; };
  }, [api, path]);
  const working = task && ACTIVE.includes(task.status) ? task : null;
  const agent = agents.find(item => item.id === agentId);
  useEffect(() => {
    const key = event => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onClose]);
  // Backend refuses a reminder with subtasks unless they are included, so the switch is required.
  const ready = Boolean(!reminder.completed && agent && criteria.trim() && (!subtaskCount || includeSubtasks));
  async function run(action) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  const assign = event => {
    event.preventDefault();
    if (ready) run(async () => { await onBeforeAssign(); onAssigned(await api.ownerAgents('POST', path, { agentId, criteria: criteria.trim(), includeSubtasks: subtaskCount > 0 && includeSubtasks })); });
  };
  return <form className="native-list-sheet nls-edit agent-assign-sheet" data-extension="agents" onSubmit={assign} aria-labelledby="aas-title">
    <header className="nls-header">
      <button className="nls-close" type="button" aria-label="Cancel" disabled={busy} onClick={onClose}><span aria-hidden="true">×</span></button>
      <h2 id="aas-title">Assign</h2>
      <button className="nls-done" type="submit" aria-label="Assign to Agent" disabled={busy || !ready}><Icon name="check" size={26} /></button>
    </header>
    <div className="nls-scroll">
      {error && <p className="aas-error" role="alert">{error}</p>}
      <h3 className="aas-section">Agents</h3>
      {connected ? <div className="aas-group" role="radiogroup" aria-label="Agent">
        {agents.map(item => <label key={item.id} className="aas-row">
          <input className="aas-radio" type="radio" name="agent" value={item.id} checked={agentId === item.id} onChange={() => setAgentId(item.id)} />
          <span>{item.name}{working?.agentId === item.id && <small>{working.status === 'claimed' ? 'Working on this' : 'Queued'}</small>}</span>
          {agentId === item.id && <Icon name="check" />}
        </label>)}
        <a className="aas-row aas-link" href="/settings/agents">Connect an Agent…</a>
      </div> : <p className="aas-footnote">Agents need the connected server.</p>}
      {working && <div className="aas-group"><button type="button" className="aas-row aas-destructive" disabled={busy} onClick={() => run(async () => { await api.ownerAgents('DELETE', path); setTask(null); })}>Stop Agent</button></div>}
      {agent && <>
        <h3 className="aas-section"><label htmlFor="aas-criteria">Done means</label></h3>
        <div className="aas-group"><textarea id="aas-criteria" required maxLength={4000} value={criteria} placeholder="e.g. Table for two booked for Friday and the confirmation emailed to me" onChange={event => setCriteria(event.target.value)} /></div>
        {subtaskCount > 0 && <div className="aas-group"><label className="aas-row"><span>Include {plural(subtaskCount, 'subtask')}</span><input type="checkbox" role="switch" required checked={includeSubtasks} onChange={event => setIncludeSubtasks(event.target.checked)} /></label></div>}
        <p className="aas-footnote">{agent.name} can work on this reminder{subtaskCount ? ' and its subtasks' : ''} without asking you again. It’s crossed off only when the agent reports “Done means” was met and the reminder hasn’t changed since.{subtaskCount ? ' A reminder with subtasks can only be assigned with them.' : ''}</p>
      </>}
    </div>
  </form>;
}
