# RepoGraphia 当前检查点

## CP12：项目级代码地图第一版已完成并通过验证

记录日期：2026-10-20。分支 `feat/project-map-r1`，PR #3。先读 `AGENTS.md`、`docs/architecture.md`、`docs/project-map.md`，再核对本分支后续提交及 PR 状态。

本轮以 CP9 `3e70ed49d3e79414d7274f824552a3883661b6f8` 为起点；PR #3 当前基线是 PR #2 的 `fix/r1-evidence-checkpoints`，不是 master。PR #2 尚未合并，本阶段没有改写它或 master。#2 合并后需要将 #3 改向 master 并重新核验，不能直接把新地图合入旧功能分支当成发布完成。

## 精确验证版本

- CP10 计划：`c7635d1cb612efc2c278eb3dc3815e2dba67f92c`。
- CP11 投影与 CLI：`e24317fa4bae3b4e3f5bac83ffddbfaf5d5a9963`，Verify #17 成功。
- CP12 完整实现：`2027bf34f4cb15cc9799038a50e83470985e07b7`。
- 完整实现 Git tree：`57e760d2fc938960f3ae350156321571606a88f0`。
- Verify #18：`39366761921`，Linux、Windows、固定真实样本三个 job 均成功。
- CI 实际测试的 PR 合并提交：`fc650164309ccf06d951e681043ca31db653f9bc`。

本检查点及 README/架构说明是随后添加的纯文档收尾，不冒充上述 CI 的受测 HEAD。最终文档提交的 CI 另记在 PR #3 中，避免为了记录最后一个 SHA 不断递归修改检查点。

## 已交付能力

新报告默认显示项目目录地图，支持目录逐层钻取、文件/函数/源码证据跳转、面包屑及返回上次目录。点击有向聚合连接可按每页 25 条审阅原始关系，返回保持原聚合选择和页码。

`src/project-map.ts` 为浏览器和 CLI 共用的纯投影工厂。它保留关系类型/状态/仅类型标记，以及组内、范围外、无目标、缺失端点、隐藏测试和预算边界。同一关系多个候选落到同组时不重复计数；跨组/跨类别计数不可直接相加。目录名是路径分组，不是功能语义推断。

分析规则仍为 4，CodeGraph schema 仍为 1；新增投影版本 1。未引入 AI、运行时追踪、Git 变更或增量分析。Codex-Monitor 仅作独立只读样本，没有修改或运行其应用/业务测试。

## 已实际完成的验证

| 检查 | 结果 |
| --- | --- |
| 锁定 TS 5.9.3 / Node 22.23.3 / Linux | 163 通过，0 失败，0 跳过 |
| 锁定 TS 5.9.3 / Node 22.23.3 / Windows | 160 通过，0 失败；3 项既有符号链接权限测试跳过 |
| 原有 Chromium 交互 | 30 项通过，实际 file:// 导航 |
| 新项目地图 Chromium 交互 | 24 项通过，实际 file:// 导航 |
| 固定样本与 CP9 同输入对照 | files/nodes/relations/coverage/diagnostics 全部一致 |

新增 32 项测试为 28 个独立聚合/CLI 正反例和 4 个手写源码矩阵测试；它们不是多个真实项目的全局准确率评测。两套浏览器检查均无页面异常、无外部请求。完整任务 ID、产物哈希及复核记录见 [CP12 验证记录](checkpoints/CP12-validation.md)。

本地辅助结果另记：Node 22.16.0 / TS 5.8.3，163/163；Playwright 1.57.0 / 系统 Chromium，set-content 模式的 24+30 检查通过。本地 file:// 被宿主策略阻止，不以辅助结果替代上述锁定 CI。

## 运行和接手

```sh
git fetch origin
git switch feat/project-map-r1
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
```

本地没有跟踪分支时用 `git switch --track origin/feat/project-map-r1`。保留未提交工作，不得使用 reset/clean 覆盖。浏览器打开 `reports/codex-monitor/index.html`。

```sh
node dist/cli.js query reports/codex-monitor/graph.json map
node dist/cli.js query reports/codex-monitor/graph.json map src --kind import
node dist/cli.js query reports/codex-monitor/graph.json map-records . --from electron --to src --limit 25
```

严格复现使用独立样本目录，固定 Codex-Monitor 到 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，按照 `.github/workflows/verify.yml` 准备类型信息；不要重置用户正在开发的样本工作区。

## 后续开发起点

本轮产品实现与验证已完成，全部代码已保存远端，不依赖临时容器恢复。首先检查 PR #2/#3 的审阅与合并状态，避免重复开发。

下一阶段围绕功能层映射定义证据模型和验收：功能与代码多对多关联、可追溯依据、不确定映射、人工纠正及快照失效规则。先做有限实例验证，不能直接给目录加业务名称当成已完成的功能理解。独立静态评测仍需扩充到更多项目。

地图布局当前为确定性环形/网格，尚无自由拖拽或语义布局；动态追踪、AI 自动归纳、Git Diff、Agent 任务交互、增量索引仍未实现。长期恢复依靠 Git 提交和文档，源码 CI 归档仅保留 30 天。
