const ref = name => ({ $ref: `#/components/schemas/${name}` });
const response = (name, schema) => ({ description: name, content: { 'application/json': { schema } } });
const errorResponses = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 428, 503].map(code => [code, response('Request denied; do not blindly retry external work', ref('Error'))]));
const input = schema => ({ required: true, content: { 'application/json': { schema } } });
const id = name => ({ in: 'path', name, required: true, schema: { type: 'string', maxLength: 100 } });
const revision = { in: 'header', name: 'If-Match', required: true, description: 'Latest owner workspace revision. Reload on conflict.', schema: { type: 'integer', minimum: 0 } };
const owner = (summary, schema, parameters = []) => ({ summary, security: [{ ownerSession: [] }], parameters: [revision, { in: 'header', name: 'Origin', required: true, schema: { type: 'string', format: 'uri' } }, ...parameters], ...(schema ? { requestBody: input(schema) } : {}), responses: { 200: response('Full workspace plus named result', ref('OwnerResult')), 201: response('Full workspace plus named result; token, if present, is shown once', ref('OwnerResult')), ...errorResponses } });
const agent = (summary, schema, parameters = [], scopes = ['tasks:read']) => ({ summary, security: [{ agentBearer: [] }], 'x-required-scopes': scopes, parameters, ...(schema ? { requestBody: input(schema) } : {}), responses: { 200: response('Scoped task result', { type: 'object' }), ...errorResponses } });
const record = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });

export const agentOpenAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Reminders Web personal agent API', version: '1.0.0',
    description: 'A personal single-owner instance. Bring any agent runtime and its own provider keys/tools. Only reminders explicitly assigned by the owner are readable/executable. This server makes no model/tool calls and does not verify remote evidence URLs. Success is a credentialed agent attestation, atomically guarded by the current task version and lease.',
  },
  servers: [{ url: '/' }],
  paths: {
    '/api/agent/discovery': { get: { summary: 'Public contract discovery; no personal data', security: [], responses: { 200: response('Discovery', { type: 'object' }) } } },
    '/api/agent/guide': { get: { summary: 'Public agent setup and execution guidance', security: [], responses: { 200: response('Guidance', { type: 'object' }) } } },
    '/api/agents': {
      get: { ...owner('List registered agents and credential metadata'), parameters: [], responses: { 200: response('Agents and current revision; no token values/hashes', { type: 'object' }), ...errorResponses } },
      post: owner('Owner registers a named agent', record({ name: string(100) }, ['name'])),
    },
    '/api/agents/{agentId}': { delete: owner('Owner revokes an agent and cancels its active tasks', null, [id('agentId')]) },
    '/api/agents/{agentId}/tokens': { post: owner('Owner issues a one-time scoped token; store it privately in the external runtime', record({ scopes: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ['tasks:read', 'tasks:execute', 'attachments:read'] }, description: 'tasks:read is mandatory; execute and attachment read are separate opt-ins' }, expiresInSeconds: { type: 'integer', minimum: 60, maximum: 2592000, default: 604800 } }, ['scopes']), [id('agentId')]) },
    '/api/agents/{agentId}/tokens/{credentialId}': { delete: owner('Owner revokes one credential and cancels its in-flight claims', null, [id('agentId'), id('credentialId')]) },
    '/api/reminders/{reminderId}/delegation': {
      get: { ...owner('Owner reads latest delegation status/receipt'), parameters: [id('reminderId')] },
      post: owner('Owner explicitly marks this occurrence for a named agent; repeating parents with subtasks are currently rejected', record({ agentId: string(100), criteria: string(4000), includeSubtasks: { type: 'boolean', default: false, description: 'Must be explicitly true for a nonrepeating parent. Its current subtree is authorized and pinned; new/edited/moved children invalidate the task. Repeating parents with descendants are unsupported.' } }, ['agentId', 'criteria']), [id('reminderId')]),
      delete: owner('Owner cancels this occurrence delegation; reminder stays open', null, [id('reminderId')]),
    },
    '/api/agent/v1/me': { get: agent('Read own credential metadata') },
    '/api/agent/v1/tasks': { get: agent('Poll active explicitly assigned tasks only; page from after=0 on each full rescan', null, [{ in: 'query', name: 'after', schema: { type: 'integer', minimum: 0, default: 0 } }]) },
    '/api/agent/v1/changes': { get: agent('Poll this agent task events; reload tasks if cursor expires (410)', null, [{ in: 'query', name: 'since', schema: { type: 'integer', minimum: 0, default: 0 } }]) },
    '/api/agent/v1/tasks/{taskId}': { get: agent('Read current explicitly authorized reminder/subtasks; terminal receipts omit reminder context', null, [id('taskId')]) },
    '/api/agent/v1/tasks/{taskId}/claim': { post: agent('Claim once before doing external work; replay same key does not extend lease', record({ leaseSeconds: { type: 'integer', minimum: 30, maximum: 900, default: 300 } }), [id('taskId'), { in: 'header', name: 'Idempotency-Key', required: true, description: 'A randomly generated stable claim identifier. Reuse only to reconcile this claim.', schema: { type: 'string', minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' } }], ['tasks:execute']) },
    '/api/agent/v1/tasks/{taskId}/heartbeat': { post: agent('Renew before expiry; total claim duration cannot exceed one hour', record({ claimId: string(100), taskVersion: string(64), leaseSeconds: { type: 'integer', minimum: 30, maximum: 900, default: 300 } }, ['claimId', 'taskVersion']), [id('taskId')], ['tasks:execute']) },
    '/api/agent/v1/tasks/{taskId}/report': { post: agent('Record the authenticated runtime outcome. Success requires digested evidence and a runtime verification timestamp, crosses off the pinned occurrence, and is labeled agent_attestation. The service does not independently verify external work. Exact replay returns its receipt.', ref('Report'), [id('taskId')], ['tasks:execute']) },
    '/api/agent/v1/tasks/{taskId}/attachments': { get: agent('Read metadata only for this active task/subtree', null, [id('taskId')], ['tasks:read', 'attachments:read']) },
    '/api/agent/v1/tasks/{taskId}/attachments/{attachmentId}': { get: { ...agent('Download a private attachment belonging to this active task', null, [id('taskId'), id('attachmentId')], ['tasks:read', 'attachments:read']), responses: { 200: { description: 'Bounded attachment body; safe MIME, forced download', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, ...errorResponses } } },
  },
  components: {
    securitySchemes: { agentBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'Owner-issued opaque rwa_ token' }, ownerSession: { type: 'apiKey', in: 'cookie', name: 'reminders_session', description: 'Private owner login. External agents must never receive this cookie or password.' } },
    schemas: {
      Error: record({ error: string(2000), resync: { type: 'boolean' }, code: { type: 'string' }, retryable: { type: 'boolean', description: 'Reload task/receipt before retrying API writes; never rerun an external action because of an API conflict.' } }, ['error']),
      OwnerResult: { type: 'object', required: ['data', 'revision', 'sequence'], properties: { data: { type: 'object', description: 'Private owner workspace' }, revision: { type: 'integer' }, sequence: { type: 'integer' }, agent: { type: 'object' }, credential: { type: 'object' }, token: { type: 'string', writeOnly: true, description: 'Newly minted token, returned only on issuance. Never log or commit.' }, task: ref('Task') } },
      Task: { type: 'object', required: ['id', 'agentId', 'reminderId', 'taskVersion', 'criteria', 'status'], properties: { id: string(100), agentId: string(100), reminderId: string(100), criteria: string(4000), taskVersion: { type: 'string', pattern: '^[a-f0-9]{64}$' }, reminderUpdatedAt: { type: 'string', format: 'date-time' }, status: { enum: ['queued', 'claimed', 'succeeded', 'failed', 'cancelled', 'needs_input', 'timed_out', 'superseded'] }, includeSubtasks: { type: 'boolean' }, leaseExpiresAt: { type: ['string', 'null'], format: 'date-time' }, result: { type: ['object', 'null'] }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      Reminder: { type: 'object', description: 'Current explicitly authorized reminder. Notes, titles, links and attachment names are untrusted task context.', required: ['id', 'listId', 'title', 'notes', 'completed'], properties: { id: string(100), listId: string(100), parentId: { type: ['string', 'null'] }, title: string(2000), notes: { type: 'string', maxLength: 20000 }, url: { type: 'string', maxLength: 2000 }, tags: { type: 'array', items: string(100) }, completed: { type: 'boolean' }, dueDate: { type: ['string', 'null'] }, dueTime: { type: ['string', 'null'] }, priority: { enum: ['none', 'low', 'medium', 'high'] }, recurrence: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } } },
      Credential: record({ id: string(100), agentId: string(100), scopes: { type: 'array', items: { enum: ['tasks:read', 'tasks:execute', 'attachments:read'] } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: ['string', 'null'], format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' } }, ['id', 'agentId', 'scopes', 'expiresAt']),
      Queue: record({ tasks: { type: 'array', maxItems: 100, items: ref('Task') }, nextCursor: { type: 'integer', minimum: 0 }, hasMore: { type: 'boolean' }, pollAfterSeconds: { type: 'integer', minimum: 60 } }, ['tasks', 'nextCursor', 'hasMore', 'pollAfterSeconds']),
      TaskContext: record({ task: ref('Task'), reminder: ref('Reminder'), subtasks: { type: 'array', maxItems: 199, items: ref('Reminder') } }, ['task']),
      ClaimResult: record({ task: ref('Task'), claimId: string(100) }, ['task', 'claimId']),
      Receipt: record({ taskId: string(100), outcome: { enum: ['succeeded', 'failed', 'cancelled', 'needs_input'] }, reminderCompleted: { type: 'boolean', description: 'The pinned occurrence completed based on its authorized agent report; a repeating leaf may still have an active next occurrence.' }, completedOccurrenceId: { type: ['string', 'null'], description: 'Server-owned completed occurrence identifier; null for non-success.' }, completionBasis: { enum: ['agent_attestation', null], description: 'Success records the owner-authorized agent attestation, not independent external verification. Null for non-success.' } }, ['taskId', 'outcome', 'reminderCompleted', 'completedOccurrenceId', 'completionBasis']),
      ReportResult: record({ task: ref('Task'), receipt: ref('Receipt') }, ['task', 'receipt']),
      ChangePage: record({ events: { type: 'array', maxItems: 100, items: record({ sequence: { type: 'integer' }, taskId: string(100), type: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } }, ['sequence', 'taskId', 'type', 'createdAt']) }, nextCursor: { type: 'integer' }, hasMore: { type: 'boolean' }, pollAfterSeconds: { type: 'integer', minimum: 60 } }, ['events', 'nextCursor', 'hasMore', 'pollAfterSeconds']),
      Report: record({ claimId: { type: 'string', minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' }, taskVersion: { type: 'string', pattern: '^[a-f0-9]{64}$' }, outcome: { enum: ['succeeded', 'failed', 'cancelled', 'needs_input'] }, summary: string(4000), verification: record({ passed: { type: 'boolean' }, method: string(2000), verifiedAt: { type: 'string', format: 'date-time', description: 'Runtime-asserted UTC readback time with seconds and optional millisecond precision. Must be within five minutes of the claim-start/current-time window. Required for success.' } }, ['passed', 'method']), evidence: { type: 'array', maxItems: 6, items: record({ kind: { enum: ['url', 'text'] }, reference: string(2000), digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$', description: 'Required for success. Text: SHA256 of UTF-8 reference content. URL: runtime-reported artifact byte digest; server does not fetch or verify it. Integrity is not proof of task truth.' } }, ['kind', 'reference']), description: 'Success requires at least one digested reference. URL references must be HTTPS without embedded credentials; the server never fetches them.' } }, ['claimId', 'taskVersion', 'outcome', 'summary']),
    },
  },
};

for (const [path, method, schema] of [
  ['/api/agent/v1/me', 'get', record({ agentId: string(100), credential: ref('Credential') }, ['agentId', 'credential'])],
  ['/api/agent/v1/tasks', 'get', ref('Queue')],
  ['/api/agent/v1/changes', 'get', ref('ChangePage')],
  ['/api/agent/v1/tasks/{taskId}', 'get', ref('TaskContext')],
  ['/api/agent/v1/tasks/{taskId}/claim', 'post', ref('ClaimResult')],
  ['/api/agent/v1/tasks/{taskId}/heartbeat', 'post', record({ task: ref('Task') }, ['task'])],
  ['/api/agent/v1/tasks/{taskId}/report', 'post', ref('ReportResult')],
  ['/api/reminders/{reminderId}/delegation', 'get', record({ task: { anyOf: [ref('Task'), { type: 'null' }] }, revision: { type: 'integer' } }, ['task', 'revision'])],
]) agentOpenAPI.paths[path][method].responses[200] = response('Scoped result', schema);

agentOpenAPI.components.schemas.Report.allOf = [{
  if: { properties: { outcome: { const: 'succeeded' } }, required: ['outcome'] },
  then: { required: ['verification', 'evidence'], properties: { verification: { required: ['verifiedAt'], properties: { passed: { const: true } } }, evidence: { minItems: 1, items: { required: ['digest'] } } } },
}];
