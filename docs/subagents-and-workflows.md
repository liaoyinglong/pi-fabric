# Pi Fabric 子代理与工作流：Main 自主调度

Lean V2 的目标不是让用户先配置一组固定角色，再在聊天里手动指定 `research`、`review` 等 profile。

新的模型是：**Main Agent 自己决定是否需要委派，并在每次委派时临时定义角色、任务边界、执行档位和能力权限。**

```text
用户任务
   |
   v
Main Agent
   |
   |-- 简单、强耦合任务 ------------------> Main 自己完成
   |
   `-- 值得隔离 / 并行 / 降成本 / 独立验证
          |
          |  Main 临时定义 role + instructions
          |  Main 选择 tier
          |  Main 选择 policy
          v
      agents.run / spawn / recurse
          |
          v
      bounded child result
          |
          v
      Main 综合、决策、集成
```

## 1. Main 负责什么

Main 在调用子代理前自主决定四件事：

1. **是否值得委派**：并不是任务一复杂就必须拆。
2. **临时角色**：例如 repository scout、API verifier、test analyst、focused implementer、architecture critic。
3. **执行 tier**：`fast`、`balance`、`strong`。
4. **能力 policy**：`inspect`、`execute`、`modify`、`isolated`。

角色不是配置项，也不决定模型或工具权限。它只描述当前子任务的职责和输出边界。

## 2. 第一版的三个 tier

第一版默认三档都走 Pi，模型按能力/成本逐级提升：

```text
fast     -> gpt-5.6-luna
balance  -> gpt-5.6-terra
strong   -> gpt-5.6-sol
```

三档默认都使用 `medium` thinking。AGY / Droid 继续保留为可覆盖的 CLI runner，但不再属于默认 tier 映射。

### `fast`

适合：

- 搜索代码位置；
- 收集证据；
- 阅读少量相关文件；
- 重复性检查；
- 很明确、不需要架构判断的调研。

默认：

```text
runner: pi
model: cliproxyapi/gpt-5.6-luna
thinking: medium
```

Main 应该优先把机械式、边界清楚的工作交给 `fast`，而不是让主模型或强模型浪费上下文与成本。

### `balance`

适合：

- 常规 debugging；
- 普通实现任务；
- 根据已有证据进行分析；
- 跑测试并判断结果；
- 中等复杂度验证。

默认：

```text
runner: pi
model: cliproxyapi/gpt-5.6-terra
thinking: medium
```

这是常规子任务的默认档位。

### `strong`

适合：

- 模糊、难定位的 bug；
- 架构和高影响决策；
- 多种解释都合理的复杂问题；
- 对 Main 的结论做真正独立的强审查；
- `fast` / `balance` 已经无法可靠解决的任务。

默认：

```text
runner: pi
model: cliproxyapi/gpt-5.6-sol
thinking: medium
```

原则不是“重要任务全部 strong”，而是：**先用能够可靠完成任务的最低档位，证据不足或任务确实更难时再升级。**

## 3. policy：角色和权限彻底分开

第一版提供四个默认 policy。

### `inspect`

```text
read, grep, find, ls
```

只读。适合 research、repo exploration、review、证据收集。

### `execute`

```text
read, grep, find, ls, bash
```

可以跑测试、build、诊断命令，但不能 edit/write。

### `modify`

```text
read, grep, find, ls, bash, edit, write
worktree: false
```

用于在当前 workspace 做范围明确的实现。

### `isolated`

```text
read, grep, find, ls, bash, edit, write
worktree: true
```

用于实验性修改、并行修改，或者不希望污染 Main 当前 workspace 的任务。

这里有一个重要规则：**policy 是能力边界，role 不是。**

即使 Main 把一个 child 命名为 `implementer`，只要它选择的是 `inspect`，child 仍然没有写文件的能力。

## 4. Main 如何动态定义子代理

### 快速代码探查

```ts
const evidence = await agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "只返回相关文件、调用链和关键证据，不要讨论无关架构。",
  task: "定位 reconnect backoff 的实现。",
});
return evidence;
```

### 常规实现

```ts
return agents.run({
  tier: "balance",
  policy: "modify",
  role: "focused implementer",
  instructions: "保持 patch 最小，只修改任务必要文件，并运行直接相关测试。",
  task: "修复 Main 已定位的 retry timer leak。",
});
```

### 独立强审查

```ts
return agents.run({
  tier: "strong",
  policy: "inspect",
  role: "independent reviewer",
  instructions: "不要默认 Main 的方案正确。只报告有证据支持的 regression、遗漏和 residual risk。",
  task: "独立审查当前 diff。",
});
```

## 5. Main 什么时候应该主动委派

默认 policy 建议 Main 在这些情况下主动使用 subagent：

- **保护 Main context**：需要读很多文件、长日志、大量 grep 结果；
- **天然并行**：多个模块/资料源彼此独立；
- **成本优化**：低智力要求的 bounded work 可以用 `fast`；
- **独立验证**：关键实现或判断值得让另一个上下文重新审查；
- **隔离 mutation**：实验或并行修改适合独立 worktree。

反过来，以下情况不值得为了“用了 subagent”而拆：

- 任务很小；
- 下一步高度依赖刚刚得到的结果；
- Main 已经掌握全部必要上下文；
- 拆分后同步和整合成本高于收益。

## 6. 工作流由 Main 决定，而不是另一个 planner

Workflow 只是 TypeScript 编排工具，不是第二个调度大脑。

Main 先决定每个 worker 的 role / tier / policy，再用普通 `Promise.all` 或 workflow helper 组合。

```ts
const findings = await parallel(
  ["auth", "routing", "cache"].map((topic) => () =>
    agent(`Inspect ${topic} and return bounded evidence.`, {
      tier: "fast",
      policy: "inspect",
      role: `${topic} repository scout`,
      label: `inspect ${topic}`,
    })
  ),
  { concurrency: 3 },
);

return agent(
  `独立验证这些 findings，删除没有证据支持的结论：\n${JSON.stringify(findings)}`,
  {
    tier: "strong",
    policy: "inspect",
    role: "independent reviewer",
    label: "verify",
  },
);
```

简单 fan-out 优先直接使用：

```ts
const [docs, code] = await Promise.all([
  agents.run({
    tier: "fast",
    policy: "inspect",
    role: "upstream researcher",
    task: "检查 upstream contract。",
  }),
  agents.run({
    tier: "fast",
    policy: "inspect",
    role: "repository scout",
    task: "定位本地实现。",
  }),
]);
return { docs, code };
```

## 7. 并发规则

Main 可以并发：

- 不同模块的只读 exploration；
- 多个资料源 research；
- 独立测试/验证；
- 已明确分区的工作。

Main 不应该并发：

- 有前后依赖的步骤；
- 多个 `modify` worker 同时改相同文件；
- 一个 worker 的输出决定另一个 worker 的任务内容。

如果确实需要并行 mutation，应优先使用 `isolated`，或者明确划分文件 ownership。

## 8. 子代理默认输出 policy

每个 child 都会自动获得这些默认要求：

- 返回**压缩后的结果**，不要返回完整 tool transcript；
- 相关时提供具体证据、changed files、验证结果；
- 明确说明 uncertainty、缺失证据或 blocker；
- 不要自行扩大任务范围；
- Main 负责最终 synthesis 和 decision。

这正是 subagent 与直接开一个完整 pane/CLI 的主要区别：Main 应该收到的是 bounded result，而不是重新阅读 child 的所有过程输出。

## 9. 配置覆盖

即使完全没有 `subagents.yaml`，默认 tier/policy 也能直接工作。

全局覆盖：

```text
~/.pi/agent/fabric/subagents.yaml
```

项目覆盖：

```text
.pi/fabric/subagents.yaml
```

项目配置只在 trusted project 中加载。

示例：

```yaml
tiers:
  fast:
    runner: pi
    model: cliproxyapi/gpt-5.6-luna
    thinking: medium

  balance:
    runner: pi
    model: cliproxyapi/gpt-5.6-terra
    thinking: medium

  strong:
    runner: pi
    model: cliproxyapi/gpt-5.6-sol
    thinking: medium

policies:
  inspect:
    tools: [read, grep, find, ls]

  execute:
    tools: [read, grep, find, ls, bash]

  modify:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: false

  isolated:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: true
```

这里只支持 `tiers:` 和 `policies:`。**不兼容旧 `roles:` / profile 配置。**

Tier 可以覆盖 runner、CLI adapter、transport、model、thinking、timeout、extensions 和 tier instructions；policy 可以覆盖 tools、worktree、description 和 policy instructions。

例如，你仍然可以把某个 tier 覆盖到 AGY：

```yaml
tiers:
  fast:
    runner: cli
    cli: agy
    thinking: low
```

需要查看当前语义配置时：

```ts
return agents.routing({});
```

Main 正常工作时不需要每次先 discover routing。

## 10. 递归委派

只有一个 child context 仍然明显不足时，才使用：

```ts
return agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "拆解这个跨模块问题，必要时继续委派 bounded evidence gathering，最后返回验证后的结论。",
});
```

选择的 tier 必须最终解析为 Pi runner。默认情况下 `fast`、`balance`、`strong` 三档都可以 recurse；如果某个 tier 被覆盖成 CLI runner，它仍然只能 one-shot。

递归仍受这些限制：

- `agents.maxDepth`；
- 每次 `fabric_exec` 的 agent call ceiling；
- child timeout / token limit；
- `agents.budgetUsd`；
- 当前 policy 的工具和 worktree 权限。

普通任务优先 `run` / `spawn`，不要把 recursion 当作默认编排方式。

## 11. 最终心智模型

最简单的理解是：

```text
Main = planner + router + synthesizer
Tier = 成本 / 智力档位
Policy = 能力权限边界
Role = Main 临时创建的任务身份
Workflow = 纯编排工具
Subagent = bounded worker
```

这样我们不需要提前猜未来会有哪些角色，也不需要维护越来越大的 `research/explore/review/tester/...` 配置目录。Main 根据当前任务动态定义角色，而真正需要稳定配置的只有少量 tier 与 policy。
