import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

const AAD = "ai-office-gateway-api-key";
const ALGO = "aes-256-gcm";

export class GatewayError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function encKey(): Buffer {
  const k = process.env.GATEWAY_ENC_KEY;
  if (!k) throw new Error("GATEWAY_ENC_KEY tidak diatur");
  return createHash("sha256").update(k).digest();
}

export interface ApiKeySeal {
  encrypted: string;
  iv: string;
}

export function encryptApiKey(plaintext: string): ApiKeySeal {
  const key = encKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(AAD, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encrypted: Buffer.concat([enc, cipher.getAuthTag()]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptApiKey(seal: ApiKeySeal): string {
  const key = encKey();
  const data = Buffer.from(seal.encrypted, "hex");
  const iv = Buffer.from(seal.iv, "hex");
  if (data.length < 16) throw new Error("api key terenkripsi rusak");
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(AAD, "utf8"));
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export interface Account {
  id: string;
  provider: string;
  baseUrl: string;
  model: string;
  tokenCap: number;
  tokensUsed: number;
}

export interface AccountWithKey extends Account {
  apiKey: string | null;
}

export interface CreateAccountInput {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string | null;
  tokenCap?: number;
}

export interface ChatInput {
  accountId: string;
  messages?: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

interface StmtLike {
  bind(params: unknown[]): void;
  step(): boolean;
  get(): unknown[] | null;
  run(params: unknown[]): void;
  free(): void;
}

interface DbLike {
  prepare(sql: string): StmtLike;
}

function all(db: DbLike, sql: string, params: unknown[] = []): unknown[][] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out: unknown[][] = [];
  while (stmt.step()) {
    const row = stmt.get();
    if (row) out.push(row);
  }
  stmt.free();
  return out;
}

function one(
  db: DbLike,
  sql: string,
  params: unknown[] = [],
): unknown[] | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get();
  stmt.free();
  return row;
}

const ACCOUNT_COLS =
  "id, provider, base_url, model, api_key, iv, token_cap, tokens_used";

function toAccount(row: unknown[]): Account {
  return {
    id: String(row[0]),
    provider: String(row[1]),
    baseUrl: String(row[2]),
    model: String(row[3]),
    tokenCap: Number(row[6] ?? 0),
    tokensUsed: Number(row[7] ?? 0),
  };
}

function toAccountWithKey(row: unknown[]): AccountWithKey {
  return {
    ...toAccount(row),
    apiKey:
      row[4] == null || row[5] == null
        ? null
        : decryptApiKey({ encrypted: String(row[4]), iv: String(row[5]) }),
  };
}

// shortcut: sql.js statement-only DB abstraction, tidak bergantung pada paket @ai-office/db;
// upgrade jika butuh transaksi atau query builder.
export function createGateway({
  db,
  fetchFn = fetch,
}: {
  db: DbLike;
  fetchFn?: typeof fetch;
}) {
  function listAccounts(): Account[] {
    return all(db, `SELECT ${ACCOUNT_COLS} FROM ai_accounts`).map(toAccount);
  }

  function getAccount(id: string): AccountWithKey | null {
    const row = one(
      db,
      `SELECT ${ACCOUNT_COLS} FROM ai_accounts WHERE id = ?`,
      [id],
    );
    return row ? toAccountWithKey(row) : null;
  }

  function createAccount(input: CreateAccountInput): Account {
    const id = `acct_${randomUUID().replace(/-/g, "")}`;
    const seal = input.apiKey ? encryptApiKey(input.apiKey) : null;
    db.prepare(
      `INSERT INTO ai_accounts (id, provider, base_url, model, api_key, iv, token_cap, tokens_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run([
      id,
      input.provider ?? "ollama",
      input.baseUrl ?? "http://localhost:11434",
      input.model ?? "llama3",
      seal?.encrypted ?? null,
      seal?.iv ?? null,
      input.tokenCap ?? 0,
      0,
    ]);
    return {
      id,
      provider: input.provider ?? "ollama",
      baseUrl: input.baseUrl ?? "http://localhost:11434",
      model: input.model ?? "llama3",
      tokenCap: input.tokenCap ?? 0,
      tokensUsed: 0,
    };
  }

  async function chatCompletions(
    input: ChatInput,
  ): Promise<{ status: number; body: unknown }> {
    const { accountId, messages, ...upstream } = input;
    const acc = getAccount(accountId);
    if (!acc) throw new GatewayError(404, "account tidak ditemukan");
    if (acc.tokenCap > 0 && acc.tokensUsed >= acc.tokenCap) {
      throw new GatewayError(429, "token cap tercapai");
    }

    const url = `${acc.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${acc.apiKey ?? ""}`,
        },
        body: JSON.stringify({ model: acc.model, messages, ...upstream }),
      });
    } catch (err) {
      throw new GatewayError(
        502,
        `provider tidak dapat dijangkau: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {}
    if (!res.ok) {
      return {
        status: res.status,
        body: json ?? { error: `provider mengembalikan ${res.status}` },
      };
    }

    const total =
      json !== null &&
      typeof json === "object" &&
      "usage" in json
        ? (json as { usage?: { total_tokens?: unknown } }).usage?.total_tokens
        : undefined;
    const added = Number.isFinite(Number(total)) ? Number(total) : 0;
    const nextUsed = acc.tokensUsed + added;
    db.prepare(`UPDATE ai_accounts SET tokens_used = ? WHERE id = ?`).run([
      nextUsed,
      accountId,
    ]);
    // cap tercapai setelah panggilan ditambah penggunaan: panggilan berikutnya diblokir 429

    return { status: 200, body: json };
  }

  return { listAccounts, getAccount, createAccount, chatCompletions };
}
