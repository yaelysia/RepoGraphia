# RepoGraphia 当前检查点

## CP23：审查修复、全部 PR 合并和主分支验证完成

2026-10-20。日常安装、使用和后续开发以 **master** 为入口，不再需要切换旧功能分支。PR #2、#3、#4、#5、#6 已按依赖顺序通过保留历史的 merge 合并；没有 squash、rebase、强推或删除分支。Codex-Monitor 未被修改或运行。

接手先读本文件和 AGENTS.md。安装使用见 README；本轮审查见 `docs/checkpoints/CP22-audit-results.md`；精确合并与验证记录见 `docs/checkpoints/CP23-main-integration.md`。旧检查点里的“待合并/等待 CI”是历史状态，不能当作当前任务。

## 已核验基线

- 审查修复及 README：`568fe7d3333299605f26db344ec6a8f83f604fec`。
- 全栈合入 master：`24e01def5cf6eae3c16f0a5748c9d4502d875742`。
- 两者完整 Git tree 相同：`7fec4ff3d20dcd078df47f01042c409079aca82f`，比较结果无文件差异。
- 修复分支 Verify #33（`39428746942`）成功；master 自己的 push Verify #38（`39430111403`）三个任务也均 completed/success，实际 checkout 为上述 master 提交，不借用 PR 合并测试结果。
- 本 CP23 提交只更新这两份接手/验证文档；其最终 SHA 和后续 push CI 记录在已合并 PR #6 评论，不为记录自身 SHA 递归提交。

## 审查发现及修复

旧 analyze 在复用报告目录时，graph.json/index.html 若是指向源码的硬链接会截断源码；在隔离样例中已复现并修复。现在 analyze 与 Agent submit 共用独占的新目录写入器，使用 wx 写文件，先完成校验与渲染再创建输出。现有目录（即使为空）和文件都不覆盖；Agent receipt 仍最后写入。新增 7 项输出安全和带空格路径的安装使用测试。没有改动静态解析规则、图 schema 或功能审阅语义。

README 已整理为 master 源码安装、第一份报告、Agent+Skill 使用、标注保存/迁移、版本更新和常见错误处理，包含可直接提供给 Agent 的任务文本。

## master 实际验证

| 环境/检查 | 结果 |
| --- | --- |
| Linux / Node 22.23.3 / 锁定 TypeScript 5.9.3 | npm test：279 通过、0 失败、0 跳过 |
| Windows / 同版本 | npm test：276 通过、0 失败；3 项既有符号链接权限用例跳过 |
| 固定 Codex-Monitor | 静态断言、同输入对照、目录投影、功能标注/迁移及 Agent 提案复播通过 |
| 离线 Chromium | 原代码图、项目地图、功能映射、迁移和 Agent 报告五套检查均通过 |

这些是当前测试范围的结果，不是全仓库语义准确率或零缺陷证明。作者 Skill 自用与确定性复播的区别仍见 CP21；本轮没有新增模型理解试验。

## 从 master 接手或更新

先保留自己的未提交工作，在 RepoGraphia 目录执行：

```sh
git fetch origin
git switch master
git pull --ff-only origin master
npm ci --ignore-scripts
npm run build
node dist/cli.js agent --help
```

验证开发改动用 `npm test`。不得 reset/clean 强制覆盖工作。README 包含首次 clone 流程；不要求发布 npm 包或配置 MCP。

两个仓库位于同级时，生成新报告：

```sh
npm run analyze -- "../Codex-Monitor" --out "./reports/codex-monitor-r1" --include-source
```

最后一级输出目录必须尚不存在，重跑用 r2 等新名称。打开报告的 index.html；功能提案使用 `skills/repographia-function-map/SKILL.md`。页面编辑仍需导出标注 JSON，更新工具不会自动刷新旧 HTML。保留原 graph.json 和标注用于显式迁移。

## 下一轮起点

本次审查、合并、README 和验证已完成，没有未提交实现需要从临时容器恢复。今后从最新 master 新建小范围分支并保留检查点，不继续往已合并的旧 PR 堆叠。

下一轮优先在未预设答案的其他区域/仓库或实际使用的 Agent 上验证 Skill 的功能划分、查询成本和审阅效果，具体范围再按用户任务确定。当前仍没有内置模型/MCP、实时 Git Diff 或 Agent 进度、增量分析、完整跨语言/跨进程关系和动态追踪；它们不是此次遗漏的代码。
