# RepoGraphia 当前检查点

接手先读本文件、`AGENTS.md` 和 `docs/architecture.md`，再查看本检查点之后的分支提交。历史记录保存在 `docs/checkpoints/`，不要把历史状态当成当前结论。

## 当前状态：CP2 已验证，正在收尾文档与报告版本显示

- 仓库：`yaelysia/RepoGraphia`，独立工具；Codex-Monitor 仅是只读验证样本。
- 工作分支：`fix/r1-evidence-checkpoints`；PR：#2。
- 基线：`master` 的 `3987fb218bdcff4973329c0d13fcc1ea9a341b52`，R1 已由 PR #1 合并。不要因为聊天回复缺失而重建项目。
- 最新已验证核心代码：`47277e0f35dd0dcb91a798410c7c65e6c1088bc2`。
- 对应 GitHub Verify #8：`39272165071`，Linux、Windows、固定真实样本及 Chromium 检查均成功。
- 本次提交补充开发约定、架构说明、分析规则版本显示和旧报告兼容检查；这些新增页面检查需要在后续 CI 上验证，不能用 #8 替代。

## 本轮已经完成

1. 恢复已合并 R1，建立永久 Git 检查点与精确测试源码归档。
2. 复现并修复三类静态分析问题：可变父类确定性误升级、计算方法名调用归属错误、`satisfies` 包装后丢失值绑定。新增 15 项正反例，包含源位置/哈希和父子关系校验。
3. 增加 `ANALYSIS_REVISION=2`，纳入 snapshot 和报告元数据。旧报告缺字段时不得推定为新规则。
4. 核心修复完成锁定 TypeScript 5.9.3 的跨平台和真实样本验证。未修改或执行 Codex-Monitor 应用。

## 检查点历史

| 检查点 | 提交 | 内容 |
| --- | --- | --- |
| CP0 | `02563476eeda93a969ea5bd15a9b81c93084aadc` | 恢复基线与接手入口 |
| 归档修复 | `0984f2635f7da86b7841bd1cb836f09c29f8b810` | 修复 CI 归档路径；Git 源码归档可用 |
| CP1 | `eaf1c91a7f60e17ada4d6a8666b4c4d6cf802b47` | 可复现反例与待修问题 |
| CP2 | `47277e0f35dd0dcb91a798410c7c65e6c1088bc2` | 修复、15 项新增测试、分析规则版本 |

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

## 下一步（本轮未完项）

完成新增的 14 项浏览器检查的 CI 验证，保存精确提交/run 与报告产物，更新此入口及 PR #2，再将 PR 标为可审阅。

本轮之后优先扩充人工标注的静态反例和未解析类别评估，再考虑多项目引用/函数值传播。不要直接跳到 AI 功能归纳、动态追踪、跨语言完整图或增量分析；这些仍需单独定义正确性边界。
