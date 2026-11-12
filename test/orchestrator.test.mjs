import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  STAGES,
  nextStage,
  isValidStage,
  stageIndex,
} from "../packages/orchestrator/dist/pipeline.js";
import { runCommand } from "../packages/orchestrator/dist/runner.js";
import { isStuck } from "../packages/orchestrator/dist/watchdog.js";

describe("orchestrator pipeline", () => {
  it("stages advance one step at a time", () => {
    assert.equal(nextStage("needs-work"), "needs-review");
    assert.equal(nextStage("needs-review"), "needs-qa");
    assert.equal(nextStage("needs-docs"), "ready-to-merge");
    assert.equal(nextStage("ready-to-merge"), null);
  });

  it("rejects unknown stages", () => {
    assert.ok(!isValidStage("deployed"));
    assert.throws(() => nextStage("deployed"));
    assert.equal(stageIndex("needs-qa"), 2);
    assert.equal(STAGES.length, 5);
  });

  it("watchdog detects idle issues", () => {
    const now = Date.now();
    assert.ok(isStuck(new Date(now - 60 * 60 * 1000).toISOString(), 30 * 60 * 1000, now));
    assert.ok(!isStuck(new Date(now - 60 * 1000).toISOString(), 30 * 60 * 1000, now));
  });
});

describe("agent runner sandbox", () => {
  it("captures stdout and exit code", async () => {
    const r = await runCommand(process.execPath, [
      "-e",
      "process.stdout.write('ok')",
    ]);
    assert.equal(r.timedOut, false);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "ok");
  });

  it("kills a command that exceeds the timeout", async () => {
    const r = await runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      { timeoutMs: 300 }
    );
    assert.equal(r.timedOut, true);
    assert.equal(r.code, -1);
  });
});
