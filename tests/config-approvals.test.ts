import { describe, expect, it } from "vitest";
import {
  MAX_EXECUTOR_MEMORY_LIMIT_BYTES,
  QUICKJS_MAX_MEMORY_LIMIT_BYTES,
  normalizeFabricConfig,
} from "../src/config.js";

describe("approval config normalization", () => {
  it("maps legacy auto approval to explicit ask and ignores removed agent policy", () => {
    const config = normalizeFabricConfig({
      approvals: {
        read: "auto",
        write: "auto",
        execute: "deny",
        network: "allow",
        agent: "ask",
        model: "anthropic/classifier",
      },
    });

    expect(config.approvals).toEqual({
      read: "ask",
      write: "ask",
      execute: "deny",
      network: "allow",
    });
    expect("agent" in config.approvals).toBe(false);
    expect("model" in config.approvals).toBe(false);
  });

  it("maps legacy captured agent risk to the retained execute gate", () => {
    const config = normalizeFabricConfig({
      capture: {
        defaultRisk: "agent",
        risks: { delegate: "agent" },
      },
    });

    expect(config.capture.defaultRisk).toBe("execute");
    expect(config.capture.risks.delegate).toBe("execute");
  });

  it("does not expose legacy code-mode or schema switches", () => {
    const config = normalizeFabricConfig({
      fullCodeMode: false,
      schema: { mode: "enforce" },
    });

    expect("fullCodeMode" in config).toBe(false);
    expect("schema" in config).toBe(false);
  });

  it("ignores legacy executor selection and enforces the QuickJS memory ceiling", () => {
    const config = normalizeFabricConfig({
      executor: {
        runtime: "node-process",
        memoryLimitBytes: Number.MAX_SAFE_INTEGER,
      },
    });

    expect("runtime" in config.executor).toBe(false);
    expect(config.executor.memoryLimitBytes).toBe(MAX_EXECUTOR_MEMORY_LIMIT_BYTES);
    expect(MAX_EXECUTOR_MEMORY_LIMIT_BYTES).toBeLessThanOrEqual(QUICKJS_MAX_MEMORY_LIMIT_BYTES);
  });
});
