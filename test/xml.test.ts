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

  it("single-page diagrams still patch without page argument", () => {
    const patched = applyPatch(BLANK_DIAGRAM, [{ type: "add_node", id: "a", label: "A" }]);
    expect(summarizeXml(patched).pages).toHaveLength(1);
    expect(summarizeXml(patched).cells.map((cell) => cell.id)).toEqual(["a"]);
    // 单页时显式给 page=1 也允许
    expect(() => applyPatch(BLANK_DIAGRAM, [{ type: "add_node", label: "A" }], 1)).not.toThrow();
  });
});
