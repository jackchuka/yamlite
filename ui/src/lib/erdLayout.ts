import { graphlib, layout } from "@dagrejs/dagre";
import type { ErdEdge, ErdNode } from "./erd";

export const NODE_WIDTH = 240;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 24;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ErdNode renders at exactly this size, so the layout never waits for a measurement
export const nodeHeight = (node: ErdNode): number => HEADER_HEIGHT + ROW_HEIGHT * node.columns.length + 2;

// left to right: a table sits left of the tables it references; swap this function to try ELK
export function layoutErd(nodes: ErdNode[], edges: ErdEdge[]): Map<string, Box> {
  const g = new graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 100, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n) });
  for (const e of edges) {
    // dagre would invent a zero-sized node for a missing end, and a self-loop adds nothing to the ranking
    if (e.source !== e.target && g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, {}, e.id);
  }
  layout(g);
  return new Map(
    nodes.map((n) => {
      const p = g.node(n.id);
      // dagre places centres; React Flow positions top-left corners
      return [n.id, { x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height }];
    }),
  );
}
