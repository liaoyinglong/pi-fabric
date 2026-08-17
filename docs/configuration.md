# Pi Fabric Lean V2 Configuration Reference

This reference describes the configuration fields read by Lean V2. Day-to-day examples live in [usage.md](usage.md).

## File locations and precedence

Global configuration:

```text
~/.pi/agent/fabric.json
```

Trusted project configuration:

```text
.pi/fabric.json
```

Optional explicit configuration:

```bash
PI_FABRIC_CONFIG=/absolute/path/to/fabric.json pi
```

Precedence:

```text
global < trusted project < PI_FABRIC_CONFIG
```

Project configuration is skipped when Pi marks the project untrusted. `fabric.json` changes apply when the Lean runtime initializes again; subagent profile files are resolved per agent call.

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

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables one-shot child workers |
| `runner` | `pi` | Fallback runner when a profile does not specify one |
| `transport` | `process` | Fallback process transport |
| `model` | unset | Fallback Pi child model; an unset Pi model can inherit the host model |
| `thinking` | `medium` | Fallback child reasoning level |
| `maxConcurrent` | `4` | Maximum concurrently managed children |
| `maxPerExecution` | `100` | Maximum `run`/`spawn`/`recurse` starts in one `fabric_exec` |
| `maxDepth` | `2` | Maximum recursive Pi child depth |
| `timeoutMs` | `3600000` | Default child deadline |
| `extensions` | `true` | Keeps Pi extension discovery available to children, including dynamically registered model providers |
| `defaultTools` | `read, grep, find, ls` | Read-only fallback child tool allowlist |
| `retainRuns` | `false` | Keeps completed local run state when enabled |
| `notifyOnComplete` | `true` | Delivers detached `spawn` completion back to Main |
| `budgetUsd` | `0` | Shared child cost budget; `0` disables it |
| `maxTokensPerChild` | `0` | Per-child cumulative token guard; `0` disables it |
| `sessionExport` | `true` | Exports Pi-format usage records for child attribution |
| `sessionExportDir` | empty | Optional explicit export directory |

These values are defaults and safety ceilings. Ordinary Code Mode calls should select a semantic `profile`; model/runner/tool policy belongs in the profile file and stays out of the `agents.run` call.

If a one-shot profile omits `tools`, it inherits the read-only `read`, `grep`, `find`, and `ls` allowlist. Shell execution and writes (`bash`, `edit`, `write`) are opt-in through profile or host configuration. Extension discovery stays enabled by default so provider extensions such as dynamically registered model providers remain available in the child. When an ordinary child discovers Pi Fabric itself, Lean detects that it is a non-recursive Fabric child, stays inert, and leaves the child's core tools untouched. The Pi `--tools` allowlist remains the model-facing tool boundary.

`agents.run` and `agents.wait` are foreground work. `agents.spawn` is detached until waited; when detached work settles and `notifyOnComplete` is enabled, Lean sends a bounded follow-up to Main.

### Claude runner

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.claude.binary` | `claude` | Claude CLI executable |
| `agents.claude.model` | unset | Claude runner model default |

### CLI runner

The `cli` runner calls a supported headless CLI directly through a small adapter. Fabric no longer needs a Veda intermediary.

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.cli.adapter` | `agy` | Default CLI adapter: `agy` or `droid` |
| `agents.cli.agy.binary` | `agy` | Antigravity CLI executable |
| `agents.cli.agy.model` | unset | Antigravity model default |
| `agents.cli.droid.binary` | `droid` | Factory Droid CLI executable |
| `agents.cli.droid.model` | unset | Droid model default |

Example:

```json
{
  "agents": {
    "runner": "cli",
    "cli": {
      "adapter": "agy",
      "agy": { "binary": "agy" },
      "droid": { "binary": "droid" }
    }
  }
}
```

CLI adapters are one-shot: they do not support recursive Fabric, steering, follow-ups, or Fabric-triggered compaction. Droid maps Fabric's portable tool names to Droid's native tool IDs and uses Droid's native tool restriction flags. Antigravity does not currently expose an equivalent per-run tool allowlist, so Fabric passes the requested tool list as an explicit prompt boundary and leaves Antigravity's own permission policy authoritative; Fabric never enables Antigravity's dangerous permission bypass automatically.

## Subagent profile files

The historical configuration key remains `roles:`; the public runtime selector is `profile`.

Global files:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project files:

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
global < trusted project < PI_FABRIC_SUBAGENTS_FILE
```

Project files are skipped for untrusted projects. Profiles merge field-by-field; later arrays such as `tools` replace earlier arrays.

Profile fields:

| Field | Meaning |
| --- | --- |
| `description` | Short semantic purpose shown during profile discovery |
| `instructions` | Instructions prepended to the child task |
| `runner` | `pi`, `claude`, or `cli` |
| `cli` | For `runner: cli`, select `agy` or `droid`; omitted profiles use `agents.cli.adapter` |
| `transport` | `auto`, `process`, `tmux`, `screen`, `localterm`, or `herdr` |
| `model` | Runner-specific model identifier |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |
| `tools` | Portable child tool allowlist; omitted profiles inherit `read, grep, find, ls` |
| `timeoutMs` | Profile child timeout |
| `extensions` | Whether Pi extension discovery is enabled for the child; omitted means `true` |
| `worktree` | Create an isolated Git worktree |

Example CLI profiles:

```yaml
roles:
  research:
    runner: cli
    cli: agy
    model: gemini-3.7-flash
    tools: [read, grep, find, ls]

  review:
    runner: cli
    cli: droid
    tools: [read, grep, find, ls]
```

Public `agents.run` / `agents.spawn` calls expose only `task`, `profile`, optional display `name`, `timeoutMs`, `worktree`, and `schema`. Raw runner/model/thinking/tool fields are intentionally not part of the model-facing call schema.

## Recursive delegation

`agents.recurse({ profile, task })` explicitly starts a recursive Pi profile and returns a compact result. The resolved profile must use `runner: pi`.

Relevant guards:

- `agents.maxDepth` limits recursive depth;
- `agents.maxPerExecution` limits starts in the current Code Mode execution;
- `agents.timeoutMs` / profile timeout bound each child;
- `agents.maxTokensPerChild` bounds cumulative child tokens when non-zero;
- `agents.budgetUsd` provides a shared cost ledger across recursive Pi descendants when non-zero.

Recursive Pi children force Lean Fabric on and keep `fabric_exec` as the model-facing execution gateway. The selected profile's original `tools` allowlist becomes the hard internal Fabric capability grant: for example, a read-only profile may call `pi.read`, `pi.grep`, `pi.find`, and `pi.ls` inside `fabric_exec`, but cannot reach `pi.bash`, `pi.edit`, or `pi.write`. Captured extension actions are likewise limited to extension tool names granted by the profile. This keeps recursive Code Mode from expanding a profile's authority.

There is no separate RLM provider or persistent recursive scheduler.

## `capture`

Lean V2 owns model-facing tool visibility in Full Code Mode. The runtime forces capture on and captured extension tools hidden from Main. `capture.enabled` and `capture.hideFromModel` remain compatibility inputs but normalize to `true`.

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
