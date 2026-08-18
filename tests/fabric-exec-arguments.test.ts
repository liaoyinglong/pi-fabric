import { describe, expect, it } from "vitest";
import { prepareFabricExecArguments } from "../src/fabric-exec-arguments.js";

describe("prepareFabricExecArguments", () => {
  it("keeps canonical arguments unchanged", () => {
    const input = { code: "return 1;", resultFormat: "json" };
    expect(prepareFabricExecArguments(input)).toBe(input);
  });

  it("wraps a root code string before schema validation", () => {
    expect(prepareFabricExecArguments("return 1;")).toEqual({ code: "return 1;" });
  });

  it("joins all-string code arrays and leaves malformed arrays invalid", () => {
    expect(prepareFabricExecArguments({ code: ["const x = 1;", "return x;"] })).toEqual({
      code: "const x = 1;\nreturn x;",
    });
    const malformed = { code: ["return ", 1] };
    expect(prepareFabricExecArguments(malformed)).toBe(malformed);
  });

  it("omits null optional fields but preserves a null required code", () => {
    expect(prepareFabricExecArguments({
      code: null,
      strings: null,
      resultFormat: null,
    })).toEqual({ code: null });
  });
});
