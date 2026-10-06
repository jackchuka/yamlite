import "@xyflow/react/dist/style.css";
import { type UseQueryResult, useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { RotateCcw } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { warningCounts } from "@/lib/activity";
import { api } from "@/lib/api";
import { buildErd, type Erd } from "@/lib/erd";
import { layoutErd } from "@/lib/erdLayout";
import { useEvents, useMeta } from "@/lib/providers";
import { useTheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Meta, TableSchema } from "@/lib/types";
import { columnHandle, type ErdFlowNode, ErdNodeView, headerHandle, HighlightContext } from "./ErdNode";
import { ErdSelfLoop } from "./ErdSelfLoop";
import { Placeholder } from "./Placeholder";

const nodeTypes = { erd: ErdNodeView };
const edgeTypes = { self: ErdSelfLoop };
// React Flow's own colours, mapped onto the yamlite palette so both themes match the rest of the UI
const palette = {
  "--xy-background-color": "var(--y-bg)",
  "--xy-background-pattern-dots-color": "var(--y-line)",
  "--xy-minimap-background-color": "var(--y-panel)",
  "--xy-minimap-mask-background-color": "color-mix(in srgb, var(--y-bg) 60%, transparent)",
  "--xy-minimap-node-background-color": "var(--y-line)",
  "--xy-controls-button-background-color": "var(--y-bg)",
  "--xy-controls-button-background-color-hover": "var(--y-panel-2)",
  "--xy-controls-button-color": "var(--y-text)",
  "--xy-controls-button-border-color": "var(--y-line)",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;
const dataOf = (results: UseQueryResult<TableSchema>[]) => results.map((r) => r.data);

// what the layout depends on: which nodes, which rows in which order, and which edges; counts and problems are
// left out. Rows count by name: React Flow keeps measured handle positions until a node is laid out again
const shapeOf = (erd: Erd): string =>
  JSON.stringify([erd.nodes.map((n) => [n.id, n.columns.map((c) => c.name)]), erd.edges.map((e) => e.id)]);

function related(erd: Erd, selected: string | null): ReadonlySet<string> {
  const out = new Set<string>();
  if (selected === null) return out;
  out.add(selected);
  for (const e of erd.edges) {
    if (e.source === selected || e.target === selected) {
      out.add(e.source);
      out.add(e.target);
    }
  }
  return out;
}

export function toEdges(erd: Erd, selected: string | null): Edge[] {
  return erd.edges.map((e) => {
    const lit = selected !== null && (e.source === selected || e.target === selected);
    const opacity = selected !== null && !lit ? 0.2 : 1;
    if (e.kind === "parent") {
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: headerHandle.out,
        targetHandle: headerHandle.in,
        style: {
          stroke: lit ? "var(--y-accent)" : "var(--y-muted)",
          strokeDasharray: "2 4",
          strokeWidth: 1.2,
          opacity,
        },
      };
    }
    const color = lit ? "var(--y-accent)" : e.broken ? "var(--y-warn)" : "var(--y-muted)";
    return {
      id: e.id,
      type: e.source === e.target ? "self" : undefined,
      source: e.source,
      target: e.target,
      sourceHandle: columnHandle(e.sourceColumn ?? "", "out"),
      targetHandle: columnHandle(e.targetColumn ?? "", "in"),
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: lit ? 2 : 1.5, strokeDasharray: e.broken ? "6 4" : undefined, opacity },
    };
  });
}

interface DiagramProps {
  meta: Meta;
  schemas: ReadonlyMap<string, TableSchema>;
  warnings: Record<string, string[]>;
}

function Diagram({ meta, schemas, warnings }: DiagramProps) {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const { fitView } = useReactFlow();
  const theme = useTheme();
  const [showViews, setShowViews] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const erd = useMemo(
    () =>
      buildErd(meta, schemas, warningCounts(warnings, new Set(meta.views.map((v) => v.name))), { views: showViews }),
    [meta, schemas, warnings, showViews],
  );
  const shape = shapeOf(erd);
  // keyed on the shape alone: a sync that only changes counts or problems must not move the nodes
  const boxes = useMemo(() => layoutErd(erd.nodes, erd.edges), [shape, round]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>([]);

  useEffect(() => {
    setNodes(
      erd.nodes.map((n) => {
        const box = boxes.get(n.id);
        return {
          id: n.id,
          type: "erd",
          position: { x: box?.x ?? 0, y: box?.y ?? 0 },
          width: box?.width,
          height: box?.height,
          data: { node: n },
        };
      }),
    );
    requestAnimationFrame(() => void fitView({ duration: 200 }));
  }, [boxes]);

  useEffect(() => {
    const byId = new Map(erd.nodes.map((n) => [n.id, n]));
    setNodes((prev) => prev.map((p) => ({ ...p, data: { node: byId.get(p.id) ?? p.data.node } })));
  }, [erd, setNodes]);

  const selected = picked !== null && erd.nodes.some((n) => n.id === picked) ? picked : null;
  const highlight = useMemo(() => ({ selected, related: related(erd, selected) }), [erd, selected]);
  const edges = useMemo(() => toEdges(erd, selected), [erd, selected]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 max-md:px-3">
        <h1 className="max-md:sr-only text-[15px] font-bold">ERD</h1>
        <label className="flex items-center gap-2 text-[12px]">
          <Switch checked={showViews} onCheckedChange={setShowViews} />
          ビューを表示
        </label>
        <Button size="sm" variant="outline" onClick={() => setRound((r) => r + 1)}>
          <RotateCcw className="size-3.5" /> 再レイアウト
        </Button>
        <span className="text-[12px] text-muted-foreground max-md:basis-full max-md:text-[12.5px] md:ml-auto">
          {mobile
            ? "タップで関連をハイライト · タイトルをタップでテーブルを開く"
            : "クリックで関連をハイライト · ダブルクリックでテーブルを開く"}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <HighlightContext.Provider value={highlight}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => setPicked(n.id)}
            onPaneClick={() => setPicked(null)}
            onNodeDoubleClick={(_, n) => void navigate({ to: "/t/$table", params: { table: n.id } })}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            colorMode={theme}
            minZoom={0.1}
            fitView
            style={palette}
          >
            <Background gap={18} />
            <Controls showInteractive={false} className="max-md:[&_button]:size-9" />
            {!mobile && <MiniMap pannable zoomable />}
          </ReactFlow>
        </HighlightContext.Provider>
      </div>
    </div>
  );
}

export function ErdDiagram(props: DiagramProps) {
  return (
    <ReactFlowProvider>
      <Diagram {...props} />
    </ReactFlowProvider>
  );
}

export function ErdView() {
  const { data: meta } = useMeta();
  const { warnings } = useEvents();
  const tables = meta?.tables;
  const results = useQueries({
    queries: (tables ?? []).map((t) => ({ queryKey: ["schema", t.name], queryFn: () => api.schema(t.name) })),
    combine: dataOf,
  });
  const schemas = useMemo(() => {
    const out = new Map<string, TableSchema>();
    for (const [i, t] of (tables ?? []).entries()) {
      const s = results[i];
      if (s) out.set(t.name, s);
    }
    return out;
  }, [tables, results]);
  if (!meta) return null;
  if (meta.tables.length === 0) return <Placeholder title="テーブルがありません" />;
  return <ErdDiagram meta={meta} schemas={schemas} warnings={warnings} />;
}
