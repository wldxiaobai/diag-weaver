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

/** 单页摘要;index 为 1 起的页号 */
export type PageSummary = {
  index: number;
  id?: string;
  name?: string;
  cells: CellSummary[];
};

export type DiagramSummary = {
  blank: boolean;
  /** 跨页平铺视图,便于单页场景直接消费;多页时以 pages 分组为准 */
  cells: CellSummary[];
  pages: PageSummary[];
};

/** 页定位:1 起的页号,或页 name / id */
export type PageRef = number | string;

export type ExportFormat = "drawio" | "png" | "svg";

export type SnapshotInfo = {
  label: string;
  file: string;
  path: string;
  createdAt: string;
};

export type PatchOp =
  | { type: "add_node"; id?: string; label: string; style?: string }
  | { type: "add_edge"; id?: string; source: string; target: string; label?: string; style?: string }
  | { type: "set_label"; id: string; label: string }
  | { type: "remove_node"; id: string }
  | { type: "remove_edge"; id: string };

export interface EditorHost {
  readonly url: string;
  isConnected(): boolean;
  ensure(): Promise<EditorStatus>;
  load(opts: LoadOptions): Promise<string>;
  readXml(): Promise<string>;
  onAutosave(handler: (xml: string) => void): void;
  close(): Promise<void>;
}
