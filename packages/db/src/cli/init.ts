import { openDb, runSchema, closeDb } from "../db.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(__dirname, "..", "..", "src", "schema.sql"), "utf8");

async function main() {
  const ctx = await openDb();
  runSchema(ctx.db, schemaSql);
  const { queryAll } = await import("../db.js");
  const floors = String(queryAll(ctx.db, "SELECT COUNT(*) AS c FROM floors")[0][0]);
  const agents = String(queryAll(ctx.db, "SELECT COUNT(*) AS c FROM agents")[0][0]);
  const issues = String(queryAll(ctx.db, "SELECT COUNT(*) AS c FROM issues")[0][0]);
  console.log(`Schema applied to ${DB_PATH()}`);
  console.log(`Floors: ${floors}, Agents: ${agents}, Issues: ${issues}`);
  closeDb(ctx);
}

function DB_PATH(): string {
  return process.env.AI_OFFICE_DB ?? join(process.cwd(), "data", "office.sqlite");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
