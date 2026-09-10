import { BLANK_DIAGRAM } from "./blank-diagram.js";
import type { CellSummary, DiagramSummary, PatchOp } from "./types.js";

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

export function summarizeXml(xml: string): DiagramSummary {
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
  return { blank: cells.filter((cell) => cell.type === "node" || cell.type === "edge").length === 0, cells };
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
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function applyPatch(xml: string, operations: PatchOp[]): string {
  let next = xml.trim() ? xml : BLANK_DIAGRAM;
  const ids = existingIds(next);
  const additions: string[] = [];

  for (const op of operations) {
    if (op.type === "set_label") {
      next = setCellValue(next, op.id, op.label);
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

  if (additions.length) next = insertBeforeRootEnd(next, additions.join(""));
  return next;
}
