# RepoGraphia 当前检查点

## CP20a：Agent API/CLI 与 37 项回归已保存；Skill v1.0 已冻结，待实际试跑

2026-10-20；分支 `feat/agent-cli-skill-r1`，PR #6，基于 CP18 `801c47d70e045ce4b6e70c410b70f4a03b440725` / PR #5。先读 AGENTS.md、CP19-agent-scope.md 和本文件之后的提交。保持上游分支与 Codex-Monitor 只读。

实现提交 `76e1dfa85e55391ae5e695bd786a50f905a64bd9`；37项回归 `59a7e481cd082704a69ac01bcb792454507c8213`。本地 Node22.16.0 / TypeScript5.8.3 构建及新37项通过；锁定5.9.3 CI 尚需核验。GitHub 写接口正常，使用 create_tree/create_commit/update_ref 或 create_file 提交；不能把检索不到某个名字当作写接口消失。

本提交保存 `skills/repographia-function-map/SKILL.md` v1.0 及协议/自评参考。下一步按原文在固定 Codex-Monitor 图的非采集区域实际运行，保留所有查询、初稿和自评；据具体问题修订 Skill，并重新验证受影响步骤。不得事后伪造使用记录或把 CI 复播叫独立模型试验。

预计产物：overview、search/inspect/relation 原始输出、TRIAL.md、原始提案、校验及提交收据、页面截图。运行期至少每5次查询或每个功能保存检查点；代码与试跑里程碑同步提交远端。下一阶段CP20b保存真实试跑，CP21完成最终CI/产物/文档。

```sh
git fetch origin
git switch feat/agent-cli-skill-r1
npm ci --ignore-scripts
npm test
node dist/cli.js agent --help
```

不得 reset/clean 已有工作。没有 MCP 服务、模型API调用、目标执行、自动接受或覆盖人工决定。当前 API 只校验引用/引文一致性，不能证明业务语义。
