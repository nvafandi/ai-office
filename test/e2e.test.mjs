process.env.PORT = "3999";
process.env.AI_OFFICE_DB = process.cwd() + "/test/e2e.sqlite";
process.env.GATEWAY_ENC_KEY = "e2e-gateway-enc-key-0123456789abcdef0123456789abcd";

import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { bus } from "../packages/events/dist/index.js";

let start;
let server;
const BASE = "http://localhost:3999";
const DB_FILE = process.cwd() + "/test/e2e.sqlite";

async function req(path, opts = {}) {
  const r = await globalThis.fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  return { status: r.status, body: await r.json() };
}

beforeAll(async () => {
  ({ start } = await import("../apps/server/dist/index.js"));
  try { unlinkSync(DB_FILE); } catch { }
  const srv = await start();
  server = srv;
  for (let i = 0; i < 50; i++) {
    try {
      await req("/api/health");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.fail("server tidak siap");
});

afterAll(async () => {
  server?.close();
});

describe("AI Office e2e", () => {
  it("health", async () => {
    const { status, body } = await req("/api/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("floors list start empty", async () => {
    const { status, body } = await req("/api/floors");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  it("create floor then list", async () => {
    const { status, body } = await req("/api/floors", {
      method: "POST",
      body: JSON.stringify({ name: "E2E Floor", repo: "owner/e2e" }),
    });
    assert.equal(status, 201);
    assert.ok(body.id);
    assert.equal(body.name, "E2E Floor");

    const { status: s2, body: floors } = await req("/api/floors");
    assert.equal(s2, 200);
    assert.ok(floors.some((f) => f.id === body.id));
  });

  it("issues list for floor", async () => {
    const { body: floors } = await req("/api/floors");
    const id = floors[0].id;
    const { status, body } = await req(`/api/issues?floorId=${encodeURIComponent(id)}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  it("gateway accounts: enkripsi kunci, response tidak leak kunci", async () => {
    const { status, body } = await req("/api/gateway/accounts", {
      method: "POST",
      body: JSON.stringify({ provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3", apiKey: "sk-e2e-secret", tokenCap: 1000 }),
    });
    assert.equal(status, 201);
    assert.equal(body.apiKey, undefined);
    assert.ok(body.id);

    const { status: s2, body: list } = await req("/api/gateway/accounts");
    assert.equal(s2, 200);
    const acct = list.find((a) => a.id === body.id);
    assert.ok(acct);
    assert.equal(acct.provider, "ollama");
    assert.equal(acct.apiKey, undefined);
    assert.equal(acct.iv, undefined);
  });

  it("v1 chat completions butuh accountId", async () => {
    const { status } = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(status, 400);
  });

  it("v1 chat completions account tidak dikenal 404", async () => {
    const { status } = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ accountId: "acct_tidak_ada", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(status, 404);
  });

  it("v1 chat completions memanggil provider (bukan mock)", async () => {
    const { body: created } = await req("/api/gateway/accounts", {
      method: "POST",
      body: JSON.stringify({ provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3", apiKey: "sk-e2e-provider", tokenCap: 1000 }),
    });
    const { status } = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ accountId: created.id, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.ok(status >= 400, `provider tidak tersedia di uji (harus >= 400, bukan mock 200): ${status}`);
  });

  it("orchestrator: assign agent, advance stage, history", async () => {
    const { body: floors } = await req("/api/floors");
    const floorId = floors[0].id;

    const { body: issue } = await req("/api/issues", {
      method: "POST",
      body: JSON.stringify({ floorId, title: "Fix flaky test" }),
    });
    assert.equal(issue.title, "Fix flaky test");

    const { body: agent } = await req("/api/agents", {
      method: "POST",
      body: JSON.stringify({ floorId, name: "Dev Agent" }),
    });

    const assigned = await req(`/api/issues/${issue.id}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId: agent.id }),
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.agentId, agent.id);

    const advanced = await req(`/api/issues/${issue.id}/advance`, { method: "POST" });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.from, "needs-work");
    assert.equal(advanced.body.to, "needs-review");

    const rejected = await req(`/api/issues/nope/advance`, { method: "POST" });
    assert.equal(rejected.status, 400);

    const { status: hs, body: history } = await req(`/api/issues/${issue.id}/history`);
    assert.equal(hs, 200);
    assert.equal(history.length, 1);
    assert.equal(history[0].from, "needs-work");
    assert.equal(history[0].to, "needs-review");
  });
});

describe("events + notices + connections", () => {
  let floorId;
  let issueId;
  let agentId;
  let noticeId;
  const createdEvents = [];
  const stageEvents = [];
  const assignedEvents = [];

  const onCreated = (p) => createdEvents.push(p);
  const onStage = (p) => stageEvents.push(p);
  const onAssigned = (p) => assignedEvents.push(p);

  beforeAll(async () => {
    bus.subscribe("issue:created", onCreated);
    bus.subscribe("issue:stage_changed", onStage);
    bus.subscribe("issue:assigned", onAssigned);

    const { body: floors } = await req("/api/floors");
    floorId = floors[0].id;

    const { body: issue } = await req("/api/issues", {
      method: "POST",
      body: JSON.stringify({ floorId, title: "Event Issue" }),
    });
    issueId = issue.id;

    const { body: agent } = await req("/api/agents", {
      method: "POST",
      body: JSON.stringify({ floorId, name: "Event Agent" }),
    });
    agentId = agent.id;
  });

  afterAll(() => {
    bus.unsubscribe("issue:created", onCreated);
    bus.unsubscribe("issue:stage_changed", onStage);
    bus.unsubscribe("issue:assigned", onAssigned);
  });

  it("publish issue:created saat POST /api/issues", () => {
    assert.equal(createdEvents.length, 1);
    assert.equal(createdEvents[0].issue.id, issueId);
    assert.equal(createdEvents[0].issue.floorId, floorId);
    assert.equal(createdEvents[0].issue.title, "Event Issue");
    assert.equal(createdEvents[0].floorId, floorId);
  });

  it("publish issue:assigned saat assign agent", async () => {
    const { status } = await req(`/api/issues/${issueId}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
    assert.equal(status, 200);
    assert.equal(assignedEvents.length, 1);
    assert.equal(assignedEvents[0].issueId, issueId);
    assert.equal(assignedEvents[0].agentId, agentId);
  });

  it("publish issue:stage_changed saat advance stage", async () => {
    const { status, body } = await req(`/api/issues/${issueId}/advance`, {
      method: "POST",
    });
    assert.equal(status, 200);
    assert.equal(body.from, "needs-work");
    assert.equal(body.to, "needs-review");
    assert.equal(stageEvents.length, 1);
    assert.deepEqual(stageEvents[0], { issueId, from: "needs-work", to: "needs-review" });
  });

  it("unsubscribe berhenti memanggil handler", async () => {
    bus.unsubscribe("issue:stage_changed", onStage);
    await req(`/api/issues/${issueId}/advance`, { method: "POST" });
    assert.equal(stageEvents.length, 1);
  });

  it("notices kosong pada fresh DB", async () => {
    const { status, body } = await req("/api/notices");
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it("POST /api/notices 201 dengan id + createdAt", async () => {
    const { status, body } = await req("/api/notices", {
      method: "POST",
      body: JSON.stringify({ floor_id: floorId, title: "Penting", content: "isi notice", author: "admin" }),
    });
    assert.equal(status, 201);
    assert.ok(body.id);
    assert.ok(body.createdAt);
    assert.equal(body.title, "Penting");
    noticeId = body.id;
  });

  it("GET /api/notices filter floorId", async () => {
    const { status, body } = await req(`/api/notices?floorId=${encodeURIComponent(floorId)}`);
    assert.equal(status, 200);
    assert.ok(body.some((n) => n.id === noticeId));

    const { body: other } = await req(`/api/notices?floorId=floor_tidak_ada`);
    assert.equal(other.length, 0);
  });

  it("DELETE /api/notices/:id 200, lalu 404", async () => {
    const { status } = await req(`/api/notices/${noticeId}`, { method: "DELETE" });
    assert.equal(status, 200);
    const { status: s2 } = await req(`/api/notices/${noticeId}`, { method: "DELETE" });
    assert.equal(s2, 404);
  });

  it("POST /api/notices body kurang 400", async () => {
    const { status } = await req("/api/notices", {
      method: "POST",
      body: JSON.stringify({ floorId, title: "Judul saja" }),
    });
    assert.equal(status, 400);
  });

  it("GET /api/connections daftar 8 penyedia", async () => {
    const { status, body } = await req("/api/connections");
    assert.equal(status, 200);
    assert.equal(body.length, 8);
    assert.ok(body.some((c) => c.provider === "slack"));
    assert.ok(body.every((c) => c.mock === true));
  });

  it("POST /api/connections/:id/send 200 mock:true", async () => {
    const { status, body } = await req("/api/connections/conn_slack/send", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider, "slack");
    assert.equal(body.mock, true);
    assert.ok(body.messageId);
  });

  it("POST /api/connections/:id/send id salah 404", async () => {
    const { status } = await req("/api/connections/conn_tidak_ada/send", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(status, 404);
  });
});
