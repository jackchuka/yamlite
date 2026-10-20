import { render } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { AppModeContext } from "@/lib/appMode";
import { ConflictToasts } from "./ConflictToasts";

type Listener = (e: { type: string; table: string; key: string; winner: string }) => void;
let listener: Listener | undefined;
vi.mock("@/lib/providers", () => ({
  useEventStore: () => ({
    listen: (fn: Listener) => {
      listener = fn;
      return () => {};
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const conflict = { type: "conflict", table: "tasks", key: "a", winner: "file" };

test("in the editor a conflict toast leads to the diff", () => {
  const warning = vi.spyOn(toast, "warning");
  render(<ConflictToasts />);
  listener?.(conflict);
  expect(warning.mock.calls[0]?.[1]?.action).toMatchObject({ label: "View diff" });
});

test("in an app the conflict is still told, but nothing leads out of the app", () => {
  const warning = vi.spyOn(toast, "warning");
  render(
    <AppModeContext.Provider value>
      <ConflictToasts />
    </AppModeContext.Provider>,
  );
  listener?.(conflict);
  expect(warning).toHaveBeenCalledWith("Conflict in tasks/a", expect.anything());
  expect(warning.mock.calls[0]?.[1]?.action).toBeUndefined();
});
