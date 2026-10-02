import { expect, test } from "vitest";
import { ApiError } from "./api";
import { fieldError } from "./fielderror";

test("server errors that name a field are shown next to it", () => {
  expect(fieldError(new ApiError(400, "key contains a path separator or NUL", { field: "key" }))).toEqual({
    field: "key",
    message: "key contains a path separator or NUL",
  });
  expect(fieldError(new ApiError(409, '"a" already exists in tasks', { field: "key" }))?.field).toBe("key");
  expect(fieldError(new ApiError(500, "boom", {}))).toEqual({ field: null, message: "boom" });
  expect(fieldError(null)).toBeNull();
});
