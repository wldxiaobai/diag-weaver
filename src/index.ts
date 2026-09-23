#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WeaverApp } from "./app.js";
import { BrowserHost } from "./browser-host.js";
import { createMcpServer } from "./mcp-server.js";
import { SnapshotStore } from "./store.js";

async function main(): Promise<void> {
  const store = new SnapshotStore();
  const host = new BrowserHost({
    getInitialXml: () => store.readCurrent(),
  });
  const app = new WeaverApp(store, host);

  // 懒启动:进程启动只接 stdio,不绑编辑器端口、不建目录;
  // 首次 editor_ensure / diagram_replace 时 BrowserHost.ensure() 才 listen 并打开浏览器
  console.error(
    `diag-weaver ready. store=${store.rootDir()} created=${await store.hasRoot()} (editor starts lazily on first editor_ensure; directories are created only on first real save)`,
  );

  const server = createMcpServer(app);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await host.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
