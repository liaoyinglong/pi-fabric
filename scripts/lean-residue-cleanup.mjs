import fs from "node:fs/promises";

const update = async (path, transform) => {
  const source = await fs.readFile(path, "utf8");
  const next = transform(source);
  if (next === source) throw new Error(`no cleanup changes applied to ${path}`);
  await fs.writeFile(path, next);
};

await update("src/agents/manager.ts", (source) => {
  const required = [
    "AgentParticipantGuidanceRequest",
    "AgentParticipantGuidanceResolver",
    "resolveParticipantGuidance",
  ];
  for (const term of required) {
    if (!source.includes(term)) throw new Error(`manager cleanup anchor missing: ${term}`);
  }
  return source
    .replaceAll("AgentParticipantGuidanceRequest", "AgentGuidanceRequest")
    .replaceAll("AgentParticipantGuidanceResolver", "AgentGuidanceResolver")
    .replaceAll("resolveParticipantGuidance", "resolveAgentGuidance");
});

await update("tests/activity-store.test.ts", (source) => {
  const before = `  it("reopens a completed run for boundary continuation activity", () => {
    const store = new FabricActivityStore();
    store.start("run-boundary");
    store.beginCall("run-boundary", {
      callId: "prewalk",
      ref: "agents.handoff",
      args: { name: "Deferred handoff" },
    });
    store.finishCall("run-boundary", "prewalk", {
      success: true,
      result: { status: "deferred" },
    });
    store.finish("run-boundary", true);

    store.resume("run-boundary");
    store.beginCall("run-boundary", {
      callId: "prewalk",
      ref: "agents.handoff",
      args: { name: "Prewalk trajectory executor" },
    });
    store.updateCall("run-boundary", "prewalk", {
      type: "entity",
      id: "child-1",
      kind: "agent",
      name: "Prewalk trajectory executor",
    });

    const resumed = store.get("run-boundary");
    expect(resumed).toMatchObject({
      status: "running",
      calls: [{ status: "running", entityId: "child-1", entityKind: "agent" }],
    });
    expect(resumed).not.toHaveProperty("finishedAt");
  });`;
  const after = `  it("reopens a completed run for continued nested activity", () => {
    const store = new FabricActivityStore();
    store.start("run-boundary");
    store.beginCall("run-boundary", {
      callId: "continued-agent",
      ref: "agents.run",
      args: { name: "Nested workflow executor" },
    });
    store.finishCall("run-boundary", "continued-agent", {
      success: true,
      result: { status: "completed" },
    });
    store.finish("run-boundary", true);

    store.resume("run-boundary");
    store.beginCall("run-boundary", {
      callId: "continued-agent",
      ref: "agents.run",
      args: { name: "Nested workflow executor" },
    });
    store.updateCall("run-boundary", "continued-agent", {
      type: "entity",
      id: "child-1",
      kind: "agent",
      name: "Nested workflow executor",
    });

    const resumed = store.get("run-boundary");
    expect(resumed).toMatchObject({
      status: "running",
      calls: [{ status: "running", entityId: "child-1", entityKind: "agent" }],
    });
    expect(resumed).not.toHaveProperty("finishedAt");
  });`;
  if (!source.includes(before)) throw new Error("activity-store legacy continuation block not found");
  return source.replace(before, after);
});

console.log("Final Lean legacy naming residue removed");
