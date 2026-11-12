process.env.PORT = "3999";
process.env.AI_OFFICE_DB = process.cwd() + "/test/e2e.sqlite";

import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";

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

  it("gateway accounts", async () => {
    const { status, body } = await req("/api/gateway/accounts", {
      method: "POST",
      body: JSON.stringify({ provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3", tokenCap: 1000 }),
    });
    assert.equal(status, 201);

    const { status: s2, body: list } = await req("/api/gateway/accounts");
    assert.equal(s2, 200);
    assert.ok(list.some((a) => a.provider === "ollama"));
  });

  it("v1 chat completions mock", async () => {
    const { status, body } = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "any", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(status, 200);
    assert.ok(body.choices && body.choices[0] && body.choices[0].message);
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
