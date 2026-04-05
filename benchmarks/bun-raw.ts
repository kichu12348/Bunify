const server = Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url);

    // 1. Simulate Middleware (headers added to all routes)
    const headers = new Headers();
    headers.set("X-Benchmark-Time", Date.now().toString());

    if (req.method === "GET") {
      // 2. Simple GET
      if (url.pathname === "/") {
        headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify({ message: "Hello, World!" }), {
          headers,
        });
      }

      // 3. Query params map handler
      if (url.pathname === "/search") {
        headers.set("Content-Type", "application/json");
        const q = url.searchParams.get("q") || "none";
        return new Response(JSON.stringify({ results: q }), { headers });
      }

      // 4. Larger JSON Payload
      if (url.pathname === "/data") {
        headers.set("Content-Type", "application/json");
        return new Response(
          JSON.stringify({
            items: [
              { id: 1, name: "Item A" },
              { id: 2, name: "Item B" },
              { id: 3, name: "Item C" },
            ],
            status: "ok",
          }),
          { headers },
        );
      }
    }

    // 5. POST body JSON
    if (req.method === "POST" && url.pathname === "/echo") {
      const body = await req.json();
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body), { status: 201, headers });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Raw Bun server listening on ${server.hostname}:${server.port}`);
