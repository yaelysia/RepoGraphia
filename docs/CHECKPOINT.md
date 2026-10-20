# RepoGraphia 当前检查点

## CP21：Agent CLI + Skill 已实现、实际自用并通过锁定验证

2026-10-20；分支 `feat/agent-cli-skill-r1`，PR #6，基于 CP18 `801c47d70e045ce4b6e70c410b70f4a03b440725` / PR #5。先读 AGENTS.md、docs/agent-cli.md、Skill 和本文件之后的提交。上游 PR #2/#3/#4/#5 尚需按依赖顺序处理，本轮没有合并、改写或修改 Codex-Monitor。

## 已验证对象

- 完整代码、Skill1.1与测试：`0b5eb39956ce5de3ae5efefb93141a5101517b81`。
- Git tree：`aa519945a014284d851c177d542cb1aa67ca5466`。
- Verify #30：`39409249812`，三个任务 completed/success。
- 实际 CI PR 合并测试提交：`109a01f3e0d29ce75cc9be5586bd4bfec86dcfc9`。
- 本 CP21 提交只更新接手/验证文档；其最终 HEAD 的 CI 单独记录在 PR #6，不冒用 #30，不为记录最后一个 SHA 无限追加文档提交。

Linux 标准 npm test：272 pass / 0 fail / 0 skip；Windows：269 pass / 0 fail / 3 项既有符号链接权限 skip；Node22.23.3、锁定 TS5.9.3。新增40项单元/CLI/Skill检查。既有浏览器30+24+32+25项，以及新增提案报告14项全部通过，CI以真实file://打开；报告浏览器结果文件明确无异常和外部请求。

## 现在可以做什么

`agent overview/search/inspect/relation/check/submit` 提供有界结构化探索、精确引用、源码/原始引文校验和独立追加提案。命令错误返回JSON及修复提示；源码与列表分别分页。提案强制agent/proposed，不能通过该入口接受、替换功能或覆盖既有人工关联；原sidecar保持不变。固定snapshot、revision和文档摘要避免串用依据。生成新目录包含原始提案、派生标注、校验、收据和HTML。

Skill入口 `skills/repographia-function-map/SKILL.md`，协议和自评在其references目录。版本1.1要求按可观察能力划分、检查每个主要行为承诺、区别不同用户动作、提前说明适用条件、核查重要候选调用的停止边界，并定期保存TRIAL.md。没有内置模型、MCP服务、目标执行或全仓库自动归纳保证。

## 已完成的真实自用

先冻结Skill1.0，再在固定Codex-Monitor的通知区域实际执行25条CLI命令，保存原始查询与初稿。初稿2功能/5映射/4引文通过程序检查，但作者不满意：点击含义混淆、主条件放到问题列表、引文未覆盖主要承诺、只看候选来源未翻停止页。修订Skill1.1后补查并提交2功能/7映射/13引文，原3功能6映射原样保留。最终5功能13映射，新增全proposed。

仓库 `docs/trials/agent-notification/` 保留初稿、修订稿、两份自评、25条命令的归一化清单及原stdout哈希。原始stdout/stderr和自用HTML在随交付提供的完整试跑包中；不要把清单哈希当作所有原始输出都已写入Git。长期接手实现无需原临时容器。

这是一位作者的实际自用，不是独立模型试验或小模型效果评估。CI固定提案复播只验证协议、证据和UI，不会调用模型。有限结果适合初审，但匿名回调可读性、其他仓库/模型和自动触发仍未验证。

## 阶段提交

| 阶段 | 提交 |
| --- | --- |
| 中断恢复入口 | 1c8ddaa1dc551ba64ca7aaafc2f014ab57724435 |
| Agent API/CLI | 76e1dfa85e55391ae5e695bd786a50f905a64bd9 |
| 37项正反例 | 59a7e481cd082704a69ac01bcb792454507c8213 |
| Skill1.0冻结 | 2bc979ce893cad2c30104aabc7040b3792774645 |
| 初稿与具体自评 | 047deb101091f7290421e338638ef004ee59d9ce |
| Skill1.1与修订稿 | 5b4fc66f5f120ca1a4e2c9dc9d39b7d3746e3e97 |
| 固定复播及报告检查 | eb5a6fdcdda397c6f07643b133892a00c2d89c88 |
| CRLF元数据检查修正 | 0b5eb39956ce5de3ae5efefb93141a5101517b81 |

每次使用已加载GitHub写工具提交后核对ref；create_tree不是完成推送。工具发现漏项不表示接口消失。每个可验证阶段同步保存代码、测试和当前接手入口，历史检查点不覆写。

## 接手/试用

```sh
git fetch origin
git switch feat/agent-cli-skill-r1
npm ci --ignore-scripts
npm test
node dist/cli.js agent --help
```

首次跟踪可用 `git switch --track origin/feat/agent-cli-skill-r1`；已有工作保留，不用reset/clean。命令行无此分支功能时先检查PR状态和HEAD，不误用master旧版。

向可执行本地命令的Agent提供Skill路径、dist/cli.js路径、graph.json、可选features.json和新输出目录，明确要求读取Skill。扩展已有标注时每个操作都带同一 --features。源码未嵌入时先在目标外的新目录重新生成带源码的图，然后从新快照开始。自行重放固定样例见scripts/verify-agent.mjs，它不是另一轮语义归纳。

## 下一轮起点

本轮功能与测试都已提交，无待恢复的未提交实现。先核对PR #6最新CI和审阅/依赖状态。下一轮优先用未预设答案的另一个区域/仓库及实际使用的Agent做端到端试用，评估触发、查询预算、语义边界与审阅成本；不要继续堆更多接口代替验证效果。需要改动工具或Skill时保存初始版本、真实失败与修订记录。

完整自动功能图、跨仓库语义评测、内置模型API/MCP、Git Diff叠加、增量、动态运行及Agent任务调度均未实现。默认仍是离线报告，页面编辑不自动写回文件。详细验证及产物身份见 docs/checkpoints/CP21-validation.md。
