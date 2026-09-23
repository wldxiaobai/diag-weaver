import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { BLANK_DIAGRAM } from "./blank-diagram.js";
import type { EditorHost, EditorStatus, LoadOptions } from "./types.js";

type DrawioMsg = Record<string, unknown>;

const DEFAULT_PORT = 47821;
const DRAWIO_ORIGIN = "https://embed.diagrams.net";

function webDir(): string {
  return fileURLToPath(new URL("../web", import.meta.url));
}

function openBrowser(url: string): void {
  if (process.env.DIAG_WEAVER_NO_BROWSER === "1") return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

/** 解码 draw.io export 返回的 data URL(或裸 base64)为二进制 */
export function decodeExportData(data: unknown, format: "png" | "svg"): Uint8Array {
  if (typeof data !== "string" || !data.trim()) {
    throw new Error(`draw.io export returned no ${format} data`);
  }
  let bytes: Uint8Array;
  if (data.startsWith("data:")) {
    const comma = data.indexOf(",");
    if (comma === -1) throw new Error(`draw.io ${format} export is a malformed data URL`);
    const meta = data.slice(0, comma);
    const payload = data.slice(comma + 1);
    bytes = meta.includes(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
  } else {
    bytes = Buffer.from(data, "base64");
  }
  if (!bytes.length) throw new Error(`draw.io ${format} export decoded to empty data`);
  return bytes;
}

function waitUntil(predicate: () => boolean, ms: number, message: string): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > ms) return reject(new Error(message));
      setTimeout(tick, 50);
    };
    tick();
  });
}

export type BrowserHostOptions = {
  getInitialXml: () => Promise<string | null>;
  port?: number;
  openBrowser?: boolean;
};

/**
 * First-period EditorHost: local HTTP page + official draw.io embed iframe.
 * Future Webview / MCP Apps hosts should implement the same EditorHost methods
 * without changing the MCP tool contract.
 */
export class BrowserHost implements EditorHost {
  private http: HttpServer | undefined;
  private wss: WebSocketServer | undefined;
  private socket: WebSocket | null = null;
  private editorReady = false;
  private _url = "";
  private chain: Promise<unknown> = Promise.resolve();
  private readonly waiters: Array<{
    event: string;
    resolve: (msg: DrawioMsg) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private readonly autosaveHandlers: Array<(xml: string) => void> = [];
  private readonly getInitialXml: () => Promise<string | null>;
  private readonly preferredPort: number;
  private readonly shouldOpenBrowser: boolean;

  constructor(opts: BrowserHostOptions) {
    this.getInitialXml = opts.getInitialXml;
    this.preferredPort = opts.port ?? Number(process.env.DIAG_WEAVER_PORT || DEFAULT_PORT);
    this.shouldOpenBrowser = opts.openBrowser ?? process.env.DIAG_WEAVER_NO_BROWSER !== "1";
  }

  get url(): string {
    return this._url;
  }

  isConnected(): boolean {
    return this.socket?.readyState === 1 && this.editorReady;
  }

  async listen(): Promise<void> {
    if (this.http) return;
    const html = await readFile(path.join(webDir(), "editor.html"), "utf8");
    const server = createServer((req, res) => {
      void this.handleHttp(req, res, html);
    });
    this.wss = new WebSocketServer({
      server,
      path: "/bridge",
      // 浏览器发起的 WS 握手必带 Origin;只放行本机编辑器页。
      // 无 Origin 的是非浏览器客户端(如桥协议测试的 ws 库),不属于「本机恶意网页」威胁模型。
      verifyClient: (info, done) => {
        if (!info.origin || this.isAllowedOrigin(info.origin)) done(true);
        else done(false, 403, "origin not allowed");
      },
    });
    this.wss.on("connection", (ws) => this.onSocket(ws));

    let lastError: unknown;
    for (let port = this.preferredPort; port < this.preferredPort + 10; port++) {
      try {
        await listenOn(server, port);
        this.http = server;
        this._url = `http://127.0.0.1:${port}/`;
        console.error(`diag-weaver editor at ${this._url}`);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("could not bind editor HTTP port");
  }

  async ensure(): Promise<EditorStatus> {
    await this.listen();
    if (!this.isConnected() && this.shouldOpenBrowser) {
      openBrowser(this._url);
    }
    await waitUntil(
      () => this.isConnected(),
      45_000,
      "timed out waiting for the draw.io canvas. Open the editor URL if the browser did not appear.",
    );
    return { url: this._url, connected: true, ready: true };
  }

  async load(opts: LoadOptions): Promise<string> {
    await this.ensure();
    return this.enqueue(() => this.sendLoad(opts));
  }

  async readXml(): Promise<string> {
    await this.ensure();
    return this.enqueue(() => this.exportXml());
  }

  onAutosave(handler: (xml: string) => void): void {
    this.autosaveHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.failWaiters(new Error("editor host closed"));
    this.socket?.close();
    this.socket = null;
    this.editorReady = false;
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.http?.close(() => resolve()));
    this.wss = undefined;
    this.http = undefined;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private isAllowedOrigin(origin: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) return false;
    // 只认本编辑器实际绑定的端口,避免本机其它服务的页面冒充
    const selfPort = this._url ? new URL(this._url).port : "";
    return parsed.port === selfPort;
  }

  /** socket 断开、被顶替或宿主关闭时,立即 reject 全部进行中的请求,不干等超时 */
  private failWaiters(err: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  private onSocket(ws: WebSocket): void {
    if (this.socket && this.socket !== ws) {
      this.socket.close();
      this.failWaiters(new Error("draw.io bridge replaced by a new connection"));
    }
    this.socket = ws;
    this.editorReady = false;
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      let msg: DrawioMsg;
      try {
        msg = JSON.parse(text) as DrawioMsg;
      } catch {
        return;
      }
      void this.handleMessage(msg);
    });
    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = null;
        this.editorReady = false;
        this.failWaiters(new Error("draw.io bridge disconnected"));
      }
    });
  }

  private async handleMessage(msg: DrawioMsg): Promise<void> {
    const event = String(msg.event ?? "");
    if (event === "bridge-open") {
      if (msg.editorInit) this.editorReady = true;
      return;
    }
    if (event === "init") {
      this.editorReady = true;
      const xml = (await this.getInitialXml()) ?? BLANK_DIAGRAM;
      await this.enqueue(() => this.sendLoad({ xml, layout: "none" }));
      return;
    }
    if ((event === "autosave" || event === "save") && typeof msg.xml === "string" && msg.xml) {
      for (const handler of this.autosaveHandlers) handler(msg.xml);
    }
    this.resolveWaiters(event, msg);
  }

  private async sendLoad(opts: LoadOptions): Promise<string> {
    const layout = opts.layout && opts.layout !== "none" ? opts.layout : undefined;
    const payload: DrawioMsg = {
      action: "load",
      autosave: 1,
      noExitBtn: 1,
      title: opts.title ?? "diag-weaver",
    };
    if (opts.mermaid) {
      payload.descriptor = { format: "mermaid", data: opts.mermaid, wrap: true };
      payload.sourceMetadata = { key: "mermaidSource", value: opts.mermaid };
    } else {
      payload.xml = opts.xml?.trim() ? opts.xml : BLANK_DIAGRAM;
    }
    if (layout) payload.layout = layout;
    const pending = this.waitFor("load", 60_000);
    this.send(payload);
    await pending;
    return this.exportXml();
  }

  async exportImage(format: "png" | "svg"): Promise<Uint8Array> {
    await this.ensure();
    return this.enqueue(async () => {
      const msg = await this.requestExport(format);
      return decodeExportData(msg.data, format);
    });
  }

  private async requestExport(format: string): Promise<DrawioMsg> {
    const pending = this.waitFor("export", 20_000);
    this.send({ action: "export", format });
    return pending;
  }

  private async exportXml(): Promise<string> {
    const msg = await this.requestExport("xml");
    const xml = typeof msg.xml === "string" ? msg.xml : "";
    if (!xml) throw new Error("draw.io export returned empty XML");
    return xml;
  }

  private send(payload: DrawioMsg): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("draw.io canvas is not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private waitFor(event: string, ms: number): Promise<DrawioMsg> {
    return new Promise((resolve, reject) => {
      const waiter = {
        event,
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new Error(`timed out waiting for draw.io event: ${event}`));
        }, ms),
      };
      this.waiters.push(waiter);
    });
  }

  private resolveWaiters(event: string, msg: DrawioMsg): void {
    const idx = this.waiters.findIndex((waiter) => waiter.event === event);
    if (idx < 0) return;
    const waiter = this.waiters.splice(idx, 1)[0];
    clearTimeout(waiter.timer);
    waiter.resolve(msg);
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse, html: string): Promise<void> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      json(res, 200, { ok: true, ready: this.editorReady, origin: DRAWIO_ORIGIN });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(html);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end("not found");
  }
}

function listenOn(server: HttpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
