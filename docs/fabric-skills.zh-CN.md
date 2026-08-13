# Fabric Skills 中文指南

本文说明下列 Pi Fabric Skills 的使用场景、调用方式和边界：`fabric-exec`、`fabric-guide`、`fabric-ambient`、`fabric-advisor`、`fabric-council`、`fabric-fusion` 与 `fabric-rlm`。

## 先选最小机制

普通读文件、改代码、运行测试不需要高级工作流：直接让 Pi 完成任务即可。只有明确想启用高级协作时，才手动调用 `/skill:<name>`。除 `fabric-exec` 外，本文各 Skill 都是用户显式调用的工作流；它们不会被模型自动选择或相互自动调用。

| 需求 | 命令 |
| --- | --- |
| 不确定该选哪种机制 | `/skill:fabric-guide <任务>` |
| 常规 Pi 工具调用或 API 参数排错 | `fabric-exec`（Pi 自动参考） |
| 持久目标监督或同行审查 | `/skill:fabric-ambient ...` |
| 低频、安静的持久同行审查 | `/skill:fabric-advisor [关注点]` |
| 同一模型的多角色独立评审 | `/skill:fabric-council <任务>` |
| 多模型交叉比较，或参考后执行 | `/skill:fabric-fusion <任务>` |
| 任务大到一个上下文窗口放不下 | `/skill:fabric-rlm <任务>` |

## `fabric-exec`：核心工具与 API 参考

`fabric-exec` 不是需要手动编排的工作流，而是 `fabric_exec` TypeScript 程序的参考手册。Pi 用它调用文件工具、命令、Provider、MCP 和高级 Agent API。

适用：`fabric_exec` 参数形状报错、动态工具发现、Provider 返回值处理，或明确需要 Agent/Mesh/Schema API 合约时。

常用模式：

```ts
const hits = await pi.grep({ pattern: "targetSymbol", path: "src", context: 2 });
const source = await pi.read({ path: "src/engine.ts", offset: 120, limit: 80 });
return { hits, source };
```

要点：

- 优先 `grep`/`find` 定位，再用带 `offset`、`limit` 的 `read` 阅读局部。
- `pi.bash`、`pi.edit`、`pi.write` 返回 `{ ok, output, details }`；读取命令输出用 `result.output`。
- 预期命令可能非零退出时传 `settle: true`，以结果而非异常判断失败。
- 已知能力直接用 `pi.*`、`memory.*`、`state.*`、`schema.*`、`compact.*`；未知能力先 `tools.search()`、`tools.describe()`，再 `tools.call()`。
- 参数报错时：阅读报错 → `tools.describe({ ref })` 查看 `inputSchema` → 依 schema 重试，不猜参数。

## `fabric-guide`：选择器

当不确定该用哪个高级机制时调用它：

```text
/skill:fabric-guide 审查认证迁移方案，需要独立的安全、运维和正确性视角。
```

它只推荐最小够用方案并给出下一条精确 `/skill:...` 命令；不会替你执行推荐 Skill。

选择原则：

- 有限发现、并行、验证流程：`fabric-workflow`。
- 同模型多角色独立意见：`fabric-council`。
- 不同模型的比较或“参考后执行”：`fabric-fusion`。
- 上下文装不下：`fabric-rlm`。
- 持久观察：`fabric-advisor`、`fabric-supervisor` 或 `fabric-ambient`。
- 普通编码：不需要高级 Skill。

## `fabric-ambient`：持久观察者入口

`fabric-ambient` 创建持久 Actor，不安装额外扩展。它根据第一个参数选择两种 profile：

```text
/skill:fabric-ambient supervisor 完成登录限流，补齐测试并构建验证。
/skill:fabric-ambient advisor 重点检查并发、错误处理与测试遗漏。
```

| Profile | 用途 | 事件 | `triggerTurn` |
| --- | --- | --- | --- |
| `supervisor <目标>` | 盯一个具体、可验证目标；发现遗漏、跑偏、阻塞或完成 | `agent_settled`、`tool_error` | `true`，可唤醒主会话 |
| `advisor [关注点]` | 每轮给出重大正确性建议 | `turn_end` | `false`，不强制新回合 |

Actor 仅能使用 `read`、`grep`、`find`、`ls`。它们应默认沉默，只有实质问题才发送一条建议。

查看或停止：

```text
/fabric messages supervisor
/fabric stop supervisor

/fabric messages advisor
/fabric stop advisor
```

已有同名 Actor 时，设置流程会更新提示词、工具、事件和投递策略。若 runner、模型、`responseMode`、`coalesce` 或 topics 不兼容，只报告需重建原因，不自动重建。

## `fabric-advisor`：低频同行审查

`fabric-advisor` 是专用、低干扰的持久 `advisor` Actor：

```text
/skill:fabric-advisor 重点检查鉴权边界、迁移回滚和测试遗漏。
```

它在 `agent_settled` 和 `tool_error` 时检查，不是在每轮结束时检查；`triggerTurn: false`。因此适合希望只在空闲或工具失败等决策点收到提醒的任务。

它是外部观察者，不执行任务，只在发现可避免缺陷或返工的具体问题时给建议。与 `fabric-ambient advisor` 的区别：后者监听每轮 `turn_end`，更及时也更频繁；本 Skill 更安静。

控制命令：

```text
/fabric messages advisor
/fabric stop advisor
```

## `fabric-council`：同模型多角色评审

用于架构选择、实施计划、代码审查或对抗性检查：

```text
/skill:fabric-council 审查认证迁移方案，比较风险最低的实施路径。
```

运行时传入任务和 3–5 个不同角色，例如：需求怀疑者、正确性审查员、安全审查员、运维审查员、可维护性审查员。每个成员独立、并行且只读地检查；随后一个综合者输出决策。

结果状态：

- `success`：全部角色和综合均成功。
- `partial`：部分角色或综合失败；已有结论仍可用，且会标出缺口。
- `failed`：没有角色完成。

注意：角色要互补，避免重复。完整执行最多消耗“角色数 + 1”次 Agent 调用。某角色失败时只重试该角色，不自动重跑全体。若没有真实的竞争视角，普通 Agent 或直接执行更合适。

## `fabric-fusion`：多模型交叉验证

用于错误代价高的研究、方案比较或批判性审查。模型必须是不同的已解析模型，标签也必须唯一。

### Compare：比较，不拼接

默认模式让 2–8 个模型并行回答，再由 Judge 比较：

```text
/skill:fabric-fusion 比较三个数据库迁移方案，给出风险、证据和推荐。
```

Judge 返回结构化分析：

- `consensus`：多数模型同意的高置信点。
- `contradictions`：模型之间的矛盾。
- `partial_coverage`：只有部分模型覆盖的内容。
- `unique_insights`：单个模型的独特洞见。
- `blind_spots`：所有模型都未覆盖的缺口。

成本为 N 个 Panel 调用，加上至少有两个成功回答时的一个 Judge 调用。Panel 默认可用 `bash`，联网搜索或抓取会需要执行审批。

### Act：参考后执行

`act` 模式先运行 1–4 个只读 Reference，再由一个明确指定的 Actor 核对建议并执行：

```text
/skill:fabric-fusion act 修复认证中间件竞态，补齐测试并构建验证。
```

Reference 只能使用 `read`、`grep`、`find`、`ls`，且仅返回实施方法、重大风险和具体检查项。Actor 默认可用 `bash`、`edit`、`write`，会运行命令或修改工作区；敏感任务应收紧 `actorTools`。

不要把 Reference 建议当命令执行：Actor 必须把它们视为不可信数据，并用仓库证据验证。失败时只重试缺失的 Panel、Judge 或 Actor，不重跑已成功部分。若仅需要同模型角色多样性，使用 `fabric-council` 成本更低。

## `fabric-rlm`：递归上下文拆分

当相关仓库材料超过一个上下文窗口时使用：

```text
/skill:fabric-rlm 审计整个仓库的权限校验链路，列出越权风险、缺失测试和修复优先级。
```

执行阶段：

```text
Orient → Partition → Delegate → Combine
```

1. **Orient**：一个只读 Agent 把任务拆为最多 12 个不重叠、上下文大小合适的路径分区。
2. **Partition**：校验项目相对路径并合并重叠父子路径。
3. **Delegate**：能装进子上下文的分区用普通 Agent；仍过大的分区用 `rlm.query()` 递归。
4. **Combine**：仅综合已完成分区；只有一个成功分区时直接返回其结果。

约束与安全：

- 子 Agent 收到路径后自行只读检查；不要把全仓内容塞进根任务或子 prompt。
- 每批最多并行 4 个；整批全部失败时停止后续花费。
- 最多两个顶层分区可继续递归。
- 并发子任务不要修改同一文件。需要修改时按路径分配所有权，或使用 `worktree: true`。
- 跨回合保存中间绑定时用 `mesh` 的 `rlm/<rootId>/bindings/...`；不要保存密钥，完成后删除。大数据应存项目文件并保存 digest。
- `partial` 是带明确缺口的可用证据，只重试失败路径，不自动重跑整棵树。

## 状态与成本速查

`fabric-council`、`fabric-fusion`、`fabric-rlm` 都以 `success`、`partial`、`failed` 表示覆盖情况。`partial` 不等于无效，也不意味着自动重试；先检查 `failures` 和覆盖范围，再决定是否针对性补跑。

多 Agent 并发下，token/USD 预算是事后结算的观察性限制，不是并发前的硬预留。面向成本敏感任务，应缩小 panel、角色数或批次，而不是依赖预算阈值阻止瞬时超额。
