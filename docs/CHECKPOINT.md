# RepoGraphia 当前检查点

## CP20b：Skill 实际自用与修订已完成，终验待做

2026-10-20；分支feat/agent-cli-skill-r1 / PR#6；底座CP18/PR#5。先读AGENTS.md、docs/checkpoints/CP19-agent-scope.md与本文件后的提交，不覆盖上游分支和只读Codex-Monitor。

检查点：API/CLI 76e1dfa85e55391ae5e695bd786a50f905a64bd9；37测试59a7e481cd082704a69ac01bcb792454507c8213；冻结Skill1.0为2bc979ce893cad2c30104aabc7040b3792774645（Verify#25已成功）；首稿/自评047deb101091f7290421e338638ef004ee59d9ce。本提交保存Skill1.1、真实修订稿和自评；不是已完成最终CI的声明。

作者实际按Skill在固定Codex-Monitor非采集区域执行25条CLI命令，初稿2功能5映射4引文通过校验但有语义表达不足；补查候选停止页后修订为2功能7映射13引文。源码图/原3功能6映射只读，新增全agent/proposed；浏览器本地辅助14项通过，并已打开实际截图。详细记录docs/trials/agent-notification。

临时完整记录/mnt/data/agent-skill-trial包含queries/commands.jsonl/proposal-v1/v2/review-v1/v2/submission；这些不是未提交的功能实现。下一步将精确命令清单与固定输入CI复播脚本提交，新增报告页面检查，再保存最终CP21。CI复播不是独立模型试验，也不会再次调用模型。

```sh
git fetch origin
git switch feat/agent-cli-skill-r1
npm ci --ignore-scripts
npm test
node dist/cli.js agent --help
```

本地Node22.16.0/TS5.8.3只是辅助；最终须锁定TS5.9.3跨平台验证。尚未实现MCP、内置模型API、全项目自动归纳、实时推送或目标运行。保留现有文件，不用reset/clean。每次创建tree后必须commit/update_ref并核对结果，检索不全不能当作写接口不存在。
