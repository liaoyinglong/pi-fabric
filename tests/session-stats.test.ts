import { describe, expect, it } from "vitest";
import { FabricSessionStats } from "../src/session-stats.js";

describe("FabricSessionStats", () => {
  it("aggregates executions, code, results, nested calls, and discovery calls", () => {
    const stats = new FabricSessionStats();

    stats.recordExecution({
      code: "const first = await pi.read('a.ts');\nreturn first;",
      resultText: "one\ntwo",
      success: true,
      elapsedMs: 100,
      audits: [
        {
          ref: "pi.read",
          nestedToolCallId: "nested-1",
          startedAt: 1_000,
          endedAt: 1_025,
          success: true,
          resultChars: 120,
          resultTruncated: false,
        },
      ],
      trace: {
        kind: "pi-fabric.execution",
        version: 1,
        outcome: "succeeded",
        operations: [
          {
            type: "call",
            sequence: 0,
            ref: "fabric.discovery.list",
            args: {},
            outcome: "succeeded",
          },
        ],
        counts: {
          droppedValues: 0,
          truncatedValues: 0,
          redactedValues: 0,
          droppedOperations: 0,
        },
      },
    });

    stats.recordExecution({
      code: "return await pi.bash('pnpm test');",
      resultText: "x".repeat(50_001),
      success: false,
      elapsedMs: 300,
      audits: [
        {
          ref: "pi.bash",
          nestedToolCallId: "nested-2",
          startedAt: 2_000,
          endedAt: 2_100,
          success: false,
          resultChars: 75_000,
          resultTruncated: true,
        },
      ],
    });

    const snapshot = stats.snapshot();
    expect(snapshot.executions).toBe(2);
    expect(snapshot.succeeded).toBe(1);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.totalCodeLines).toBe(3);
    expect(snapshot.totalCodeChars).toBeGreaterThan(0);
    expect(snapshot.totalResultLines).toBe(3);
    expect(snapshot.totalResultChars).toBe(50_008);
    expect(snapshot.estimatedResultTokens).toBe(12_502);
    expect(snapshot.resultsOver10kChars).toBe(1);
    expect(snapshot.resultsOver50kChars).toBe(1);
    expect(snapshot.averageElapsedMs).toBe(200);
    expect(snapshot.p95ElapsedMs).toBe(300);

    expect(snapshot.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: "pi.read",
        calls: 1,
        totalResultChars: 120,
        totalDurationMs: 25,
      }),
      expect.objectContaining({
        ref: "pi.bash",
        calls: 1,
        failed: 1,
        totalResultChars: 75_000,
        truncatedResults: 1,
      }),
      expect.objectContaining({
        ref: "tools.list",
        calls: 1,
        measuredResults: 0,
      }),
    ]));

    const rendered = stats.format();
    expect(rendered).toContain("Fabric session stats");
    expect(rendered).toContain("Executions  2 (1 ok / 1 failed)");
    expect(rendered).toContain("~13k tokens est.");
    expect(rendered).toContain("pi.bash");
    expect(rendered).toContain("tools.list");
    expect(rendered).toContain("result size n/a");
  });

  it("resets with the active session", () => {
    const stats = new FabricSessionStats();
    stats.recordExecution({
      code: "return 1;",
      resultText: "1",
      success: true,
      elapsedMs: 10,
    });

    stats.reset();

    expect(stats.snapshot().executions).toBe(0);
    expect(stats.format()).toContain("No fabric_exec executions in this session yet.");
  });
});
