# Configuration

Fabric reads global configuration from `~/.pi/agent/fabric.json` and trusted-project overrides from `.pi/fabric.json`. `PI_FABRIC_CONFIG` can point at an additional explicit config file.

Configuration is file-based. Fabric does not provide a settings command or settings TUI.

## Executor

```json
{
  "executor": {
    "runtime": "quickjs",
    "timeoutMs": 120000,
    "memoryLimitBytes": 67108864,
    "maxOutputChars": 50000,
    "maxNestedResultChars": 2000000,
    "resultFormat": "auto"
  }
}
```

`runtime` is `quickjs` or `node-process`.

## Approvals

```json
{
  "approvals": {
    "read": "allow",
    "write": "allow",
    "execute": "allow",
    "network": "allow",
    "agent": "allow"
  }
}
```

Each value is `allow`, `ask`, `auto`, or `deny`. `agent` remains a generic risk class for third-party actions that delegate externally; it does not enable a Fabric subagent runtime. Auto approval is retained for now and can be evaluated independently from the execution-core cleanup.

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

`revalidate` is `changed`, `all`, or `off`.

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

Lean forces capture on and hides captured tools from the model unless they are listed in `keepVisible`. Captured tools stay available inside `fabric_exec` through `extensions.*` or core override names.

## Removed configuration

Lean V2 no longer reads or exposes Fabric-owned agent runner, tier/policy routing, workflow, child-run retention, session export, or todo configuration. Legacy keys are ignored by normalization and can be removed from existing config files.
