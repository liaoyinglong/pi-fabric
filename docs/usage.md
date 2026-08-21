# Usage

Lean Fabric exposes one Pi tool: `fabric_exec`.

Use it when related tool calls benefit from one TypeScript program with local variables, branching, loops, parallel calls, or a compact returned value. Keep simple direct work simple.

## Core tools

```ts
const hits = await pi.grep({ pattern: "createSession", path: "src", context: 2 });
const source = await pi.read({ path: "src/session.ts", offset: 1, limit: 160 });
return { hits, source };
```

`pi.read`, `pi.grep`, `pi.find`, and `pi.ls` resolve to strings. `pi.bash`, `pi.edit`, and `pi.write` resolve to envelopes with `ok`, `output`, and `details`. Shell execution is `pi.bash`; there is no `pi.exec`.

## Parallel work

Use sequential `await` when one operation depends on another. Use `Promise.all` for independent operations:

```ts
const [routes, auth] = await Promise.all([
  pi.grep({ pattern: "route", path: "src" }),
  pi.grep({ pattern: "auth", path: "src" }),
]);
return { routes, auth };
```

Fabric does not add a scheduling DSL.

## Captured extension tools

Captured Pi extension tools are available as `extensions.<tool>`:

```ts
return extensions.project_status({ verbose: false });
```

Exact-name core overrides remain on the `pi.*` surface. Fabric preserves their authored prompt snippet/guidelines even though the original registered tool is hidden from the model.

## MCP

Known MCP tools use generated namespaces:

```ts
return mcp.github.get_repo({ owner: "acme", repo: "app" });
```

For unknown or computed refs, discovery is progressive by default:

```ts
const matches = await tools.search({ query: "repository issue", limit: 10 });
const descriptor = await tools.describe({ ref: matches[0].ref });
return {
  candidate: matches[0],
  schema: descriptor.inputSchema,
};
```

`tools.list()` and `tools.search()` return lightweight summaries and omit schemas. Choose the smallest relevant candidate set, then call `tools.describe({ ref })` only for the refs whose argument shape you actually need.

Use `includeSchemas: true` only for genuine bulk-schema tasks:

```ts
const full = await tools.list({ provider: "mcp", includeSchemas: true });
```

That path is intentionally explicit because it can produce large discovery payloads. Use `tools.call({ ref, args })` only when a direct namespace call is not practical.

## Skills

Pi's model-visible skill catalog remains available in Lean mode even though native `read` is hidden. When a task matches a skill, load its `SKILL.md` through `pi.read` inside `fabric_exec` and follow it. The packaged `fabric-exec` skill is an on-demand reference, not a workflow engine.

## String inputs

Pass multiline or syntax-heavy data with the top-level `strings` field and access it through `π`:

```ts
const text = π.payload;
return text.length;
```

## Progress and logs

`tools.progress({ message: "Checking routes" })` updates execution progress. `print()` and `console.log()` write bounded diagnostics. The program's `return` value is the result sent back to the model.

A long explicit `pi.bash` timeout can raise the enclosing execution deadline enough for that shell call. Generic provider calls do not receive a special orchestration timeout floor.
