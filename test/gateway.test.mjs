process.env.GATEWAY_ENC_KEY =
  "gateway-test-enc-key-0123456789abcdef0123456789abcdef";

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  createGateway,
  encryptApiKey,
  decryptApiKey,
  GatewayError,
} from "../packages/gateway/dist/index.js";

function makeDb() {
  let stored = null;
  const updates = [];
  return {
    prepare(sql) {
      const s = String(sql);
      if (/^\s*INSERT/i.test(s)) {
        return {
          run(...p) {
            const params = Array.isArray(p[0]) && p.length === 1 ? p[0] : p;
            const cols = s.match(/\(([^)]*)\)/)[1].split(",").map((c) => c.trim());
            const obj = {};
            for (let i = 0; i < cols.length; i++) obj[cols[i]] = params[i];
            stored = obj;
          },
          bind() {},
          step() {
            return false;
          },
          get() {
            return null;
          },
          free() {},
        };
      }
      if (/^\s*UPDATE/i.test(s)) {
        return {
          bind() {},
          run(...p) {
            const params = Array.isArray(p[0]) && p.length === 1 ? p[0] : p;
            updates.push({ sql: s, params });
            if (stored) stored.tokens_used = Number(params[0]);
          },
          step() {
            return false;
          },
          get() {
            return null;
          },
          free() {},
        };
      }
      if (/^\s*SELECT/i.test(s)) {
        let done = false;
        return {
          bind() {},
          step() {
            if (done) return false;
            done = true;
            return stored !== null;
          },
          get() {
            return stored
              ? [
                  stored.id,
                  stored.provider,
                  stored.base_url,
                  stored.model,
                  stored.api_key,
                  stored.iv,
                  stored.token_cap,
                  stored.tokens_used,
                ]
              : null;
          },
          run() {},
          free() {},
        };
      }
      return { bind() {}, step() { return false; }, get() { return null; }, run() {}, free() {} };
    },
    stored() {
      return stored;
    },
    updates() {
      return updates;
    },
  };
}

const okFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "chatcmpl_1",
    model: "llama3",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
});

describe("gateway enkripsi", () => {
  it("encryptApiKey round-trip, IV berbeda, bukan plaintext", () => {
    const a = encryptApiKey("sk-test-12345");
    const b = encryptApiKey("sk-test-12345");
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.encrypted, "sk-test-12345");
    assert.equal(decryptApiKey(a), "sk-test-12345");
    assert.equal(decryptApiKey(b), "sk-test-12345");
  });

  it("fail-closed saat GATEWAY_ENC_KEY kosong", () => {
    const before = process.env.GATEWAY_ENC_KEY;
    delete process.env.GATEWAY_ENC_KEY;
    assert.throws(() => encryptApiKey("x"));
    assert.throws(() => decryptApiKey({ encrypted: "00", iv: "00" }));
    assert.throws(() => createGateway({ db: makeDb() }));
    process.env.GATEWAY_ENC_KEY = before;
  });

  it("createAccount menyimpan ciphertext + iv, response tidak leak kunci", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    const account = await g.createAccount({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3",
      apiKey: "sk-test-12345",
      tokenCap: 1000,
    });
    assert.ok(account.id);
    assert.equal(account.apiKey, undefined);
    assert.equal(account.provider, "ollama");
    assert.equal(account.tokenCap, 1000);
    assert.equal(account.tokensUsed, 0);

    const s = db.stored();
    assert.ok(s.iv, "iv wajib tersimpan");
    assert.notEqual(s.api_key, "sk-test-12345", "plaintext tidak boleh tersimpan");
    assert.equal(decryptApiKey({ encrypted: s.api_key, iv: s.iv }), "sk-test-12345");
  });

  it("listAccounts tidak mengembalikan kunci", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    const account = await g.createAccount({ apiKey: "sk-secret" });
    const list = g.listAccounts();
    assert.ok(list.some((a) => a.id === account.id));
    for (const a of list) {
      assert.equal(a.apiKey, undefined);
    }
  });
});

describe("gateway chat completions", () => {
  const messages = [{ role: "user", content: "halo" }];

  it("sukses: panggil provider, format OpenAI-compatible, tambah tokens_used", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    const account = await g.createAccount({ apiKey: "sk-key", tokenCap: 1000 });

    const out = await g.chatCompletions({ accountId: account.id, messages });
    assert.equal(out.status, 200);
    assert.equal(out.body.id, "chatcmpl_1");
    assert.ok(out.body.choices && out.body.choices[0].message);
    assert.equal(db.stored().tokens_used, 30);
  });

  it("error upstream: relay status + body, tidak menambah tokens_used", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    await g.createAccount({ apiKey: "sk-key", tokenCap: 1000 });
    const errFetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "updown" }),
    });
    const g2 = createGateway({ db, fetchFn: errFetch });
    const account = await g2.createAccount({ apiKey: "sk-key", tokenCap: 1000 });
    const out = await g2.chatCompletions({ accountId: account.id, messages });
    assert.equal(out.status, 502);
    assert.equal(out.body.error, "updown");
    assert.equal(db.updates.length, 0);
  });

  it("fetch gagal jaringan: GatewayError 502", async () => {
    const db = makeDb();
    const g = createGateway({
      db,
      fetchFn: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await g.createAccount({ apiKey: "sk-key", tokenCap: 1000 });
    const account = await g.createAccount({ apiKey: "sk-key", tokenCap: 1000 });
    await assert.rejects(
      g.chatCompletions({ accountId: account.id, messages }),
      (e) => e instanceof GatewayError && e.status === 502,
    );
  });

  it("token cap: panggilan saat tokens_used >= cap → 429 (sebelum panggil)", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    const account = await g.createAccount({ apiKey: "sk-key", tokenCap: 10 });
    db.stored().tokens_used = 10; // sudah mencapai cap
    await assert.rejects(
      g.chatCompletions({ accountId: account.id, messages }),
      (e) => e instanceof GatewayError && e.status === 429,
    );
  });

  it("token cap: setelah panggil sukses melebihi cap, panggilan berikutnya 429 (sesudah panggil)", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    const account = await g.createAccount({ apiKey: "sk-key", tokenCap: 5 });

    const out = await g.chatCompletions({ accountId: account.id, messages });
    assert.equal(out.status, 200);
    assert.equal(db.stored().tokens_used, 30); // total_tokens ditambahkan

    await assert.rejects(
      g.chatCompletions({ accountId: account.id, messages }),
      (e) => e instanceof GatewayError && e.status === 429,
    );
  });

  it("account tidak ditemukan → 404", async () => {
    const db = makeDb();
    const g = createGateway({ db, fetchFn: okFetch });
    await assert.rejects(
      g.chatCompletions({ accountId: "acct_tidak_ada", messages }),
      (e) => e instanceof GatewayError && e.status === 404,
    );
  });
});
