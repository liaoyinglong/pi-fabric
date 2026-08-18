import { describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";

describe("approval config normalization", () => {
  it("maps legacy auto approval to explicit ask", () => {
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
      agent: "ask",
    });
    expect("model" in config.approvals).toBe(false);
  });
});
