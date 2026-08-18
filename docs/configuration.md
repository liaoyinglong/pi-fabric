# Pi Fabric Lean V2 Configuration Reference

This reference describes the configuration fields read by Lean V2. Day-to-day examples live in [usage.md](usage.md).

## File locations and precedence

Global runtime configuration:

```text
~/.pi/agent/fabric.json
```

Trusted project runtime configuration:

```text
.pi/fabric.json
```

Optional explicit runtime configuration:

```bash
PI_FABRIC_CONFIG=/absolute/path/to/fabric.json pi
```

Precedence:

```text
global < trusted project < PI_FABRIC_CONFIG
```

Project configuration is skipped when Pi marks the project untrusted. `fabric.json` changes apply when the Lean runtime initializes again. Subagent routing files are resolved per agent call.

Configuration objects merge recursively. Scalar values replace earlier values. Arrays replace earlier arrays; they are not concatenated.

## `executor`

| Field | Default | Meaning |
| --- | --- | --- |
| `runtime` | `quickjs` | `quickjs` or trusted `node-process` execution |
| `timeoutMs` | `120000` | Base Code Mode execution deadline |
| `memoryLimitBytes` | `67108864` | Executor memory ceiling |
| `maxOutputChars` | `50000` | Maximum final serialized output size |
| `maxNestedResultChars` | `2000000` | Maximum serialized result retained for one nested call |
| `resultFormat` | `auto` | `auto`, `yaml`, `json`, or `text` |

Blocking agent/workflow calls can extend the active execution deadline up to the configured child timeout.

## `approvals`

Risk classes:

```text
read | write | execute | network | agent
```

Each accepts:

```text
allow | ask | auto | deny
```

Defaults are `allow`. `approvals.model` optionally selects the automatic approval classifier model.

## `mcp`

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables MCP discovery and calls |
| `configPath` | unset | Explicit mcporter configuration path |
| `disableOAuth` | `true` | Prevents a new interactive OAuth flow |
| `allowDynamicServers` | `true` | Allows ephemeral dynamic MCP servers |
| `callTimeoutMs` | `120000` | MCP call deadline |
| `cache.enabled` | `true` | Enables descriptor caching |
| `cache.revalidate` | `changed` | `changed`, `all`, or `off` |
| `cache.revalidateBudgetMs` | `60000` | Background revalidation budget |

For trusted projects, mcporter can discover from the project root. For untrusted projects, Lean uses the user Agent directory as discovery root and keeps descriptor cache state outside the repository.

With `mcp.enabled: false`, Lean does not register/warm the MCP provider and omits the `mcp` guest global.

## `agents`

The `agents` group controls the worker runtime and global safety ceilings. Main does **not** choose these raw fields in ordinary `agents.run` calls; Main chooses a tier and policy instead.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables child workers |
| `runner` | `pi` | Internal fallback runner when a tier does not resolve one |
| `transport` | `process` | Internal fallback process transport |
| `model` | unset | Fallback Pi child model |
| `thinking` | `medium` | Fallback child reasoning level |
| `maxConcurrent` | `4` | Maximum concurrently managed children |
| `maxPerExecution` | `100` | Maximum `run`/`spawn`/`recurse` starts in one `fabric_exec` |
| `maxDepth` | `2` | Maximum recursive Pi child depth |
| `timeoutMs` | `3600000` | Default child deadline |
| `extensions` | `true` | Keeps Pi extension discovery available to children |
| `defaultTools` | `read, grep, find, ls` | Internal fallback child tool allowlist |
| `retainRuns` | `false` | Keeps completed local run state when enabled |
| `notifyOnComplete` | `true` | Delivers detached `spawn` completion back to Main |
| `budgetUsd` | `0` | Shared child cost budget; `0` disables it |
| `maxTokensPerChild` | `0` | Per-child cumulative token guard; `0` disables it |
| `sessionExport` | `true` | Exports Pi-format usage records for child attribution |
| `sessionExportDir` | empty | Optional explicit export directory |

`agents.run` and `agents.wait` are foreground work. `agents.spawn` is detached until waited; when detached work settles and `notifyOnComplete` is enabled, Lean sends a bounded follow-up to Main.

Ordinary one-shot Pi children keep extension discovery enabled by default so dynamically registered providers remain available. Lean itself stays inert in non-recursive Fabric children, while the selected policy's portable tool allowlist remains the model-facing capability boundary.

### Claude runner

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.claude.binary` | `claude` | Claude CLI executable |
| `agents.claude.model` | unset | Claude runner model default |

### CLI runner

The `cli` runner calls a supported headless CLI directly through a small adapter. Fabric does not require Veda.

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.cli.adapter` | `agy` | Fallback CLI adapter: `agy` or `droid` |
| `agents.cli.agy.binary` | `agy` | Antigravity CLI executable |
| `agents.cli.agy.model` | unset | Antigravity model default |
| `agents.cli.droid.binary` | `droid` | Factory Droid CLI executable |
| `agents.cli.droid.model` | unset | Droid model default |

CLI adapters are one-shot: they do not support recursive Fabric, steering, follow-ups, or Fabric-triggered compaction. Droid maps Fabric's portable tool names to native tool IDs and uses native restriction flags. Antigravity receives the selected policy's tool list as an explicit prompt boundary while its own permission configuration remains authoritative; Fabric does not enable a dangerous permission bypass automatically.

## Subagent routing: `tiers` + `policies`

Lean V2 ships a complete default routing table. No subagent file is required for normal use.

Main chooses:

```text
tier:    fast | balance | strong
policy:  inspect | execute | modify | isolated
role:    temporary call-time semantic role
```

`role` is created dynamically by Main and is not configuration.

### Built-in tier defaults

| Tier | Default | Intended use |
| --- | --- | --- |
| `fast` | Pi `gpt-5.6-luna`, medium thinking | cheap bounded search, evidence gathering, repetitive inspection |
| `balance` | Pi `gpt-5.6-terra`, medium thinking | routine reasoning, debugging, implementation, verification |
| `strong` | Pi `gpt-5.6-sol`, medium thinking | ambiguous bugs, architecture/high-impact decisions, difficult reasoning, independent review |

AGY and Droid remain available as CLI runner overrides. The built-in routing table itself uses Pi for all three tiers.

### Built-in policy defaults

| Policy | Tools | Worktree | Intended use |
| --- | --- | --- | --- |
| `inspect` | `read, grep, find, ls` | no | research, exploration, review |
| `execute` | inspect + `bash` | no | tests/builds/diagnostics without source edits |
| `modify` | `read, grep, find, ls, bash, edit, write` | no | bounded implementation in the current workspace |
| `isolated` | same mutation tools | yes | experiments or parallel mutation in an isolated worktree |

Policies are capability boundaries. A temporary role never expands the selected policy.

### Routing file locations

Global routing:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project routing:

```text
.pi/fabric/subagents.yaml
.pi/fabric/subagents.yml
.pi/fabric/subagents.json
```

Optional explicit host file:

```bash
PI_FABRIC_SUBAGENTS_FILE=/absolute/path/to/subagents.yaml pi
```

Precedence:

```text
built-ins < global < trusted project < PI_FABRIC_SUBAGENTS_FILE
```

Project files are skipped for untrusted projects. Later values merge field-by-field; policy `tools` arrays replace earlier arrays.

Only two top-level keys are recognized: `tiers` and `policies`. There is no `roles:` or profile compatibility layer.

```yaml
tiers:
  fast:
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: medium

  balance:
    runner: pi
    model: azure-openai-responses/gpt-5.6-terra
    thinking: medium

  strong:
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: medium
    # transport: herdr

policies:
  inspect:
    tools: [read, grep, find, ls]

  execute:
    tools: [read, grep, find, ls, bash]

  modify:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: false

  isolated:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: true
```

Tier override fields:

| Field | Meaning |
| --- | --- |
| `description` | Semantic description used in child routing guidance |
| `instructions` | Tier-wide child instructions |
| `runner` | `pi`, `claude`, or `cli` |
| `cli` | `agy` or `droid` when `runner: cli` |
| `transport` | `auto`, `process`, `tmux`, `screen`, `localterm`, or `herdr` |
| `model` | Runner-specific model identifier |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |
| `timeoutMs` | Tier-specific timeout |
| `extensions` | Whether Pi extension discovery is enabled |

Policy override fields:

| Field | Meaning |
| --- | --- |
| `description` | Semantic capability description |
| `instructions` | Policy-wide hard-boundary guidance |
| `tools` | Portable child tool allowlist |
| `worktree` | Whether the worker runs in an isolated Git worktree |

Main can inspect the active semantic routing surface with `agents.routing({})`. The result intentionally exposes tier/policy meanings and policy capability boundaries, not raw model IDs or runners.

## Recursive delegation

`agents.recurse({ tier, policy, role, task })` explicitly starts a recursive child. The selected tier must resolve to `runner: pi`.

With the built-in routing table, `fast`, `balance`, and `strong` can all recurse. A tier overridden to a CLI runner remains one-shot and cannot recurse.

Relevant guards:

- `agents.maxDepth` limits recursive depth;
- `agents.maxPerExecution` limits starts in the current Code Mode execution;
- `agents.timeoutMs` / tier timeout bound each child;
- `agents.maxTokensPerChild` bounds cumulative child tokens when non-zero;
- `agents.budgetUsd` provides a shared cost ledger across recursive Pi descendants when non-zero;
- the selected policy continues to bound tools and worktree behavior.

Recursive Pi children use Lean Code Mode. A read-only `inspect` child can reach only its read/search grant through `pi.*`; a `modify` child can reach the mutation tools granted by that policy. Recursion cannot expand authority beyond policy.

There is no separate RLM provider or persistent recursive scheduler.

## `capture`

Lean V2 owns model-facing tool visibility in Full Code Mode. The runtime forces capture on and captured extension tools hidden from Main. `capture.enabled` and `capture.hideFromModel` remain broad inputs but normalize to `true`.

User-facing controls:

| Field | Default | Meaning |
| --- | --- | --- |
| `keepVisible` | `["fabric_exec"]` | Captured extension tool names that remain directly model-visible |
| `defaultRisk` | `execute` | Risk for an unknown additive captured tool |
| `risks` | core mappings | Per-tool risk overrides |

Core Pi names remain owned by Code Mode. Captured core overrides, such as FFF `find` / `grep`, are reached through `pi.find` / `pi.grep` inside `fabric_exec`.

Valid risks are `read`, `write`, `execute`, `network`, and `agent`.

## `retention`

| Field | Default | Meaning |
| --- | --- | --- |
| `orphanedTempRunMs` | `21600000` | Retention for orphaned temporary run roots |
| `oneShotRunMs` | `86400000` | Retention for completed one-shot runs |

## Values fixed by Lean V2

```text
fullCodeMode = true
schema.mode = off
capture.enabled = true
capture.hideFromModel = true
capture.advisory.mode = disabled
mcp.advisory = false
ui.updateDebounceMs = 100
```

Old Full Fabric groups such as Mesh, Memory, State, Actor, resident-host, standalone RLM, and Component supervisor configuration do not activate providers in Lean V2.
