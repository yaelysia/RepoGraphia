# RepoGraphia 当前检查点

## CP22：合并前审查与主分支安装文档（进行中）

2026-10-20；工作分支 `feat/agent-cli-skill-r1` / PR #6，起点 `f3c7b4318c70e9188fe2231261d187bb4836e759`（CP21）。用户已明确授权：审查代码，修复发现的问题，验证后合并，并重写 README 方便从 master 安装使用。

先读 AGENTS.md、docs/checkpoints/CP22-audit-scope.md、CP21-validation.md，再检查本文件之后的提交和各 PR 实际状态。CP21 的完整实现及验证已保存，不需要重做 CLI 或 Skill。

## 当前已确认

- PR #6 在上述起点仍 open / ready；基于 PR #5 的 `feat/feature-migration-r1`。
- 上游 #2 → #3 → #4 → #5 → #6 为依赖链。本轮将采用保留历史的 merge，按顺序改向 master 并核验，不 squash/rebase 或强推。
- 已通过 GitHub 连接器读到最新代码/约束；工作容器通过校验过 SHA-256 的 CP20c 源码归档恢复。CP21 后续只改文档，代码仍是相同受测实现。
- 当前容器 GitHub/npm DNS 无结果；可用本地编译器只做辅助，锁定版本以新 CI 为准。

## 下一步

1. 完成分析输出、提案/迁移边界、HTML 安全和安装路径审查，新增可复现反例并修复。
2. README 改为 master 安装/升级、无模型代码图、Agent+Skill 功能提案、数据保存和常见错误的任务式文档。
3. 提交审查成果和测试检查点，核验锁定跨平台/样本/浏览器 CI 后顺序合并。
4. 核对最终 master 源码树和 push CI，保存最终接手与安装版本。

目前尚未宣称本轮审查完成、测试通过或任何 PR 已合并。Codex-Monitor 始终只读。每个可验证阶段提交并核对远端 ref；中断后以最新提交和 CI 实际状态恢复，不从聊天推测。

恢复命令：`git fetch origin`，保留现有未提交工作后切到 `feat/agent-cli-skill-r1`，`npm ci --ignore-scripts`，`npm test`。若分支已合并，改用 master 并先读最新版检查点。禁止 reset/clean 覆盖用户工作。
