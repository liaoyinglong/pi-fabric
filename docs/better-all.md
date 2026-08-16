# Dependency-aware `all({...})`

This fork adds a small guest-side dependency scheduler adapted from the MIT-licensed [`shuding/better-all`](https://github.com/shuding/better-all).

Use `all({...})` when one `fabric_exec` program has heterogeneous work with dependencies. Every independent task starts immediately. A dependent task waits for another task through `this.$.<name>`:

```ts
const result = await all({
  manifest: () => pi.read("package.json"),
  sources: () => pi.find("*.ts", "src"),
  async summary() {
    const manifest = await this.$.manifest;
    const sources = await this.$.sources;
    return { name: JSON.parse(manifest).name, sources };
  },
});
return result.summary;
```

Direct values and already-started promises are also accepted as task entries. Use `parallel(...)` instead for bounded homogeneous fan-out, especially agent/RLM work, and keep sequential `await` for true ordering or side effects.

The phase-1 adaptation intentionally does not include `allSettled`, `flow`, debug waterfall output, per-task `AbortSignal`, or cycle detection. A dependency cycle can therefore wait forever until the outer Fabric execution timeout cancels it.

On Pi Fabric 0.55+ the helper is appended after author code as a hoisted function declaration. This keeps the upstream guest source-map contract intact: submitted code still starts on wrapped line 2 and runtime/type-check diagnostics retain their original user-facing coordinates.
