import { expect, test } from "vitest";
import type { ErdEdge, ErdNode } from "./erd";
import { layoutErd, NODE_WIDTH, nodeHeight } from "./erdLayout";

const node = (id: string, columns: number): ErdNode => ({
  id,
  kind: "table",
  name: id,
  count: 0,
  warnings: 0,
  columns: Array.from({ length: columns }, (_, i) => ({
    name: `c${i}`,
    type: "TEXT",
    key: i === 0,
    ref: false,
    problems: [],
  })),
});

const ref = (source: string, target: string): ErdEdge => ({
  id: `ref:${source}->${target}`,
  kind: "ref",
  source,
  sourceColumn: "c1",
  target,
  targetColumn: "c0",
  broken: false,
});

test("every node gets a box sized from its columns, and no two boxes overlap", () => {
  const nodes = [node("a", 3), node("b", 8), node("c", 1), node("d", 5)];
  const boxes = layoutErd(nodes, [ref("a", "b"), ref("a", "c"), ref("d", "b")]);
  expect([...boxes.keys()]).toEqual(["a", "b", "c", "d"]);
  for (const n of nodes) expect(boxes.get(n.id)).toMatchObject({ width: NODE_WIDTH, height: nodeHeight(n) });
  const list = [...boxes.values()];
  for (const [i, p] of list.entries()) {
    for (const q of list.slice(i + 1)) {
      const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
      expect(apart).toBe(true);
    }
  }
});

test("a referencing table sits left of the table it references", () => {
  const boxes = layoutErd([node("tasks", 3), node("people", 2)], [ref("tasks", "people")]);
  expect(boxes.get("tasks")?.x ?? Infinity).toBeLessThan(boxes.get("people")?.x ?? -Infinity);
});

test("a self-reference and an edge to a missing node do not break the layout", () => {
  const boxes = layoutErd([node("tasks", 3)], [ref("tasks", "tasks"), ref("tasks", "gone")]);
  expect([...boxes.keys()]).toEqual(["tasks"]);
  expect(boxes.get("tasks")).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
});

test("the height counts the header, one row per column and the border", () => {
  expect(nodeHeight(node("a", 3))).toBe(32 + 24 * 3 + 2);
});
