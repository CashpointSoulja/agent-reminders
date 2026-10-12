import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root), output = new URL("work/cloud-static/", root);
await readFile(new URL("index.html", dist));
async function checkExport(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["functions", ".git", "node_modules", "exports", "work"].includes(entry.name) || /^\.env|^\.dev\.vars|^wrangler[.\-]|\.map$/i.test(entry.name)) throw new Error(`Unexpected private or server export entry: ${entry.name}`);
    if (entry.isSymbolicLink()) throw new Error("Symbolic links are not permitted in the deployment export.");
    if (entry.isDirectory()) await checkExport(new URL(`${entry.name}/`, directory));
  }
}
await checkExport(dist);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(dist, output, { recursive: true });
await mkdir(new URL(".well-known/", output), { recursive: true });
const metadata = {
  name: "Agent Reminders",
  demo: true,
  enabled: false,
  agentApiEnabled: false,
  deviceSyncEnabled: false,
  storage: "This browser, with optional private encrypted Cloudflare storage",
  cloudStorage: { enabled: true, optIn: true, storeEncrypted: true, encrypted: true, authorization: "Private workspace recovery capability", endpoint: "/cloud/v1", publicData: false, supportedOrigins: ["https://reminders-web-rea.pages.dev", "https://agent-reminders-demo.pages.dev"], requiresConfiguredService: true },
  accountImports: { google: "Requires user consent", icloud: "Reviewed native or JSON import; manual refresh" },
  source: "https://github.com/CashpointSoulja/agent-reminders/tree/rea-reminders-build",
  message: "Owner, agent and device transport APIs are disabled. Cloud documents require the user's private capability; no reminder data is publicly crawlable.",
};
await writeFile(new URL("api-disabled.json", output), JSON.stringify(metadata, null, 2) + "\n");
await writeFile(new URL(".well-known/reminders-agent.json", output), JSON.stringify(metadata, null, 2) + "\n");
await writeFile(new URL("llms.txt", output), "# Agent Reminders\n\nA browser-local app starting with fictional seed data. More > Accounts offers user-approved Google Calendar/Tasks and reviewed native or JSON iCloud imports. Account tokens stay in memory. Optional Cloud Storage encrypts selected local reminders on the device before saving them in an isolated Cloudflare SQLite Durable Object; a private recovery capability is required to read or change that document. Recovery codes must never be included in URLs, prompts, logs or repository files.\n\nThe owner, external-agent and device transport APIs remain disabled on this deployment. There is no publicly readable reminder document. Read-only public machine metadata is available under /.well-known/reminders-agent.json.\n\nPrivacy: /privacy.html\nSource: https://github.com/CashpointSoulja/agent-reminders/tree/rea-reminders-build\n");
await writeFile(new URL("_worker.js", output), await readFile(new URL("backend/pages-cloud-proxy.js", root), "utf8"));
await writeFile(new URL("_routes.json", output), JSON.stringify({ version: 1, include: ["/cloud/*", "/api/*", "/api"], exclude: ["/_expo/*", "/assets/*"] }, null, 2) + "\n");
await writeFile(new URL("_redirects", output), "/api/* /api-disabled.json 200\n/* /index.html 200\n");
await writeFile(new URL("_headers", output), "/cloud/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n/api/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n");
await checkExport(output);
console.log("Prepared work/cloud-static: optional isolated CLOUD service; owner, agent and device APIs remain disabled. No provider secret is included.");
