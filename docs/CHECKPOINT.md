# RepoGraphia 当前检查点

## CP14：功能与代码映射层实现完成，等待锁定 CI

2026-10-20；分支 `feat/feature-code-mapping-r1`，基线 CP12 `a64c67bb7e111a2a8c2e2f1f7a30677e2a1051ea`（PR #3）。先读 AGENTS.md、docs/feature-mapping.md、docs/architecture.md，再核对分支最新提交与 PR。PR #2/#3 尚未合并，当前阶段作为其后的独立变更，不改写 master 或 Codex-Monitor。

CP13 范围检查点 `f31a6de83d61b2b43c732b4c6b310cecb05f5be0`；当前提交保存完整实现，不依赖临时容器。

## 已实现

独立 sidecar、显式多对多关联、声明/关系锚点、当前性与人工决策分离、严格快照失效、历史/版本冲突、CLI init/check/edit/render、功能页与源码/原证据/反向导航、人工修正和导入导出。所有示例都是 agent 待审提案，不冒充用户确认。

原分析规则仍为 4、CodeGraph schema 1、项目投影 1；未引入模型、动态追踪、增量或 Git Diff。参考 docs/feature-mapping.md，特别是：当前有效只表示引用一致；accepted 不是业务证明；页面编辑只有内存草稿；新 features 文件写入拒绝覆盖。

## 当前实际验证边界

本地辅助 Node 22.16.0 / TypeScript 5.8.3：198/198 单元测试通过（新增 35）。固定 CP12 Codex-Monitor 图上有 3 个功能、6 条提案映射、4 个代码实体，图数据没有修改。Playwright 1.57.0 / 系统 Chromium 采用 set-content 完成本轮浏览器辅助验证；不替代锁定 CI 的实际 file:// 导航。

容器不能解析 npm/GitHub 域名；通过 GitHub 连接器取得受测源码。已核验 CP12 最终源码 ZIP 的 SHA-256 为 073246c45e99b36ce2da163909bb012a1f3e6f280e9f7cd4452782d785b1f5c3。

## 下一步

检查本实现提交的 GitHub Actions：Linux/Windows 锁定 TS 5.9.3、原 30+24 项浏览器回归、新功能映射检查、固定样本和与 CP12 的同输入对照。失败时修复具体原因，不放宽不确定性规则。通过后保存 run/job/artifact 信息至 CP15 并更新 PR。CP14 不是最终跨平台验收完成。

```sh
git fetch origin
git switch feat/feature-code-mapping-r1
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
node dist/cli.js features init reports/codex-monitor/graph.json --out features.json
```

固定 CI 样本是独立副本 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，不重置用户工作区、不运行样本应用/业务测试。

下一轮再考虑映射迁移、细粒度失效及更多独立功能标注；当前没有 AI 自动归纳或完整业务图。长期接手使用 Git 和检查点，非会过期的 CI 产物。
