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
