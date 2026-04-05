type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type RouteSchema = {
  Query?: Record<string, any>;
  Params?: Record<string, any>;
  Body?: any;
  Reply?: any;
};

export type BunifyRequest<T extends RouteSchema = RouteSchema, D = {}> = {
  raw: Bun.BunRequest;
  query: Record<string, string> & (T["Query"] extends object ? T["Query"] : {});
  params: T["Params"] extends infer U
    ? Record<string, string> & U
    : Record<string, string>;
  json: () => Promise<T["Body"]>;
  text: () => Promise<string>;
  headers: Headers;
  method: string;
  url: string;
} & D;

type Reply = ReturnType<typeof createReply>;

export type BunifyReply<T extends RouteSchema = RouteSchema> = Reply & {
  send: (content: T["Reply"] | Response) => Response;
  json: (data: T["Reply"]) => Response;
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

function createReply() {
  let status = 200;
  const headers = new Headers();
  let body: any = null;
  let sent = false;

  return {
    get sent() {
      return sent;
    },

    status(code: number) {
      status = code;
      return this;
    },
    code(code: number) {
      return this.status(code);
    },
    headers(key: string, value: string) {
      headers.set(key, value);
      return this;
    },
    json(data: any) {
      return this.headers("Content-Type", "application/json").send(data);
    },
    redirect(url: string) {
      return this.status(302).headers("Location", url).send(null);
    },
    html(content: string) {
      return this.headers("Content-Type", "text/html").send(content);
    },
    send(content: any) {
      if (sent) {
        throw new Error("Reply has already been sent.");
      }
      sent = true;
      if (content instanceof Response) return content;

      if (typeof content === "object") {
        headers.set("Content-Type", "application/json");
        content = JSON.stringify(content);
      }

      body = content;
      return this.build();
    },

    build() {
      if (body instanceof Response) return body;

      return new Response(body, { status, headers });
    },
  };
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
      const url = new URL(req.url);

      const request: BunifyRequest<T, Decorators> = {
        raw: req,
        query: Object.fromEntries(url.searchParams.entries()) as BunifyRequest<
          T,
          Decorators
        >["query"],
        params: (req.params || {}) as BunifyRequest<T, Decorators>["params"],
        json: () => req.json(),
        text: () => req.text(),
        headers: req.headers,
        method: req.method,
        url: req.url,
        ...(this.decorators as Decorators),
      };

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
      let index = -1;
      const next = async (i: number): Promise<any> => {
        if (i <= index) {
          throw new Error("next() called multiple times");
        }
        index = i;

        if (i === middlewares.length) {
          return handler(request, reply);
        }

        const mw = middlewares[i];
        if (mw) {
          return mw(request, reply, () => next(i + 1));
        }
      };
      return next(0);
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

  private runHooks<T extends RouteSchema>(
    hooks: Middleware<T, Decorators>[],
    request: BunifyRequest<T, Decorators>,
    reply: BunifyReply<T>,
  ) {
    let index = -1;

    const next = async (i: number): Promise<any> => {
      if (i <= index) {
        throw new Error("next() called multiple times in hooks");
      }
      index = i;

      const fn = hooks[i];
      if (!fn) return;

      return fn(request, reply, () => next(i + 1));
    };
    return next(0);
  }

  private async runPipeline<T extends RouteSchema>(
    request: BunifyRequest<T, Decorators>,
    reply: BunifyReply<T>,
    handler: Handler<T, Decorators>,
  ) {
    let res = await this.runHooks(
      this.hooks.onRequest as Middleware<T, Decorators>[],
      request,
      reply,
    );
    if (reply.sent) return;

    res = await this.runHooks(
      this.hooks.preHandler as Middleware<T, Decorators>[],
      request,
      reply,
    );
    if (reply.sent) return;

    res = await handler(request, reply);
    if (reply.sent) return res;

    await this.runHooks(
      this.hooks.onResponse as Middleware<T, Decorators>[],
      request,
      reply,
    );

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

  listen(port: number, callback?: (address: string) => void) {
    const server = Bun.serve({
      port: port,
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
