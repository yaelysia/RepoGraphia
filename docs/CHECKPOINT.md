# RepoGraphia 当前检查点

## CP19-R：Agent CLI + Skill 中断恢复（2026-10-20）

分支 `feat/agent-cli-skill-r1`，恢复前 HEAD `149d2dfd00c37e3bb3fbfde7f1538e6cf0c6f670`。底座为 CP18 `801c47d70e045ce4b6e70c410b70f4a03b440725` / PR #5。先读 AGENTS.md、docs/checkpoints/CP19-agent-scope.md 和本文件之后的提交。不要覆盖其他分支或重建已完成的静态分析/映射/迁移。

## 恢复核查

远端仅保存 CP19 范围与验收标准，没有 Agent CLI/Skill 实现 PR。当前挂载恢复文件只找到上一轮试跑截图，没有相应源码、提案或查询记录；截图不能作为实现或测试通过的证据。本轮将重新实现和实际试跑，不宣称恢复了不可见的结果。

已从 Verify #23 的 checkpoint-source（artifact 12246987023）恢复 CP18 原始源码。本地 `/mnt/data/repographia-work` 是独立恢复副本；其本地 Git 提交不等同远端 SHA。Node 22.16.0，现成 TypeScript 5.8.3 仅作为辅助环境；最终必须核验锁定 5.9.3 的 CI。

## 授权范围

面向 Agent 的 CLI：项目概览、精确证据包、独立追加提案校验与输出；一个功能归纳 Skill：探索策略、功能划分、反例核查、停止和接手。复用现有纯 API，不增加 MCP 服务、模型 API、目标代码执行或自动接受；不能覆盖已有人工决定。Codex-Monitor 只读。

## 后续检查点

- CP20a：共享 Agent API/CLI 与正反例测试，提交远端后再做 Skill 试跑。
- CP20b：冻结初版 Skill，按步骤实际查询非既有采集示例区域，保存查询记录、提案、自评、修订和重新试跑结果；不是独立模型评测。
- CP21：锁定跨平台 CI、真实样本/离线页面、产物验证和最终接手。

每个阶段的代码、测试和最新入口同步提交；未验证的中间实现明确标注 WIP，不能只记录在临时目录或聊天里。开始下一阶段前确认远端 ref 已更新。历史检查点保持不变。

## 当前验证与未完项

本续做尚未运行新测试，尚无新功能完成的声明。CP18 历史结果见 docs/checkpoints/CP18-validation.md，不能替代本轮验证。

```sh
git fetch origin
git switch --track origin/feat/agent-cli-skill-r1
npm ci --ignore-scripts
npm test
```

已有本地分支则直接 switch；保留未提交工作，不使用 reset/clean。未合并的上游 PR #2/#3/#4/#5 维持原状，最终按依赖顺序处理。
