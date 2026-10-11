const { getDefaultConfig } = require("expo/metro-config");
const http = require("node:http");
const config = getDefaultConfig(__dirname);
const original = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const app = original ? original(middleware, server) : middleware;
  return (request, response, next) => {
    if (!request.url.startsWith("/api/")) return app(request, response, next);
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: 8787,
        agent: false,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(response);
      },
    );
    proxy.on("error", () => {
      if (!response.headersSent)
        response.writeHead(503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: "Local API unavailable; run npm run api:dev" }),
      );
    });
    request.pipe(proxy);
  };
};
module.exports = config;
