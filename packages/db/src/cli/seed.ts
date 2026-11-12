import { openDb, closeDb } from "../db.js";
import { nowIso, makeId } from "@ai-office/shared";

async function main() {
  const ctx = await openDb();
  const now = nowIso();

  const floorId = makeId("fl");
  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO floors (id, name, repo, owner_id, template, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(floorId, "Demo Floor", "owner/demo-repo", "owner_1", "development", "active", now, now);

  const agentId = makeId("ag");
  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO agents (id, floor_id, name, role, stage, model, token_cap, tokens_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(agentId, floorId, "Manager Demo", "manager", "needs-work", "claude-3-sonnet", 100000, 0, now, now);

  const issueId = makeId("is");
  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO issues (id, floor_id, number, title, body, stage, assignee_id, pr_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(issueId, floorId, 1, "Hello world", "First issue on the demo floor.", "needs-work", agentId, null, now, now);

  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO memories (id, scope, scope_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(makeId("me"), "floor", floorId, "welcome", "Welcome to the demo floor.", now);

  closeDb(ctx);
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
