import { expect, test } from "vitest";
import { reviewBranch, reviewSteps } from "../../src/git/review.ts";

const now = new Date("2026-10-08T07:05:09Z");
const req = { title: "Update tasks", body: "", paths: ["tasks/a.yaml"] };

test("reviewBranch names the branch after the UTC time", () => {
  expect(reviewBranch(now)).toBe("yamlite/review-20261008-070509");
});

test("from the default branch, the changes go to a new branch and a PR", () => {
  expect(reviewSteps(req, { branch: "main", defaultBranch: "main", now, openPr: true })).toEqual([
    { kind: "create_branch", name: "yamlite/review-20261008-070509" },
    { kind: "commit", message: "Update tasks", paths: ["tasks/a.yaml"] },
    { kind: "push", branch: "yamlite/review-20261008-070509" },
    { kind: "open_pr", title: "Update tasks", body: "" },
  ]);
});

test("on another branch with an open PR, the changes are only committed and pushed", () => {
  expect(reviewSteps(req, { branch: "work", defaultBranch: "main", now, openPr: false })).toEqual([
    { kind: "commit", message: "Update tasks", paths: ["tasks/a.yaml"] },
    { kind: "push", branch: "work" },
  ]);
});
