import initSqlJs from "sql.js";
import type { SqlDatabase, SqlStatement } from "sql.js";
export type { SqlDatabase, SqlStatement };
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import type {
  Agent,
  Floor,
  Issue,
  Memory,
  AIAccount,
} from "@ai-office/shared";

export const DB_PATH =
  process.env.AI_OFFICE_DB ?? join(process.cwd(), "data", "office.sqlite");
const nodeRequire = createRequire(import.meta.url);
const WASM_PATH = nodeRequire.resolve("sql.js/dist/sql-wasm.wasm");

type SqlFactory = { Database: new (buffer?: Uint8Array) => SqlDatabase };

let Sql: SqlFactory | null = null;

async function getSql(): Promise<SqlFactory> {
  if (!Sql) {
    const wasm = readFileSync(WASM_PATH);
    const SQL = await initSqlJs({ wasmBinary: wasm });
    Sql = SQL as SqlFactory;
  }
  return Sql;
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export async function openDb(dbPath: string = DB_PATH) {
  ensureDir(join(dbPath, ".."));
  const SQL = await getSql();
  const db: SqlDatabase = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();
  return { db, SQL, path: dbPath };
}

export function closeDb(ctx: { db: SqlDatabase; SQL: SqlFactory; path?: string }): void {
  writeFileSync(ctx.path ?? DB_PATH, ctx.db.export());
  ctx.db.close();
}

export function runSchema(db: SqlDatabase, sql: string): void {
  db.exec(sql);
}

export function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export function queryAll(db: SqlDatabase, sql: string): unknown[][] {
  const stmt = db.prepare(sql);
  try {
    const out: unknown[][] = [];
    while (stmt.step()) {
      const row = stmt.get();
      if (row) out.push(row as unknown[]);
    }
    return out;
  } finally {
    stmt.free();
  }
}

export function queryRow(db: SqlDatabase, sql: string): unknown[] | null {
  const stmt = db.prepare(sql);
  try {
    if (!stmt.step()) return null;
    return stmt.get() as unknown[] | null;
  } finally {
    stmt.free();
  }
}

export type Db = { db: SqlDatabase; SQL: SqlFactory };
export type Stmt = SqlStatement;

export interface RepoAgent {
  id: string;
  floor_id: string;
  name: string;
  role: string;
  stage: string;
  model: string;
  token_cap: number;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}
export interface RepoFloor {
  id: string;
  name: string;
  repo: string;
  owner_id: string;
  template: string;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface RepoIssue {
  id: string;
  floor_id: string;
  number: number;
  title: string;
  body: string | null;
  stage: string;
  assignee_id: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}
export interface RepoMemory {
  id: string;
  scope: string;
  scope_id: string;
  key: string;
  value: string;
  updated_at: string;
}
export interface RepoAIAccount {
  id: string;
  provider: string;
  base_url: string;
  model: string;
  api_key: string | null;
  token_cap: number;
  tokens_used: number;
}

export function toAgentRow(a: RepoAgent): Agent {
  return {
    id: a.id,
    floorId: a.floor_id,
    name: a.name,
    role: a.role as any,
    stage: a.stage as any,
    model: a.model,
    tokenCap: a.token_cap,
    tokensUsed: a.tokens_used,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}
export function toFloorRow(f: RepoFloor): Floor {
  return {
    id: f.id,
    name: f.name,
    repo: f.repo,
    ownerId: f.owner_id,
    template: f.template,
    status: f.status as any,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}
export function toIssueRow(i: RepoIssue): Issue {
  return {
    id: i.id,
    floorId: i.floor_id,
    number: i.number,
    title: i.title,
    body: i.body,
    stage: i.stage as any,
    assigneeId: i.assignee_id,
    prUrl: i.pr_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  };
}
export function toMemoryRow(m: RepoMemory): Memory {
  return {
    id: m.id,
    scope: m.scope as any,
    scopeId: m.scope_id,
    key: m.key,
    value: m.value,
    updatedAt: m.updated_at,
  };
}
export function toAccountRow(a: RepoAIAccount): AIAccount {
  return {
    id: a.id,
    provider: a.provider as any,
    baseUrl: a.base_url,
    model: a.model,
    apiKey: a.api_key,
    tokenCap: a.token_cap,
    tokensUsed: a.tokens_used,
  };
}
