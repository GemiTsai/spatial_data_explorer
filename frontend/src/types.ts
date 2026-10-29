export type Point = [number, number];
export type Cell = {
  id: string;
  spatial: Point;
  umap: Point | null;
  polygon: Point[] | null;
  metadata: Record<string, string | null>;
};
export type Summary = {
  version: string;
  name: string;
  platform: string;
  n_cells: number;
  n_genes: number;
  metadata_fields: string[];
  layers: string[];
  has_umap: boolean;
  synthetic: boolean;
  warnings: string[];
  polygon_count: number;
  coordinate_unit: string;
};
export type Roi = { space: 'spatial' | 'umap'; points: Point[]; operation: string };
export type Group = { name: string; ids: string[] };
export type Overlay = {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  source_name: string;
  note?: string;
};
export type Row = {
  gene: string;
  score: number | null;
  logfoldchange: number | null;
  pvalue: number | null;
  padj: number | null;
  mean_a: number;
  mean_b: number;
  fraction_a: number;
  fraction_b: number;
};
export type Result = { rows: Row[]; provenance: Record<string, unknown> };
export const WARNING =
  '細胞並非獨立生物複本，cell-level 比較可能造成顯著性膨脹（p 值過小、假陽性增加）；多重檢定校正不能消除此問題，結果用於探索性排序，不作病人／條件層級推論。';
