type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type RouteSchema = {
  Query?: Record<string, any>;
  Params?: Record<string, any>;
  Body?: any;
  Reply?: any;
};

export type Handler<T extends RouteSchema = RouteSchema, D = {}> = (
  request: BunifyRequest<T, D>,
  reply: BunifyReply<T>,
) => T["Reply"] | Response | Promise<T["Reply"] | Response>;

export type Middleware<T extends RouteSchema = RouteSchema, D = {}> = (
  request: BunifyRequest<T, D>,
  reply: BunifyReply<T>,
  next: () => Promise<any>,
) => any;

type HookType = "onRequest" | "preHandler" | "onResponse";

export interface BunifyInstance {
  get<T extends RouteSchema = RouteSchema>(
    path: string,
    handler: Handler<T>,
  ): void;
  post<T extends RouteSchema = RouteSchema>(
    path: string,
    handler: Handler<T>,
  ): void;
  put<T extends RouteSchema = RouteSchema>(
    path: string,
    handler: Handler<T>,
  ): void;
  delete<T extends RouteSchema = RouteSchema>(
    path: string,
    handler: Handler<T>,
  ): void;
  patch<T extends RouteSchema = RouteSchema>(
    path: string,
    handler: Handler<T>,
  ): void;
  listen(port: number, callback?: (address: string) => void): void;
}

interface RegisterOptions {
  prefix?: string;
}

// Look at how lean this is! No closures, no heavy standard objects.
export class BunifyReply<T extends RouteSchema = RouteSchema> {
  private _status: number = 200;
  private _headers: Record<string, string> = {}; // Fast, plain object
  private _body: any = null;
  public sent: boolean = false;

  status(code: number) {
    this._status = code;
    return this;
  }

  code(code: number) {
    return this.status(code);
  }

  headers(key: string, value: string) {
    this._headers[key] = value;
    return this;
  }

  json(data: T["Reply"]) {
    return this.headers("Content-Type", "application/json").send(data);
  }

  redirect(url: string) {
    return this.status(302).headers("Location", url).send(null);
  }

  html(content: string) {
    return this.headers("Content-Type", "text/html").send(content);
  }

  send(content: T["Reply"] | Response | null) {
    if (this.sent) {
      throw new Error("Reply has already been sent.");
    }
    this.sent = true;

    if (content instanceof Response) return content;

    if (typeof content === "object" && content !== null) {
      this._headers["Content-Type"] = "application/json";
      content = JSON.stringify(content) as any;
    }

    this._body = content;
    return this.build();
  }

  build() {
    if (this._body instanceof Response) return this._body;
    return new Response(this._body, {
      status: this._status,
      headers: this._headers,
    });
  }
}

function createReply() {
  return new BunifyReply();
}

export class BunifyRequest<T extends RouteSchema = RouteSchema, D = {}> {
  raw: Bun.BunRequest;
  method: string;
  url: string;
  headers: Headers;
  params: any;

  private _queryString: string = "";
  private _parsedQuery: any = null;

  constructor(req: Bun.BunRequest, decorators: Record<string, any>) {
    this.raw = req;
    this.method = req.method;
    this.url = req.url;
    this.headers = req.headers;
    this.params = (req as any).params || {};

    // 2. Fast decorator assignment (Avoids the object spread penalty!)
    const keys = Object.keys(decorators);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key !== undefined) {
        (this as any)[key] = decorators[key];
      }
    }
  }

  // 3. Our Lazy Evaluated Getter
  get query() {
    if (this._parsedQuery !== null) return this._parsedQuery;

    const urlStr = this.raw.url;
    const queryStart = urlStr.indexOf("?", 8);
    if (queryStart !== -1) {
      this._queryString = urlStr.substring(queryStart + 1);
    }

    if (!this._queryString) {
      this._parsedQuery = {};
      return this._parsedQuery;
    }

    this._parsedQuery = Object.fromEntries(
      new URLSearchParams(this._queryString),
    );
    return this._parsedQuery;
  }

  json() {
    return this.raw.json();
  }

  text() {
    return this.raw.text();
  }
}

export class Bunify<Decorators extends Record<string, any> = {}> {
  private logger: boolean;
  private prefix: string = "";
  private routes: { [key: string]: any };
  private middlewares: Middleware<any, Decorators>[] = [];
  private hooks: Record<HookType, Middleware<any, Decorators>[]> = {
    onRequest: [],
    preHandler: [],
    onResponse: [],
  };

  private decorators: Decorators = {} as Decorators;

  constructor(options?: { logger?: boolean }) {
    this.logger = options?.logger ?? false;
    this.routes = {};
  }

  private joinPaths(base: string, path: string) {
    return (base + path).replace(/\/+/g, "/");
  }

  private addRoute<T extends RouteSchema = RouteSchema>(
    method: Method,
    path: string,
    handlers: (Handler<T, Decorators> | Middleware<T, Decorators>)[],
  ) {
    const { handler, middlewares } = this.parseHandlers<T>(handlers);
    const composedHandler = this.compose<T>(
      [...this.middlewares, ...middlewares] as Middleware<T, Decorators>[],
      handler,
    );
    const wrappedHandler = async (req: Bun.BunRequest) => {
      let parsedQuery: any = null;
      // const request: BunifyRequest<T, Decorators> = {
      //   raw: req,
      //   // Lazily parse query parameters when accessed for the first time to optimize performance
      //   get query() {
      //     if (parsedQuery !== null) return parsedQuery;

      //     const urlStr = req.url;
      //     const queryStart = urlStr.indexOf("?", 8);

      //     if (queryStart === -1) {
      //       parsedQuery = {};
      //       return parsedQuery;
      //     }

      //     const queryString = urlStr.substring(queryStart + 1);
      //     parsedQuery = Object.fromEntries(new URLSearchParams(queryString));

      //     return parsedQuery;
      //   },
      //   params: (req.params || {}) as BunifyRequest<T, Decorators>["params"],
      //   json: () => req.json(),
      //   text: () => req.text(),
      //   headers: req.headers,
      //   method: req.method,
      //   url: req.url,
      //   ...(this.decorators as Decorators),
      // };

      const request = new BunifyRequest<T, Decorators>(req, this.decorators);

      const reply = createReply() as BunifyReply<T>;

      try {
        const res = await this.runPipeline(request, reply, composedHandler);
        if (!reply.sent && res !== undefined) {
          return reply.send(res);
        }
        return reply.build();
      } catch (err) {
        if (this.logger) {
          console.error(`Error in [${method} ${path}]:`, err);
        }
        return new Response("Internal Server Error", { status: 500 });
      }
    };

    const fullPath = this.joinPaths(this.prefix, path);

    const route = this.routes[fullPath];
    if (!route) {
      this.routes[fullPath] = { [method]: wrappedHandler };
    } else {
      this.routes[fullPath][method] = wrappedHandler;
    }
  }

  private compose<T extends RouteSchema>(
    middlewares: Middleware<T, Decorators>[],
    handler: Handler<T, Decorators>,
  ) {
    return async (
      request: BunifyRequest<T, Decorators>,
      reply: BunifyReply<T>,
    ) => {
      for (let i = 0; i < middlewares.length; i++) {
        const fn = middlewares[i];
        if (fn) {
          await fn(request, reply, async () => {});
          if (reply.sent) return;
        }
      }
      const res = await handler(request, reply);
      if (res !== undefined && !reply.sent) return reply.send(res);
    };
  }

  private parseHandlers<T extends RouteSchema = RouteSchema>(
    handlers: (Handler<T, Decorators> | Middleware<T, Decorators>)[],
  ) {
    const flat = handlers.flat();
    const handler = flat[flat.length - 1] as Handler<T, Decorators>;
    const middlewares = flat.slice(0, -1) as Middleware<T, Decorators>[];
    return { handler, middlewares };
  }

  private async runHooks<T extends RouteSchema>(
    hooks: Middleware<T, Decorators>[],
    request: BunifyRequest<T, Decorators>,
    reply: BunifyReply<T>,
  ) {
    for (let i = 0; i < hooks.length; i++) {
      const fn = hooks[i];
      if (fn) {
        await fn(request, reply, async () => {});
        if (reply.sent) return;
      }
    }
  }

  private async runPipeline<T extends RouteSchema>(
    request: BunifyRequest<T, Decorators>,
    reply: BunifyReply<T>,
    handler: Handler<T, Decorators>,
  ) {
    if (this.hooks.onRequest.length > 0) {
      await this.runHooks(
        this.hooks.onRequest as Middleware<T, Decorators>[],
        request,
        reply,
      );
      if (reply.sent) return;
    }

    if (this.hooks.preHandler.length > 0) {
      await this.runHooks(
        this.hooks.preHandler as Middleware<T, Decorators>[],
        request,
        reply,
      );
      if (reply.sent) return;
    }

    const res = await handler(request, reply);
    if (res !== undefined && !reply.sent) return reply.send(res);

    if (this.hooks.onResponse.length > 0) {
      await this.runHooks(
        this.hooks.onResponse as Middleware<T, Decorators>[],
        request,
        reply,
      );
    }
    return res;
  }

  decorate<K extends string, V>(name: K, value: V) {
    if ((this.decorators as any)[name]) {
      throw new Error(`Decorator '${name}' already exists.`);
    }
    (this.decorators as any)[name] = value;

    return this as any;
  }

  register(
    fn: (app: Bunify<Decorators>) => void,
    { prefix = "" }: RegisterOptions,
  ) {
    const child = new Bunify<Decorators>({ logger: this.logger });
    child.routes = this.routes; // Share routes
    child.prefix = this.joinPaths(this.prefix, prefix);

    child.hooks = {
      onRequest: [...this.hooks.onRequest],
      preHandler: [...this.hooks.preHandler],
      onResponse: [...this.hooks.onResponse],
    };

    child.decorators = { ...this.decorators };

    child.middlewares = [...(this.middlewares || [])];
    fn(child);
  }

  use(fn: Middleware<any, Decorators>) {
    this.middlewares.push(fn);
  }

  addHook(type: HookType, fn: Middleware<any, Decorators>) {
    this.hooks[type].push(fn);
  }

  get<T extends RouteSchema = RouteSchema>(
    path: string,
    ...handlers: [...Middleware<T, Decorators>[], Handler<T, Decorators>]
  ) {
    this.addRoute("GET", path, handlers);
  }

  post<T extends RouteSchema = RouteSchema>(
    path: string,
    ...handlers: [...Middleware<T, Decorators>[], Handler<T, Decorators>]
  ) {
    this.addRoute("POST", path, handlers);
  }

  put<T extends RouteSchema = RouteSchema>(
    path: string,
    ...handlers: [...Middleware<T, Decorators>[], Handler<T, Decorators>]
  ) {
    this.addRoute("PUT", path, handlers);
  }

  delete<T extends RouteSchema = RouteSchema>(
    path: string,
    ...handlers: [...Middleware<T, Decorators>[], Handler<T, Decorators>]
  ) {
    this.addRoute("DELETE", path, handlers);
  }

  patch<T extends RouteSchema = RouteSchema>(
    path: string,
    ...handlers: [...Middleware<T, Decorators>[], Handler<T, Decorators>]
  ) {
    this.addRoute("PATCH", path, handlers);
  }

  listen(
    { port, host = "" }: { port: number; host?: string },
    callback?: (address: string) => void,
  ) {
    const server = Bun.serve({
      port: port,
      hostname: host,
      routes: this.routes,
      fetch: async () => {
        return new Response("Not Found", { status: 404 });
      },
    });
    if (callback) {
      callback(server.hostname + ":" + server.port);
    }

    return server;
  }
}
