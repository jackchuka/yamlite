import { BaseEdge, type EdgeProps } from "@xyflow/react";

// a self-reference leaves the column's right side and loops back into the key row on the same side,
// instead of crossing behind the card to the key's left handle
export function ErdSelfLoop({ id, sourceX, sourceY, targetY, markerEnd, style }: EdgeProps) {
  const out = sourceX + 40;
  return (
    <BaseEdge
      id={id}
      path={`M ${sourceX} ${sourceY} C ${out} ${sourceY}, ${out} ${targetY}, ${sourceX} ${targetY}`}
      markerEnd={markerEnd}
      style={style}
    />
  );
}
