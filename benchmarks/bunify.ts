import { Bunify } from "../src/core";

const app = new Bunify();

// 1. App-level Middleware
app.use(async (req, reply, next) => {
  reply.headers("X-Benchmark-Time", Date.now().toString());
  return next();
});

// 2. Simple GET
app.get("/", () => {
  return { message: "Hello, World!" };
});

// 3. Query params map handler
app.get("/search", (req) => {
  return {
    results: req.query.q || "none",
  };
});

// 4. Larger JSON Payload
app.get("/data", () => {
  return {
    items: [
      { id: 1, name: "Item A" },
      { id: 2, name: "Item B" },
      { id: 3, name: "Item C" },
    ],
    status: "ok",
  };
});

// 5. POST body JSON
app.post("/echo", async (req, reply) => {
  const body = await req.json();
  return reply.status(201).json(body);
});

app.listen(3000, (url) => {
  console.log(`Bunify listening on ${url}`);
});
