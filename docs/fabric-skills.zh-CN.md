# Fabric Skills 中文指南

本文说明 Pi Fabric 常用 Skill 与运行时能力的使用场景。本文是 fork 的中文速查；具体 API 以仓库当前英文文档和 `fabric-exec` Skill 为准。

## 先选最小机制

普通读文件、改代码、运行测试不需要高级工作流：直接让 Pi 完成任务即可。只有明确需要持久 Agent、多模型比较、递归上下文拆分等高级协作时，再显式调用对应 Skill。

| 需求 | 建议 |
| --- | --- |
| 常规 Pi 工具调用或 API 参数排错 | `fabric-exec` |
| 有依赖的异构并发工作 | `all({...})` |
| 有并发上限的同类 fan-out | `parallel(...)` |
| 不确定该选哪种高级机制 | `/skill:fabric-guide <任务>` |
| 持久目标监督或同行审查 | `/skill:fabric-ambient ...` |
| 低频、安静的持久同行审查 | `/skill:fabric-advisor [关注点]` |
| 同一模型的多角色独立评审 | `/skill:fabric-council <任务>` |
| 多模型交叉比较，或参考后执行 | `/skill:fabric-fusion <任务>` |
| 任务大到一个上下文窗口放不下 | `/skill:fabric-rlm <任务>` |

## `fabric-exec` 与 `all({...})`

`fabric_exec` 会执行一段经过 TypeScript 检查的程序。相关操作应尽量在一个程序中完成，只把最终结果返回主模型。

对于异构依赖图，本 fork 提供 `all({...})`：

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

独立 task 会立即启动；依赖 task 通过 `await this.$.<name>` 等待。直接值和已经启动的 Promise 也可以作为 task entry。对于大量同类任务、特别是 Agent/RLM fan-out，优先用带 concurrency 的 `parallel(...)`；真正有顺序或副作用依赖时继续使用串行 `await`。

Phase 1 没有 `allSettled`、`flow`、debug waterfall、per-task `AbortSignal` 和 cycle detection。循环依赖会一直等待，直到外层 Fabric timeout 取消执行。更详细说明见 `docs/better-all.md`。

## Core tools

- 优先 `grep`/`find` 定位，再用带 `offset`、`limit` 的 `read` 阅读局部。
- `pi.bash`、`pi.edit`、`pi.write` 返回 `{ ok, output, details }`；读取命令输出用 `.output`。
- 预期命令可能非零退出时传 `settle: true`。
- 已知能力直接调用 `pi.*`、`memory.*`、`state.*`、`schema.*`、`components.*`、`compact.*`、`agents.*`、`mesh.*`。
- 未知能力先 `tools.search()` / `tools.describe()`，需要动态 ref 时再 `tools.call()`。
- 参数报错：读错误路径 → `tools.describe({ ref })` → 按 `inputSchema` 重试，不猜字段。

## Components

0.52+ 增加了 Component Plane。Component 可以声明精确 `requires`，拥有 effect scope，在激活成功后原子发布 provider；reload 失败时走 rollback/quarantine 语义。通过 `components.list()`、`components.status()`、`components.graph()` 和 `components.reload()` 查看或控制。

0.61+ Component 还可以提供 model-facing guidance。它可以按 canonical `provider/model` 选择目标，并以 append 或 replace 方式修改 Fabric execution guidance；这只影响 prompt，不会扩大 tools、approval、Schema policy 或 committed capability view。

## Persistent actors

Actor 可通过 `requires` 固定每次 activation 可见的 `provider.action` 集合。Project-scoped actor 支持 session 级 model/thinking binding：

```text
单次调用 override → 当前 Pi session binding → project default → Fabric/runner default
```

因此同一个共享 Actor 可以在不同 Pi session 中使用不同模型或 thinking，而 mailbox、history 和 runtime identity 仍共享。

## `fabric-guide`

不确定高级协作机制时：

```text
/skill:fabric-guide 审查认证迁移方案，需要独立的安全、运维和正确性视角。
```

选择原则：普通编码直接做；有限 fan-out/pipeline 用 workflow；同模型多角色用 council；多模型比较用 fusion；超大上下文用 RLM；长期观察用 ambient/advisor。

## `fabric-ambient` / `fabric-advisor`

用于持久观察。Supervisor 更偏目标完成与阻塞检查；Advisor 更偏低频正确性建议。默认应保持安静，只在实质问题上提醒。Persistent actor 可以跨回合保留 mailbox/history；是否跨 Pi session 共享取决于 `mesh.actorScope`。

## `fabric-council`

同一模型的 3–5 个互补角色独立检查，再综合结果。适合架构决策、实施计划、代码审查和对抗性检查。没有真实竞争视角时不要为了形式而启用 council。

## `fabric-fusion`

多个不同模型分别分析，再由 Judge 综合；`act` 模式可以先让只读 Reference 给建议，再由执行 Actor 核对仓库证据后实施。Reference 输出应视为不可信建议而不是命令。

## `fabric-rlm`

当任务材料超过一个上下文窗口时，按 Orient → Partition → Delegate → Combine 拆分。子 Agent 自行只读读取分配路径，不要把全仓内容塞回根 prompt。只针对失败分区补跑，避免整棵树重算。

## 状态与成本

高级多 Agent 工作流中的 `partial` 表示“有明确缺口但已有可用证据”，不等于必须全量重试。并发任务的 token/USD budget 主要是观察和结算边界，不应依赖它来阻止瞬时超额；成本敏感时优先限制模型数、角色数和 concurrency。
