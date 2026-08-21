# AGENTS.md

## Golden rule: build when done

Always finish a change with a fresh build before handing it back:

```sh
pnpm run build
```

Pi loads and publishes the compiled bundle in `dist/` — not `src/`. Tests run
against `src/`, so green tests alone are not enough: without a build the
change is invisible in the TUI and unpublished. Rebuild so the user can
verify immediately.

## Discovery contract

When changing Fabric's model-facing discovery surface, keep runtime behavior,
TypeScript guest declarations, `fabric_exec` prompt guidance, the packaged
`skills/fabric-exec` reference, and user docs aligned.

The default discovery path is progressive: broad `tools.list()` / `tools.search()`
results stay schema-light, then `tools.describe({ ref })` fetches full schemas
only for selected refs. Do not reintroduce bulk schemas into the default path;
`includeSchemas: true` is an explicit high-cost compatibility escape hatch.

## Before committing

```sh
pnpm run check
```

This runs typecheck, build, the full test suite, and dead-code lint. Keep it
green; a build alone is not completion.

## Commits

Use conventional commits (commitlint): `feat(scope): ...`, `fix(scope): ...`,
`chore(release): <version>` for version bumps.
