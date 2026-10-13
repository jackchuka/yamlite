// Node-free, so the UI can import them

export type GitStep =
  | { kind: "create_branch"; name: string; from?: string }
  | { kind: "switch"; branch: string }
  | { kind: "commit"; message: string; paths: string[] }
  | { kind: "push"; branch: string }
  | { kind: "pull"; branch: string }
  | { kind: "open_pr"; title: string; body: string; base?: string };

export interface StepResult {
  status: "done" | "failed" | "skipped";
  message?: string;
  url?: string;
  created?: boolean;
}
