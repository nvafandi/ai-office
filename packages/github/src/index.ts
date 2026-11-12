import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { openDb, closeDb, sqlEscape } from "@ai-office/db";
import { STAGES } from "@ai-office/orchestrator";
import { bus } from "@ai-office/events";

const DEFAULT_REDIRECT_URI = "http://localhost:3045/api/github/oauth-callback";
const DEFAULT_SCOPE = "repo,read:user";

export interface OAuthUrlInput {
  clientId: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
}

export function generateOAuthUrl({
  clientId,
  redirectUri = DEFAULT_REDIRECT_URI,
  scope = DEFAULT_SCOPE,
  state = crypto.randomUUID(),
}: OAuthUrlInput): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TokenExchangeInput {
  code: string;
  state: string;
  expectedState: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  fetchFn?: typeof fetch;
}

export async function exchangeCodeForToken({
  code,
  state,
  expectedState,
  clientId = process.env.GITHUB_CLIENT_ID,
  clientSecret = process.env.GITHUB_CLIENT_SECRET,
  redirectUri = DEFAULT_REDIRECT_URI,
  fetchFn = fetch,
}: TokenExchangeInput): Promise<string> {
  if (state !== expectedState) throw new Error("invalid oauth state");
  if (!clientId || !clientSecret)
    throw new Error("github oauth tidak dikonfigurasi");
  const res = await fetchFn("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`token exchange gagal: ${res.status}`);
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (json.error || !json.access_token)
    throw new Error(json.error ?? "token tidak diterima dari github");
  return json.access_token;
}

export interface OAuthFlowState {
  expectedState: string;
  redirectUri: string;
  scope: string;
  createdAt: number;
}

export interface OAuthFlowInput {
  clientId: string;
  redirectUri?: string;
  scope?: string;
}

export interface OAuthFlowVerifyInput {
  code: string;
  state: string;
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  fetchFn?: typeof fetch;
}

export interface OAuthFlow {
  generateUrl: (input: OAuthFlowInput) => { url: string; state: string };
  verifyAndExchange: (input: OAuthFlowVerifyInput) => Promise<string>;
}

// Anti-CSRF: single-use OAuth state with TTL (10 menit). Map di-memori,
// kunci adalah state yang di-generate sendiri (bukan dicerminkan dari klien).
export function createOAuthFlow({
  ttlMs = 10 * 60 * 1000,
  fetchFn = fetch,
}: { ttlMs?: number; fetchFn?: typeof fetch } = {}): OAuthFlow {
  const states = new Map<string, OAuthFlowState>();

  const sweep = () => {
    const now = Date.now();
    for (const [key, value] of states) {
      if (now - value.createdAt > ttlMs) states.delete(key);
    }
  };

  const generateUrl = ({
    clientId,
    redirectUri = DEFAULT_REDIRECT_URI,
    scope = DEFAULT_SCOPE,
  }: OAuthFlowInput): { url: string; state: string } => {
    sweep();
    const state = crypto.randomUUID();
    states.set(state, {
      expectedState: state,
      redirectUri,
      scope,
      createdAt: Date.now(),
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
    return { url: url.toString(), state };
  };

  const verifyAndExchange = async ({
    code,
    state,
    clientId = process.env.GITHUB_CLIENT_ID,
    redirectUri = DEFAULT_REDIRECT_URI,
    scope = DEFAULT_SCOPE,
    fetchFn: useFetch = fetchFn,
  }: OAuthFlowVerifyInput): Promise<string> => {
    const stored = states.get(state);
    if (!stored) throw new Error("invalid oauth state");
    if (Date.now() - stored.createdAt > ttlMs) {
      states.delete(state);
      throw new Error("oauth state expired");
    }
    if (stored.redirectUri !== redirectUri)
      throw new Error("oauth redirect_uri tidak cocok");
    if (stored.scope !== scope) throw new Error("oauth scope tidak cocok");
    states.delete(state); // single-use: state tidak bisa dipakai ulang
    return exchangeCodeForToken({
      code,
      state,
      expectedState: stored.expectedState,
      clientId,
      redirectUri: stored.redirectUri,
      fetchFn: useFetch,
    });
  };

  return { generateUrl, verifyAndExchange };
}

function encKey(): Buffer {
  const k = process.env.GITHUB_TOKEN_ENC_KEY;
  if (!k) throw new Error("GITHUB_TOKEN_ENC_KEY tidak diatur");
  return createHash("sha256").update(k).digest();
}

export function encryptToken(plaintext: string): {
  encrypted: string;
  iv: string;
} {
  const key = encKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("ai-office-github-token", "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([enc, tag]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptToken(input: { encrypted: string; iv: string }): string {
  const key = encKey();
  const data = Buffer.from(input.encrypted, "hex");
  const iv = Buffer.from(input.iv, "hex");
  if (data.length < 16) throw new Error("token terenkripsi rusak");
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from("ai-office-github-token", "utf8"));
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export interface GitHubInstallation {
  id: number;
  account: { login: string };
}

export interface ListInstallationsInput {
  token: string;
  fetchFn?: typeof fetch;
}

export async function listInstallations({
  token,
  fetchFn = fetch,
}: ListInstallationsInput): Promise<GitHubInstallation[]> {
  const res = await fetchFn("https://api.github.com/user/installations", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-office",
    },
  });
  if (!res.ok) throw new Error(`daftar instalasi github gagal: ${res.status}`);
  return (await res.json()) as GitHubInstallation[];
}

export interface GitHubUser {
  login: string;
  id: number;
}

export interface VerifyTokenInput {
  token: string;
  fetchFn?: typeof fetch;
}

// Validasi token nyata melalui GitHub /user (digunakan sebagai otorisasi
// untuk rute /api/github/installations karena tidak ada sistem sesi).
export async function verifyToken({
  token,
  fetchFn = fetch,
}: VerifyTokenInput): Promise<GitHubUser> {
  const res = await fetchFn("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-office",
    },
  });
  if (!res.ok) throw new Error(`token tidak valid: ${res.status}`);
  return (await res.json()) as GitHubUser;
}

export interface VerifyWebhookInput {
  payload: string | Buffer;
  signature: string | undefined;
}

export function verifyWebhook({
  payload,
  signature,
}: VerifyWebhookInput): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET tidak diatur");
  if (!signature) return false;
  const [algo, hex] = String(signature).split("=", 2);
  if (algo !== "sha256" || !hex) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "latin1");
  const b = Buffer.from(hex, "latin1");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string | null;
}

export interface IntakeInput {
  owner: string;
  repo: string;
  number: number;
  fetchFn?: typeof fetch;
}

export interface IntakeResult {
  floorId: string;
  agentId: string;
  issueId: string;
}

export async function intakeFromGitHub({
  owner,
  repo,
  number,
  fetchFn = fetch,
}: IntakeInput): Promise<IntakeResult> {
  const res = await fetchFn(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ai-office",
      },
    },
  );
  if (!res.ok) throw new Error(`github issue tidak ditemukan: ${res.status}`);
  const issue = (await res.json()) as GitHubIssue;

  const ctx = await openDb();
  try {
    const now = new Date().toISOString();
    const floorId = `fl_${crypto.randomUUID().replace(/-/g, "")}`;
    const agentId = `ag_${crypto.randomUUID().replace(/-/g, "")}`;
    ctx.db.exec(
      `INSERT INTO floors (id, name, repo, owner_id, template, status, created_at, updated_at) VALUES (
        ${sqlEscape(floorId)}, ${sqlEscape(repo)}, ${sqlEscape(`${owner}/${repo}`)}, ${sqlEscape("github-intake")}, 'development', 'active', ${sqlEscape(now)}, ${sqlEscape(now)})`,
    );
    ctx.db.exec(
      `INSERT INTO agents (id, floor_id, name, role, stage, model, token_cap, tokens_used, created_at, updated_at) VALUES (
        ${sqlEscape(agentId)}, ${sqlEscape(floorId)}, ${sqlEscape("GitHub Manager")}, 'manager', ${sqlEscape(STAGES[0])}, ${sqlEscape("mock")}, 0, 0, ${sqlEscape(now)}, ${sqlEscape(now)})`,
    );
    bus.publish("issue:intake", {
      floorId,
      agentId,
      issue: {
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        html_url: issue.html_url ?? null,
      },
    });
    return { floorId, agentId, issueId: String(issue.id) };
  } finally {
    closeDb(ctx);
  }
}
