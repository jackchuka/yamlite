// the engine and one data root's server, without the CLI or the HTTP listener; runs in Node or, with browserAliases, in a browser worker
export * from "./index.ts";
export { createWorkspace, type Workspace, type WorkspaceOptions } from "./serve/workspace.ts";
export type { ApiContext } from "./serve/context.ts";
export { HttpError } from "./serve/errors.ts";
export { ReviewRefused, type GitDriver, type GitStatus, type ReviewOutcome, type StepRunner } from "./git/driver.ts";
export {
  describeChange,
  fieldChanges,
  worthShowing,
  type DiffResult,
  type Extract,
  type Extracted,
  type HistoryEntry,
  type HistoryPage,
  type HistoryTarget,
} from "./githistory.ts";
export type { ReviewRequest } from "./git/review.ts";
export type { Repo } from "./git/repo.ts";
export type { GitStep, RunOptions, StepResult } from "./git/steps.ts";
