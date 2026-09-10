export type LayoutName =
  | "verticalFlow"
  | "horizontalFlow"
  | "verticalTree"
  | "horizontalTree"
  | "radialTree"
  | "organic"
  | "none";

export const LAYOUT_PRESETS: Exclude<LayoutName, "none">[] = [
  "verticalFlow",
  "horizontalFlow",
  "verticalTree",
  "horizontalTree",
  "radialTree",
  "organic",
];

export type LoadOptions = {
  xml?: string;
  mermaid?: string;
  layout?: LayoutName;
  title?: string;
};

export type EditorStatus = {
  url: string;
  connected: boolean;
  ready: boolean;
};

export type CellSummary = {
  id: string;
  type: "node" | "edge";
  label?: string;
  source?: string;
  target?: string;
};

export type DiagramSummary = {
  blank: boolean;
  cells: CellSummary[];
};

export type SnapshotInfo = {
  label: string;
  file: string;
  path: string;
  createdAt: string;
};

export type PatchOp =
  | { type: "add_node"; id?: string; label: string; style?: string }
  | { type: "add_edge"; id?: string; source: string; target: string; label?: string; style?: string }
  | { type: "set_label"; id: string; label: string };

export interface EditorHost {
  readonly url: string;
  isConnected(): boolean;
  ensure(): Promise<EditorStatus>;
  load(opts: LoadOptions): Promise<string>;
  readXml(): Promise<string>;
  onAutosave(handler: (xml: string) => void): void;
  close(): Promise<void>;
}
