# Configuration

Fabric reads global configuration from `~/.pi/agent/fabric.json` and trusted-project overrides from `.pi/fabric.json`. `PI_FABRIC_CONFIG` can point at an additional explicit config file.

Configuration is file-based. Fabric does not provide a settings command or settings TUI.

## Executor

```json
{
  "executor": {
    "timeoutMs": 120000,
    "memoryLimitBytes": 67108864,
    "maxOutputChars": 50000,
    "maxNestedResultChars": 2000000,
    "resultFormat": "auto"
  }
}
```

Lean V2 uses QuickJS as its single sandbox executor. `memoryLimitBytes` is capped to the QuickJS/WASM32 ceiling and the host's available memory.

## Approvals

```json
{
  "approvals": {
    "read": "allow",
    "write": "allow",
    "execute": "allow",
    "network": "allow"
  }
}
```

Each value is `allow`, `ask`, or `deny`. `ask` requires explicit user approval and can grant one call or the risk class for the current Pi session.

Legacy `auto` values normalize to `ask`. Legacy `approvals.agent` and `approvals.model` fields are ignored. A legacy captured-tool risk value of `agent` normalizes to `execute`.

## MCP

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

`revalidate` is `changed`, `all`, or `off`. When MCP is disabled, the `mcp` guest namespace is excluded from generated typing and calls report the provider as unavailable.

## Captured tools

```json
{
  "capture": {
    "keepVisible": ["fabric_exec"],
    "defaultRisk": "execute",
    "risks": {
      "read": "read",
      "grep": "read",
      "find": "read",
      "ls": "read",
      "edit": "write",
      "write": "write",
      "bash": "execute"
    }
  }
}
```

Lean always captures registered extension tools. Captured tools remain registered with Pi so host extensions can observe their lifecycle. The model-facing active set hides captured tools unless their names appear in `keepVisible`. They remain callable inside `fabric_exec` through `extensions.*` or exact-name core overrides through `pi.*`.

`capture.enabled`, `capture.hideFromModel`, and `capture.advisory` are legacy keys and are ignored by normalized Lean configuration.

## Removed configuration

Lean V2 always exposes Pi core tools and captured extension tools inside `fabric_exec`. The legacy `fullCodeMode` switch and `schema.mode` orchestration setting are ignored and do not appear in normalized configuration.

Lean V2 uses QuickJS exclusively. The legacy `executor.runtime` selector, including `node-process`, is ignored and does not appear in normalized configuration.

Lean V2 also ignores Fabric-owned agent runner, tier or policy routing, workflow, child-run retention, session export, todo, MCP advisory, and model-driven approval configuration. These keys can be removed from existing config files.
