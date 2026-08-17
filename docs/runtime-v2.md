# Code Mode Runtime V2 Kernel

`pi-fabric/runtime-v2` is the standalone execution kernel for the next Code Mode runtime.

Its first stage has four responsibilities:

- execute one model-generated TypeScript program in a fresh QuickJS context;
- expose a fixed host surface: `host.read`, `host.grep`, `host.bash`, and `host.mcp`;
- expose caller-provided strings through `π` plus bounded `print` and `console` logs;
- return one structured result with cancellation, timeout, and runtime status.

The kernel has zero imports from the Fabric orchestration stack. Provider registries, approvals, agent budgets, subagents, workflows, MCP discovery, activity state, traces, dashboards, and Pi extension lifecycle stay above this boundary.

## Public API

```ts
import { CodeModeRuntimeV2 } from "pi-fabric/runtime-v2";

const runtime = new CodeModeRuntimeV2({
  read: async ({ path }) => readFile(String(path)),
  grep: async ({ pattern }) => search(String(pattern)),
  bash: async ({ command }, signal) => runCommand(String(command), signal),
  mcp: async ({ server, tool, args }, signal) => callMcp(server, tool, args, signal),
});

const result = await runtime.execute({
  code: `
const matches = await host.grep({ pattern: "CodeModeRuntimeV2" });
return { matches, label: π.label };
`,
  strings: { label: "runtime-v2" },
});
```

Each host handler receives an argument object and the execution-scoped `AbortSignal`. Missing handlers fail closed when guest code calls the capability.

## Guest surface

The stage-one guest globals are deliberately small:

```text
host.read(args)
host.grep(args)
host.bash(args)
host.mcp(args)
π.<key>
print(...values)
console.log/info/warn/error(...values)
```

Legacy guest globals such as `pi`, `tools`, `extensions`, `agents`, `workflow`, and direct `mcp` namespaces are absent from this kernel.

## Migration status

The current Lean extension keeps its established host composition while this kernel is validated as a standalone package entrypoint. A later migration can adapt Pi tools, MCP, and orchestration policies into the four host capabilities while those policies remain outside the kernel.
