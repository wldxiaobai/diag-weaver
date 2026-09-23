import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WeaverApp } from "../src/app.js";
import { MemoryHost } from "../src/memory-host.js";
import { createMcpServer } from "../src/mcp-server.js";
import { SnapshotStore } from "../src/store.js";

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "diag-weaver-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function appAt(storeRoot: string): WeaverApp {
  return new WeaverApp(new SnapshotStore(storeRoot), new MemoryHost());
}

/** 支持图片导出的测试桩:返回可识别的假字节 */
class ImageHost extends MemoryHost {
  async exportImage(format: "png" | "svg"): Promise<Uint8Array> {
    return Buffer.from(format === "png" ? "fake-png-bytes" : "fake-svg-bytes");
  }
}

describe("WeaverApp", () => {
  it("does not create graph-store or the user store on read/ensure", async () => {
    const workspace = await tempDir();
    const storeRoot = path.join(await tempDir(), "missing-store");
    const previous = process.cwd();
    process.chdir(workspace);
    try {
      const app = appAt(storeRoot);
      await app.editorEnsure();
      const read = await app.read();
      expect(read.empty).toBe(true);
      expect(await readdir(workspace)).toEqual([]);
      expect(await app.store.hasRoot()).toBe(false);
    } finally {
      process.chdir(previous);
    }
  });

  it("replace, patch, snapshot, restore, and explicit export", async () => {
    const workspace = await tempDir();
    const storeRoot = path.join(await tempDir(), "store");
    const previous = process.cwd();
    process.chdir(workspace);
    try {
      const app = appAt(storeRoot);
      const replaced = await app.replace({
        content: "flowchart TD\n  ingest --> weave",
      });
      expect(replaced.format).toBe("mermaid");
      expect(replaced.summary.blank).toBe(false);

      const patched = await app.patch({
        operations: [{ type: "add_node", id: "note", label: "keep" }],
        layout: "none",
      });
      expect(patched.summary.cells.some((cell) => cell.id === "note")).toBe(true);

      const snap = await app.snapshot("评审前");
      expect(snap.label).toBe("评审前");

      await app.patch({
        operations: [{ type: "set_label", id: "note", label: "changed" }],
        layout: "none",
      });
      await app.restore("评审前");
      const after = await app.read();
      expect("summary" in after && after.summary.cells.some((cell) => cell.label === "keep")).toBe(true);

      const exported = await app.exportTo("./docs/architecture.drawio");
      expect(await readFile(exported.path, "utf8")).toMatch(/vertex="1"/);
      expect(await readdir(workspace)).toEqual(["docs"]);
      expect(await app.store.hasCurrent()).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });

  it("serializes concurrent autosave writes so the file is always complete", async () => {
    const storeRoot = path.join(await tempDir(), "store");
    const app = appAt(storeRoot);
    const xmls = Array.from(
      { length: 10 },
      (_, i) => `<mxfile><diagram name="d${i}"><mxGraphModel><root><mxCell id="0"/><mxCell id="v${i}" vertex="1" parent="1"/>${"<!-- pad -->".repeat(64)}</root></mxGraphModel></diagram></mxfile>`,
    );
    // 模拟连续拖拽:不等待前一次落盘就触发下一次
    await Promise.all(xmls.map((xml) => app.persistAutosave(xml)));
    const final = await readFile(path.join(storeRoot, "current.drawio"), "utf8");
    expect(final).toBe(xmls[9]);
    expect(final).toMatch(/^<mxfile>[\s\S]*<\/mxfile>$/);
  });

  it("patch requires and targets an explicit page for multi-page diagrams", async () => {
    const app = appAt(path.join(await tempDir(), "store"));
    const multiPage = `<mxfile host="test">
      <diagram id="p1" name="架构"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>
      </root></mxGraphModel></diagram>
      <diagram id="p2" name="部署"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>
      </root></mxGraphModel></diagram>
    </mxfile>`;
    await app.replace({ content: multiPage, format: "drawio", layout: "none" });

    await expect(
      app.patch({ operations: [{ type: "add_node", id: "x", label: "X" }], layout: "none" }),
    ).rejects.toThrow(/explicit page/);

    const patched = await app.patch({
      operations: [{ type: "add_node", id: "x", label: "X" }],
      layout: "none",
      page: "部署",
    });
    expect(patched.summary.pages[1].cells.some((cell) => cell.id === "x")).toBe(true);
    expect(patched.summary.pages[0].cells.some((cell) => cell.id === "x")).toBe(false);
  });

  it("remove ops delete cells without triggering relayout", async () => {
    const app = appAt(path.join(await tempDir(), "store"));
    await app.replace({ content: "flowchart TD\n  ingest --> weave" });
    const patched = await app.patch({ operations: [{ type: "remove_node", id: "ingest" }] });
    expect(patched.layout).toBe("none");
    expect(patched.summary.cells.some((cell) => cell.id === "ingest")).toBe(false);
    expect(patched.summary.cells.some((cell) => cell.id === "weave")).toBe(true);
  });

  it("exports png/svg via the live canvas, inferring format from extension", async () => {
    const workspace = await tempDir();
    const app = new WeaverApp(new SnapshotStore(path.join(await tempDir(), "store")), new ImageHost());
    const previous = process.cwd();
    process.chdir(workspace);
    try {
      await app.replace({ content: "flowchart TD\n  a --> b" });

      const png = await app.exportTo("./img/arch.png");
      expect(png.format).toBe("png");
      expect((await readFile(png.path)).toString("utf8")).toBe("fake-png-bytes");

      // 显式 format 优先于扩展名
      const svg = await app.exportTo("./img/arch.blob", "svg");
      expect(svg.format).toBe("svg");
      expect((await readFile(svg.path)).toString("utf8")).toBe("fake-svg-bytes");

      const drawio = await app.exportTo("./img/arch.drawio");
      expect(drawio.format).toBe("drawio");
      expect(await readFile(drawio.path, "utf8")).toMatch(/vertex="1"|<mxfile/);

      expect((await readdir(path.join(workspace, "img"))).sort()).toEqual(["arch.blob", "arch.drawio", "arch.png"]);
    } finally {
      process.chdir(previous);
    }
  });

  it("image export fails clearly without image-capable canvas", async () => {
    const workspace = await tempDir();
    const app = appAt(path.join(await tempDir(), "store"));
    const previous = process.cwd();
    process.chdir(workspace);
    try {
      await app.replace({ content: "flowchart TD\n  a --> b" });
      await expect(app.exportTo("./img/arch.png")).rejects.toThrow(/live canvas/);
      expect(await readdir(workspace)).toEqual([]);
    } finally {
      process.chdir(previous);
    }
  });

  it("registers the thin MCP tool surface", () => {
    const server = createMcpServer(appAt(path.join(os.tmpdir(), "unused")));
    const tools = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(tools.sort()).toEqual(
      [
        "diagram_export",
        "diagram_patch",
        "diagram_read",
        "diagram_replace",
        "diagram_restore",
        "diagram_snapshot",
        "editor_ensure",
      ].sort(),
    );
  });
});
