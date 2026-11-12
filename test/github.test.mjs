process.env.AI_OFFICE_DB = process.cwd() + "/test/github.sqlite";
process.env.GITHUB_TOKEN_ENC_KEY =
  "test-enc-key-0123456789abcdef0123456789abcdef";
process.env.GITHUB_WEBHOOK_SECRET = "whsec_test_secret";
process.env.GITHUB_CLIENT_ID = "test_client_id";
process.env.GITHUB_CLIENT_SECRET = "test_client_secret";

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { unlinkSync } from "node:fs";
import {
  generateOAuthUrl,
  exchangeCodeForToken,
  encryptToken,
  decryptToken,
  verifyWebhook,
  listInstallations,
  createOAuthFlow,
  verifyToken,
  intakeFromGitHub,
} from "../packages/github/dist/index.js";
import {
  openDb,
  closeDb,
  runSchema,
  queryRow,
  sqlEscape,
} from "../packages/db/dist/index.js";
import { bus } from "../packages/events/dist/index.js";

const DB_FILE = process.cwd() + "/test/github.sqlite";

const issueJson = {
  id: 9001,
  number: 42,
  title: "Bug lama",
  body: "perbaiki dong",
  html_url: "https://github.com/o/r/issues/42",
};

const fakeFetchIssue = async () => ({
  ok: true,
  json: async () => issueJson,
});

const fakeFetchToken = async () => ({
  ok: true,
  json: async () => ({ access_token: "ghs_v1_test" }),
});

const fakeFetchInstallations = async () => ({
  ok: true,
  json: async () => [{ id: 12345, account: { login: "octocat" } }],
});

describe("github", () => {
  it("generateOAuthUrl mengandung parameter klien", () => {
    const url = generateOAuthUrl({
      clientId: "cid",
      redirectUri: "http://localhost:3045/api/github/oauth-callback",
      scope: "repo",
      state: "st",
    });
    const u = new URL(url);
    assert.equal(u.origin, "https://github.com");
    assert.equal(u.pathname, "/login/oauth/authorize");
    assert.equal(u.searchParams.get("client_id"), "cid");
    assert.equal(
      u.searchParams.get("redirect_uri"),
      "http://localhost:3045/api/github/oauth-callback",
    );
    assert.equal(u.searchParams.get("scope"), "repo");
    assert.equal(u.searchParams.get("state"), "st");
  });

  it("generateOAuthUrl pakai default redirect_uri dan scope", () => {
    const u = new URL(generateOAuthUrl({ clientId: "cid" }));
    assert.equal(
      u.searchParams.get("redirect_uri"),
      "http://localhost:3045/api/github/oauth-callback",
    );
    assert.equal(u.searchParams.get("scope"), "repo,read:user");
    assert.ok(u.searchParams.get("state"));
  });

  it("enkripsi round-trip sama dengan asli, IV berbeda tiap kali", () => {
    const a = encryptToken("rahasia-token");
    const b = encryptToken("rahasia-token");
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.encrypted, "rahasia-token");
    assert.equal(decryptToken(a), "rahasia-token");
    assert.equal(decryptToken(b), "rahasia-token");
  });

  it("enkripsi gagal fail-closed jika kunci kosong", () => {
    const before = process.env.GITHUB_TOKEN_ENC_KEY;
    delete process.env.GITHUB_TOKEN_ENC_KEY;
    assert.throws(() => encryptToken("x"));
    assert.throws(() => decryptToken({ encrypted: "00", iv: "00" }));
    process.env.GITHUB_TOKEN_ENC_KEY = before;
  });

  it("verifyWebhook terima tanda tangan valid, tolak salah", () => {
    const payload = JSON.stringify({ zen: "testing" });
    const sig =
      "sha256=" +
      createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");
    assert.ok(verifyWebhook({ payload, signature: sig }));
    assert.ok(!verifyWebhook({ payload, signature: "sha256=deadbeef" }));
    assert.ok(!verifyWebhook({ payload, signature: undefined }));
    assert.ok(!verifyWebhook({ payload, signature: "sha1=abc" }));
  });

  it("verifyWebhook gagal jika secret tidak diatur", () => {
    const before = process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    assert.throws(() =>
      verifyWebhook({ payload: "{}", signature: "sha256=x" }),
    );
    process.env.GITHUB_WEBHOOK_SECRET = before;
  });

  it("exchangeCodeForToken validasi state dan ambil token", async () => {
    const token = await exchangeCodeForToken({
      code: "c1",
      state: "s1",
      expectedState: "s1",
      fetchFn: fakeFetchToken,
    });
    assert.equal(token, "ghs_v1_test");
    await assert.rejects(
      exchangeCodeForToken({
        code: "c1",
        state: "salah",
        expectedState: "benar",
        fetchFn: fakeFetchToken,
      }),
      /invalid oauth state/,
    );
  });

  it("listInstallations ambil daftar dari github API", async () => {
    const inst = await listInstallations({
      token: "ghs_x",
      fetchFn: fakeFetchInstallations,
    });
    assert.equal(inst.length, 1);
    assert.equal(inst[0].id, 12345);
    assert.equal(inst[0].account.login, "octocat");
  });

  it("createOAuthFlow: generateUrl + verifyAndExchange terima state yang cocok", async () => {
    const flow = createOAuthFlow({ fetchFn: fakeFetchToken });
    const { url, state } = flow.generateUrl({ clientId: "cid" });
    const u = new URL(url);
    assert.equal(u.searchParams.get("state"), state);
    const token = await flow.verifyAndExchange({
      code: "c1",
      state,
      clientId: "cid",
    });
    assert.equal(token, "ghs_v1_test");
  });

  it("createOAuthFlow: tolak state tidak dikenal", async () => {
    const flow = createOAuthFlow({ fetchFn: fakeFetchToken });
    await assert.rejects(
      flow.verifyAndExchange({
        code: "c1",
        state: "tidak-ada",
        clientId: "cid",
      }),
      /invalid oauth state/,
    );
  });

  it("createOAuthFlow: state single-use tidak bisa dipakai ulang", async () => {
    const flow = createOAuthFlow({ fetchFn: fakeFetchToken });
    const { state } = flow.generateUrl({ clientId: "cid" });
    await flow.verifyAndExchange({ code: "c1", state, clientId: "cid" });
    await assert.rejects(
      flow.verifyAndExchange({ code: "c1", state, clientId: "cid" }),
      /invalid oauth state/,
    );
  });

  it("createOAuthFlow: state kadaluarsa ditolak (TTL)", async () => {
    const flow = createOAuthFlow({ ttlMs: 50, fetchFn: fakeFetchToken });
    const { state } = flow.generateUrl({ clientId: "cid" });
    await new Promise((r) => setTimeout(r, 80));
    await assert.rejects(
      flow.verifyAndExchange({ code: "c1", state, clientId: "cid" }),
      /oauth state expired/,
    );
  });

  it("createOAuthFlow: redirect_uri dan scope harus cocok dengan yang tersimpan", async () => {
    const flow = createOAuthFlow({ fetchFn: fakeFetchToken });
    const { state } = flow.generateUrl({
      clientId: "cid",
      redirectUri: "http://callback/a",
      scope: "repo",
    });
    await assert.rejects(
      flow.verifyAndExchange({
        code: "c1",
        state,
        clientId: "cid",
        redirectUri: "http://callback/b",
        scope: "repo",
      }),
      /redirect_uri tidak cocok/,
    );
    const { state: s2 } = flow.generateUrl({
      clientId: "cid",
      redirectUri: "http://callback/a",
      scope: "repo",
    });
    await assert.rejects(
      flow.verifyAndExchange({
        code: "c1",
        state: s2,
        clientId: "cid",
        redirectUri: "http://callback/a",
        scope: "read:user",
      }),
      /scope tidak cocok/,
    );
  });

  it("decryptToken gagal throw saat ciphertext dimodifikasi (GCM auth tag)", () => {
    const enc = encryptToken("rahasia");
    const rusak = { encrypted: enc.encrypted.slice(0, -2) + "ff", iv: enc.iv };
    assert.throws(() => decryptToken(rusak));
  });

  it("verifyToken terima token valid via /user dan tolak invalid", async () => {
    const okFetch = async () => ({
      ok: true,
      json: async () => ({ login: "octocat", id: 1 }),
    });
    const user = await verifyToken({ token: "good", fetchFn: okFetch });
    assert.equal(user.login, "octocat");
    assert.equal(user.id, 1);
    const badFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    await assert.rejects(
      verifyToken({ token: "bad", fetchFn: badFetch }),
      /token tidak valid/,
    );
  });

  it("intake membuat floor + agen manager dan publish issue:intake", async () => {
    const ctx = await openDb();
    runSchema(
      ctx.db,
      `
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
      CREATE TABLE IF NOT EXISTS github_installations (
        id TEXT PRIMARY KEY, installation_id INTEGER NOT NULL UNIQUE, account_login TEXT NOT NULL,
        encrypted_token TEXT NOT NULL, iv TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      `,
    );
    closeDb(ctx);

    let intakeEvent;
    const onIntake = (p) => {
      intakeEvent = p;
    };
    bus.subscribe("issue:intake", onIntake);

    let result;
    try {
      result = await intakeFromGitHub({
        owner: "o",
        repo: "r",
        number: 42,
        fetchFn: fakeFetchIssue,
      });
    } finally {
      bus.unsubscribe("issue:intake", onIntake);
    }

    assert.ok(result.floorId);
    assert.ok(result.agentId);
    assert.equal(result.issueId, "9001");
    assert.ok(intakeEvent);
    assert.equal(intakeEvent.floorId, result.floorId);
    assert.equal(intakeEvent.agentId, result.agentId);
    assert.equal(intakeEvent.issue.number, 42);
    assert.equal(intakeEvent.issue.title, "Bug lama");

    const ctx2 = await openDb();
    try {
      const fRow = queryRow(
        ctx2.db,
        `SELECT name, repo FROM floors WHERE id = ${sqlEscape(result.floorId)}`,
      );
      const aRow = queryRow(
        ctx2.db,
        `SELECT role, stage FROM agents WHERE id = ${sqlEscape(result.agentId)}`,
      );
      assert.ok(fRow);
      assert.equal(fRow[0], "r");
      assert.equal(fRow[1], "o/r");
      assert.ok(aRow);
      assert.equal(aRow[0], "manager");
      assert.equal(aRow[1], "needs-work");
    } finally {
      closeDb(ctx2);
      try {
        unlinkSync(DB_FILE);
      } catch {}
    }
  });
});
