# RepoGraphia 当前检查点

接手先读本文件、`AGENTS.md` 和 `docs/architecture.md`，再查看本检查点之后的分支提交。历史记录保存在 `docs/checkpoints/`，不要把历史状态当成当前结论。

## 当前状态：CP3，本轮开发与验证完成（2026-10-19）

- 仓库：`yaelysia/RepoGraphia`，独立工具；Codex-Monitor 仅是只读验证样本。
- 工作分支：`fix/r1-evidence-checkpoints`；PR：#2。
- 基线：`master` 的 `3987fb218bdcff4973329c0d13fcc1ea9a341b52`，R1 已由 PR #1 合并。不要因为聊天回复缺失而重建项目。
- 最新已验证完整实现（含页面与开发文档）：`5f3b3498ca2f9142dc5d402e40309c55c5a8d906`。
- 对应 GitHub Verify #9：`39274258988`，三个 job 均成功。CI 实际 checkout 的 PR 合并测试提交为 `276152ef111d6d13442fe9a0f1b941a87523db80`。
- 本检查点提交只更新接手记录，不改变上述代码。后续分支 HEAD/CI 与合并状态以 PR #2 为准；本轮交付保留 PR 审阅，不直接覆盖 master。

## 本轮已经完成

1. 恢复已合并 R1，建立永久 Git 检查点与精确测试源码归档。
2. 复现并修复三类静态分析问题：可变父类确定性误升级、计算方法名调用归属错误、`satisfies` 包装后丢失值绑定。新增 15 项正反例，包含源位置/哈希和父子关系校验。
3. 增加 `ANALYSIS_REVISION=2`，纳入 snapshot 和报告元数据。旧报告缺字段时不得推定为新规则。
4. 核心修复、页面版本显示和旧报告兼容检查均通过锁定 TypeScript 5.9.3 的跨平台和真实样本验证。未修改或执行 Codex-Monitor 应用。

## 已核验结果

| 检查 | 结果 |
| --- | --- |
| Linux / Node 22.23.3 / TypeScript 5.9.3 | 57 通过，0 失败，0 跳过 |
| Windows / Node 22.23.3 / TypeScript 5.9.3 | 54 通过，0 失败；3 项既有符号链接权限用例跳过 |
| Chromium 离线页面 | 14 项检查通过；无浏览器异常、无外部网络请求 |
| 固定 Codex-Monitor | 131 个文件、2630 个非文件实体、12978 个显式调用点；0 编译诊断；选定跨文件绑定和 IPC 不误连断言通过 |

上述数量不是全项目准确率或运行覆盖率。具体来源、job ID、产物哈希及复核记录见 `docs/checkpoints/CP3-validation.md`。

## 检查点历史

| 检查点 | 提交 | 内容 |
| --- | --- | --- |
| CP0 | `02563476eeda93a969ea5bd15a9b81c93084aadc` | 恢复基线与接手入口 |
| 归档修复 | `0984f2635f7da86b7841bd1cb836f09c29f8b810` | 修复 CI 归档路径；Git 源码归档可用 |
| CP1 | `eaf1c91a7f60e17ada4d6a8666b4c4d6cf802b47` | 可复现反例与待修问题 |
| CP2 | `47277e0f35dd0dcb91a798410c7c65e6c1088bc2` | 修复、15 项新增测试、分析规则版本 |
| CP3 验证对象 | `5f3b3498ca2f9142dc5d402e40309c55c5a8d906` | 页面版本、旧报告兼容和接手约定；Verify #9 全通过 |

历史 CP1/CP2 文档记录当时未完成的验证；本文件和 PR #2 记录最新结果。源码归档 `checkpoint-source` 只保留 30 天，长期恢复使用提交，不依赖临时下载链接。

## 接手与运行

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci --ignore-scripts
npm test
node --check viewer/app.js
```

如果分支尚未建立本地跟踪，用 `git switch --track origin/fix/r1-evidence-checkpoints`。有未提交工作先保留，不得使用 reset/clean 覆盖。此分支合并后以 PR 记录的合并结果为准。

用自己已有的目标仓库生成离线页面（此命令只读目标，不自动安装其依赖）：

```sh
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
```

严格复现 CI 则使用另一个独立目录，固定 Codex-Monitor 到 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，按 `scripts/verify-sample.mjs` / CI 配置准备类型信息后执行：

```sh
node scripts/verify-sample.mjs /path/to/pinned/Codex-Monitor ./reports/codex-monitor
python scripts/check-viewer.py reports/codex-monitor/index.html --output reports/codex-monitor/preview.png
```

需要 Node 22+；浏览器验证需要 Playwright 1.55.0 和 Chromium。不要为了样本固定版本重置正在开发的用户工作区，不执行样本应用或业务测试。

## 验证环境区别

助手容器不能解析 GitHub/npm 域名，通过 GitHub 连接器和 CI 源码归档恢复代码。本地 Node 22.16.0 / TypeScript 5.8.3 的辅助测试为 57/57；它不替代锁定 5.9.3 的 CI。容器限制 file:// 导航，本地页面采用脚本显式的 `--set-content` 模式；CI 使用真实 file:// 报告导航。

## 下一轮起点与明确边界

本轮代码和验证已完成，没有需要从临时容器挽救的未提交实现。接手首先检查 PR #2 最新审阅/合并状态，避免重复修复。

下一轮优先对当前 2755 个未解析调用按原因分类，并补充独立人工标注的正反例；优先选择可由类型/符号证据确定的类别，不为提高解析比例猜测关系。然后再单独评估多项目引用或函数值传播的成本。

当前仍是单一 tsconfig 的全量静态分析：没有增量正确性保证、运行时完整目标集合、自动 IPC/事件/跨语言桥接、AI 功能归纳或动态追踪。它们不是本轮遗失的工作，而是尚未启动的后续范围。
