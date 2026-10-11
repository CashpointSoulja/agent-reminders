export async function onRequest({ request, env }) {
  if (!env.API)
    return Response.json({ error: "API unavailable" }, { status: 503 });
  return env.API.fetch(request);
}
