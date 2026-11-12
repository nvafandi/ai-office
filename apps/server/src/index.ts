import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  closeDb,
  runSchema,
  queryAll,
  sqlEscape,
} from "@ai-office/db";

const PORT = Number(process.env.PORT ?? 3045);
const HOST = process.env.HOST ?? "localhost";
const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..", "..");
const ROOT = join(APP_ROOT, "web", "public");
const DB_PATH =
  process.env.AI_OFFICE_DB ??
  join(APP_ROOT, "packages", "db", "data", "office.sqlite");
const THREE_BUILD = join(APP_ROOT, "node_modules", "three", "build");
const THREE_EXAMPLES = join(APP_ROOT, "node_modules", "three", "examples", "jsm");

function dirname(p: string): string {
  return p.split(/[\\/]/).slice(0, -1).join("/") || ".";
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL, owner_id TEXT NOT NULL,
  template TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, floor_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  stage TEXT NOT NULL, model TEXT NOT NULL, token_cap INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY, floor_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL,
  body TEXT, stage TEXT NOT NULL DEFAULT 'needs-work', assignee_id TEXT, pr_url TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK (scope IN ('office','floor','role')),
  scope_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_accounts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK (provider IN ('claude','chatgpt','grok','ollama')),
  base_url TEXT NOT NULL, model TEXT NOT NULL, api_key TEXT,
  token_cap INTEGER NOT NULL DEFAULT 0, tokens_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agents_floor ON agents(floor_id);
CREATE INDEX IF NOT EXISTS idx_issues_floor ON issues(floor_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
`;

type Req = import("node:http").IncomingMessage & { body?: unknown };

function readBody(req: Req): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res: import("node:http").ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function notFound(res: import("node:http").ServerResponse) {
  json(res, 404, { error: "not found" });
}

async function serveFile(res: import("node:http").ServerResponse, filePath: string) {
  if (!existsSync(filePath)) {
    notFound(res);
    return;
  }
  const ext = extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  const contentType = types[ext] ?? "application/octet-stream";
  const [file, st] = await Promise.all([readFile(filePath), stat(filePath)]);
  res.writeHead(200, { "Content-Type": contentType, "Content-Length": String(st.size) });
  res.end(file);
}

type Row = unknown[];

function mapRows(columns: string[], rows: Row[]): Record<string, unknown>[] {
  return rows.map((r) =>
    Object.fromEntries(columns.map((c, i) => [c, r[i]]))
  );
}

async function withDb<T>(fn: (db: import("@ai-office/db").SqlDatabase) => Promise<T>): Promise<T> {
  const ctx = await openDb(DB_PATH);
  try {
    return await fn(ctx.db);
  } finally {
    closeDb(ctx);
  }
}

export function createApp() {
  return async (req: Req, res: import("node:http").ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (pathname.startsWith("/three/build/")) {
      const rel = pathname.slice("/three/build/".length);
      await serveFile(res, join(THREE_BUILD, rel));
      return;
    }
    if (pathname.startsWith("/three/examples/jsm/")) {
      const rel = pathname.slice("/three/examples/jsm/".length);
      await serveFile(res, join(THREE_EXAMPLES, rel));
      return;
    }
    if (pathname.startsWith("/app.js") || pathname.startsWith("/style.css") || pathname === "/favicon.ico") {
      await serveFile(res, join(ROOT, basename(pathname)));
      return;
    }
    if (pathname === "/") {
      await serveFile(res, join(ROOT, "index.html"));
      return;
    }
    if (!pathname.startsWith("/api")) {
      notFound(res);
      return;
    }

    const floorId = url.searchParams.get("floorId") ?? undefined;
    const floorFilter = floorId ? `WHERE floor_id = ${sqlEscape(floorId)}` : "";

    try {
      if (pathname === "/api/health" && method === "GET") {
        json(res, 200, { ok: true, service: "ai-office-server" });
        return;
      }

      if (pathname === "/api/floors" && method === "GET") {
        const floors = await withDb(async (db) =>
          mapRows(
            ["id", "name", "repo", "owner_id", "template", "status", "created_at", "updated_at"],
            queryAll(
              db,
              `SELECT id, name, repo, owner_id, template, status, created_at, updated_at FROM floors`
            )
          )
        );
        json(res, 200, floors);
        return;
      }

      if (pathname === "/api/floors" && method === "POST") {
        const body = (await readBody(req)) as {
          name?: string;
          repo?: string;
          owner_id?: string;
          template?: string;
        };
        const id = `fl_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        await withDb(async (db) =>
          db.exec(
            `INSERT INTO floors (id, name, repo, owner_id, template, status, created_at, updated_at) VALUES (
              ${sqlEscape(id)}, ${sqlEscape(body.name ?? "New Floor")}, ${sqlEscape(
              body.repo ?? ""
            )}, ${sqlEscape(body.owner_id ?? "owner_1")}, ${sqlEscape(
              body.template ?? "development"
            )}, 'active', ${sqlEscape(now)}, ${sqlEscape(now)})`
          )
        );
        json(res, 201, { id, name: body.name ?? "New Floor" });
        return;
      }

      if (pathname === "/api/agents" && method === "GET") {
        const agents = await withDb(async (db) =>
          mapRows(
            ["id", "floor_id", "name", "role", "stage", "model", "token_cap", "tokens_used", "created_at", "updated_at"],
            queryAll(
              db,
              `SELECT id, floor_id, name, role, stage, model, token_cap, tokens_used, created_at, updated_at FROM agents ${floorFilter}`
            )
          )
        );
        json(res, 200, agents);
        return;
      }

      if (pathname === "/api/issues" && method === "GET") {
        const issues = await withDb(async (db) =>
          mapRows(
            ["id", "floor_id", "number", "title", "body", "stage", "assignee_id", "pr_url", "created_at", "updated_at"],
            queryAll(
              db,
              `SELECT id, floor_id, number, title, body, stage, assignee_id, pr_url, created_at, updated_at FROM issues ${floorFilter} ORDER BY number`
            )
          )
        );
        json(res, 200, issues);
        return;
      }

      notFound(res);
    } catch (err) {
      console.error(err);
      json(res, 500, { error: "internal error" });
    }
  };
}

let server: HttpServer | null = null;
export async function start() {
  const ctx = await openDb(DB_PATH);
  runSchema(ctx.db, SCHEMA_SQL);
  closeDb(ctx);

  const app = createApp();
  server = createServer(app);
  server.listen(PORT, HOST, () => {
    console.log(`ai-office server listening on http://${HOST}:${PORT}`);
  });
  return server;
}

if (import.meta.main) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
