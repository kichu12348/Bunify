# Bunify

A fast, lightweight, and strictly-typed web framework built specifically for [Bun](https://bun.sh/). 

**Bunify** offers a developer-friendly API heavily inspired by proven web frameworks like Fastify, but optimized for the modern Bun ecosystem. It features robust typing, lifecycle hooks, powerful routing, and middleware support right out of the box.

## Installation

Since Bunify relies on native Bun features, ensure you have [Bun installed](https://bun.sh/).

```bash
bun add bunify
```

## Quick Start

```typescript
import { Bunify } from "bunify";

const app = new Bunify({ logger: true });

app.get("/hello", (request, reply) => {
  return { message: "Hello, World!" };
});

app.listen(3000, (address) => {
  console.log(`Server is running at http://${address}`);
});
```

## Features

### Type-Safe Routing
Bunify enforces strict typing on your `return` statements and incoming requests using `RouteSchema` definition.

```typescript
type GreetRoute = {
  Body: { name: string };
  Query: { formal?: string };
  Params: { id: string };
  Reply: { greeting: string };
};

app.post<GreetRoute>("/greet/:id", async (request, reply) => {
  const body = await request.json(); // Strongly typed to { name: string }
  const formal = request.query.formal;
  const id = request.params.id; // Strongly typed to string

  return { greeting: `Hello ${body.name}, your id is ${id}` };
});
```

### Middleware (`use`)
You can use middleware to intercept incoming requests and process them before they hit your routes. Note that you MUST call `next()` to proceed.

```typescript
app.use(async (request, reply, next) => {
  console.log(`Incoming request: ${request.method} ${request.url}`);
  await next();
});
```

### Lifecycle Hooks
Tap into requests at specific lifecycles. Available hooks are `onRequest`, `preHandler`, and `onResponse`.

```typescript
app.addHook("onRequest", async (request, reply, next) => {
  // Logic here
  await next();
});
```

### Routing & Chaining Middlewares
You can apply middleware locally per-route by chaining them before the final handler.

```typescript
app.get(
  "/protected",
  async (request, reply, next) => {
    if (!request.headers.get("Authorization")) {
      return reply.status(401).json({ error: "Unauthorized" });
    }
    await next();
  },
  (request, reply) => {
    return { data: "Top Secret" };
  }
);
```

### Decorators
Easily attach custom utilities, instances, or metadata to your `Bunify` application context and requests.

```typescript
// Define expected decorators
type AppDecorators = { db: any };

const app = new Bunify<AppDecorators>();

app.decorate("db", { getDocs: () => [{ id: 1 }] });

app.get("/docs", (request, reply) => {
  // request.db is available and correctly typed
  return request.db.getDocs();
});
```

### Plugins / Sub-Routers
Divide your application into logical modules combining prefixes, scoped dependencies, and decorators securely using `.register()`.

```typescript
app.register(
  (adminApp) => {
    adminApp.get("/dashboard", (request, reply) => {
      reply.html("<h1>Admin Dashboard</h1>");
    });
  },
  { prefix: "/admin" } // accessible at /admin/dashboard
);
```

## Reply Methods

The `reply` object gives you fine-grained control to shape responses gracefully.

- `reply.status(code)` / `reply.code(code)`: Set the HTTP status code
- `reply.headers(key, value)`: Insert a new Header
- `reply.json(data)`: Automatically sends a JSON response
- `reply.html(content)`: Easily serve HTML tags
- `reply.redirect(url)`: Responds with a 302 redirect
- `reply.send(content)`: Generic send handler
- Return directly from `handler` instead of returning `reply.send()` (See Quick Start).

## License

[MIT](./LICENSE)
