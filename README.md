# Pi Fabric

A programmable tool and agent runtime for Pi.

Pi Fabric exposes one model-facing `fabric_exec` tool. Inside it, type-checked TypeScript can compose Pi core tools, captured extension tools, MCP tools, and generic Fabric discovery/calls while keeping large intermediate data inside the sandbox.

## Discovery

Fabric uses progressive, schema-lazy discovery by default:

```ts
const candidates = await tools.search({ query: "repository issue", limit: 10 });
const descriptor = await tools.describe({ ref: candidates[0].ref });
return descriptor.inputSchema;
```

`tools.list()` and `tools.search()` return lightweight action summaries without input/output schemas. Fetch full schemas only for selected refs with `tools.describe({ ref })`. `includeSchemas: true` is available as an explicit high-cost compatibility path for genuine bulk-schema tasks.

See `docs/usage.md` and the packaged `skills/fabric-exec/SKILL.md` for details.

## Development

```sh
pnpm install
pnpm run check
```

`pnpm run check` runs typecheck, build, tests, and dead-code lint.
