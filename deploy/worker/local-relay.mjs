#!/usr/bin/env bun
/**
 * Local stand-in for the Cloudflare Worker in ./src/index.js: same protocol,
 * no account needed. Use it to try the relay end to end, or when you want the
 * tunnel on a machine of your own.
 *
 *   bun deploy/worker/local-relay.mjs --key my-secret --port 8787
 *
 * Then in CC GUI → 设置 → 手机访问 → 外网访问, set the address to
 * http://127.0.0.1:8787 with that key.
 */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const KEY = args.get("key") ?? process.env.RELAY_KEY ?? "dev-secret";
const PORT = Number(args.get("port") ?? process.env.PORT ?? 8787);

/** @type {ServerWebSocket | null} */
let agent = null;
let nextId = 1;
/** @type {Map<number, {push: (b: Uint8Array) => void, ws: ServerWebSocket | null}>} */
const streams = new Map();

function send(frame) {
  if (agent) agent.send(JSON.stringify(frame));
}

function base64FromBytes(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function bytesFromBase64(text) {
  return new Uint8Array(Buffer.from(text, "base64"));
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/agent") {
      if (url.searchParams.get("key") !== KEY) return new Response("forbidden", { status: 403 });
      if (server.upgrade(request, { data: { agent: true } })) return;
      return new Response("expected a websocket", { status: 426 });
    }

    if (!agent) {
      return new Response("desktop not connected to the relay", { status: 503 });
    }

    const appPath = url.pathname + url.search;
    const id = nextId++;

    if (request.headers.get("upgrade") === "websocket") {
      // Carry the browser's headers, the Worker does the same: the bridge's
      // gate reads the cookie to recognise an approved device.
      if (
        !server.upgrade(request, {
          data: { id, path: appPath, headers: Object.fromEntries(request.headers.entries()) },
        })
      ) {
        return new Response("upgrade failed", { status: 400 });
      }
      return;
    }

    // HTTP: request head + body out, response head + chunks back. The status
    // and headers must come from the desktop (403 + the waiting page included).
    const body = new Uint8Array(await request.arrayBuffer());
    const headers = Object.fromEntries(request.headers.entries());
    let controller;
    const queued = [];
    let resolveHead;
    const headReady = new Promise((r) => (resolveHead = r));
    const stream = new ReadableStream({
      start: (c) => {
        controller = c;
        for (const chunk of queued.splice(0)) c.enqueue(chunk);
      },
      cancel: () => send({ t: "close", id }),
    });
    streams.set(id, {
      push: (bytes) => {
        if (controller) {
          try {
            controller.enqueue(bytes);
          } catch {}
        } else {
          queued.push(bytes);
        }
      },
      ws: null,
      head: (info) => resolveHead(info),
      end: () => {
        streams.delete(id);
        try {
          controller?.close();
        } catch {}
      },
      fail: (message) => {
        streams.delete(id);
        queued.push(new TextEncoder().encode(message));
        try {
          controller?.close();
        } catch {}
      },
    });

    send({ t: "open", id, method: request.method, path: appPath, headers });
    if (body.length) send({ t: "body", id, b64: base64FromBytes(body) });
    send({ t: "end", id });

    const head = await Promise.race([
      headReady,
      new Promise((r) => setTimeout(() => r({ status: 504, headers: {} }), 30000)),
    ]);
    return new Response(stream, { status: head.status ?? 200, headers: head.headers ?? {} });
  },
  websocket: {
    open(socket) {
      const data = socket.data;
      if (data.agent) {
        if (agent && agent !== socket) agent.close(1012, "replaced");
        agent = socket;
        return;
      }
      // Phone socket: hand the desktop an open for it.
      streams.set(data.id, {
        push: (bytes, asText) =>
          socket.send(asText === false ? bytes : Buffer.from(bytes).toString("utf8")),
        ws: socket,
        end: () => socket.close(1012),
        fail: () => socket.close(1012),
      });
      // Forward the browser's headers, cookie included: the bridge's gate
      // needs them to recognise an approved device (matches the Worker).
      send({ t: "open", id: data.id, ws: true, path: data.path, headers: data.headers ?? {} });
    },
    message(socket, message) {
      const data = socket.data;
      if (data.agent) {
        const frame = JSON.parse(typeof message === "string" ? message : message.toString());
        const stream = streams.get(frame.id);
        if (!stream) return;
        if (frame.t === "head") stream.head?.({ status: frame.status, headers: frame.headers ?? {} });
        if (frame.t === "data") stream.push(bytesFromBase64(frame.b64), frame.text);
        if (frame.t === "close") stream.end();
        if (frame.t === "error") stream.fail(frame.message ?? "relay error");
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      // Phone → desktop.
      const isText = typeof message === "string";
      const bytes = isText ? Buffer.from(message) : message;
      send({ t: "data", id: data.id, b64: base64FromBytes(bytes), text: isText });
    },
    close(socket) {
      const data = socket.data;
      if (data.agent) {
        if (agent === socket) agent = null;
        for (const stream of streams.values()) stream.end();
        streams.clear();
        return;
      }
      streams.delete(data.id);
      send({ t: "close", id: data.id });
    },
  },
});

console.log(`relay listening on http://127.0.0.1:${PORT} (key: ${KEY})`);
console.log(`phone url: http://127.0.0.1:${PORT}/?token=<the token in 设置 → 手机访问>`);
