import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserHost, decodeExportData } from "../src/browser-host.js";

const hosts: BrowserHost[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) closeQuietly(client);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function track(client: WebSocket): WebSocket {
  clients.push(client);
  return client;
}

/** 清理测试客户端:未连上的握手 terminate 会同步抛错,吞掉即可 */
function closeQuietly(client: WebSocket): void {
  client.removeAllListeners();
  client.on("error", () => {});
  try {
    client.terminate();
  } catch {
    client.close();
  }
}

function bridgeUrl(host: BrowserHost): string {
  return host.url.replace(/^http/, "ws") + "bridge";
}

/**
 * 模拟 embed 编辑器页:init 握手、应答 load;
 * 第 1 次 export 正常应答(消化 init 流程),第 2 次 export 到达时只记录不应答,
 * 供断连 / 顶替场景挂起等待。
 */
async function fakeEditor(host: BrowserHost): Promise<{
  client: WebSocket;
  secondExport: Promise<void>;
}> {
  const client = track(new WebSocket(bridgeUrl(host)));
  await once(client, "open");
  let exports = 0;
  let resolveSecond!: () => void;
  const secondExport = new Promise<void>((resolve) => {
    resolveSecond = resolve;
  });
  client.on("message", (data) => {
    const msg = JSON.parse(String(data)) as { action?: string };
    if (msg.action === "load") client.send(JSON.stringify({ event: "load" }));
    if (msg.action === "export") {
      exports += 1;
      if (exports === 1) client.send(JSON.stringify({ event: "export", xml: "<mxfile/>" }));
      else resolveSecond();
    }
  });
  client.send(JSON.stringify({ event: "init" }));
  return { client, secondExport };
}

async function listeningHost(): Promise<BrowserHost> {
  const host = new BrowserHost({
    getInitialXml: async () => null,
    port: await freePort(),
    openBrowser: false,
  });
  hosts.push(host);
  await host.listen();
  return host;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

describe("BrowserHost", () => {
  it("listens without creating a store and serves health + editor page", async () => {
    const port = await freePort();
    const host = new BrowserHost({
      getInitialXml: async () => null,
      port,
      openBrowser: false,
    });
    hosts.push(host);
    await host.listen();
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const health = await fetch(new URL("/health", host.url));
    expect(health.ok).toBe(true);
    const body = (await health.json()) as { ok: boolean; ready: boolean };
    expect(body.ok).toBe(true);
    expect(body.ready).toBe(false);

    const page = await fetch(host.url);
    const html = await page.text();
    expect(html).toContain("embed.diagrams.net");
    expect(html).toContain("proto=json");
  });

  it("stays lazy: no port bound and not connected before listen/ensure", async () => {
    const host = new BrowserHost({
      getInitialXml: async () => null,
      port: await freePort(),
      openBrowser: false,
    });
    hosts.push(host);
    expect(host.url).toBe("");
    expect(host.isConnected()).toBe(false);
  });

  it("rejects a bridge handshake from a foreign web page origin", async () => {
    const host = await listeningHost();
    const evil = track(new WebSocket(bridgeUrl(host), { origin: "http://evil.example" }));
    const outcome = await new Promise<string>((resolve) => {
      evil.on("unexpected-response", (_req, res) => resolve(`status ${res.statusCode}`));
      evil.on("open", () => resolve("open"));
    });
    expect(outcome).toBe("status 403");
  });

  it("accepts the local editor page origin", async () => {
    const host = await listeningHost();
    const port = new URL(host.url).port;
    const good = track(new WebSocket(bridgeUrl(host), { origin: `http://127.0.0.1:${port}` }));
    const outcome = await new Promise<string>((resolve) => {
      good.on("unexpected-response", (_req, res) => resolve(`status ${res.statusCode}`));
      good.on("open", () => resolve("open"));
    });
    expect(outcome).toBe("open");
  });

  it("fails pending requests immediately when the bridge disconnects", async () => {
    const host = await listeningHost();
    const { client, secondExport } = await fakeEditor(host);
    const pending = host.readXml();
    await secondExport;
    const started = Date.now();
    client.terminate();
    await expect(pending).rejects.toThrow(/disconnected/i);
    // 断连必须快速失败,而不是干等 20s export 超时
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("exportImage round-trips base64 png data through the bridge", async () => {
    const host = await listeningHost();
    const client = track(new WebSocket(bridgeUrl(host)));
    await once(client, "open");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    client.on("message", (data) => {
      const msg = JSON.parse(String(data)) as { action?: string; format?: string };
      if (msg.action === "load") client.send(JSON.stringify({ event: "load" }));
      if (msg.action === "export") {
        if (msg.format === "png") {
          client.send(
            JSON.stringify({ event: "export", format: "png", data: `data:image/png;base64,${png.toString("base64")}` }),
          );
        } else {
          client.send(JSON.stringify({ event: "export", xml: "<mxfile/>" }));
        }
      }
    });
    client.send(JSON.stringify({ event: "init" }));
    const got = await host.exportImage("png");
    expect(Buffer.from(got)).toEqual(png);
  });

  it("fails pending requests when a second tab replaces the socket", async () => {
    const host = await listeningHost();
    const { secondExport } = await fakeEditor(host);
    // 同步挂上 rejection handler,避免服务端先 reject 造成 unhandled rejection
    const outcome = host.readXml().then(
      () => null,
      (err: Error) => err.message,
    );
    await secondExport;
    const started = Date.now();
    const second = track(new WebSocket(bridgeUrl(host)));
    await once(second, "open");
    expect(await outcome).toMatch(/replaced/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("decodeExportData", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("decodes base64 data URLs", () => {
    const decoded = decodeExportData(`data:image/png;base64,${pngBytes.toString("base64")}`, "png");
    expect(Buffer.from(decoded)).toEqual(pngBytes);
  });

  it("decodes raw base64 without the data URL prefix", () => {
    expect(Buffer.from(decodeExportData(pngBytes.toString("base64"), "png"))).toEqual(pngBytes);
  });

  it("decodes url-encoded svg data URLs", () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const decoded = decodeExportData(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, "svg");
    expect(Buffer.from(decoded).toString("utf8")).toBe(svg);
  });

  it("rejects empty or malformed payloads", () => {
    expect(() => decodeExportData("", "png")).toThrow(/no png data/);
    expect(() => decodeExportData(undefined, "svg")).toThrow(/no svg data/);
    expect(() => decodeExportData("data:image/png;base64,", "png")).toThrow(/empty data/);
    expect(() => decodeExportData("data:image/png", "png")).toThrow(/malformed data URL/);
  });
});
