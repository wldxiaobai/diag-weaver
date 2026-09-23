import { BLANK_DIAGRAM } from "./blank-diagram.js";
import type { CellSummary, DiagramSummary, PageRef, PatchOp } from "./types.js";

export function detectFormat(content: string): "mermaid" | "drawio" {
  const t = content.trim();
  if (t.startsWith("<") && /mxfile|mxGraphModel|mxGraph/i.test(t)) return "drawio";
  return "mermaid";
}

export function isBlankDiagram(xml: string | null | undefined): boolean {
  if (!xml || !xml.trim()) return true;
  return !/(?:\bvertex="1"|\bedge="1"|\bvertex="true"|\bedge="true")/.test(xml);
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function unescapeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function attr(tagAttrs: string, name: string): string | undefined {
  const m = tagAttrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m?.[1];
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 一页 <diagram> 的内容区间;裸 mxGraphModel(无 mxfile 包裹)视为单页 */
export type PageSpan = {
  contentStart: number;
  contentEnd: number;
  id?: string;
  name?: string;
};

export function findPages(xml: string): PageSpan[] {
  const pages: PageSpan[] = [];
  const re = /<diagram\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const contentStart = re.lastIndex;
    const close = xml.indexOf("</diagram>", contentStart);
    const contentEnd = close === -1 ? xml.length : close;
    pages.push({ contentStart, contentEnd, id: attr(m[1], "id"), name: attr(m[1], "name") });
    re.lastIndex = contentEnd;
  }
  if (!pages.length) pages.push({ contentStart: 0, contentEnd: xml.length });
  return pages;
}

function pageLabel(span: PageSpan, index: number): string {
  return span.name || span.id || String(index + 1);
}

/** 解析目标页:单页可省略 page;多页必须显式指定,否则报错列出全部页 */
export function resolvePageIndex(spans: PageSpan[], page: PageRef | undefined): number {
  const known = spans.map(pageLabel).join(", ");
  const matches = (span: PageSpan, index: number): boolean => {
    if (page === undefined) return false;
    if (typeof page === "number") return page === index + 1;
    const needle = page.trim();
    if (/^\d+$/.test(needle)) return Number(needle) === index + 1;
    return needle === span.name || needle === span.id;
  };
  const idx = spans.findIndex(matches);
  if (spans.length === 1) {
    if (page === undefined || idx === 0) return 0;
    throw new Error(`page not found: ${page}. known pages: ${known}`);
  }
  if (page === undefined) {
    throw new Error(`diagram has ${spans.length} pages; pass an explicit page (one of: ${known})`);
  }
  if (idx === -1) throw new Error(`page not found: ${page}. known pages: ${known}`);
  return idx;
}

/** 扫描单页内容区间,输出该页的 cell 列表 */
function summarizeCells(xml: string): CellSummary[] {
  const cells: CellSummary[] = [];
  const seen = new Set<string>();

  const objects = /<UserObject\b([^>]*)>([\s\S]*?)<\/UserObject>/g;
  let m: RegExpExecArray | null;
  while ((m = objects.exec(xml))) {
    const attrs = m[1];
    const inner = m[2];
    const id = attr(attrs, "id");
    if (!id || id === "0" || id === "1") continue;
    const vertex = /\bvertex="1"/.test(inner) || /\bvertex="true"/.test(inner);
    const edge = /\bedge="1"/.test(inner) || /\bedge="true"/.test(inner);
    if (!vertex && !edge) continue;
    if (/style="[^"]*\bgroup;/.test(inner)) continue;
    seen.add(id);
    const label = unescapeXml(attr(attrs, "label") ?? "");
    cells.push({
      id,
      type: vertex ? "node" : "edge",
      label: label || undefined,
      source: attr(inner, "source"),
      target: attr(inner, "target"),
    });
  }

  const re = /<mxCell\b([^>]*)\/?>/g;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const id = attr(attrs, "id");
    if (!id || id === "0" || id === "1" || seen.has(id)) continue;
    const vertex = attr(attrs, "vertex");
    const edge = attr(attrs, "edge");
    const type = vertex === "1" || vertex === "true" ? "node" : edge === "1" || edge === "true" ? "edge" : null;
    if (!type) continue;
    const label = unescapeXml(attr(attrs, "value") ?? "");
    cells.push({
      id,
      type,
      label: label || undefined,
      source: attr(attrs, "source"),
      target: attr(attrs, "target"),
    });
  }
  return cells;
}

export function summarizeXml(xml: string): DiagramSummary {
  const pages = findPages(xml).map((span, index) => ({
    index: index + 1,
    id: span.id,
    name: span.name,
    cells: summarizeCells(xml.slice(span.contentStart, span.contentEnd)),
  }));
  const cells = pages.flatMap((page) => page.cells);
  return { blank: cells.length === 0, cells, pages };
}

function existingIds(xml: string): Set<string> {
  const ids = new Set<string>();
  const re = /\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) ids.add(m[1]);
  return ids;
}

function freshId(ids: Set<string>, prefix: string): string {
  for (let i = 0; i < 20; i++) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    if (!ids.has(id)) {
      ids.add(id);
      return id;
    }
  }
  const id = `${prefix}${Date.now().toString(36)}`;
  ids.add(id);
  return id;
}

function setCellValue(xml: string, id: string, label: string): string {
  const escapedId = escapeRe(id);
  const escaped = escapeXml(label);
  const objectRe = new RegExp(`<UserObject\\b[^>]*\\bid="${escapedId}"[^>]*>`);
  const objectMatch = objectRe.exec(xml);
  if (objectMatch && objectMatch.index !== undefined) {
    let tag = objectMatch[0];
    if (/\blabel="/.test(tag)) {
      tag = tag.replace(/\blabel="[^"]*"/, `label="${escaped}"`);
    } else {
      tag = tag.replace("<UserObject ", `<UserObject label="${escaped}" `);
    }
    return xml.slice(0, objectMatch.index) + tag + xml.slice(objectMatch.index + objectMatch[0].length);
  }
  const re = new RegExp(`<mxCell\\b[^>]*\\bid="${escapedId}"[^>]*?/?>`);
  const match = re.exec(xml);
  if (!match || match.index === undefined) {
    throw new Error(`cell not found: ${id}`);
  }
  let tag = match[0];
  if (/\bvalue="/.test(tag)) {
    tag = tag.replace(/\bvalue="[^"]*"/, `value="${escaped}"`);
  } else {
    tag = tag.replace("<mxCell ", `<mxCell value="${escaped}" `);
  }
  return xml.slice(0, match.index) + tag + xml.slice(match.index + match[0].length);
}

function insertBeforeRootEnd(xml: string, snippet: string): string {
  const idx = xml.lastIndexOf("</root>");
  if (idx === -1) throw new Error("diagram XML has no </root>; cannot patch");
  return xml.slice(0, idx) + snippet + xml.slice(idx);
}

/** 取 cell 的属性串;UserObject 包裹时 id 在外层、vertex/edge 在内层 mxCell */
function cellAttrs(segment: string, id: string): { attrs: string; inner: string } | null {
  const esc = escapeRe(id);
  const uo = new RegExp(`<UserObject\\b([^>]*\\bid="${esc}"[^>]*)>([\\s\\S]*?)</UserObject>`).exec(segment);
  if (uo) return { attrs: uo[1], inner: uo[2] };
  const cell = new RegExp(`<mxCell\\b([^>]*\\bid="${esc}"[^>]*?)/?>`).exec(segment);
  if (cell) return { attrs: cell[1], inner: "" };
  return null;
}

function cellKindIn(segment: string, id: string): "node" | "edge" | null {
  const found = cellAttrs(segment, id);
  if (!found) return null;
  const hay = `${found.attrs} ${found.inner}`;
  if (/\bvertex="(?:1|true)"/.test(hay)) return "node";
  if (/\bedge="(?:1|true)"/.test(hay)) return "edge";
  // id="0"/id="1" 等根 cell 不算可删元素
  return null;
}

/** 找出页内挂在某节点上的边(边 id 可能在包裹的 UserObject 上) */
function edgesTouching(segment: string, node: string): string[] {
  const touches = (attrs: string): boolean =>
    /\bedge="(?:1|true)"/.test(attrs) && (attr(attrs, "source") === node || attr(attrs, "target") === node);
  const found: string[] = [];
  const seen = new Set<string>();
  const objects = /<UserObject\b([^>]*)>([\s\S]*?)<\/UserObject>/g;
  let m: RegExpExecArray | null;
  while ((m = objects.exec(segment))) {
    const id = attr(m[1], "id");
    if (!id) continue;
    seen.add(id);
    if (touches(m[2])) found.push(id);
  }
  const cells = /<mxCell\b([^>]*?)\/?>/g;
  while ((m = cells.exec(segment))) {
    const id = attr(m[1], "id");
    if (!id || seen.has(id)) continue;
    if (touches(m[1])) found.push(id);
  }
  return found;
}

/** 从页内删除整个 cell 元素(含 UserObject 包裹与 mxGeometry 子节点) */
function cutCell(segment: string, id: string): string {
  const esc = escapeRe(id);
  const patterns = [
    new RegExp(`[ \\t]*<UserObject\\b[^>]*\\bid="${esc}"[^>]*>[\\s\\S]*?</UserObject>[ \\t]*\\r?\\n?`),
    new RegExp(`[ \\t]*<mxCell\\b[^>]*\\bid="${esc}"[^>]*?(?:/>|>[\\s\\S]*?</mxCell>)[ \\t]*\\r?\\n?`),
  ];
  for (const re of patterns) {
    if (re.test(segment)) return segment.replace(re, "");
  }
  return segment;
}

/**
 * 对目标页应用结构化补丁;所有查找与插入都限定在该页区间内,
 * 避免多页图命中错误页或跨页 id 冲突。id 唯一性仍按全文件检查。
 */
export function applyPatch(xml: string, operations: PatchOp[], page?: PageRef): string {
  const next = xml.trim() ? xml : BLANK_DIAGRAM;
  const spans = findPages(next);
  const span = spans[resolvePageIndex(spans, page)];
  let segment = next.slice(span.contentStart, span.contentEnd);
  const ids = existingIds(next);
  const additions: string[] = [];

  for (const op of operations) {
    if (op.type === "set_label") {
      segment = setCellValue(segment, op.id, op.label);
      continue;
    }
    if (op.type === "remove_node" || op.type === "remove_edge") {
      const kind = cellKindIn(segment, op.id);
      if (!kind) throw new Error(`cell not found: ${op.id}`);
      if (op.type === "remove_node" && kind !== "node") throw new Error(`cell is not a node: ${op.id}`);
      if (op.type === "remove_edge" && kind !== "edge") throw new Error(`cell is not an edge: ${op.id}`);
      // 删节点级联删挂在其上的边,避免留下悬空连线
      const doomed = kind === "node" ? [op.id, ...edgesTouching(segment, op.id)] : [op.id];
      for (const id of doomed) segment = cutCell(segment, id);
      continue;
    }
    if (op.type === "add_node") {
      const id = op.id && !ids.has(op.id) ? op.id : freshId(ids, "n");
      if (op.id) ids.add(id);
      const style = op.style ?? "rounded=1;whiteSpace=wrap;html=1;";
      additions.push(
        `        <mxCell id="${escapeXml(id)}" value="${escapeXml(op.label)}" style="${escapeXml(style)}" vertex="1" parent="1">\n          <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>\n        </mxCell>\n`,
      );
      continue;
    }
    const id = op.id && !ids.has(op.id) ? op.id : freshId(ids, "e");
    if (op.id) ids.add(id);
    const style = op.style ?? "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;";
    const value = op.label ? ` value="${escapeXml(op.label)}"` : "";
    additions.push(
      `        <mxCell id="${escapeXml(id)}"${value} style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(op.source)}" target="${escapeXml(op.target)}">\n          <mxGeometry relative="1" as="geometry"/>\n        </mxCell>\n`,
    );
  }

  if (additions.length) segment = insertBeforeRootEnd(segment, additions.join(""));
  return next.slice(0, span.contentStart) + segment + next.slice(span.contentEnd);
}
