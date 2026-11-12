import { z } from "zod";

export const StageSchema = z.enum([
  "needs-work",
  "needs-review",
  "needs-qa",
  "needs-docs",
  "ready-to-merge",
]);

export const RoleSchema = z.enum([
  "manager",
  "coder",
  "reviewer",
  "qa",
  "docs",
  "designer",
]);

export const AgentSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  name: z.string(),
  role: RoleSchema,
  stage: StageSchema,
  model: z.string(),
  tokenCap: z.number().nonnegative(),
  tokensUsed: z.number().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const FloorSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo: z.string(),
  ownerId: z.string(),
  template: z.string(),
  status: z.enum(["active", "paused", "archived"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const IssueSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  stage: StageSchema,
  assigneeId: z.string().nullable().optional(),
  prUrl: z.string().url().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const MemorySchema = z.object({
  id: z.string(),
  scope: z.enum(["office", "floor", "role"]),
  scopeId: z.string(),
  key: z.string().min(1),
  value: z.string(),
  updatedAt: z.string().datetime(),
});

export const AIAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(["claude", "chatgpt", "grok", "ollama"]),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().nullable().optional(),
  tokenCap: z.number().nonnegative(),
  tokensUsed: z.number().nonnegative(),
});
