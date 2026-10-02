import { isScalar } from "@/lib/cell";

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className="text-syn-str">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-syn-num">{value}</span>;
  return <span className="text-muted-foreground">{String(value)}</span>;
}

export function JsonTree({ value }: { value: unknown }) {
  if (isScalar(value)) return <Scalar value={value} />;
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  return (
    <div className="font-mono text-[12px] leading-[1.7]">
      {entries.map(([k, v]) => (
        <div key={k}>
          {!Array.isArray(value) && <span className="text-syn-key">{k}</span>}
          {!Array.isArray(value) && ": "}
          {isScalar(v) ? (
            <Scalar value={v} />
          ) : (
            <>
              <span className="text-muted-foreground">
                {Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v as object).length}}`}
              </span>
              <div className="ml-[3px] border-l pl-3.5">
                <JsonTree value={v} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
