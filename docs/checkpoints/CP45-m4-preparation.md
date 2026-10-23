# CP45 — M1～M3 用户验收收尾与下一阶段准备

2026-10-23。用户反馈：“通过测试，前面的功能都已经正常，可以预备下一阶段的开发。”本检查点记录这一用户验收，以及下一阶段提案；**尚未实现 M4**。

## 已确认状态

- 远端 master：`0ef69d3dc9256dbfeea7a8bd625004a84c9525b5`。
- master tree：`c63df4eef3e333cef71ee3e02c067e9f20c8ba93`。
- 导出修复 PR [#15](https://github.com/yaelysia/RepoGraphia/pull/15) 已合并；实现 HEAD 为 `e48cdf0644067281f787f0542fc411fe2c240d0d`，与上述合并提交 tree 一致。
- 实现 PR 的 [Verify #62](https://github.com/yaelysia/RepoGraphia/actions/runs/39913332415) 及合并后 master 的 [Verify #63](https://github.com/yaelysia/RepoGraphia/actions/runs/39914395704) 均已通过。#63 在本次准备时通过 GitHub 重新核对为 `completed / success`，绑定上述 master SHA。
- 本次开始时远端没有打开的 PR；新计划的发布状态另按本分支/PR 核对。
- 用户的最新反馈作为真实使用验收记录保存。本次没有再次运行其 3 个功能/10 条映射数据，不能把用户反馈写成本轮独立复测。

CP43/CP44 的历史过程保持原样。它们中的待 CI 表述是当时状态；此处补上最终合并及验收事实，不重复实施导出修复。

## 本阶段工作

计划分支：`docs/m4-preparation`，从上述 master 建立独立工作树。只读核对 M1/M2/M3 文档、当前工作台、任务/提案与保存接口，并分别审视运行集成和降低理解成本的优先级。

新增 [工作台内的功能分析提案](../analysis-execution-plan.md)：建议以显式启动本机 Codex、可靠运行记录、自动收回待审结果和按功能阅读本批变化为 M4。复用固定任务、`revisionProtocol: 1`、Skill、已有校验与人工应用，不把执行结束等同于人工认可。

范围包含三步：M4.1 适配器与运行/收件基础；M4.2 原有暗色左右工作台闭环；M4.3 跨平台与实际使用验收。单工作区先限一项分析运行；取消、异常重开、重复收件和迟到结果都有明确验收。独立的行为变化解释、目标达成推断和真正局部增量分析保留为后续专题。

同步给产品方向补充当前交付状态，并将其早期“现有 Agent 只能追加”的描述更新为 M2 已实现任务修订的事实。M1～M3 早期规划语义与历史检查点仍保留。

## 验证与实际限制

- 本阶段仅文档变更，计划、产品方向与 CP45 的 **14 条文档相对路径**均存在；引用的任务/提案与界面入口已对照源码核实。`git diff --check` 通过。两份独立只读审查的修正已纳入，包括取消与恢复收件的顺序、receipt 的证明边界、按功能聚合已有依据与真实 CLI 尚未验证。
- 本次没有运行单元/浏览器测试，也未运行模型、目标项目或目标构建/测试；不将基线 Verify #63 当作 M4 测试。
- 官方 Codex 非交互文档已核对。当前准备环境没有发现 `codex` 可执行程序，因此 CLI 版本兼容、沙箱边界和 Windows/Linux 取消语义均列为实现阶段待验证项。
- Skill/只读文件权限不能单独证明目标代码无法执行。M4.1 必须验证实际适配器边界；不能只添加启动按钮就承诺受限分析安全完成。
- 现行 `AGENTS.md` 的默认不执行 AI 契约未改变。将来实施显式分析模式时再同步其准确边界，不能通过修改文档绕过用户或宿主权限。

## 接手顺序

1. 核对最新 master、本分支及计划 PR，确认后续是否已有实施提交。
2. 先读 `AGENTS.md`、`docs/CHECKPOINT.md`、`docs/product-direction.md`、`docs/analysis-execution-plan.md`。
3. 进入实施时从最新已合并基线创建独立实现分支，优先完成 M4.1 的能力/权限验证与运行契约；不恢复已经完成的 M1/M2/M3 工作树。
4. 每个通过的阶段更新检查点、提交并记录精确 HEAD、实际平台与结果。新能力通过 Windows/Linux 和用户流程验收后再报告完成。

核对本准备分支的命令（先保留当前本地修改）：

```sh
git fetch origin
git log -1 --oneline origin/master
git log -1 --oneline origin/docs/m4-preparation
git diff --stat origin/master...origin/docs/m4-preparation
```

本文件与计划是文档交付；计划 PR 的新 CI/合并状态另查，不能从本检查点推断 M4 已获实现验收。
