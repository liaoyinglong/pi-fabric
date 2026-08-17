# Pi Fabric Lean V2 Configuration Reference

This reference describes the configuration fields read by Lean V2. The day-to-day examples live in [usage.md](usage.md).

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

Project configuration is skipped when Pi marks the project untrusted. Changes to `fabric.json` take effect after the Lean runtime is initialized again, such as in a new Pi session. Named subagent role files are resolved per agent call.

Configuration objects merge recursively. Scalar values replace earlier values. Arrays replace earlier arrays; they are not concatenated. This matters for fields such as `capture.keepVisible`, `agents.defaultTools`, and a role's `tools` list.

## `executor`

| Field | Default | Meaning |
| --- | --- | --- |
| `runtime` | `quickjs` | `quickjs` or trusted `node-process` execution |
| `timeoutMs` | `120000` | Base Code Mode execution deadline |
| `memoryLimitBytes` | `67108864` | Executor memory ceiling |
| `maxOutputChars` | `50000` | Maximum final serialized output size |
| `maxNestedResultChars` | `2000000` | Maximum serialized result retained for one nested call |
| `resultFormat` | `auto` | `auto`, `yaml`, `json`, or `text` |

Agent and workflow calls can extend the active execution deadline up to the configured agent timeout when the runtime detects blocking orchestration.

## `approvals`

The risk classes are `read`, `write`, `execute`, `network`, and `agent`.

Each class accepts:

```text
allow | ask | auto | deny
```

The defaults are `allow` for all five classes.

`approvals.model` optionally selects the model used by automatic approval classification when that path is enabled.

## `mcp`

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables MCP discovery and calls |
| `configPath` | unset | Explicit mcporter configuration path |
| `disableOAuth` | `true` | Prevents a new interactive OAuth flow |
| `allowDynamicServers` | `true` | Allows `mcp.register(...)` for ephemeral servers |
| `callTimeoutMs` | `120000` | MCP call deadline |
| `cache.enabled` | `true` | Enables the descriptor cache |
| `cache.revalidate` | `changed` | `changed`, `all`, or `off` |
| `cache.revalidateBudgetMs` | `60000` | Background descriptor revalidation budget |

The descriptor cache is stored under the project Fabric directory when caching is enabled. With `mcp.enabled: false`, Lean V2 does not register or warm the MCP provider, and the `mcp` guest global is omitted from that runtime's capability surface.

## `agents`

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables one-shot child workers |
| `runner` | `pi` | Default runner: `pi`, `claude`, or `veda` |
| `transport` | `process` | Default transport |
| `model` | unset | Default Pi child model; an unset Pi model can inherit the host model |
| `thinking` | `medium` | Default child reasoning level |
| `maxConcurrent` | `4` | Maximum concurrently managed children |
| `maxPerExecution` | `100` | Maximum agent starts in one `fabric_exec` |
| `maxDepth` | `2` | Maximum recursive Pi child depth |
| `timeoutMs` | `3600000` | Default child deadline |
| `extensions` | `true` | Enables runner extensions for children |
| `defaultTools` | Pi core tool set | Default portable child tool allowlist |
| `retainRuns` | `false` | Keeps completed local run state when enabled |
| `notifyOnComplete` | `true` | Delivers a detached `agents.spawn` completion back to Main as a follow-up and triggers a turn |
| `budgetUsd` | `0` | Shared child cost budget; `0` disables the budget |
| `maxTokensPerChild` | `0` | Per-child cumulative token guard; `0` disables it |
| `sessionExport` | `true` | Exports Pi-format usage records for child attribution |
| `sessionExportDir` | empty | Optional explicit export directory |

`agents.run` and `agents.wait` are foreground work for the current program. `agents.spawn` is detached until the program waits on its handle; when a detached run settles and `notifyOnComplete` is enabled, Lean V2 sends the bounded completion summary back to Main.

### Claude runner

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.claude.binary` | `claude` | Claude CLI executable |
| `agents.claude.model` | unset | Claude runner model default |

### Veda runner

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.veda.binary` | `veda` | Veda CLI executable |
| `agents.veda.backend` | `agy` | Veda backend |
| `agents.veda.persona` | `navigator-chat` | Default Veda persona |
| `agents.veda.model` | unset | Veda model default |

A named role can override runner, transport, model, persona, thinking, tools, timeout, extensions, recursion, and worktree behavior for one semantic role. Explicit supported call arguments take precedence over role defaults.

## Named subagent role files

Global role files:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project role files:

```text
.pi/fabric/subagents.yaml
.pi/fabric/subagents.yml
.pi/fabric/subagents.json
```

Optional explicit role file:

```bash
PI_FABRIC_SUBAGENTS_FILE=/absolute/path/to/subagents.yaml pi
```

Role precedence:

```text
global < trusted project < PI_FABRIC_SUBAGENTS_FILE < supported call overrides
```

Project role files are skipped for untrusted projects. The explicit environment path is host supplied and remains eligible. Role profiles merge field-by-field; a later `tools` array replaces the earlier role's `tools` array.

## `capture`

Lean V2 owns model-facing tool visibility as part of Full Code Mode. The runtime forces capture on and forces captured tools hidden from the main model. `capture.enabled` and `capture.hideFromModel` are retained compatibility inputs; Lean V2 normalizes their effective values to `true`.

The user-facing capture controls are:

| Field | Default | Meaning |
| --- | --- | --- |
| `keepVisible` | `["fabric_exec"]` | Captured extension tool names that remain directly model-visible |
| `defaultRisk` | `execute` | Risk assigned to an unknown captured additive tool |
| `risks` | core mappings | Per-tool risk overrides |

Core Pi tool names remain owned by Code Mode. A captured extension that replaces a core registration, such as an FFF `find` or `grep` override, is reached through `pi.find` or `pi.grep` inside `fabric_exec`.

The old capture advisory mechanism is disabled in Lean V2.

## `retention`

| Field | Default | Meaning |
| --- | --- | --- |
| `orphanedTempRunMs` | `21600000` | Retention period for orphaned temporary run roots |
| `oneShotRunMs` | `86400000` | Retention period for completed one-shot runs |
| `actorRunArchiveMs` | `604800000` | Legacy compatibility field left from the removed Actor runtime |

`actorRunArchiveMs` is not part of the Lean V2 product surface and should not be used for new configuration. Its remaining compatibility code is scheduled for removal from the lean branch.

## Fields fixed by Lean V2

Lean V2 fixes these internal values regardless of old Full Fabric configuration:

```text
fullCodeMode = true
schema.mode = off
capture.enabled = true
capture.hideFromModel = true
capture.advisory.mode = disabled
mcp.advisory = false
ui.updateDebounceMs = 100
```

Old Full Fabric groups such as Mesh, Memory, State, Schema runtime, Actor, resident-host, and Component supervisor configuration do not become active providers in Lean V2.
