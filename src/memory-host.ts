import { BLANK_DIAGRAM } from "./blank-diagram.js";
import { applyPatch, detectFormat } from "./xml.js";
import type { EditorHost, EditorStatus, LoadOptions, PageRef, PatchOp } from "./types.js";

/**
 * In-process canvas stand-in for tests. Not a product path.
 * Real sessions use BrowserHost + embed.diagrams.net.
 */
export class MemoryHost implements EditorHost {
  readonly url = "memory://diag-weaver";
  xml = BLANK_DIAGRAM;
  private readonly autosaveHandlers: Array<(xml: string) => void> = [];

  isConnected(): boolean {
    return true;
  }

  async ensure(): Promise<EditorStatus> {
    return { url: this.url, connected: true, ready: true };
  }

  async load(opts: LoadOptions): Promise<string> {
    if (opts.mermaid) {
      this.xml = mermaidStub(opts.mermaid);
    } else {
      this.xml = opts.xml?.trim() ? opts.xml : BLANK_DIAGRAM;
    }
    this.emit();
    return this.xml;
  }

  async readXml(): Promise<string> {
    return this.xml;
  }

  onAutosave(handler: (xml: string) => void): void {
    this.autosaveHandlers.push(handler);
  }

  async close(): Promise<void> {}

  async applyOperations(ops: PatchOp[], page?: PageRef): Promise<string> {
    this.xml = applyPatch(this.xml, ops, page);
    this.emit();
    return this.xml;
  }

  private emit(): void {
    for (const handler of this.autosaveHandlers) handler(this.xml);
  }
}

function mermaidStub(source: string): string {
  const format = detectFormat(source);
  if (format === "drawio") return source;
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%") && !/^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram)/i.test(line));
  const nodes = new Set<string>();
  for (const line of lines) {
    for (const token of line.split(/-->|->|---|-.->/)) {
      const id = token.replace(/[\[\](){}|].*$/, "").trim();
      if (id) nodes.add(id.slice(0, 40));
    }
  }
  const cells = [...nodes].map((id, i) => {
    const x = 40 + (i % 3) * 180;
    const y = 40 + Math.floor(i / 3) * 100;
    return `        <mxCell id="${id}" value="${id}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">\n          <mxGeometry x="${x}" y="${y}" width="140" height="60" as="geometry"/>\n        </mxCell>`;
  });
  return `<mxfile host="diag-weaver-memory"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>\n${cells.join("\n")}\n</root></mxGraphModel></diagram></mxfile>`;
}
