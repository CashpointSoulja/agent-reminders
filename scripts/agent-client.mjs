import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

export async function evidenceDigest(content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createAgentClient({ baseURL, token, fetchImpl = globalThis.fetch }) {
  const base = new URL(baseURL);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Use an HTTPS app origin, or localhost HTTP for development. Never put credentials in the URL.');
  if (token !== undefined && !/^rwa_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid scoped agent token.');
  const request = async (path, { method = 'GET', data, key, publicDefinition = false } = {}) => {
    if (!publicDefinition && !token) throw new Error('REMINDERS_AGENT_TOKEN is required for assigned tasks.');
    const response = await fetchImpl(new URL(path, base), {
      method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { ...(publicDefinition ? {} : { Authorization: `Bearer ${token}` }), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || `Agent API denied request (${response.status}).`); error.status = response.status; error.code = result.code || 'request_failed'; error.retryable = Boolean(result.retryable); throw error; }
    return result;
  };
  const taskPath = id => `/api/agent/v1/tasks/${encodeURIComponent(id)}`;
  return {
    discover: () => request('/api/agent/discovery', { publicDefinition: true }),
    tasks: (after = 0) => request(`/api/agent/v1/tasks?after=${encodeURIComponent(after)}`),
    changes: (since = 0) => request(`/api/agent/v1/changes?since=${encodeURIComponent(since)}`),
    task: id => request(taskPath(id)),
    claim: (id, claimId, leaseSeconds = 300) => request(`${taskPath(id)}/claim`, { method: 'POST', key: claimId, data: { leaseSeconds } }),
    heartbeat: (id, claimId, taskVersion, leaseSeconds = 300) => request(`${taskPath(id)}/heartbeat`, { method: 'POST', data: { claimId, taskVersion, leaseSeconds } }),
    report: (id, result) => request(`${taskPath(id)}/report`, { method: 'POST', data: result }),
    attachments: id => request(`${taskPath(id)}/attachments`),
  };
}

// The caller supplies its own authorized tool driver. No provider key or model call is built in.
export async function runAssignedTask(client, taskId, execute) {
  if (typeof execute !== 'function') throw new Error('An explicitly configured task driver is required.');
  const claimId = crypto.randomUUID(), claim = await client.claim(taskId, claimId);
  const taskVersion = claim.task.taskVersion;
  const controller = new AbortController();
  let renewalError, pendingRenewal = Promise.resolve();
  const timer = setInterval(() => {
    pendingRenewal = pendingRenewal.then(() => client.heartbeat(taskId, claimId, taskVersion)).catch(error => { renewalError = error; controller.abort(error); });
  }, 100000);
  timer.unref?.();
  try {
    const context = await client.task(taskId);
    if (context.task.status !== 'claimed' || context.task.taskVersion !== taskVersion || !context.reminder) throw new Error('Task changed after claim; stop new work.');
    const result = await execute({ ...context, claimId, signal: controller.signal });
    await pendingRenewal;
    if (renewalError) throw renewalError;
    if (!result || typeof result !== 'object') throw new Error('Driver must return an actual outcome, summary and verification evidence.');
    return await client.report(taskId, { ...result, claimId, taskVersion });
  } finally { clearInterval(timer); }
}

async function cli() {
  const [command = 'discover', taskId, file] = process.argv.slice(2);
  if (!['discover', 'tasks', 'changes', 'task', 'claim', 'report'].includes(command)) throw new Error('Usage: agent-client.mjs discover|tasks|changes|task ID|claim ID|report ID RESULT.json. Execution is performed by your own runtime.');
  const client = createAgentClient({ baseURL: process.env.REMINDERS_AGENT_BASE_URL || 'http://localhost:8787', token: process.env.REMINDERS_AGENT_TOKEN });
  let result;
  if (command === 'discover') result = await client.discover();
  else if (command === 'tasks') result = await client.tasks();
  else if (command === 'changes') result = await client.changes(Number(taskId || 0));
  else {
    if (!taskId) throw new Error('Task ID required.');
    if (command === 'task') result = await client.task(taskId);
    else if (command === 'claim') result = await client.claim(taskId, crypto.randomUUID());
    else { if (!file) throw new Error('Path to the actual outcome JSON file required.'); result = await client.report(taskId, JSON.parse(await readFile(file, 'utf8'))); }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
