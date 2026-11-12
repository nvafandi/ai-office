export type Stage =
  | "needs-work"
  | "needs-review"
  | "needs-qa"
  | "needs-docs"
  | "ready-to-merge";

export const STAGES: Stage[] = [
  "needs-work",
  "needs-review",
  "needs-qa",
  "needs-docs",
  "ready-to-merge",
];

export type Role = "manager" | "coder" | "reviewer" | "qa" | "docs" | "designer";

export interface Agent {
  id: string;
  floorId: string;
  name: string;
  role: Role;
  stage: Stage;
  model: string;
  tokenCap: number;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface Floor {
  id: string;
  name: string;
  repo: string;
  ownerId: string;
  template: string;
  status: "active" | "paused" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  floorId: string;
  number: number;
  title: string;
  body?: string | null;
  stage: Stage;
  assigneeId?: string | null;
  prUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Memory {
  id: string;
  scope: "office" | "floor" | "role";
  scopeId: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface AIAccount {
  id: string;
  provider: "claude" | "chatgpt" | "grok" | "ollama";
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  tokenCap: number;
  tokensUsed: number;
}
