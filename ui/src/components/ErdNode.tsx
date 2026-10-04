import { Link } from "@tanstack/react-router";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { ArrowRight, KeyRound, Layers, Table2, TriangleAlert } from "lucide-react";
import { createContext, useContext } from "react";
import type { ErdColumn, ErdNode } from "@/lib/erd";
import { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT } from "@/lib/erdLayout";
import { cn } from "@/lib/utils";

export type ErdFlowNode = Node<{ node: ErdNode }, "erd">;

export interface Highlight {
  selected: string | null;
  related: ReadonlySet<string>;
}

// kept out of node data so a click restyles the nodes without handing React Flow new node objects
export const HighlightContext = createContext<Highlight>({ selected: null, related: new Set() });

// edges attach to these; they are invisible and never start a connection. The prefixes keep a column named
// like the header handle (say "node") from sharing its id
export const headerHandle = { in: "node:in", out: "node:out" } as const;
export const columnHandle = (column: string, side: "in" | "out"): string => `c:${column}:${side}`;

const handle = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function Mark({ column }: { column: ErdColumn }) {
  if (column.problems.length > 0) return <TriangleAlert aria-label="problem" className="size-3 text-warn" />;
  if (column.key) return <KeyRound aria-label="key" className="size-3 text-tomato" />;
  if (column.ref) return <ArrowRight aria-label="reference" className="size-3 opacity-70" />;
  return null;
}

export function ErdNodeView({ data: { node } }: NodeProps<ErdFlowNode>) {
  const { selected, related } = useContext(HighlightContext);
  const isSelected = selected === node.id;
  const dimmed = selected !== null && !related.has(node.id);
  return (
    <div
      data-testid={`erd-node-${node.id}`}
      data-selected={isSelected || undefined}
      data-dimmed={dimmed || undefined}
      style={{ width: NODE_WIDTH }}
      className={cn(
        "rounded-lg border bg-background text-[12px] shadow-sm transition-opacity",
        node.kind === "view" && "bg-panel",
        isSelected && "border-tomato ring-2 ring-tomato/30",
        dimmed && "opacity-30",
      )}
    >
      <div
        className="relative flex items-center gap-1.5 border-b px-2.5 font-semibold"
        style={{ height: HEADER_HEIGHT }}
      >
        <Handle type="target" position={Position.Left} id={headerHandle.in} isConnectable={false} className={handle} />
        {node.kind === "view" ? (
          <Layers className="size-3.5 shrink-0 opacity-70" />
        ) : (
          <Table2 className="size-3.5 shrink-0 opacity-70" />
        )}
        <Link to="/t/$table" params={{ table: node.name }} className="nodrag truncate hover:underline">
          {node.name}
        </Link>
        {node.warnings > 0 && (
          <span
            title={`${node.warnings} 件の警告`}
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-warn-soft px-1 text-[10.5px] font-semibold text-warn"
          >
            <TriangleAlert className="size-3" />
            {node.warnings}
          </span>
        )}
        <span className="ml-auto text-[11px] font-normal text-muted-foreground tabular-nums">{node.count}</span>
        <Handle
          type="source"
          position={Position.Right}
          id={headerHandle.out}
          isConnectable={false}
          className={handle}
        />
      </div>
      {node.columns.map((c) => (
        <div
          key={c.name}
          title={c.problems.length > 0 ? c.problems.join("\n") : undefined}
          className={cn("relative flex items-center gap-1.5 px-2.5", c.problems.length > 0 && "bg-warn-soft")}
          style={{ height: ROW_HEIGHT }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id={columnHandle(c.name, "in")}
            isConnectable={false}
            className={handle}
          />
          <span className="flex w-3.5 shrink-0 justify-center">
            <Mark column={c} />
          </span>
          <span className={cn("truncate font-mono", c.key && "font-semibold")}>{c.name}</span>
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{c.type}</span>
          <Handle
            type="source"
            position={Position.Right}
            id={columnHandle(c.name, "out")}
            isConnectable={false}
            className={handle}
          />
        </div>
      ))}
    </div>
  );
}
