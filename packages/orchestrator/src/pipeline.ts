export const STAGES = [
  "needs-work",
  "needs-review",
  "needs-qa",
  "needs-docs",
  "ready-to-merge",
] as const;

export type Stage = (typeof STAGES)[number];

export function isValidStage(stage: string): boolean {
  return (STAGES as readonly string[]).includes(stage);
}

export function stageIndex(stage: string): number {
  const i = STAGES.indexOf(stage as Stage);
  if (i < 0) throw new Error(`unknown stage: ${stage}`);
  return i;
}

/** The stage after `stage`, or null when the issue is already at the last stage. */
export function nextStage(stage: string): Stage | null {
  const i = stageIndex(stage);
  return i >= STAGES.length - 1 ? null : STAGES[i + 1];
}
