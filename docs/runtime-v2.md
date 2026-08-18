# Code Mode Runtime V2

Runtime V2 is split into two explicit layers:

```text
Fabric guest surface
  |- tools.*
  |- pi.*
  |- extensions.*
  |- mcp.*
  |- agents.*
  `- workflow / agent / parallel / pipeline / phase
        |
        v
FabricRuntimeV2HostAdapter
  |- ActionRegistry dispatch
  |- MCP discovery + invocation
  |- subagent routing + execution
  |- agent-call budgets
  `- lightweight workflow progress/phase hooks
        |
        v
CodeModeRuntimeV2
  |- fresh QuickJS context
  |- timeout / memory / cancellation
  |- serialization
  `- capability bridge
```

The split is intentional: the kernel remains small and independently runnable, while the adapter restores the Fabric product surface without importing orchestration policy into the kernel.

## Standalone kernel

`pi-fabric/runtime-v2` exports `CodeModeRuntimeV2`.

The standalone kernel executes one model-generated TypeScript program in a fresh QuickJS context, exposes caller-provided strings through `π`, bounds logs, memory, and runtime, and returns one structured execution result.

```ts
import { CodeModeRuntimeV2 } from "pi-fabric/runtime-v2";

const runtime = new CodeModeRuntimeV2({
  read: async ({ path }) => readFile(String(path)),
  grep: async ({ pattern }) => search(String(pattern)),
  bash: async ({ command }, signal) => runCommand(String(command), signal),
});

const result = await runtime.execute({
  code: `
const matches = await host.grep({ pattern: "CodeModeRuntimeV2" });
return { matches, label: π.label };
`,
  strings: { label: "runtime-v2" },
});
```

The minimal host capabilities are:

```text
host.read(args)
host.grep(args)
host.bash(args)
host.mcp(args)
host.dispatch(args)
```

`dispatch` is the generic composition hook. A trusted host may also supply `guestSetup`; it is evaluated after the minimal host surface is installed and before model-generated code runs. The kernel itself still has no imports from `ActionRegistry`, agents, MCP providers, workflow helpers, approvals, activity, or tracing.

## Fabric adapter

`pi-fabric/runtime-v2/fabric` exports `FabricRuntimeV2HostAdapter`.

The adapter owns the higher-level composition and uses the existing `ActionRegistry` as the dispatch authority.

```ts
import { FabricRuntimeV2HostAdapter } from "pi-fabric/runtime-v2/fabric";

const runtime = new FabricRuntimeV2HostAdapter(registry, {
  timeoutMs: 30_000,
  maxAgentCalls: 8,
  approve: async (action, args) => {
    await approvalPolicy.approve(action, args);
  },
});

const result = await runtime.execute({
  code: `
const servers = await mcp.servers();
const tools = await mcp.tools("github");
const evidence = await agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  task: "Find the implementation and return concrete evidence.",
});
const checks = await parallel([
  () => pi.grep({ pattern: "refreshToken", path: "src" }),
  () => extensions.fffind({ pattern: "auth", path: "src" }),
]);
return { servers, tools, evidence: evidence.text, checks };
`,
  parentToolCallId,
  context,
});
```

## MCP discovery

MCP is retained as a full product capability above the kernel.

The V2 guest surface supports:

```ts
await mcp.servers();
await mcp.tools("server-name");
await mcp.call({ server: "server-name", tool: "tool-name", args: {} });
await mcp.serverName.toolName({});
```

`mcp.tools(...)` returns the registry descriptors for that server, including each tool's input schema. Discovery and invocation still come from the configured MCP provider; `CodeModeRuntimeV2` does not read mcporter configuration or own MCP lifecycle.

Generic discovery remains available through `tools.providers`, `tools.catalog`, `tools.list`, `tools.search`, and `tools.describe`.

## Agents

Subagents are retained and cross the host boundary through the registered `agents` provider.

The V2 guest surface exposes:

```text
agents.run
agents.spawn
agents.recurse
agents.wait
agents.status
agents.list
agents.routing
agents.stop
agents.cleanup
agents.steer
agents.followUp
agents.setSteeringMode
agents.setFollowUpMode
agents.compact
```

Main-routed `fast` / `balance` / `strong` tiers and `inspect` / `execute` / `modify` / `isolated` policies therefore stay above the kernel. The adapter also enforces an execution-scoped agent-call budget before dispatching `run`, `spawn`, or `recurse`.

## Workflow

Workflow remains guest-side composition rather than a persistent workflow engine.

```ts
const findings = await parallel([
  () => agents.run({ tier: "fast", policy: "inspect", task: "Inspect auth" }),
  () => agents.run({ tier: "fast", policy: "inspect", task: "Inspect routing" }),
]);

const verified = await agent(
  `Verify these findings: ${JSON.stringify(findings)}`,
  { tier: "strong", policy: "inspect", role: "independent reviewer" },
);

await phase("verification");
return verified;
```

`parallel` and `pipeline` run inside the guest. `agent(...)` delegates through `agents.run`, and `phase(...)` reports lightweight progress through the adapter. No Actor/Mesh/State or persistent workflow subsystem is reintroduced.

## Boundary

The important boundary is now explicit:

- **kernel:** execute trusted TypeScript safely and bridge named host capabilities;
- **adapter:** map Fabric refs to registered providers and enforce host policy;
- **guest setup:** provide ergonomic `pi`, `extensions`, `mcp`, `agents`, and workflow APIs;
- **providers:** own Pi tools, MCP discovery/lifecycle, subagent runners, and captured extensions.

The raw standalone kernel intentionally does not expose these Fabric globals unless the Fabric adapter supplies the trusted guest composition.
