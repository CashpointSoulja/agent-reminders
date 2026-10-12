import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root), output = new URL('work/demo-static/', root);
await readFile(new URL('index.html', dist));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(dist, output, { recursive: true });
await mkdir(new URL('.well-known/', output), { recursive: true });
const disabled = { name: 'Agent Reminders playground', demo: true, enabled: false, agentApiEnabled: false, deviceSyncEnabled: false, storage: 'This browser only', accountImports: { google: 'Requires a public OAuth web client and user consent', icloud: 'Reviewed native or JSON import; manual refresh' }, source: 'https://github.com/CashpointSoulja/agent-reminders', message: 'Self-host the backend to connect agents. The playground has no server API.' };
await writeFile(new URL('api-disabled.json', output), JSON.stringify(disabled, null, 2) + '\n');
await writeFile(new URL('.well-known/reminders-agent.json', output), JSON.stringify(disabled, null, 2) + '\n');
await writeFile(new URL('llms.txt', output), '# Agent Reminders playground\n\nA browser-local app starting with fictional seed data. More > Accounts offers user-approved Google Calendar/Tasks imports and reviewed native or JSON iCloud imports. Google needs a public OAuth web client configured for this origin. Imports and edits remain in this browser. This deployment has no server agent, device transport, or storage API.\n\nPrivacy: /privacy.html\nSource and self-hosting: https://github.com/CashpointSoulja/agent-reminders\n');
await writeFile(new URL('_redirects', output), '/api/* /api-disabled.json 200\n/* /index.html 200\n');
await writeFile(new URL('_headers', output), '/api/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n');
console.log('Static-only demo prepared in work/demo-static; no API or service bindings.');
