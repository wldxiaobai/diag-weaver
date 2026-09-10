import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WeaverApp } from "../dist/app.js";
import { BrowserHost } from "../dist/browser-host.js";
import { SnapshotStore } from "../dist/store.js";

const storeRoot = await mkdtemp(path.join(os.tmpdir(), "diag-weaver-live-"));
const store = new SnapshotStore(storeRoot);
const host = new BrowserHost({
  getInitialXml: () => store.readCurrent(),
  port: Number(process.env.DIAG_WEAVER_PORT || 47821),
  openBrowser: false,
});
const app = new WeaverApp(store, host);
await host.listen();
console.error(`SMOKE_URL ${host.url}`);
console.error(`SMOKE_STORE ${storeRoot} created=${await store.hasRoot()}`);

const replaced = await app.replace({
  content: "flowchart LR\n  User -->|UI| Editor\n  Agent -->|MCP| Editor\n  Editor --> Store",
  layout: "horizontalFlow",
});
const read = await app.read({ format: "xml" });
const out = path.join(process.cwd(), "smoke-result.json");
await writeFile(
  out,
  JSON.stringify(
    {
      storeRoot,
      storeCreated: await store.hasRoot(),
      replaced,
      cellCount: "summary" in read ? read.summary.cells.length : 0,
      xmlSnippet: "xml" in read ? String(read.xml).slice(0, 400) : "",
    },
    null,
    2,
  ),
);
console.error(`SMOKE_DONE ${out}`);
await new Promise((resolve) => setTimeout(resolve, Number(process.env.SMOKE_HOLD_MS || 0)));
await host.close();
process.exit(0);
