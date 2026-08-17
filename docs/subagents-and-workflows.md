# Pi Fabric 子代理（Subagents）与工作流（Workflows）使用指南

在 Pi Fabric Lean V2 中，Subagent 委派与 Workflow 编排不再是独立的 CLI 命令或重量级的后台常驻服务，而是作为 **Lean Code Mode (`fabric_exec`)** 环境中的 TypeScript 原生 API 运行。

本文档详细说明 Subagents 与 Workflows 的实际运行机制、在对话中如何触发（包括**模型自主触发**与**用户显式提示触发**）、生命周期与常用使用模式。

---

## 1. 运行机制概述

当在 Pi 中加载 Pi Fabric 扩展后，主 Agent（Main LLM）拥有 Code Mode 能力，并默认加载 `fabric-subagents` 与 `fabric-workflow` 技能。

```text
               ┌─────────────────────────────────┐
               │         用户在对话中发送任务     │
               └────────────────┬────────────────┘
                                │
                                ▼
               ┌─────────────────────────────────┐
               │    Pi 主 Agent (Main LLM)       │
               └────────────────┬────────────────┘
                                │ 编写 TypeScript 并调用 `fabric_exec`
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ fabric_exec 运行时环境 (QuickJS / Node)                      │
 │                                                             │
 │   // 子代理 (Subagents)                                     │
 │   await agents.run({ profile: "research", task: "..." })    │
 │   await agents.spawn({ profile: "review", task: "..." })   │
 │   await agents.recurse({ profile: "deep", task: "..." })   │
 │                                                             │
 │   // 工作流 (Workflows)                                     │
 │   await Promise.all([...])                                  │
 │   await parallel(items.map(...), { concurrency: 3 })        │
 │   await pipeline(steps)                                     │
 └──────────────────────────────┬──────────────────────────────┘
                                │ 返回提炼后的精简结果
                                ▼
               ┌─────────────────────────────────┐
               │    主 Agent 回复给用户           │
               └─────────────────────────────────┘
```

---

## 2. 触发机制：何时与如何触发？

### 一、模型自主触发（Autonomous Delegation）

主 Agent（Main LLM）在加载技能后，会根据以下场景**自动决策**何时发起子代理或工作流，无需用户手动编写调用代码：

1. **上下文保护与证据收集（Context Preservation）**：
   * **痛点**：若在主对话中连续读取数十个文件、大规模 grep 或长日志，会导致上下文急剧膨胀，破坏主模型的逻辑推理能力。
   * **自主行为**：主 Agent 会自动派出 `research` 或 `explore` profile 的子代理在独立的子上下文里阅读、检索与过滤，仅返回提炼后的结论给主 Agent。

2. **异构模型路由与成本优化（Cost & Capability Efficiency）**：
   * **痛点**：使用昂贵的高思考模型做简单的文件扫视或日志检索很不划算，而轻量模型又难以处理复杂的架构决策。
   * **自主行为**：主 Agent 可以把机械式检索派发给 `runner: cli` 的轻量 profile，例如 `cli: agy`，也可以把复杂逻辑交给高 thinking 的 Pi profile；路由策略全部放在 profile 配置中。

3. **独立审查与双盲验证（Independent Verification）**：
   * **痛点**：同一个 LLM 在刚写完一段复杂代码后，进行自我审查时容易产生确认偏误（Confirmation Bias）。
   * **自主行为**：主 Agent 在完成关键重构或修复后，可唤起 `review` profile，例如通过 `cli: droid` 在独立进程中重新审阅 diff。

4. **多模块并发探查（Multi-Domain Parallel Exploration）**：
   * **痛点**：需要同时调研多个不相关的子模块（如 `auth/`、`database/`、`router/`）时，串行处理耗时较长。
   * **自主行为**：主 Agent 自动编写 `parallel(...)` 或 `Promise.all(...)` 脚本，并发派发多个探查任务。

5. **深度递归解题（Recursive Decomposition）**：
   * **痛点**：复杂的大型跨系统重构需要多层级的规划、分发与验证。
   * **自主行为**：主 Agent 自动调用 `agents.recurse({ profile: "deep", task: "..." })`，赋予子 Pi 实例继续使用 Code Mode 并二次分发的能力。

---

### 二、对话中显式触发（User-Prompted Triggering）

用户可以直接在日常自然语言对话中指示 Pi 调用指定的 profile 或执行并发工作流：

#### 1. 指定 Profile 进行委派

* **调研与资料检索（Research / Exploration）**：
  > “用 research profile 查一下 upstream 仓库关于 connection retry 的改动和文档说明，只要结论。”  
  > “使用 explore profile 快速梳理一下 `src/router` 的入口和导出方法。”

* **独立代码审查（Independent Code Review）**：
  > “修复 session 管理中的竞态条件，并在完成前使用 review profile 独立审查 diff。”

* **深度推理与决策（Deep Reasoning）**：
  > “用 deep profile 评估一下当前 schema 迁移到 PostgreSQL 的风险与步骤。”

#### 2. 触发并发工作流（Workflow Fan-Out）

* **多模块并发检查**：
  > “并发排查 `src/auth`、`src/billing` 和 `src/notifications` 中是否有遗留的废弃 user ID 引用。”  
  > “跑一个工作流并发测试这 5 个外部 API 的联通性，汇总失败的端点。”

* **分阶段流水线（Pipeline / Phased）**：
  > “建立一个流水线：第一步提取所有数据库 migration 脚本，第二步校验语法，第三步检查是否缺少 rollback 逻辑。”

#### 3. 隔离环境（Worktree）

* **安全无污染修改**：
  > “在独立的 git worktree 中让 subagent 尝试将打包工具迁移到 Vite，不要影响当前工作区。”

---

## 3. Profiles 配置与语义角色

Subagents 的配置位于 `subagents.yaml`（全局位于 `~/.pi/agent/fabric/subagents.yaml`，项目级位于 `.pi/fabric/subagents.yaml`）。

### 常用 Profiles 角色说明

| Profile 角色 | 典型 Runner | 思考等级 (Thinking) | 可用工具 | 适用场景 |
|---|---|---|---|---|
| `research` | `cli: agy` / `pi` | `low` | `[read, grep, find, ls]` | 低成本收集证据、查阅资料、回答定点问题 |
| `explore` | `pi` | `low` | `[read, grep, find, ls]` | 探索项目代码结构、定位实现位置与依赖关系 |
| `deep` | `pi` | `high` | 全部工具 | 疑难 Bug 分析、架构重构设计、递归解题 |
| `review` | `cli: droid` / `pi` | `high` | `[read, grep, find, ls]` | 对 diff 进行独立审阅与代码安全检查 |

例如：

```yaml
roles:
  research:
    runner: cli
    cli: agy
    thinking: low
    tools: [read, grep, find, ls]

  review:
    runner: cli
    cli: droid
    thinking: high
    tools: [read, grep, find, ls]

  deep:
    runner: pi
    thinking: high
```

`runner: cli` 是一个通用适配入口，第一版内置 `agy` 与 `droid` 两个 adapter。Fabric 直接调用对应 CLI，不再要求安装 Veda。后续支持新的 headless CLI 时，应新增 adapter，而不是向 AgentManager/worker 再添加一套 runner 分支。

CLI adapters 当前是 one-shot：不支持 `agents.recurse`、steer/follow-up 或 Fabric 主动 compact。递归 profile 必须使用 `runner: pi`。

在对话中随时查询当前可用的 Profiles：

```ts
const catalog = await agents.profiles({});
return catalog.profiles;
```

---

## 4. 对话与 TUI 交互体验

当 Subagent 或 Workflow 在执行时，Pi 的 TUI 界面会呈现如下生命周期：

1. **`fabric_exec` 卡片预览**：
   * 折叠状态下默认显示前 8 行 TypeScript 调度脚本；
   * 在 TUI 中按 `Ctrl+O` 可展开查看完整的调度与逻辑代码。

2. **实时子任务进度**：
   * 界面会实时显示当前正在执行的子代理 headline（例如 `agents.run [research]`、`pi.grep` 等）；
   * 并发执行时会清晰呈现每个 worker 的并发进度。

3. **结果精简聚合**：
   * 子代理执行完成后，最终结果或结构化数据返回给主 Agent；
   * 主 Agent 结合结果直接回答用户，保持主对话的历史记录干净清爽，避免大量零散的 tool step 污染主聊天窗口。

---

## 5. 常用 TypeScript 调度代码范式

### 同步调用单个子代理
```ts
const docs = await agents.run({
  profile: "research",
  task: "查阅 upstream 文档中关于重试退避算法的配置规范。",
});
return docs;
```

### 并发工作流（Parallel Fan-Out）
```ts
const findings = await parallel(
  ["auth", "router", "models"].map((area) => () =>
    agent(`审查 ${area} 目录下是否存在硬编码密钥。`, {
      profile: "explore",
      label: `audit ${area}`,
    })
  ),
  { concurrency: 3 },
);
return findings;
```

### 递归任务分解（Recursive Delegation）
```ts
return await agents.recurse({
  profile: "deep",
  task: "对这个跨进程内存泄露问题进行分层排查，按需分发子探查任务并返回修复方案。",
});
```
