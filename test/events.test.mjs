import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { bus } from "../packages/events/dist/index.js";

describe("EventBus", () => {
  it("mengirim payload bertipe ke subscriber", () => {
    let received;
    bus.subscribe("issue:stage_changed", (p) => {
      received = p;
    });
    bus.publish("issue:stage_changed", {
      issueId: "iss_1",
      from: "needs-work",
      to: "needs-review",
    });
    assert.deepEqual(received, {
      issueId: "iss_1",
      from: "needs-work",
      to: "needs-review",
    });
  });

  it("unsubscribe menghentikan pemanggilan", () => {
    let received;
    const handler = (p) => {
      received = p;
    };
    bus.subscribe("issue:assigned", handler);
    bus.unsubscribe("issue:assigned", handler);
    bus.publish("issue:assigned", { issueId: "iss_1", agentId: "ag_1" });
    assert.equal(received, undefined);
  });

  it("event lain tidak terpengaruh oleh unsubscribe", () => {
    let created = 0;
    bus.subscribe("issue:created", () => {
      created += 1;
    });
    bus.publish("issue:stage_changed", {
      issueId: "iss_1",
      from: "a",
      to: "b",
    });
    bus.publish("issue:created", {
      issue: { id: "iss_1", floorId: "fl_1", title: "x" },
      floorId: "fl_1",
    });
    assert.equal(created, 1);
  });
});
