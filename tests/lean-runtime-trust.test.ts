import path from "node:path";
import { describe, expect, it } from "vitest";
import { leanMcpCachePath, leanMcpDiscoveryRoot } from "../src/lean-runtime.js";

describe("Lean runtime project trust boundaries", () => {
  it("uses the project as MCP discovery root only when trusted", () => {
    const cwd = path.resolve("/work/project");
    const agentDir = path.resolve("/home/user/.pi/agent");

    expect(leanMcpDiscoveryRoot(cwd, agentDir, true)).toBe(cwd);
    expect(leanMcpDiscoveryRoot(cwd, agentDir, false)).toBe(agentDir);
  });

  it("keeps untrusted MCP descriptor cache outside the project", () => {
    const projectRoot = path.resolve("/work/project");
    const agentDir = path.resolve("/home/user/.pi/agent");

    expect(leanMcpCachePath(projectRoot, agentDir, true)).toBe(
      path.join(projectRoot, ".pi", "fabric", "mcp-descriptors.json"),
    );
    expect(leanMcpCachePath(projectRoot, agentDir, false)).toBe(
      path.join(agentDir, "fabric", "mcp-descriptors.json"),
    );
  });
});
