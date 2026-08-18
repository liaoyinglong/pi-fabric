import type { Skill } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { CapturedToolCatalog } from "../src/capture/catalog.js";
import { buildLeanSystemPrompt } from "../src/lean-index.js";

const skill: Skill = {
  name: "review",
  description: "Review the current implementation.",
  filePath: "/skills/review/SKILL.md",
  baseDir: "/skills/review",
  sourceInfo: {} as Skill["sourceInfo"],
  disableModelInvocation: false,
};

describe("lean system prompt compatibility", () => {
  it("restores model-visible skills without adding turn-varying content", () => {
    const capturedTools = new CapturedToolCatalog();
    const renderTurn = (_turnPrompt: string): string => buildLeanSystemPrompt({
      systemPrompt: "Core prompt\nCurrent working directory: /workspace",
      skills: [skill],
      capturedTools,
    });

    const ordinaryTurn = renderTurn("Inspect the auth flow.");
    const skillTurn = renderTurn([
      '<skill name="review" location="/skills/review/SKILL.md">',
      "TURN_ONLY_SKILL_EXPANSION",
      "</skill>",
    ].join("\n"));

    expect(skillTurn).toBe(ordinaryTurn);
    expect(skillTurn).not.toContain("Inspect the auth flow.");
    expect(skillTurn).not.toContain("TURN_ONLY_SKILL_EXPANSION");
    expect(skillTurn).toContain("<name>review</name>");
    expect(skillTurn).toContain(
      "Use `pi.read` inside `fabric_exec` to load a skill's file when the task matches its description.",
    );
  });
});
