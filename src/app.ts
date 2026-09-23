import path from "node:path";
import { BLANK_DIAGRAM } from "./blank-diagram.js";
import { SnapshotStore } from "./store.js";
import { applyPatch, detectFormat, isBlankDiagram, summarizeXml } from "./xml.js";
import type { EditorHost, LayoutName, PageRef, PatchOp } from "./types.js";

export class WeaverApp {
  /** autosave 写入串行化:连续拖拽触发的并发写按入队顺序落盘 */
  private autosaveChain: Promise<void> = Promise.resolve();

  constructor(
    readonly store: SnapshotStore,
    readonly host: EditorHost,
  ) {
    this.host.onAutosave((xml) => {
      void this.persistAutosave(xml);
    });
  }

  async editorEnsure() {
    const status = await this.host.ensure();
    return {
      ...status,
      storeRoot: this.store.rootDir(),
      storeCreated: await this.store.hasRoot(),
    };
  }

  async replace(args: { content: string; format?: "mermaid" | "drawio"; layout?: LayoutName }) {
    const format = args.format ?? detectFormat(args.content);
    const layout: LayoutName = args.layout ?? (format === "mermaid" ? "verticalFlow" : "none");
    const xml =
      format === "mermaid"
        ? await this.host.load({ mermaid: args.content, layout })
        : await this.host.load({ xml: args.content, layout });
    await this.persistAutosave(xml);
    return { format, layout, summary: summarizeXml(xml) };
  }

  async read(args: { format?: "summary" | "xml" } = {}) {
    const xml = await this.readXmlOptional();
    if (!xml || isBlankDiagram(xml)) {
      return {
        empty: true,
        storeRoot: this.store.rootDir(),
        storeCreated: await this.store.hasRoot(),
        ...(args.format === "xml" && xml ? { xml } : {}),
      };
    }
    const summary = summarizeXml(xml);
    if (args.format === "xml") return { empty: false, summary, xml };
    return { empty: false, summary };
  }

  async patch(args: { operations: PatchOp[]; layout?: LayoutName; page?: PageRef }) {
    if (!args.operations.length) throw new Error("diagram_patch requires at least one operation");
    const xml0 = (await this.readXmlOptional()) ?? BLANK_DIAGRAM;
    const xml1 = applyPatch(xml0, args.operations, args.page);
    const needsLayout = args.operations.some((op) => op.type !== "set_label");
    const layout: LayoutName = args.layout ?? (needsLayout ? "verticalFlow" : "none");
    const xml = await this.host.load({ xml: xml1, layout });
    await this.persistAutosave(xml);
    return { layout, summary: summarizeXml(xml) };
  }

  async snapshot(label: string) {
    const xml = await this.readXmlOptional();
    if (!xml || isBlankDiagram(xml)) throw new Error("nothing to snapshot");
    return this.store.snapshot(label, xml);
  }

  async restore(label?: string) {
    if (!label) return { snapshots: await this.store.list() };
    const xml = await this.store.restore(label);
    await this.host.load({ xml, layout: "none" });
    return { restored: label, summary: summarizeXml(xml) };
  }

  async exportTo(filePath: string) {
    const trimmed = filePath.trim();
    if (!trimmed) throw new Error("diagram_export requires an explicit path");
    const xml = await this.readXmlOptional();
    if (!xml) throw new Error("no diagram to export");
    const dest = path.resolve(trimmed);
    await this.store.exportTo(dest, xml);
    return { path: dest };
  }

  async persistAutosave(xml: string): Promise<void> {
    const run = this.autosaveChain.then(() => this.writeAutosave(xml));
    this.autosaveChain = run.catch(() => {});
    return run;
  }

  private async writeAutosave(xml: string): Promise<void> {
    try {
      if (isBlankDiagram(xml) && !(await this.store.hasCurrent())) return;
      await this.store.writeCurrent(xml);
    } catch (err) {
      console.error("diag-weaver autosave failed:", err);
    }
  }

  private async readXmlOptional(): Promise<string | null> {
    if (this.host.isConnected()) return this.host.readXml();
    return this.store.readCurrent();
  }
}
