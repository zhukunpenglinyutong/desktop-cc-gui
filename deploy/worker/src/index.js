/**
 * CC GUI 中继（Cloudflare Worker）——让手机在外网访问本机 CC GUI，而无需在
 * 本机开放任何入站端口。
 *
 * 桌面端主动外连 /agent?key=<secret> 并保持一条 WebSocket；此后每个进来的请求
 * 都成为这条连接上的一条流，因此「谁能进来」仍然只由桌面端自己的桥接决定：URL
 * 里的 token 与逐设备授权都在应用内完成。本 Worker 只校验 key 并搬运字节。
 *
 * 流是具名且多路复用的，每个 key 一个 Durable Object 持有 agent socket，所以
 * 重连的桌面端永远不会和自己交错。
 *
 * ---
 *
 * CC GUI relay: lets a phone reach the desktop app without opening any
 * inbound port on the desktop.
 *
 * The desktop dials OUT to /agent?key=<secret> and keeps one WebSocket open.
 * Every request that arrives here becomes a stream on that socket, so the
 * desktop's own bridge stays the only thing that decides who gets in: the
 * token in the URL and the per-device approval both happen inside the app.
 * This Worker only checks the key and moves bytes.
 *
 * Streams are named and multiplexed, and one Durable Object per key owns the
 * agent socket, so a reconnecting desktop can never interleave with itself.
 */

const AGENT_PATH = "/agent";

export class Relay {
  constructor() {
    /** @type {WebSocket | null} */
    this.agent = null;
    this.nextId = 1;
    /** @type {Map<number, (t: string, frame: any) => void>} */
    this.streams = new Map();
  }

  send(frame) {
    if (this.agent?.readyState === WebSocket.OPEN) this.agent.send(JSON.stringify(frame));
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === AGENT_PATH) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket", { status: 426 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      // A reconnecting desktop replaces the previous socket; otherwise the
      // phone would keep talking into a pipe nobody reads.
      if (this.agent && this.agent !== server) {
        try {
          this.agent.close(1012, "replaced by a new agent connection");
        } catch {}
      }
      this.agent = server;
      server.addEventListener("message", (event) => this.onAgentFrame(event.data));
      server.addEventListener("close", () => {
        if (this.agent !== server) return;
        this.agent = null;
        for (const deliver of this.streams.values()) deliver("close", {});
        this.streams.clear();
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!this.agent || this.agent.readyState !== WebSocket.OPEN) {
      return new Response(
        "CC GUI 桌面端未连接到中继。请在电脑上打开 CC GUI → 设置 → 远程访问 → 外网访问，启动中转。",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    return request.headers.get("Upgrade") === "websocket"
      ? this.tunnelSocket(request)
      : this.tunnelHttp(request);
  }

  /** HTTP: request head + body in, response head + chunks out. */
  async tunnelHttp(request) {
    const id = this.nextId++;
    const body = new Uint8Array(await request.arrayBuffer());
    const headers = {};
    for (const [name, value] of request.headers) {
      // The hop is TLS-terminated here; the desktop's bridge sees plain HTTP.
      if (["host", "cf-connecting-ip", "cf-ray", "upgrade", "connection"].includes(name.toLowerCase())) continue;
      headers[name] = value;
    }

    let resolveHead;
    const headReady = new Promise((r) => (resolveHead = r));
    let controller;
    const queued = [];
    const stream = new ReadableStream({
      start: (c) => {
        controller = c;
        for (const chunk of queued.splice(0)) c.enqueue(chunk);
      },
      cancel: () => this.send({ t: "close", id }),
    });

    this.streams.set(id, (kind, frame) => {
      if (kind === "head") {
        resolveHead({ status: frame.status, headers: frame.headers ?? {} });
        return;
      }
      if (kind === "data") {
        const bytes = bytesFromBase64(frame.b64);
        if (controller) {
          try {
            controller.enqueue(bytes);
          } catch {}
        } else {
          queued.push(bytes);
        }
        return;
      }
      if (kind === "close" || kind === "error") {
        this.streams.delete(id);
        const finish = () => {
          try {
            controller?.close();
          } catch {}
        };
        // A stream that died before its head still needs a valid response.
        resolveHead({ status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
        if (controller) finish();
        else queued.push(new TextEncoder().encode(frame.message ?? "relay stream closed"));
        return;
      }
    });

    const path = new URL(request.url).pathname + new URL(request.url).search;
    this.send({ t: "open", id, method: request.method, path, headers });
    if (body.length) this.send({ t: "body", id, b64: base64FromBytes(body) });
    this.send({ t: "end", id });

    // A head that never came back still has to release the stream: the desktop
    // may answer later (or never), and leaving the entry in `streams` leaks one
    // per timed-out request while the phone waits on a body nobody will close.
    const timeout = new Promise((r) =>
      setTimeout(
        () => r({ status: 504, headers: { "content-type": "text/plain; charset=utf-8" }, expired: true }),
        30000,
      ),
    );
    const head = await Promise.race([headReady, timeout]);
    if (head.expired) {
      this.streams.delete(id);
      this.send({ t: "close", id });
      try {
        controller?.close();
      } catch {}
    }
    return new Response(stream, { status: head.status, headers: head.headers });
  }

  /** Live socket (the app's /ws): frames travel both ways, unframed. */
  tunnelSocket(request) {
    const id = this.nextId++;
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    const headers = {};
    for (const [name, value] of request.headers) {
      if (["host", "cf-connecting-ip", "cf-ray", "upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"].includes(name.toLowerCase())) continue;
      headers[name] = value;
    }

    this.streams.set(id, (kind, frame) => {
      if (kind === "data") {
        try {
          // The app's client reads JSON; a frame the desktop sent as text must
          // not turn into a Blob on the way (it used to, and every response was
          // dropped).
          const bytes = bytesFromBase64(frame.b64);
          if (frame.text === false) server.send(bytes);
          else server.send(new TextDecoder().decode(bytes));
        } catch {}
        return;
      }
      if (kind === "close" || kind === "error") {
        this.streams.delete(id);
        try {
          server.close(1012, "relay stream closed");
        } catch {}
      }
    });

    const path = new URL(request.url).pathname + new URL(request.url).search;
    this.send({ t: "open", id, ws: true, path, headers });

    server.addEventListener("message", (event) => {
      const isText = typeof event.data === "string";
      const bytes = isText ? new TextEncoder().encode(event.data) : new Uint8Array(event.data);
      this.send({ t: "data", id, b64: base64FromBytes(bytes), text: isText });
    });
    server.addEventListener("close", () => {
      this.streams.delete(id);
      this.send({ t: "close", id });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  onAgentFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const deliver = this.streams.get(frame.id);
    deliver?.(frame.t, frame);
  }
}

function base64FromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export default {
  async fetch(request, env) {
    const key = env.RELAY_KEY;
    if (!key) return new Response("relay key is not configured", { status: 500 });
    const url = new URL(request.url);

    // 1. The desktop's own connection: /agent?key=<secret>.
    if (url.pathname === AGENT_PATH) {
      if (url.searchParams.get("key") !== key) return new Response("forbidden", { status: 403 });
      return env.RELAY.get(env.RELAY.idFromName(key)).fetch(request);
    }

    // 2. Everyone else is the phone, and its URL carries the app's own token:
    //    the desktop's bridge is what decides (token + per-device approval),
    //    so this Worker holds no policy beyond "is there a desktop attached".
    return env.RELAY.get(env.RELAY.idFromName(key)).fetch(request);
  },
};
