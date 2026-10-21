# RepoGraphia 当前检查点

## CP26：功能地图可读性实现完成，等待锁定版本 CI

2026-10-21。工作分支 `feat/readable-feature-map`，从 master `470be6c73654991e0d43090a30f27ac428a7e8fc` 新建。PR #2–#7 已合并；用户未推送的 `codex/agent-trial-01` 不是依赖，不改写该分支。

先读 AGENTS.md、`docs/checkpoints/CP25-feature-readability-plan.md`、`docs/checkpoints/CP26-feature-scene-implementation.md`。新界面与使用方式见 `docs/feature-map-visual.md`。阶段代码与测试提交远端后，以分支最新提交和 PR 状态识别已保存范围。

实现：紧凑功能节点 → 入口/实现/支撑/测试角色子图 → 完整说明与源码证据按需展开；支撑默认折叠，完整分页列表仍可用。原始调用箭头可选，候选、不完整端点和预算保留；不画推测性功能依赖。审阅、编辑、导出、迁移和源码返回继续使用原模型。

辅助本地 npm test 308 通过；新增浏览器 41 项及原五套浏览器回归通过。用户实际 3 功能/39 映射重渲染通过 21 检查，图、标注、审阅和历史完全不变。容器使用 TS5.8.3 和字节保真 set_content；不得充作锁定 TS5.9.3 或 Windows/file:// 验证。

## 接手

```sh
git fetch origin
git switch feat/readable-feature-map
npm ci --ignore-scripts
npm test
node tests/helpers/feature-scene.mjs reports/feature-scene
python scripts/check-feature-scene.py reports/feature-scene
```

保留未提交修改，不使用 reset/clean。先查 PR 和 CI 的精确 SHA，再修复真实失败；本轮不扩大到模型接口或增量分析。成功后合并 master 并更新 CP27；不要求用户长期切功能分支。

用户现有提案只需用原 graph.json 和 features.json 执行 `features render --out 新文件`，不需要重跑 Agent。旧 HTML 不自动更新，编辑仍需导出 JSON。实际用户源码/图/报告不提交到仓库。
