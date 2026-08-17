# Pi Fabric Lean V2 Usage Guide

This guide covers the user-facing Lean V2 workflow: installation, Code Mode, captured Pi extension tools, MCP, named one-shot subagents, Veda/AGY routing, workflows, configuration precedence, and migration from full Fabric.

Lean V2 intentionally has three product surfaces:

1. `fabric_exec` for programmatic tool calling.
2. Named one-shot subagents for bounded delegated work.
3. Workflow helpers for orchestration over the same subagent runtime.

Persistent Actor, Mesh, State, Schema runtime, Memory, RLM, Prewalk, resident-host, and trajectory-handoff systems are removed from Lean V2; they are not model-facing APIs or shared agent-runtime compatibility paths.

## 1. Install

Install this branch directly with Pi:

```bash
pi install git:github.com/liaoyinglong/pi-fabric#agent/code-mode-runtime-v2
```

Requirements:

- Node.js 24+
- Pi 0.80.6+

For local development:

```bash
pnpm install
pnpm check
pnpm build
pi -e /absolute/path/to/pi-fabric
```

After loading the extension, the model-facing entrypoint is `fabric_exec`.

## 2. Configuration files and precedence

Lean V2 keeps the existing Fabric config paths so an existing installation does not need a new directory layout.

Global config:

```text
~/.pi/agent/fabric.json
```

Project config:

```text
.pi/fabric.json
```

An explicit config file can be supplied with:

```bash
PI_FABRIC_CONFIG=/absolute/path/to/fabric.json pi
```

Precedence is:

```text
global < trusted project < PI_FABRIC_CONFIG
```

Project config is ignored when the project is not trusted.

Lean V2 reads only these configuration groups:

- `executor`
- `approvals`
- `mcp`
- `agents`
- `capture`
- `retention`

Removed Full Fabric provider groups do not activate those providers in Lean V2. See [Configuration Reference](configuration.md) for the exact active fields and defaults.

A practical starting config is:

```json
{
  "executor": {
    "runtime": "quickjs",
    "timeoutMs": 120000,
    "memoryLimitBytes": 67108864,
    "maxOutputChars": 50000,
    "maxNestedResultChars": 2000000,
    "resultFormat": "auto"
  },
  "approvals": {
    "read": "allow",
    "write": "allow",
    "execute": "allow",
    "network": "allow",
    "agent": "allow"
  },
  "agents": {
    "enabled": true,
    "runner": "pi",
    "transport": "process",
    "thinking": "medium",
    "maxConcurrent": 4,
    "timeoutMs": 3600000,
    "extensions": true,
    "defaultTools": ["read", "bash", "edit", "write", "grep", "find", "ls"],
    "veda": {
      "binary": "veda",
      "backend": "agy",
      "persona": "navigator-chat"
    }
  },
  "capture": {
    "keepVisible": ["fabric_exec"],
    "defaultRisk": "execute",
    "risks": {
      "fffind": "read",
      "ffgrep": "read"
    }
  }
}
```

Only add fields you want to override; omitted fields use Lean V2 defaults. Full Code Mode forces capture on and hides captured extension tools from the main model except names listed in `capture.keepVisible`.

## 3. Code Mode basics

`fabric_exec` receives one type-checked TypeScript program. Keep related mechanical work inside that program and return only the compact value the main model needs.

```ts
const [manifest, files] = await Promise.all([
  pi.read({ path: "package.json" }),
  pi.find({ pattern: "**/*.ts", path: "src" }),
]);

return {
  packageName: JSON.parse(manifest).name,
  sourceFiles: files.split("\n").filter(Boolean).length,
};
```

Use sequential `await` when one result determines the next call:

```ts
const hits = await pi.grep({ pattern: "createSession", path: "src" });
const first = hits.split("\n")[0];
if (!first) return { found: false };

return {
  found: true,
  hits,
};
```

Use `Promise.all`, `parallel(...)`, or `all({...})` only for independent work.

### Pi core tools

In Full Code Mode, Pi core tools are called through `pi.*`:

```ts
const source = await pi.read({ path: "src/index.ts", offset: 1, limit: 120 });
const matches = await pi.grep({ pattern: "TODO", path: "src", context: 2 });
const files = await pi.find({ pattern: "**/*.tsx", path: "src" });
const result = await pi.bash({ command: "pnpm test", timeout: 120000 });
return { source, matches, files, test: result.output };
```

`pi.bash`, `pi.edit`, and `pi.write` return result envelopes. Read `.output` when only their textual result is needed.

## 4. Captured Pi extension tools

Pi extensions can remain installed normally. Lean V2 captures their registered tools and exposes hidden additive tools inside Code Mode under `extensions.*` while preserving Pi's normal registered-tool lifecycle.

With FFF in `tools-and-ui` or `tools-only` mode, its additive tools can be called through `extensions.*`:

```ts
const files = await extensions.fffind({ pattern: "auth session", path: "src" });
const hits = await extensions.ffgrep({ pattern: "refreshToken", path: "src", context: 2 });
return { files, hits };
```

With FFF in `override` mode, it replaces Pi's core `find` and `grep` registrations. Keep using the normal Code Mode core surface:

```ts
const files = await pi.find({ pattern: "auth session", path: "src" });
const hits = await pi.grep({ pattern: "refreshToken", path: "src", context: 2 });
return { files, hits };
```

Lean V2 detects captured core overrides and routes `pi.find` / `pi.grep` through the registered extension implementation while preserving Code Mode argument normalization and lifecycle handling.

Exact argument shapes come from the extension itself. If you do not know a captured tool's schema, discover it first:

```ts
const matches = await tools.search({ query: "fffind" });
if (matches.length === 0) return null;
return tools.describe({ ref: matches[0].ref });
```

### `capture.keepVisible`

Full Code Mode hides captured tools from the model-facing Pi tool list but does not disable them inside `fabric_exec`.

`capture.keepVisible` is the exception list. For the normal Lean V2 setup, keep only:

```json
{
  "capture": {
    "keepVisible": ["fabric_exec"]
  }
}
```

If a specific extension tool must remain directly visible to the main model, add that exact tool name.

### Captured-tool risk

Unknown captured tools default to `capture.defaultRisk`, which is `execute` by default. Assign known read-only additive tools explicitly:

```json
{
  "capture": {
    "risks": {
      "fffind": "read",
      "ffgrep": "read"
    }
  }
}
```

Core overrides use their core tool identity, so an overridden `find` or `grep` follows the core read-risk path.

Valid risk classes are `read`, `write`, `execute`, `network`, and `agent`.

## 5. MCP

MCP is available inside Code Mode as `mcp.*` when `mcp.enabled` is true.

Known server/tool names can be called directly:

```ts
const result = await mcp.context7.resolve_library_id({
  libraryName: "react",
  query: "hooks",
});
return result;
```

When the exact name is unknown, use discovery:

```ts
const matches = await tools.search({ query: "library documentation" });
return matches;
```

Useful MCP configuration:

```json
{
  "mcp": {
    "enabled": true,
    "disableOAuth": true,
    "allowDynamicServers": true,
    "callTimeoutMs": 120000,
    "cache": {
      "enabled": true,
      "revalidate": "changed",
      "revalidateBudgetMs": 60000
    }
  }
}
```

Set `mcp.configPath` when mcporter should load one explicit config path.

For a trusted project, mcporter discovery uses the project as its root. For an untrusted project, Lean V2 uses the user Agent directory as the MCP discovery root and keeps its descriptor cache outside the repository, so project-local MCP/import configuration is not loaded through Fabric.

With `mcp.enabled: false`, the MCP provider is not registered or warmed and the `mcp` guest global is omitted from the active capability surface.

## 6. Named subagent roles

Subagent roles move model and runner selection out of prompts and workflows.

Global role files are searched in:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project role files are searched in:

```text
.pi/fabric/subagents.yaml
.pi/fabric/subagents.yml
.pi/fabric/subagents.json
```

One explicit host-supplied file can be added with:

```bash
PI_FABRIC_SUBAGENTS_FILE=/absolute/path/to/subagents.yaml pi
```

Role precedence is:

```text
global < trusted project < PI_FABRIC_SUBAGENTS_FILE < supported call overrides
```

Role profiles are merged field-by-field. Project role files are skipped when Pi marks the project untrusted.

### Recommended role catalog

```yaml
roles:
  research:
    description: Cheap bounded research and evidence gathering
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
      Avoid editing files.
    runner: veda
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    description: Repository exploration with the Pi runner
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]

  deep:
    description: Difficult reasoning or implementation
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high

  review:
    description: Independent verification
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high
    tools: [read, grep, find, ls]
```

For Veda roles, omitting `model` and `persona` uses the configured backend defaults. Add either value only after confirming the identifier accepted by the installed Veda backend. Fabric forwards those selections to Veda and does not maintain its own Veda model/persona catalog.

A role can define:

- `description`
- `instructions`
- `runner`: `pi`, `claude`, or `veda`
- `transport`: `auto`, `process`, `tmux`, `screen`, `localterm`, or `herdr`
- `model`
- `persona` for Veda
- `thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`
- `tools`
- `timeoutMs`
- `extensions`
- `recursive`
- `worktree`

Role `instructions` are automatically prepended to the child task.

### Discover configured roles

```ts
return await agents.roles({});
```

The generic equivalent is:

```ts
return await tools.call({ ref: "agents.roles", args: {} });
```

### Run a role and wait

```ts
const result = await agents.run({
  name: "research",
  task: "Find the upstream behavior relevant to this bug.",
});
return result;
```

When `name` exactly matches a configured role, that role profile is selected. A non-role `name` is only the worker display name. `name` is the public Code Mode role selector.

### Override a role for one call

Explicit supported call arguments win over role defaults:

```ts
return agents.run({
  name: "explore",
  task: "Trace this race condition and propose a fix.",
  thinking: "high",
  model: "azure-openai-responses/gpt-5.6-sol",
});
```

### Spawn and wait later

```ts
const handle = await agents.spawn({
  name: "review",
  task: "Review the current diff independently.",
});

const localEvidence = await pi.grep({ pattern: "dangerouslySetInnerHTML", path: "src" });
const review = await agents.wait({ id: handle.id });
return { localEvidence, review };
```

A detached `agents.spawn` can deliver a bounded completion follow-up to Main when `agents.notifyOnComplete` is enabled. Calling `agents.wait` makes that run foreground work for the current program.

Other retained one-shot actions are:

- `agents.status({ id })`
- `agents.list({})`
- `agents.roles({})`
- `agents.models({ runner?, refresh? })`
- `agents.stop({ id })`
- `agents.cleanup({ id, deleteBranch? })`
- `agents.steer({ id, message, data? })`
- `agents.followUp({ id, message, data? })`
- `agents.setSteeringMode({ id, mode })`
- `agents.setFollowUpMode({ id, mode })`
- `agents.compact({ id, instructions? })`

`agents.compact` applies only to a running Pi child. Lean V2 has no Fabric main-session compaction feature.

With `agents.enabled: false`, Lean V2 does not register the agents provider and normal system guidance does not advertise semantic delegation.

## 7. Veda / AGY routing

Set the default Veda binary, backend, and persona in `fabric.json`:

```json
{
  "agents": {
    "veda": {
      "binary": "veda",
      "backend": "agy",
      "persona": "navigator-chat"
    }
  }
}
```

Then select `runner: veda` in a role.

Fabric invokes Veda in headless JSON mode. Conceptually it runs:

```text
veda -b <backend> -p <persona> -m <model> -r <thinking> --tools ... --json
```

The configured model string is forwarded to Veda's `-m` argument. A leading `veda/` prefix is stripped; other model strings are passed through unchanged. If `model` is omitted, Veda chooses the backend default.

Veda tool mapping is:

```text
read  -> read
grep  -> grep
find  -> glob
ls    -> glob
bash  -> bash
edit  -> edit
write -> write
```

Unknown Fabric tool names are rejected before Veda starts. For the AGY backend specifically, Veda's tool allowlist may be advisory because AGY does not expose the same per-run allowlist mechanism.

Each Fabric Veda child gets an isolated Veda session named from the Fabric run id, so parallel children do not share Veda selection/conversation state.

## 8. Runner and transport are separate choices

`runner` selects the agent harness:

```text
pi | claude | veda
```

`transport` selects where/how the child process is hosted:

```text
process | tmux | screen | localterm | herdr | auto
```

Example:

```yaml
roles:
  research:
    runner: veda
    transport: herdr
    thinking: low
    tools: [read, grep, find, ls]
```

This means Veda executes the worker while Herdr hosts the process. `transport: auto` tries the available transport chain and falls back to a normal process.

## 9. Workflow

Workflow is only orchestration. It uses the same named one-shot subagent substrate and does not own separate model routing.

A simple research-and-review workflow:

```ts
const topics = ["routing", "cache", "auth"];

const findings = await parallel(
  topics.map((topic) => () =>
    agent(`Inspect ${topic} and return bounded evidence.`, {
      label: `explore ${topic}`,
      name: "explore",
    })
  ),
  { concurrency: 3 },
);

const verified = await agent(
  `Verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  {
    label: "verify",
    name: "review",
  },
);

return verified;
```

Because `name: "explore"` and `name: "review"` resolve through the role catalog, this workflow contains no model ids.

### Structured worker results

Use a JSON Schema when aggregation needs machine-readable output:

```ts
const result = await agent<{ files: string[]; summary: string }>(
  "Find the files responsible for authentication.",
  {
    label: "auth inventory",
    name: "explore",
    schema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" } },
        summary: { type: "string" }
      },
      required: ["files", "summary"],
      additionalProperties: false
    }
  },
);

return result;
```

### Concurrent edits

Do not let concurrent workers edit the same files. For parallel implementation work, either partition path ownership or use `worktree: true` on workers that should receive isolated Git worktrees.

## 10. Pi skills

Lean V2 ships only:

```text
fabric-exec
fabric-subagents
fabric-workflow
```

Your normal Pi/user skills still exist. Full Code Mode adapts progressive skill loading so a skill file can be read through `pi.read` inside `fabric_exec` even though the direct model-facing `read` tool is hidden.

Use:

- `fabric-exec` for exact Code Mode, captured-tool, MCP, and discovery contracts.
- `fabric-subagents` for role-based delegation.
- `fabric-workflow` for multi-phase fan-out/pipeline orchestration.

## 11. Migration from full Fabric

If you already have a full Fabric configuration, you do not need to delete it before trying Lean V2.

Removed provider groups do not become active Lean V2 providers. In practice:

1. Keep your existing `~/.pi/agent/fabric.json` while migrating.
2. Add or adjust `capture` and `agents` if needed.
3. Create `subagents.yaml` for semantic model routing.
4. Stop using Actor, Mesh, State, Schema, Memory, RLM, Prewalk, Council, Swarm, persistent participant, and trajectory-handoff APIs.
5. Replace those patterns with bounded `agents.run` / `agents.spawn` workers and ordinary workflow composition.

A useful mental mapping is:

```text
old persistent Actor     -> named one-shot role
old Council/Swarm        -> parallel named roles + final review role
old RLM                  -> explicit bounded Pi subagent when needed
old trajectory handoff   -> run/spawn a named Pi role
old Mesh coordination    -> keep coordination inside one workflow or your external harness
```

## 12. Troubleshooting

### A captured extension tool is missing

Check that the Pi extension is loaded, then discover it:

```ts
return tools.search({ query: "tool name" });
```

Lean V2 Full Code Mode forces capture on. If a registered extension tool is still missing, inspect the active extension registration and discoverable `extensions.*` actions.

### A tool is hidden from the main model

That is expected in Full Code Mode. Hidden captured tools remain callable through `extensions.*` inside `fabric_exec`.

Add a tool to `capture.keepVisible` only when it needs direct model visibility.

### A role is not selected

Inspect the loaded role catalog:

```ts
return agents.roles({});
```

The result includes role names and source files. `name` must exactly match the configured role name. Project role files will not appear for an untrusted project.

### Veda fails before starting

Verify the binary and backend independently:

```bash
veda --help
```

Then check the configured `agents.veda.binary`, `agents.veda.backend`, current backend persona/model selections, and tool list. Fabric rejects unsupported Veda tool ids before launch.

### A child times out

The default agent timeout is one hour. Increase `agents.timeoutMs` or a role/call `timeoutMs` when a long task needs more time.

### Too many children start at once

Reduce:

```json
{
  "agents": {
    "maxConcurrent": 2
  }
}
```

Workflow `parallel(..., { concurrency })` adds a second, local fan-out bound for that workflow section.

## 13. Recommended everyday pattern

For a main high-capability Pi model, keep the main conversation focused on decisions and implementation while delegating bounded work semantically:

```text
Main Pi
  |
  |-- mechanical repo work -> pi.* / extensions.* / mcp.* inside fabric_exec
  |
  |-- cheap evidence       -> research
  |-- repo exploration     -> explore
  |-- difficult reasoning  -> deep
  `-- independent check    -> review
```

Main receives lightweight system guidance to discover configured semantic roles and prefer them over raw model ids when delegation is useful. The user does not need to name a child model in ordinary conversation.

The important rule is that workflows choose roles, and role configuration chooses runner/model/thinking. This keeps prompts stable when providers or model ids change.

For the complete field list, see [Configuration Reference](configuration.md). For implementation details and the current physical-cleanup boundary, see [Lean Code Mode V2 Architecture](lean-code-mode.md).