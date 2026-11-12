import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  closeDb,
  runSchema,
  queryAll,
  queryRow,
  sqlEscape,
  toNoticeRow,
} from "@ai-office/db";
import { createGateway, GatewayError } from "@ai-office/gateway";
import {
  assignAgent,
  advanceStage,
  stageHistory,
} from "@ai-office/orchestrator";
import { bus } from "@ai-office/events";
import { connectionManager } from "@ai-office/communications";
import {
  encryptToken,
  verifyWebhook,
  listInstallations,
  createOAuthFlow,
  verifyToken,
} from "@ai-office/github";
import type { RepoNotice } from "@ai-office/db";

const PORT = Number(process.env.PORT ?? 3045);
const HOST = process.env.HOST ?? "localhost";
const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..", "..", "..");
const ROOT = join(APP_ROOT, "apps", "web", "public");
const DB_PATH =
  process.env.AI_OFFICE_DB ??
  join(APP_ROOT, "packages", "db", "data", "office.sqlite");
const THREE_BUILD = join(APP_ROOT, "node_modules", "three", "build");
const THREE_EXAMPLES = join(
  APP_ROOT,
  "node_modules",
  "three",
  "examples",
  "jsm",
);

const oauthFlow = createOAuthFlow();

function dirname(p: string): string {
  return p.split(/[\\/]/).slice(0, -1).join("/") || ".";
}

function gw(db: import("@ai-office/db").SqlDatabase) {
  return createGateway({ db, fetchFn: fetch });
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
  base_url TEXT NOT NULL, model TEXT NOT NULL, api_key TEXT, iv TEXT,
  token_cap INTEGER NOT NULL DEFAULT 0, tokens_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agents_floor ON agents(floor_id);
CREATE INDEX IF NOT EXISTS idx_issues_floor ON issues(floor_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
CREATE TABLE IF NOT EXISTS stage_history (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_history_issue ON stage_history(issue_id);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL, author TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notices_floor ON notices(floor_id);
CREATE TABLE IF NOT EXISTS github_installations (
  id TEXT PRIMARY KEY, installation_id INTEGER NOT NULL UNIQUE,
  account_login TEXT NOT NULL, encrypted_token TEXT NOT NULL, iv TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_installations_account ON github_installations(account_login);
`;

type Req = import("node:http").IncomingMessage & { body?: unknown };

function readBodyRaw(req: Req): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk as Buffer)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(
  res: import("node:http").ServerResponse,
  status: number,
  data: unknown,
) {
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

async function serveFile(
  res: import("node:http").ServerResponse,
  filePath: string,
) {
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
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(st.size),
  });
  res.end(file);
}

type Row = unknown[];

function mapRows(columns: string[], rows: Row[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

async function withDb<T>(
  fn: (db: import("@ai-office/db").SqlDatabase) => Promise<T>,
): Promise<T> {
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
    if (
      pathname.startsWith("/app.js") ||
      pathname.startsWith("/style.css") ||
      pathname.startsWith("/styles/") ||
      pathname === "/favicon.ico"
    ) {
      const rel = pathname.slice(1);
      if (rel.split("/").includes("..")) {
        notFound(res);
        return;
      }
      const rawPath = (req.url ?? "").split("?")[0];
      if (rawPath.split("/").includes("..")) {
        notFound(res);
        return;
      }
      await serveFile(res, join(ROOT, rel));
      return;
    }
    if (pathname === "/") {
      await serveFile(res, join(ROOT, "index.html"));
      return;
    }
    if (!pathname.startsWith("/api") && !pathname.startsWith("/v1")) {
      notFound(res);
      return;
    }

    const floorId = url.searchParams.get("floorId") ?? undefined;
    const floorFilter = floorId ? `WHERE floor_id = ${sqlEscape(floorId)}` : "";

    try {
      const raw = await readBodyRaw(req);
      let parsedBody: unknown = null;
      if (raw.length > 0) {
        parsedBody = JSON.parse(raw.toString("utf8"));
      }

      if (pathname === "/api/health" && method === "GET") {
        json(res, 200, { ok: true, service: "ai-office-server" });
        return;
      }

      if (pathname === "/api/floors" && method === "GET") {
        const floors = await withDb(async (db) =>
          mapRows(
            [
              "id",
              "name",
              "repo",
              "owner_id",
              "template",
              "status",
              "created_at",
              "updated_at",
            ],
            queryAll(
              db,
              `SELECT id, name, repo, owner_id, template, status, created_at, updated_at FROM floors`,
            ),
          ),
        );
        json(res, 200, floors);
        return;
      }

      if (pathname === "/api/floors" && method === "POST") {
        const body = parsedBody as {
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
                body.repo ?? "",
              )}, ${sqlEscape(body.owner_id ?? "owner_1")}, ${sqlEscape(
                body.template ?? "development",
              )}, 'active', ${sqlEscape(now)}, ${sqlEscape(now)})`,
          ),
        );
        json(res, 201, { id, name: body.name ?? "New Floor" });
        return;
      }

      if (pathname === "/api/agents" && method === "GET") {
        const agents = await withDb(async (db) =>
          mapRows(
            [
              "id",
              "floor_id",
              "name",
              "role",
              "stage",
              "model",
              "token_cap",
              "tokens_used",
              "created_at",
              "updated_at",
            ],
            queryAll(
              db,
              `SELECT id, floor_id, name, role, stage, model, token_cap, tokens_used, created_at, updated_at FROM agents ${floorFilter}`,
            ),
          ),
        );
        json(res, 200, agents);
        return;
      }

      if (pathname === "/api/issues" && method === "GET") {
        const issues = await withDb(async (db) =>
          mapRows(
            [
              "id",
              "floor_id",
              "number",
              "title",
              "body",
              "stage",
              "assignee_id",
              "pr_url",
              "created_at",
              "updated_at",
            ],
            queryAll(
              db,
              `SELECT id, floor_id, number, title, body, stage, assignee_id, pr_url, created_at, updated_at FROM issues ${floorFilter} ORDER BY number`,
            ),
          ),
        );
        json(res, 200, issues);
        return;
      }

      if (pathname === "/api/gateway/accounts" && method === "GET") {
        const accounts = await withDb(async (db) => gw(db).listAccounts());
        json(res, 200, accounts);
        return;
      }

      if (pathname === "/api/gateway/accounts" && method === "POST") {
        const body = parsedBody as {
          provider?: string;
          baseUrl?: string;
          model?: string;
          apiKey?: string | null;
          tokenCap?: number;
        };
        const account = await withDb(async (db) =>
          gw(db).createAccount({
            provider: body.provider ?? "ollama",
            baseUrl: body.baseUrl ?? "http://localhost:11434",
            model: body.model ?? "llama3",
            apiKey: body.apiKey ?? null,
            tokenCap: body.tokenCap ?? 0,
          }),
        );
        json(res, 201, account);
        return;
      }

      if (pathname === "/v1/chat/completions" && method === "POST") {
        const body = parsedBody as {
          accountId?: string;
          messages?: Array<{ role: string; content: string }>;
          [key: string]: unknown;
        } | null;
        if (!body?.accountId || !Array.isArray(body.messages)) {
          json(res, 400, { error: "accountId dan messages wajib diisi" });
          return;
        }
        const { accountId, ...rest } = body;
        try {
          const { status, body: out } = await withDb(async (db) =>
            gw(db).chatCompletions({ accountId, ...rest }),
          );
          json(res, status, out);
          return;
        } catch (e) {
          if (e instanceof GatewayError) {
            json(res, e.status, { error: e.message });
            return;
          }
          throw e;
        }
      }

      if (pathname === "/api/issues" && method === "POST") {
        const body = parsedBody as {
          floorId?: string;
          title?: string;
          body?: string | null;
        };
        if (!body.floorId) {
          json(res, 400, { error: "floorId is required" });
          return;
        }
        const id = `iss_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        await withDb(async (db) => {
          const max = queryAll(
            db,
            `SELECT COALESCE(MAX(number), 0) FROM issues WHERE floor_id = ${sqlEscape(body.floorId)}`,
          )[0]?.[0] as number;
          db.exec(
            `INSERT INTO issues (id, floor_id, number, title, body, stage, assignee_id, pr_url, created_at, updated_at) VALUES (
              ${sqlEscape(id)}, ${sqlEscape(body.floorId)}, ${sqlEscape(max + 1)}, ${sqlEscape(body.title ?? "New Issue")},
              ${sqlEscape(body.body ?? null)}, 'needs-work', NULL, NULL, ${sqlEscape(now)}, ${sqlEscape(now)})`,
          );
        });
        bus.publish("issue:created", {
          issue: {
            id,
            floorId: body.floorId,
            title: body.title ?? "New Issue",
          },
          floorId: body.floorId,
        });
        json(res, 201, { id, number: 1, title: body.title ?? "New Issue" });
        return;
      }

      if (pathname === "/api/agents" && method === "POST") {
        const body = parsedBody as {
          floorId?: string;
          name?: string;
          role?: string;
          model?: string;
          tokenCap?: number;
        };
        if (!body.floorId) {
          json(res, 400, { error: "floorId is required" });
          return;
        }
        const id = `ag_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        await withDb(async (db) =>
          db.exec(
            `INSERT INTO agents (id, floor_id, name, role, stage, model, token_cap, tokens_used, created_at, updated_at) VALUES (
              ${sqlEscape(id)}, ${sqlEscape(body.floorId)}, ${sqlEscape(body.name ?? "Agent")}, ${sqlEscape(body.role ?? "developer")},
              'needs-work', ${sqlEscape(body.model ?? "mock")}, ${sqlEscape(body.tokenCap ?? 0)}, 0, ${sqlEscape(now)}, ${sqlEscape(now)})`,
          ),
        );
        json(res, 201, { id, name: body.name ?? "Agent" });
        return;
      }

      const issueAction =
        /^\/api\/issues\/([^/]+)\/(assign|advance|history)$/.exec(pathname);
      if (issueAction) {
        const issueId = decodeURIComponent(issueAction[1]);
        const action = issueAction[2];
        if (action === "assign" && method === "POST") {
          const body = parsedBody as { agentId?: string };
          if (!body.agentId) {
            json(res, 400, { error: "agentId is required" });
            return;
          }
          try {
            await withDb(async (db) =>
              assignAgent(db, issueId, body.agentId as string),
            );
            json(res, 200, { issueId, agentId: body.agentId });
          } catch (e) {
            json(res, 400, { error: String(e) });
          }
          return;
        }
        if (action === "advance" && method === "POST") {
          try {
            const result = await withDb(async (db) =>
              advanceStage(db, issueId),
            );
            json(res, 200, result);
          } catch (e) {
            json(res, 400, { error: String(e) });
          }
          return;
        }
        if (action === "history" && method === "GET") {
          const history = await withDb(async (db) => stageHistory(db, issueId));
          json(res, 200, history);
          return;
        }
      }

      if (pathname === "/api/notices" && method === "GET") {
        const notices = await withDb(async (db) =>
          mapRows(
            [
              "id",
              "floor_id",
              "title",
              "content",
              "author",
              "created_at",
              "updated_at",
            ],
            queryAll(
              db,
              `SELECT id, floor_id, title, content, author, created_at, updated_at FROM notices ${floorId ? `WHERE floor_id = ${sqlEscape(floorId)}` : ""} ORDER BY created_at DESC`,
            ),
          ),
        );
        json(
          res,
          200,
          notices.map((n) => toNoticeRow(n as unknown as RepoNotice)),
        );
        return;
      }

      if (pathname === "/api/notices" && method === "POST") {
        const b = parsedBody as {
          floor_id?: string;
          title?: string;
          content?: string;
          author?: string;
        } | null;
        if (!b?.floor_id || !b?.title || !b?.content || !b?.author) {
          json(res, 400, {
            error: "floor_id, title, content, author are required",
          });
          return;
        }
        const id = `nt_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        await withDb(async (db) =>
          db.exec(
            `INSERT INTO notices (id, floor_id, title, content, author, created_at, updated_at) VALUES (
              ${sqlEscape(id)}, ${sqlEscape(b.floor_id)}, ${sqlEscape(b.title)}, ${sqlEscape(b.content)}, ${sqlEscape(b.author)}, ${sqlEscape(now)}, ${sqlEscape(now)})`,
          ),
        );
        json(res, 201, {
          id,
          floorId: b.floor_id,
          title: b.title,
          content: b.content,
          author: b.author,
          createdAt: now,
          updatedAt: now,
        });
        return;
      }

      const noticeAction = /^\/api\/notices\/([^/]+)$/.exec(pathname);
      if (noticeAction && method === "DELETE") {
        const id = decodeURIComponent(noticeAction[1]);
        let deleted = false;
        await withDb(async (db) => {
          const row = queryRow(
            db,
            `SELECT id FROM notices WHERE id = ${sqlEscape(id)}`,
          );
          if (row) {
            db.exec(`DELETE FROM notices WHERE id = ${sqlEscape(id)}`);
            deleted = true;
          }
        });
        if (!deleted) {
          json(res, 404, { error: "not found" });
          return;
        }
        json(res, 200, { id, deleted: true });
        return;
      }

      if (pathname === "/api/connections" && method === "GET") {
        json(res, 200, connectionManager.listConnections());
        return;
      }

      const connSend = /^\/api\/connections\/([^/]+)\/send$/.exec(pathname);
      if (connSend && method === "POST") {
        const id = decodeURIComponent(connSend[1]);
        const c = connectionManager.getConnection(id);
        if (!c) {
          json(res, 404, { error: "not found" });
          return;
        }
        const b = parsedBody as { message?: string } | null;
        const result = connectionManager.sendNotification(id, b?.message ?? "");
        json(res, 200, result);
        return;
      }

      if (pathname === "/api/github/oauth-url" && method === "GET") {
        const clientId =
          url.searchParams.get("client_id") ??
          process.env.GITHUB_CLIENT_ID ??
          "";
        if (!clientId) {
          json(res, 400, { error: "client_id is required" });
          return;
        }
        const { url: oauthUrl } = oauthFlow.generateUrl({
          clientId,
          redirectUri:
            url.searchParams.get("redirect_uri") ??
            "http://localhost:3045/api/github/oauth-callback",
          scope: url.searchParams.get("scope") ?? "repo,read:user",
        });
        json(res, 200, { url: oauthUrl });
        return;
      }

      if (pathname === "/api/github/oauth-callback" && method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        if (!code) {
          json(res, 400, { error: "code is required" });
          return;
        }
        try {
          const token = await oauthFlow.verifyAndExchange({
            code,
            state,
            clientId: process.env.GITHUB_CLIENT_ID,
            redirectUri:
              url.searchParams.get("redirect_uri") ??
              "http://localhost:3045/api/github/oauth-callback",
            scope: url.searchParams.get("scope") ?? "repo,read:user",
          });
          const { encrypted, iv } = encryptToken(token);
          const installations = await listInstallations({ token });
          const inst = installations[0];
          if (!inst) {
            json(res, 400, { error: "no github installations for this token" });
            return;
          }
          await withDb(async (db) => {
            const insId = `gi_${crypto.randomUUID().replace(/-/g, "")}`;
            const now = new Date().toISOString();
            db.exec(
              `INSERT INTO github_installations (id, installation_id, account_login, encrypted_token, iv, created_at, updated_at) VALUES (
                ${sqlEscape(insId)}, ${sqlEscape(String(inst.id))}, ${sqlEscape(inst.account.login)}, ${sqlEscape(encrypted)}, ${sqlEscape(iv)}, ${sqlEscape(now)}, ${sqlEscape(now)})`,
            );
          });
          json(res, 200, {
            ok: true,
            installationId: inst.id,
            account_login: inst.account.login,
          });
          return;
        } catch (e) {
          json(res, 400, { error: String(e) });
          return;
        }
      }

      if (pathname === "/api/github/installations" && method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          json(res, 401, { error: "token is required" });
          return;
        }
        try {
          await verifyToken({ token });
        } catch {
          json(res, 401, { error: "token tidak valid" });
          return;
        }
        const owner = url.searchParams.get("owner") ?? undefined;
        const rows = await withDb(async (db) =>
          mapRows(
            [
              "id",
              "installation_id",
              "account_login",
              "created_at",
              "updated_at",
            ],
            queryAll(
              db,
              owner
                ? `SELECT id, installation_id, account_login, created_at, updated_at FROM github_installations WHERE account_login = ${sqlEscape(owner)}`
                : "SELECT id, installation_id, account_login, created_at, updated_at FROM github_installations",
            ),
          ),
        );
        json(res, 200, rows);
        return;
      }

      if (pathname === "/api/github/installations" && method === "POST") {
        const b = parsedBody as {
          installation_id?: string;
          account_login?: string;
          token?: string;
        } | null;
        if (!b?.installation_id || !b?.account_login || !b?.token) {
          json(res, 400, {
            error: "installation_id, account_login, token are required",
          });
          return;
        }
        try {
          await verifyToken({ token: b.token });
        } catch {
          json(res, 401, { error: "token tidak valid" });
          return;
        }
        const { encrypted, iv } = encryptToken(b.token);
        const id = `gi_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        await withDb(async (db) => {
          db.exec(
            `INSERT INTO github_installations (id, installation_id, account_login, encrypted_token, iv, created_at, updated_at) VALUES (
              ${sqlEscape(id)}, ${sqlEscape(b.installation_id)}, ${sqlEscape(b.account_login)}, ${sqlEscape(encrypted)}, ${sqlEscape(iv)}, ${sqlEscape(now)}, ${sqlEscape(now)})`,
          );
        });
        json(res, 201, {
          id,
          installation_id: b.installation_id,
          account_login: b.account_login,
        });
        return;
      }

      if (pathname === "/api/github/webhook" && method === "POST") {
        const signature = String(req.headers["x-hub-signature-256"] ?? "");
        let ok = false;
        try {
          ok = verifyWebhook({ payload: raw, signature });
        } catch {
          ok = false;
        }
        if (!ok) {
          json(res, 401, { error: "invalid signature" });
          return;
        }
        json(res, 200, { ok: true, received: true });
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
