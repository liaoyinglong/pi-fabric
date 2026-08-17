# Pi Fabric Lean V2 Usage Guide

Lean V2 is a focused Programmatic Tool Calling runtime for Pi with three surfaces:

1. `fabric_exec` for one type-checked TypeScript program that composes many tool calls.
2. Profile-based one-shot subagents for bounded delegated work.
3. Thin workflow helpers over the same one-shot runtime.

A small `agents.recurse` primitive supports bounded recursive Pi delegation. Persistent Actor, Mesh, State, Memory, standalone RLM/Council/Swarm, Prewalk, resident-host, trajectory-handoff, and dashboard systems are not part of Lean V2.

## 1. Install

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

## 2. Configuration files

Global config:

```text
~/.pi/agent/fabric.json
```

Trusted project config:

```text
.pi/fabric.json
```

Explicit host config:

```bash
PI_FABRIC_CONFIG=/absolute/path/to/fabric.json pi
```

Precedence:

```text
global < trusted project < PI_FABRIC_CONFIG
```

Project config is ignored when Pi does not trust the project. See [configuration.md](configuration.md) for every active field and default.

A practical starting point:

```json
{
  "executor": {
    "runtime": "quickjs"
  },
  "agents": {
    "enabled": true,
    "maxConcurrent": 4,
    "maxDepth": 2,
    "veda": {
      "binary": "veda",
      "backend": "agy",
      "persona": "navigator-chat"
    }
  },
  "capture": {
    "keepVisible": ["fabric_exec"],
    "risks": {
      "fffind": "read",
      "ffgrep": "read"
    }
  }
}
```

## 3. Code Mode

`fabric_exec` receives one TypeScript function body. Keep related mechanical work inside the program and return only what Main needs.

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

Use sequential `await` when the first result determines the next operation:

```ts
const hits = await pi.grep({ pattern: "createSession", path: "src" });
if (!hits.trim()) return { found: false };
const source = await pi.read({ path: "src/session.ts", offset: 1, limit: 160 });
return { found: true, hits, source };
```

Use `Promise.all`, `parallel(...)`, or `all({...})` only for independent work.

### TUI

The `fabric_exec` card keeps generated code visible:

- collapsed: first 8 TypeScript lines;
- `Ctrl+O`: complete program;
- running: concise nested tool headlines and progress;
- write/edit: bounded diff preview;
- final: call count, duration, failures, and only a real returned value;
- `undefined` return: no synthetic `(no output)` body.

This keeps the useful original Fabric Code Mode observability without restoring the old dashboard stack.

## 4. Pi core tools

Use `pi.*` inside Full Code Mode:

```ts
const source = await pi.read({ path: "src/index.ts", offset: 1, limit: 120 });
const matches = await pi.grep({ pattern: "TODO", path: "src", context: 2 });
const files = await pi.find({ pattern: "**/*.tsx", path: "src" });
const test = await pi.bash({ command: "pnpm test", timeout: 120 });
return { source, matches, files, test: test.output };
```

`pi.bash`, `pi.edit`, and `pi.write` return envelopes. Read `.output` when only textual output is needed.

## 5. Captured Pi extension tools

Lean retains Fabric's low-level executable-tool capture. Additive Pi extension tools remain callable through `extensions.*` while Pi's normal lifecycle hooks still run.

With FFF additive tools:

```ts
const files = await extensions.fffind({ pattern: "auth", path: "src" });
const hits = await extensions.ffgrep({ pattern: "refreshToken", path: "src" });
return { files, hits };
```

With FFF override mode, keep using the core names:

```ts
const files = await pi.find({ pattern: "auth", path: "src" });
const hits = await pi.grep({ pattern: "refreshToken", path: "src" });
return { files, hits };
```

If the exact schema is unknown:

```ts
const matches = await tools.search({ query: "fffind" });
if (!matches[0]) return null;
return tools.describe({ ref: matches[0].ref });
```

`capture.keepVisible` controls which captured extension tools remain directly visible outside Code Mode. Normally keep only `fabric_exec` visible.

## 6. MCP

When enabled, known tools use generated namespaces:

```ts
return mcp.context7.resolve_library_id({ libraryName: "react" });
```

For unknown refs, use `tools.search` / `tools.describe` / `tools.call`.

For trusted projects, mcporter discovery can use the project root. For untrusted projects, Lean uses the user Agent directory as discovery root and keeps descriptor cache state outside the repository so project-local MCP/import configuration is not loaded through Fabric.

With `mcp.enabled: false`, Lean does not register/warm the provider and the `mcp` guest global is omitted.

## 7. Semantic subagent profiles

Configuration files keep the historical `roles:` key, but runtime selection is explicitly `profile`.

Global profile files:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project profile files:

```text
.pi/fabric/subagents.yaml
.pi/fabric/subagents.yml
.pi/fabric/subagents.json
```

Optional host-supplied file:

```bash
PI_FABRIC_SUBAGENTS_FILE=/absolute/path/to/subagents.yaml pi
```

Recommended catalog:

```yaml
roles:
  research:
    description: Cheap bounded research and evidence gathering
    instructions: |
      Gather concrete evidence. Avoid editing files.
    runner: veda
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    description: Repository exploration
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]

  deep:
    description: Difficult reasoning or implementation decisions
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

Profiles can define `description`, `instructions`, `runner`, `transport`, `model`, `persona`, `thinking`, `tools`, `timeoutMs`, `extensions`, `recursive`, and `worktree`.

Project profiles are skipped for untrusted projects. Profiles merge field-by-field in this order:

```text
global < trusted project < PI_FABRIC_SUBAGENTS_FILE
```

### Discover profiles

```ts
const catalog = await agents.profiles({});
return catalog.profiles;
```

### Run a profile

```ts
return agents.run({
  profile: "research",
  task: "Find the upstream behavior relevant to this bug.",
});
```

### Spawn a profile

```ts
const handle = await agents.spawn({
  profile: "review",
  name: "independent review",
  task: "Review the current diff independently.",
});

const localEvidence = await pi.grep({ pattern: "unsafe", path: "src" });
const review = await agents.wait({ id: handle.id });
return { localEvidence, review };
```

`name` is display-only in the public API. Older code that used a matching role name as `name` remains a compatibility fallback, but new code should use `profile`.

The public run/spawn contract intentionally does not expose raw routing fields such as `runner`, `model`, `persona`, `thinking`, `tools`, `extensions`, or `recursive`. Change the profile definition when routing policy changes.

Retained child controls:

```text
agents.wait
agents.status
agents.list
agents.stop
agents.cleanup
agents.steer
agents.followUp
agents.setSteeringMode
agents.setFollowUpMode
agents.compact
```

Pi/Claude workers can be steered between turns; Veda is one-shot.

## 8. Minimal recursive delegation

Use `agents.recurse` only when one child context is insufficient:

```ts
return agents.recurse({
  profile: "deep",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

The profile must resolve to `runner: pi`. The recursive child gets Lean Code Mode and can delegate again. The parent receives a compact result rather than the full internal run record.

Current recursion bounds are intentionally simple:

- `agents.maxDepth` limits Pi recursion depth;
- `agents.maxPerExecution` and top-level `agentBudget` cap starts in one `fabric_exec` execution;
- `agents.timeoutMs` and `maxTokensPerChild` bound each child;
- `agents.budgetUsd` shares a cost ledger across recursive Pi descendants when enabled.

There is no separate RLM provider, Actor tree, Mesh, persistent scheduler, or recursive workflow engine.

## 9. Veda / AGY

Set Veda defaults in `fabric.json`:

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

Then bind a profile to `runner: veda`. Omit profile `model` and `persona` to inherit backend defaults; add them only after confirming identifiers accepted by the installed Veda backend.

Portable tool mapping:

```text
read  -> read
grep  -> grep
find  -> glob
ls    -> glob
bash  -> bash
edit  -> edit
write -> write
```

Runner and transport are independent profile settings. For example:

```yaml
roles:
  research:
    runner: veda
    transport: herdr
    thinking: low
    tools: [read, grep, find, ls]
```

Veda executes the worker while Herdr hosts its process.

## 10. Thin workflow

Workflow is not another agent runtime. Use plain TypeScript whenever it is clearer.

Few independent workers:

```ts
const [docs, code] = await Promise.all([
  agents.run({ profile: "research", task: "Check upstream behavior." }),
  agents.run({ profile: "explore", task: "Locate the implementation." }),
]);
return { docs, code };
```

Larger bounded fan-out:

```ts
const findings = await parallel(
  ["routing", "cache", "auth"].map((topic) => () =>
    agent(`Inspect ${topic} and return concrete evidence.`, {
      profile: "explore",
      label: `explore ${topic}`,
    })
  ),
  { concurrency: 3 },
);

return agent(
  `Verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  { profile: "review", label: "verify findings" },
);
```

Use `pipeline` for repeated staged transforms and `phase` only when explicit progress boundaries add value. If a helper makes the code harder to read than `await` or `Promise.all`, do not use it.

## 11. Structured results

Use `schema` when machine-readable output materially simplifies aggregation:

```ts
const result = await agents.run({
  profile: "explore",
  task: "Find authentication files.",
  schema: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" } },
      summary: { type: "string" }
    },
    required: ["files", "summary"],
    additionalProperties: false
  }
});
return result.value;
```

## 12. Worktrees

Set `worktree: true` on a call or in the profile when parallel implementation workers need file isolation. Do not let concurrent workers edit the same files in one shared workspace. Clean a completed worktree with:

```ts
await agents.cleanup({ id: handle.id, deleteBranch: true });
```

## 13. Troubleshooting

### I only see `fabric_exec`

Expected in Full Code Mode. Pi core tools, captured extension tools, MCP, and profiles are invoked from inside the generated program.

### FFF additive tools are missing

Use `extensions.fffind` / `extensions.ffgrep` for additive modes. In FFF override mode use `pi.find` / `pi.grep`.

### A project profile is ignored

Confirm Pi trusts the project. Untrusted projects cannot supply `.pi/fabric/subagents.*`.

### A profile is unknown

Run:

```ts
return agents.profiles({});
```

Then use the exact `profile` name.

### I want to change a worker model for one task

Change or add a semantic profile. Ordinary call sites deliberately do not choose raw models.

### A Veda profile fails

Test Veda/AGY independently first, then omit `model`/`persona` to verify backend defaults before adding explicit identifiers.

### I need recursive work

Try one normal `agents.run` first. Use `agents.recurse` only when decomposition across isolated child contexts is the reason the task is difficult.

## 14. Verification

Before publishing changes:

```bash
pnpm check
```

This runs typecheck, build/artifact assertions, the full Vitest suite, and structural dead-code analysis. GitHub Actions runs the repository checks on Ubuntu and Windows.
