import { queryAll, type SqlDatabase } from "@ai-office/db";

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export function isStuck(
  updatedAt: string,
  idleMs: number = DEFAULT_IDLE_MS,
  now: number = Date.now()
): boolean {
  return now - new Date(updatedAt).getTime() > idleMs;
}

/** Issues with no update for longer than `idleMs` — candidates for the watchdog. */
export function stuckIssues(
  db: SqlDatabase,
  idleMs: number = DEFAULT_IDLE_MS,
  now: number = Date.now()
): Array<{ id: string; stage: string; updatedAt: string; idleMs: number }> {
  return queryAll(
    db,
    `SELECT id, stage, updated_at FROM issues`
  )
    .map((r) => ({
      id: r[0] as string,
      stage: r[1] as string,
      updatedAt: r[2] as string,
    }))
    .filter((i) => isStuck(i.updatedAt, idleMs, now))
    .map((i) => ({ ...i, idleMs: now - new Date(i.updatedAt).getTime() }));
}

export function countByStage(db: SqlDatabase): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of queryAll(db, `SELECT stage, COUNT(*) FROM issues GROUP BY stage`)) {
    out[r[0] as string] = r[1] as number;
  }
  return out;
}
