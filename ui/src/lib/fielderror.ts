import { ApiError } from "./api";

export function fieldError(e: unknown): { field: string | null; message: string } | null {
  if (!e) return null;
  if (e instanceof ApiError)
    return { field: typeof e.body.field === "string" ? e.body.field : null, message: e.message };
  return { field: null, message: e instanceof Error ? e.message : String(e) };
}
