const appOrigins = new Set(["https://reminders-web-rea.pages.dev", "https://agent-reminders-demo.pages.dev"]);
const json = (value, status) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(request.method)) return json({ enabled: false, agentApiEnabled: false, deviceSyncEnabled: false, error: "This deployment has no owner, agent or device API." }, 405);
      const response = await env.ASSETS.fetch(new Request(new URL("/api-disabled.json", url.origin), { method: request.method }));
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store"); headers.set("x-content-type-options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    }
    if (!url.pathname.startsWith("/cloud/")) return env.ASSETS.fetch(request);
    if (!appOrigins.has(url.origin)) return json({ configured: false, error: "Private cloud storage is unavailable on this origin." }, 503);
    if (url.search) return json({ error: "Private cloud routes do not accept URL parameters." }, 400);
    const origin = request.headers.get("origin");
    if (origin ? origin !== url.origin : !["GET", "HEAD"].includes(request.method)) return json({ error: "Origin denied." }, 403);
    if (!env.CLOUD?.fetch) return json({ configured: false, error: "Private cloud storage is unavailable." }, 503);
    if (url.pathname !== "/cloud/health" && request.method !== "OPTIONS" && !/^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers.get("authorization") || "")) return json({ error: "Private cloud access required." }, 401);
    const headers = new Headers(request.headers);
    headers.set("origin", origin || url.origin);
    headers.delete("cookie"); headers.delete("referer");
    if (url.pathname === "/cloud/health" || request.method === "OPTIONS") headers.delete("authorization");
    try {
      const response = await env.CLOUD.fetch(new Request(request, { headers, redirect: "error" }));
      if (response.status >= 300 && response.status < 400) return json({ error: "Private cloud redirects are disabled." }, 503);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("cache-control", "no-store"); responseHeaders.set("x-content-type-options", "nosniff"); responseHeaders.set("referrer-policy", "no-referrer"); responseHeaders.delete("set-cookie");
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } catch { return json({ error: "Private cloud storage is unavailable." }, 503); }
  },
};
