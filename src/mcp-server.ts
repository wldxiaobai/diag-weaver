import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WeaverApp } from "./app.js";
import type { LayoutName } from "./types.js";

const layoutSchema = z.enum([
  "verticalFlow",
  "horizontalFlow",
  "verticalTree",
  "horizontalTree",
  "radialTree",
  "organic",
  "none",
]);

const patchOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_node"),
    id: z.string().optional(),
    label: z.string(),
    style: z.string().optional(),
  }),
  z.object({
    type: z.literal("add_edge"),
    id: z.string().optional(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
    style: z.string().optional(),
  }),
  z.object({
    type: z.literal("set_label"),
    id: z.string(),
    label: z.string(),
  }),
  z.object({
    type: z.literal("remove_node"),
    id: z.string().describe("Node id; edges attached to it are removed as well"),
  }),
  z.object({
    type: z.literal("remove_edge"),
    id: z.string().describe("Edge id"),
  }),
]);

const pageSchema = z
  .union([z.number().int().positive(), z.string()])
  .optional()
  .describe("Target page: 1-based index or page name/id. Required when the diagram has multiple pages; optional for single-page diagrams.");

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

export function createMcpServer(app: WeaverApp): McpServer {
  const server = new McpServer({
    name: "diag-weaver",
    version: "0.1.0",
  });

  server.registerTool(
    "editor_ensure",
    {
      description:
        "Open the local draw.io canvas in the browser if needed and wait until it is connected. Does not create store directories.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return ok(await app.editorEnsure());
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "diagram_replace",
    {
      description:
        "Replace the whole diagram with Mermaid or draw.io XML. Loads into the live canvas and lets draw.io layout. Prefer this over many tiny geometry edits.",
      inputSchema: z.object({
        content: z.string().describe("Mermaid source or draw.io / mxfile XML"),
        format: z.enum(["mermaid", "drawio"]).optional(),
        layout: layoutSchema
          .optional()
          .describe("draw.io layout preset. Defaults to verticalFlow for Mermaid, none for XML."),
      }),
    },
    async ({ content, format, layout }) => {
      try {
        return ok(await app.replace({ content, format, layout: layout as LayoutName | undefined }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "diagram_read",
    {
      description:
        "Read the current diagram. Default is a compact cell summary for the agent, grouped per page (summary.pages). Pass format=xml for the full draw.io XML. Uses the live canvas if connected, otherwise the saved current.drawio. Does not create directories.",
      inputSchema: z.object({
        format: z.enum(["summary", "xml"]).optional(),
      }),
    },
    async ({ format }) => {
      try {
        return ok(await app.read({ format }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "diagram_patch",
    {
      description:
        "Apply a few structured edits (add_node, add_edge, set_label, remove_node, remove_edge). Prefer remove_* over diagram_replace when deleting elements, so the user's manual layout survives. Do not supply x/y; draw.io layout places new cells. Coordinates belong to the editor, not the model. Patches always target one page: pass page (index or name) for multi-page diagrams.",
      inputSchema: z.object({
        operations: z.array(patchOpSchema).min(1),
        layout: layoutSchema.optional(),
        page: pageSchema,
      }),
    },
    async ({ operations, layout, page }) => {
      try {
        return ok(await app.patch({ operations, layout: layout as LayoutName | undefined, page }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "diagram_snapshot",
    {
      description:
        "Copy the current diagram to a labeled snapshot under the user data directory (not the agent cwd).",
      inputSchema: z.object({
        label: z.string().describe('Short memorable label, e.g. "评审前"'),
      }),
    },
    async ({ label }) => {
      try {
        return ok(await app.snapshot(label));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "diagram_restore",
    {
      description:
        "Restore a labeled snapshot onto the canvas. Omit label to list snapshots. Restore copies the snapshot to current and loads it; there is no separate checkout/rollback.",
      inputSchema: z.object({
        label: z.string().optional(),
      }),
    },
    async ({ label }) => {
      try {
        return ok(await app.restore(label));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "diagram_export",
    {
      description:
        "Write the current diagram to an explicit filesystem path as .drawio. Relative paths resolve against the process cwd. Will not write unless path is provided.",
      inputSchema: z.object({
        path: z.string().describe("Absolute or cwd-relative destination, e.g. ./docs/architecture.drawio"),
      }),
    },
    async ({ path: dest }) => {
      try {
        return ok(await app.exportTo(dest));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
