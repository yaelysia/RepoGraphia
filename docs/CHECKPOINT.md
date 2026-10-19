# RepoGraphia 当前检查点

接手先读本文件、`AGENTS.md`、`docs/architecture.md`，再检查分支在本检查点之后的提交和 PR #2 状态。历史文档仅记录当时情况，不代表最新验证状态。

## CP6：规则 3 的跨平台、真实样本与产物复核完成

记录日期：2026-10-20（UTC+08:00）。本轮只完成 CP5 的验证与交付，不引入新的分析规则。

- 工作分支：`fix/r1-evidence-checkpoints`；PR #2 保持审阅，未合并 master。
- 已验证实现：`09ca6d38e1e68b8a831d69b5899676840b7dbc00`，分析规则版本 3。
- 实现 Git 树：`f8f58425639e0858fdcc34e849809dbef752c918`。
- Verify #12：`39282138269`，已完成且结论 success。CI 实际测试的合并提交为 `9398d0687cad83006400d68dce033c26ca875484`。
- 本 CP6 是随后的纯文档提交，不将它冒充为 #12 的受测 HEAD。文档 HEAD 的后续 CI 以 PR #2 最新记录为准。
- Codex-Monitor 始终只是独立只读样本，没有向其仓库提交任何修改，也未执行其应用或业务测试。

## 已核验结果

| 验证 | 实际结果 |
| --- | --- |
| Linux / Node 22.23.3 / TypeScript 5.9.3 | 92 通过，0 失败，0 跳过 |
| Windows / Node 22.23.3 / TypeScript 5.9.3 | 89 通过，0 失败，3 项既有符号链接权限测试跳过 |
| Chromium / Playwright 1.55.0 | 24 项具名检查通过，file:// 导航，无页面异常、无外部请求 |
| 固定 Codex-Monitor | 131 文件、2630 个非文件实体、12978 个显式调用点，0 编译诊断 |
| 下载后完整性复核 | 131 个文件内容哈希、2761 个节点引用、15362 条关系端点/源码区间与 HTML 内嵌数据核验通过 |

同一次 CI 在同一个样本及类型依赖目录中对照规则 2 和规则 3：12978 个调用点全部保留。未解析从 2755 变为 399，其中 2350 条仅重新识别为外部声明边界，6 条获得项目内候选目标；没有新增 bound 调用。这不是准确率提升 85% 的结论。6 条新增候选全部位于测试文件，已逐条检查其显式函数初始化依据。

完整版本、测试任务 ID、原因分布、产物哈希和复核限制见 [CP6 验证记录](checkpoints/CP6-validation.md)。CP5 历史记录的“等待 CI”已由本次核验解除。

## 接手与运行

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
node dist/cli.js query reports/codex-monitor/graph.json diagnostics
```

本地没有跟踪分支时使用 `git switch --track origin/fix/r1-evidence-checkpoints`。先保留任何未提交工作，不得使用 reset/clean 覆盖。生成页面在 `reports/codex-monitor/index.html`；目标项目已有的依赖由其自己的环境管理，分析器不会自动安装或执行它们。

严格复现 CI 使用独立副本，样本固定到 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，规则 2 工具固定到 `165532b7eb8dbb7872ef2e725a6f960df5256868`。按照 `.github/workflows/verify.yml` 和 `scripts/verify-sample.mjs` 准备类型信息；不要重置正在开发的目标工作区。

## 下一轮起点

本轮实现及验证均已完成，没有未提交功能需要从临时环境恢复。接手先检查 PR #2 是否已有后续修改或合并，避免重复开发。

剩余 399 条未解析中，224 条来自解构值、62 条来自函数参数。下一轮优先调查这两类的有限值来源追踪：先选小型正反例，再增加有界、可解释的静态规则；无法确定时仍明确停止，不按函数名或框架名称猜目标。数量大不等于都能安全解析。

动态追踪、AI 功能归纳、增量分析、多项目遍历、自动 IPC/跨语言桥接仍未启动，不属于遗失的工作。长期恢复依靠远端 Git 提交与检查点；`checkpoint-source` CI 归档仅保留 30 天。
