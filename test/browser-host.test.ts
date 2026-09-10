import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserHost } from "../src/browser-host.js";

const hosts: BrowserHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

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
});
