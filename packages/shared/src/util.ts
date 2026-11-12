export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function nextStage(stage: string): string | null {
  const order: string[] = [
    "needs-work",
    "needs-review",
    "needs-qa",
    "needs-docs",
    "ready-to-merge",
  ];
  const idx = order.indexOf(stage);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}
