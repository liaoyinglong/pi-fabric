import { describe, expect, it } from "vitest";
import {
  FABRIC_NESTED_TOOL_CALL_ID_PREFIX,
  FABRIC_TOOL_RESULT_PROXY_KIND,
  readFabricToolResultProxyDetailsV1,
} from "../src/public-protocol.js";

// @ts-expect-error Provider execution types are internal Lean implementation details.
import type { FabricProvider } from "../src/public-protocol.js";
void (undefined as unknown as FabricProvider);

describe("public protocol", () => {
  it("keeps the nested-call and tool-result middleware contract stable", () => {
    expect(FABRIC_NESTED_TOOL_CALL_ID_PREFIX).toBe("fabric_");
    expect(FABRIC_TOOL_RESULT_PROXY_KIND).toBe("pi-fabric.tool-result-proxy.v1");
    expect(readFabricToolResultProxyDetailsV1({
      kind: FABRIC_TOOL_RESULT_PROXY_KIND,
      ref: "mcp.github.search",
      result: { ok: true },
    })).toEqual({
      kind: FABRIC_TOOL_RESULT_PROXY_KIND,
      ref: "mcp.github.search",
      result: { ok: true },
    });
  });

  it("rejects unrelated detail objects", () => {
    expect(readFabricToolResultProxyDetailsV1({ kind: "other", ref: "pi.read", result: null }))
      .toBeUndefined();
  });
});
