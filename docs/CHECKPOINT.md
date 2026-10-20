# RepoGraphia 当前检查点

## CP22：合并前审查修复和 README 已提交，等待新 CI

2026-10-20；工作分支 `feat/agent-cli-skill-r1` / PR #6。用户已授权审查、修复后合并到 master，并整理安装使用文档。起点为 CP21 `f3c7b4318c70e9188fe2231261d187bb4836e759`；范围检查点 `cc70119d8bcd238ac4620819bc65a19101f4d799`。

先读 AGENTS.md、docs/checkpoints/CP22-audit-results.md，再检查本文件之后的提交、实际 CI 和 PR 状态。历史 CP21 功能与验证不重复实现。

## 已完成

审查了静态证据/候选传播、目录聚合、功能映射与迁移、Agent 提案限制、HTML 文本安全和 CLI/安装路径。复现并修复分析输出硬链接可覆盖源码的问题；analyze 和 Agent submit 共用只写新目录的发布器。先完成 sidecar 校验/渲染再创建目录。新增 7 项回归，未改分析规则和图数据。

README 已重写为 master 安装、生成第一份报告、Agent+Skill 接入、保存/迁移、更新和错误处理，不再要求用户切开发分支（这一使用入口将在本轮完成合并后生效）。

本地 Node22.16.0/TS5.8.3 辅助验证：构建、7 项新测试、40 项 Agent/Skill 测试通过。整套并行基线 npm test 在容器调用时限内未完成，不能宣称本地全套通过。仍须核对本提交新 CI 的锁定 TS5.9.3 Linux/Windows、真实样本和浏览器结果。

## 待完成

1. 核对新提交的 Git blob 与本地受测版本，检查 CI，不以旧运行冒充。
2. 按 #2 → #3 → #4 → #5 → #6 顺序保留历史 merge；后续 PR 改向 master，比较合并测试树，使用 expected head SHA，不强推。
3. 验证最终 master push CI，更新 CP23 和实际合并状态。

合并前恢复命令：`git fetch origin`，保留本地工作后切换 `feat/agent-cli-skill-r1`，`npm ci --ignore-scripts`，`npm test`。合并后改用 master 并重读最新检查点。不得 reset/clean 覆盖用户工作。Codex-Monitor 一直只读；没有未保存的新增产品模块、模型 API 或 MCP 服务。
