# RepoGraphia 当前检查点

接手先读本文件、AGENTS.md、docs/architecture.md，再检查本记录之后的分支提交和 PR #2 状态。不要重建已完成的实现。

## CP4：未解析调用分类与边界修正，已开始

- 分支：`fix/r1-evidence-checkpoints`；继续既有 PR #2，不改 Codex-Monitor。
- 本轮起点：`165532b7eb8dbb7872ef2e725a6f960df5256868`。PR #2 已核实仍开放、非草稿、尚未合并；master 为 `3987fb218bdcff4973329c0d13fcc1ea9a341b52`。
- 前轮完成记录：`docs/checkpoints/CP3-validation.md`；完整旧接手入口保存在上述起点提交。Verify #10 验证过该起点，不是本轮后续改动的验证。

## 已完成的本轮调查

从 Verify #9 的精确源码归档恢复工作副本，并校验 ZIP SHA-256：`e98a3db9842e9d76e27d6f75c2a3e130fa1d64f675ddf83ecdb8dc849a41dcb4`。已有样本 graph.json 使用 TypeScript 5.9.3 / analysisRevision 2。

程序统计固定 Codex-Monitor 的 2755 个未解析显式调用点：2663 条为 `unknown-callable-value`，92 条为 `no-project-target`。其中包含 Map/Set/Error 等可由标准库声明定位的边界，也包含参数、解构值、函数返回值以及仓库内 .d.mts 声明对应的未索引实现。不能把这些类别混成“模型不理解”。这些是旧产物的计数，不是新规则解析结果。

## 本轮实施顺序

1. 建立结构化未解析原因及有界诊断查询；旧图缺少原因时明确显示未分类，不反推旧证据。
2. 正反例验证外部声明边界：直接绑定外部声明不误当未知；本地同名遮蔽、参数、可变别名不能被升级。
3. 对对象/类字段显式函数初始化提供候选声明，不推断完整运行时值流；未能证实的类别继续保留。
4. 将分类和可点击源码示例展示在离线页面，复用程序诊断逻辑。
5. 锁定版本 Windows/Linux CI、固定样本、浏览器检查全部完成后保存 CP5/CP6 和交付产物。

## 环境和验证边界

当前容器实际测试 DNS：GitHub/npm 域名不能解析。现有 Node 为 22.16.0，预装 TypeScript 为 5.8.3；使用它只能辅助验证，最终以 npm ci 锁定 5.9.3 的 CI 为准。此 CP4 提交只更新接手记录，尚无本轮新增应用代码或测试结果。

## 接手命令

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci --ignore-scripts
npm test
```

有未提交工作时先保留，不得 reset/clean。严格样本复现使用独立副本，固定到 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，按 scripts/verify-sample.mjs 和 CI 配置执行；不得运行样本应用或业务测试。

动态分析、AI 功能图、增量分析、多 tsconfig 自动遍历和自动 IPC 桥接仍未启动。当前工作不扩大到这些方向。所有实际修复须配正反例并记录证据边界，不能把统计数量改进当成准确率。
