import { randomUUID } from "node:crypto";
import { queryAll, queryRow, sqlEscape, type SqlDatabase } from "@ai-office/db";
import { bus } from "@ai-office/events";
import { nextStage } from "./pipeline.js";

function now(): string {
  return new Date().toISOString();
}

export function findIssue(db: SqlDatabase, issueId: string): string | null {
  const row = queryRow(
    db,
    `SELECT stage FROM issues WHERE id = ${sqlEscape(issueId)}`
  );
  return row ? (row[0] as string) : null;
}

export function assignAgent(
  db: SqlDatabase,
  issueId: string,
  agentId: string
): { issueId: string; agentId: string } {
  if (!findIssue(db, issueId)) throw new Error(`issue not found: ${issueId}`);
  if (
    !queryRow(db, `SELECT id FROM agents WHERE id = ${sqlEscape(agentId)}`)
  ) {
    throw new Error(`agent not found: ${agentId}`);
  }
  db.exec(
    `UPDATE issues SET assignee_id = ${sqlEscape(agentId)}, updated_at = ${sqlEscape(now())} WHERE id = ${sqlEscape(issueId)}`
  );
  bus.publish("issue:assigned", { issueId, agentId });
  return { issueId, agentId };
}

/** Move an issue one stage forward and record the transition. */
export function advanceStage(
  db: SqlDatabase,
  issueId: string,
  note = ""
): { issueId: string; from: string; to: string } {
  const from = findIssue(db, issueId);
  if (!from) throw new Error(`issue not found: ${issueId}`);
  const to = nextStage(from);
  if (!to) throw new Error(`issue already at final stage: ${from}`);
  const at = now();
  db.exec(
    `UPDATE issues SET stage = ${sqlEscape(to)}, updated_at = ${sqlEscape(at)} WHERE id = ${sqlEscape(issueId)}`
  );
  db.exec(
    `INSERT INTO stage_history (id, issue_id, from_stage, to_stage, note, created_at) VALUES (
      ${sqlEscape(randomUUID())}, ${sqlEscape(issueId)}, ${sqlEscape(from)}, ${sqlEscape(to)}, ${sqlEscape(note)}, ${sqlEscape(at)})`
  );
  bus.publish("issue:stage_changed", { issueId, from, to });
  return { issueId, from, to };
}

export function stageHistory(
  db: SqlDatabase,
  issueId: string
): Array<{ from: string; to: string; note: string; createdAt: string }> {
  return queryAll(
    db,
    `SELECT from_stage, to_stage, note, created_at FROM stage_history WHERE issue_id = ${sqlEscape(issueId)} ORDER BY created_at`
  ).map((r) => ({
    from: r[0] as string,
    to: r[1] as string,
    note: (r[2] as string) ?? "",
    createdAt: r[3] as string,
  }));
}
