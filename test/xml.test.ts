import { describe, expect, it } from "vitest";
import { BLANK_DIAGRAM } from "../src/blank-diagram.js";
import { applyPatch, detectFormat, isBlankDiagram, summarizeXml } from "../src/xml.js";

describe("xml helpers", () => {
  it("treats the blank template as empty", () => {
    expect(isBlankDiagram(BLANK_DIAGRAM)).toBe(true);
    expect(isBlankDiagram("")).toBe(true);
    expect(summarizeXml(BLANK_DIAGRAM).blank).toBe(true);
  });

  it("detects mermaid vs drawio", () => {
    expect(detectFormat("flowchart TD\nA-->B")).toBe("mermaid");
    expect(detectFormat(BLANK_DIAGRAM)).toBe("drawio");
  });

  it("summarizes draw.io UserObject-wrapped mermaid cells", () => {
    const xml = `<mxfile><diagram><mxGraphModel><root>
      <UserObject label="" id="0"><mxCell /></UserObject>
      <mxCell id="1" parent="0" />
      <UserObject label="User" id="2"><mxCell parent="9" vertex="1" /></UserObject>
      <UserObject label="MCP" id="6"><mxCell edge="1" parent="9" source="2" target="3" /></UserObject>
    </root></mxGraphModel></diagram></mxfile>`;
    expect(isBlankDiagram(xml)).toBe(false);
    expect(summarizeXml(xml).cells).toEqual([
      { id: "2", type: "node", label: "User", source: undefined, target: undefined },
      { id: "6", type: "edge", label: "MCP", source: "2", target: "3" },
    ]);
    const relabeled = applyPatch(xml, [{ type: "set_label", id: "2", label: "Person" }]);
    expect(summarizeXml(relabeled).cells[0].label).toBe("Person");
  });

  it("patches nodes, edges, and labels", () => {
    const xml = applyPatch(BLANK_DIAGRAM, [
      { type: "add_node", id: "a", label: "Start" },
      { type: "add_node", id: "b", label: "End" },
      { type: "add_edge", id: "e1", source: "a", target: "b", label: "go" },
    ]);
    expect(isBlankDiagram(xml)).toBe(false);
    const labeled = applyPatch(xml, [{ type: "set_label", id: "a", label: "Begin" }]);
    const summary = summarizeXml(labeled);
    expect(summary.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a", type: "node", label: "Begin" }),
        expect.objectContaining({ id: "b", type: "node", label: "End" }),
        expect.objectContaining({ id: "e1", type: "edge", source: "a", target: "b", label: "go" }),
      ]),
    );
  });
});

// 两页、且两页存在同名 id "shared",用于验证按页定位与跨页 id 冲突
const MULTI_PAGE = `<mxfile host="test">
  <diagram id="p1" name="架构">
    <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="shared" value="Page1Node" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>
    </root></mxGraphModel>
  </diagram>
  <diagram id="p2" name="部署">
    <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="shared" value="Page2Node" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>
    </root></mxGraphModel>
  </diagram>
</mxfile>`;

describe("multi-page safety", () => {
  it("summarizes per page", () => {
    const summary = summarizeXml(MULTI_PAGE);
    expect(summary.blank).toBe(false);
    expect(summary.pages).toHaveLength(2);
    expect(summary.pages[0]).toMatchObject({ index: 1, id: "p1", name: "架构" });
    expect(summary.pages[1]).toMatchObject({ index: 2, id: "p2", name: "部署" });
    expect(summary.pages[0].cells).toEqual([
      expect.objectContaining({ id: "shared", label: "Page1Node" }),
    ]);
    expect(summary.pages[1].cells).toEqual([
      expect.objectContaining({ id: "shared", label: "Page2Node" }),
    ]);
  });

  it("refuses to patch a multi-page diagram without explicit page", () => {
    expect(() => applyPatch(MULTI_PAGE, [{ type: "add_node", label: "x" }])).toThrow(/explicit page/);
    expect(() => applyPatch(MULTI_PAGE, [{ type: "add_node", label: "x" }], "缺失页")).toThrow(/page not found/);
  });

  it("inserts additions into the target page only", () => {
    const byName = applyPatch(MULTI_PAGE, [{ type: "add_node", id: "added", label: "New" }], "部署");
    const byIndex = applyPatch(MULTI_PAGE, [{ type: "add_node", id: "added", label: "New" }], 2);
    for (const patched of [byName, byIndex]) {
      const summary = summarizeXml(patched);
      expect(summary.pages[0].cells.map((cell) => cell.id)).toEqual(["shared"]);
      expect(summary.pages[1].cells.map((cell) => cell.id)).toEqual(["shared", "added"]);
    }
  });

  it("set_label on duplicate ids only touches the target page", () => {
    const patched = applyPatch(MULTI_PAGE, [{ type: "set_label", id: "shared", label: "Renamed" }], 1);
    const summary = summarizeXml(patched);
    expect(summary.pages[0].cells[0].label).toBe("Renamed");
    expect(summary.pages[1].cells[0].label).toBe("Page2Node");
  });

  it("keeps a caller id that already exists on another page", () => {
    const withOnly = applyPatch(MULTI_PAGE, [{ type: "add_node", id: "only-p1", label: "P1" }], 1);
    const patched = applyPatch(withOnly, [{ type: "add_node", id: "only-p1", label: "P2" }], 2);
    const summary = summarizeXml(patched);
    expect(summary.pages[0].cells.map((cell) => cell.id)).toEqual(["shared", "only-p1"]);
    expect(summary.pages[1].cells.map((cell) => cell.id)).toEqual(["shared", "only-p1"]);
    expect(summary.pages[1].cells.map((cell) => cell.label)).toEqual(["Page2Node", "P2"]);
  });

  it("single-page diagrams still patch without page argument", () => {
    const patched = applyPatch(BLANK_DIAGRAM, [{ type: "add_node", id: "a", label: "A" }]);
    expect(summarizeXml(patched).pages).toHaveLength(1);
    expect(summarizeXml(patched).cells.map((cell) => cell.id)).toEqual(["a"]);
    // 单页时显式给 page=1 也允许
    expect(() => applyPatch(BLANK_DIAGRAM, [{ type: "add_node", label: "A" }], 1)).not.toThrow();
  });
});

describe("remove operations", () => {
  const base = applyPatch(BLANK_DIAGRAM, [
    { type: "add_node", id: "a", label: "A" },
    { type: "add_node", id: "b", label: "B" },
    { type: "add_edge", id: "e1", source: "a", target: "b", label: "go" },
  ]);

  it("remove_edge deletes only the edge", () => {
    const summary = summarizeXml(applyPatch(base, [{ type: "remove_edge", id: "e1" }]));
    expect(summary.cells.map((cell) => cell.id).sort()).toEqual(["a", "b"]);
  });

  it("remove_node cascades attached edges", () => {
    const summary = summarizeXml(applyPatch(base, [{ type: "remove_node", id: "a" }]));
    expect(summary.cells.map((cell) => cell.id)).toEqual(["b"]);
  });

  it("removes UserObject-wrapped cells with their geometry", () => {
    const xml = `<mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <UserObject label="User" id="u1"><mxCell vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></UserObject>
      <UserObject label="link" id="ue1"><mxCell edge="1" parent="1" source="u1" target="u1"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>
    </root></mxGraphModel></diagram></mxfile>`;
    const patched = applyPatch(xml, [{ type: "remove_node", id: "u1" }]);
    expect(patched).not.toContain("u1");
    expect(summarizeXml(patched).cells).toEqual([]);
    expect(summarizeXml(patched).blank).toBe(true);
  });

  it("rejects unknown ids, wrong kinds, and root cells", () => {
    expect(() => applyPatch(base, [{ type: "remove_node", id: "missing" }])).toThrow(/cell not found/);
    expect(() => applyPatch(base, [{ type: "remove_edge", id: "a" }])).toThrow(/not an edge/);
    expect(() => applyPatch(base, [{ type: "remove_node", id: "e1" }])).toThrow(/not a node/);
    expect(() => applyPatch(base, [{ type: "remove_node", id: "1" }])).toThrow(/cell not found/);
  });

  it("removes a nested group without leaving a dangling close tag", () => {
    const xml = `<mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="g" value="Group" style="group;" vertex="1" parent="1">
        <mxGeometry x="0" y="0" width="200" height="120" as="geometry"/>
        <mxCell id="c" value="Child" vertex="1" parent="g">
          <mxGeometry x="10" y="10" width="80" height="40" as="geometry"/>
        </mxCell>
      </mxCell>
      <mxCell id="keep" value="Keep" vertex="1" parent="1">
        <mxGeometry x="240" y="40" width="80" height="40" as="geometry"/>
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const patched = applyPatch(xml, [{ type: "remove_node", id: "g" }]);
    expect(patched).not.toContain('id="g"');
    expect(patched).not.toContain('id="c"');
    const opens = patched.match(/<mxCell\b[^>]*[^/]>/g)?.length ?? 0;
    expect(patched.match(/<\/mxCell>/g)?.length ?? 0).toBe(opens);
    expect(summarizeXml(patched).cells.map((cell) => cell.id)).toEqual(["keep"]);
  });

  it("cascades sibling children and edges that reference them", () => {
    const xml = `<mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="g" value="Lane" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="80" as="geometry"/></mxCell>
      <mxCell id="c" value="InLane" vertex="1" parent="g"><mxGeometry x="20" y="20" width="80" height="40" as="geometry"/></mxCell>
      <mxCell id="out" value="Out" vertex="1" parent="1"><mxGeometry x="240" y="20" width="80" height="40" as="geometry"/></mxCell>
      <mxCell id="e" edge="1" parent="1" source="c" target="out"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const patched = applyPatch(xml, [{ type: "remove_node", id: "g" }]);
    expect(summarizeXml(patched).cells.map((cell) => cell.id)).toEqual(["out"]);
    expect(patched).not.toContain('parent="g"');
    expect(patched).not.toContain('id="e"');
  });

  it("reuses an id removed earlier in the same patch", () => {
    const patched = applyPatch(base, [
      { type: "remove_node", id: "a" },
      { type: "add_node", id: "a", label: "A2" },
    ]);
    const cell = summarizeXml(patched).cells.find((item) => item.id === "a");
    expect(cell?.label).toBe("A2");
  });

  it("rejects an id that is still on the target page", () => {
    expect(() => applyPatch(base, [{ type: "add_node", id: "a", label: "dup" }])).toThrow(/id already exists/);
    expect(() => applyPatch(base, [{ type: "add_edge", id: "e1", source: "a", target: "b" }])).toThrow(/id already exists/);
  });

  it("removes only within the target page", () => {
    const patched = applyPatch(MULTI_PAGE, [{ type: "remove_node", id: "shared" }], "架构");
    const summary = summarizeXml(patched);
    expect(summary.pages[0].cells).toEqual([]);
    expect(summary.pages[1].cells.map((cell) => cell.id)).toEqual(["shared"]);
  });
});
