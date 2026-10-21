# RepoGraphia 当前检查点

## CP24：Windows 生成的离线报告只有框架

2026-10-21。本轮修复 Windows CRLF 导致的内联脚本 CSP 哈希不匹配，详见 `docs/checkpoints/CP24-windows-report-csp.md`。日常安装入口仍为 **master**，本轮实现分支 `fix/windows-report-csp` 仅用于审查和 CI；最终合并及受测 SHA、Windows/Linux 浏览器结果记录在对应 PR。读取时以 PR 实际状态核对发布情况，不为写入自身 SHA 递归提交。

接手先读本文件与 AGENTS.md。基线为 `54c8f583f8dda5bd1b5e02401000752b007b4949`（CP23），恢复源码归档的完整 tree 已核对为 `f9d9a5054a883a258e33a9d917ab2f1963739b60`。PR #2–#6 均已合并；不要重新处理旧 PR 或把历史“等待合并”作为当前工作。

## 本轮结论

用户上传报告含完整数据，实际浏览器拒绝了唯一可执行脚本。旧生成器对含 CRLF 的原始脚本计算哈希，而 HTML 解析先规范化换行；两者哈希不同。规范化完整运行脚本后再哈希与嵌入即可修复，不修改图数据、源码哈希或分析规则。继续使用原 hash-only CSP，不关闭浏览器安全控制。

增加静态启动失败提示、5 项隔离换行回归，以及 Windows/Linux 的真实 file:// 浏览器检查（4 正例、错误哈希与脚本篡改 2 负例）。本地新回归及保留字节的 Chromium set_content 复现通过；锁定版本、真实 file:// 和最终主分支结果以 PR 中的 CI 记录为准。用户上传源码与报告没有写入仓库。

## 安装与重新生成

先保留本地未提交修改，在 RepoGraphia 目录执行：

```sh
git fetch origin
git switch master
git pull --ff-only origin master
npm ci --ignore-scripts
npm run build
npm run analyze -- "../Codex-Monitor" --out "./reports/codex-monitor-r2" --include-source
```

打开新 `reports/codex-monitor-r2/index.html`。最后一级目录必须尚不存在；已有 r2 则换 r3 等新名字。工具更新不会修复旧 HTML。不要 reset/clean，也无需启动服务或放宽 CSP。标注编辑仍需导出 JSON，旧图与标注继续保留用于明确迁移。

## 验证和后续

开发回归：`npm test`。浏览器换行夹具：`node tests/helpers/report-line-endings.mjs reports/startup`，随后 `python scripts/check-report-startup.py reports/startup`；需安装锁定 Playwright 1.55.0 与 Chromium。正常验收使用默认 file://，只有受限容器才用 `--set-content --chromium /path/to/chromium`，且必须披露。

CP23 的完整合并与验证记录仍保存在 `docs/checkpoints/CP23-main-integration.md`，硬链接输出保护记录在 CP22，Agent Skill 自用见 CP21。本次不改变提取规则、图 schema、功能审阅、迁移或 Agent 提案语义；Codex-Monitor 只读。

后续功能工作按新的用户任务确定；不借此次显示修复引入内置模型/MCP、实时 Git Diff/Agent 进度、增量分析或动态追踪。
