import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { isOneShotFabricChild } from "../src/lean-index.js";
import { recursiveChildToolGrants } from "../src/lean-runtime.js";
import type {
  FabricInvocationContext,
  FabricProvider,
} from "../src/protocol.js";
import { RestrictedFabricProvider } from "../src/providers/restricted-provider.js";

const context = {} as FabricInvocationContext;

describe("Lean child boundaries", () => {
  it("keeps extension discovery enabled by default for dynamic model providers", () => {
    expect(DEFAULT_FABRIC_CONFIG.agents.extensions).toBe(true);
    expect(DEFAULT_FABRIC_CONFIG.agents.defaultTools).toEqual(["read", "grep", "find", "ls"]);
  });

  it("makes Fabric inert only in ordinary nested Pi children", () => {
    expect(isOneShotFabricChild({
      PI_FABRIC_PARENT_RUN: "parent",
      PI_FABRIC_FULL_CODE_MODE: "false",
    })).toBe(true);
    expect(isOneShotFabricChild({
      PI_FABRIC_PARENT_RUN: "parent",
      PI_FABRIC_FULL_CODE_MODE: "true",
    })).toBe(false);
    expect(isOneShotFabricChild({})).toBe(false);
  });

  it("derives recursive Fabric capabilities from the original child allowlist", () => {
    expect(recursiveChildToolGrants(
      ["read", "grep", "find", "ls", "fffind", "fabric_exec"],
      {
        PI_FABRIC_PARENT_RUN: "parent",
        PI_FABRIC_FULL_CODE_MODE: "true",
      },
    )).toEqual({
      piTools: ["read", "grep", "find", "ls"],
      extensionTools: ["fffind"],
    });
  });

  it("hard-blocks ungranted actions inside recursive Fabric", async () => {
    const invoke = vi.fn(async (name: string) => name);
    const inner: FabricProvider = {
      name: "pi",
      description: "test",
      async list() {
        return [
          { name: "read", description: "read", inputSchema: {}, risk: "read" },
          { name: "bash", description: "bash", inputSchema: {}, risk: "execute" },
        ];
      },
      async describe(name) {
        if (name !== "read" && name !== "bash") return undefined;
        return { name, description: name, inputSchema: {}, risk: name === "read" ? "read" : "execute" };
      },
      invoke,
    };
    const restricted = new RestrictedFabricProvider(inner, ["read"]);

    expect((await restricted.list({}, context)).map((action) => action.name)).toEqual(["read"]);
    expect(await restricted.describe("bash", context)).toBeUndefined();
    await expect(restricted.invoke("bash", {}, context)).rejects.toThrow(
      "pi.bash is not granted",
    );
    await expect(restricted.invoke("read", {}, context)).resolves.toBe("read");
  });
});
