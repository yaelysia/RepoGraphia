# RepoGraphia 当前检查点

## CP20a-WIP：Agent API 与 CLI 接入已提交，测试与 Skill 待提交

2026-10-20，分支 `feat/agent-cli-skill-r1`。前置恢复检查点 `1c8ddaa1dc551ba64ca7aaafc2f014ab57724435`；底座 CP18 `801c47d70e045ce4b6e70c410b70f4a03b440725` / PR #5。先读 AGENTS.md、docs/checkpoints/CP19-agent-scope.md 和本文件之后的提交。上游 PR #2/#3/#4/#5 与 Codex-Monitor 不改动。

本提交将 src/agent.ts、src/agent-cli.ts 和 cli 分发保存远端：overview/search/inspect/relation/check/submit，结构化分页、精确引用、独立 agent/proposed 追加通道。不是已经完成整轮交付；Skill、真实试跑和锁定 CI 仍未完成。

本地恢复副本 /mnt/data/repographia-work 的 tests/agent.test.mjs 已有 37 项辅助测试通过（Node22.16.0 / TypeScript5.8.3），测试尚未包含在本提交，下一步立即提交；不能把本地辅助结果冒充锁定5.9.3 CI。

下一步：提交37项测试并开草稿PR；冻结初版 Skill、实际探索非既有采集例子的区域、保存查询/原始提案/自评，针对不足修订后重跑。最后跑跨平台标准 npm test、真实样本与离线页面检查，形成 CP21。

恢复时先核对远端 HEAD 和本文件后的提交，不凭聊天缺失重写项目。每个可验证阶段同步提交代码和最新检查点；WIP 明确写清，不只创建 Git tree 而忘记 create_commit/update_ref。Skill 试跑产物先存阶段记录，不留到全做完才保存。

```sh
git fetch origin
git switch feat/agent-cli-skill-r1
npm ci --ignore-scripts
npm run build
node dist/cli.js agent --help
```

已有工作须保留，不使用 reset/clean。没有 MCP、模型调用、自动接受、目标项目执行或全项目功能覆盖声明。
