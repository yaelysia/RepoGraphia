# CP5 — 规则 3 诊断实现（历史检查点）

本轮起点 `165532b7eb8dbb7872ef2e725a6f960df5256868`；CP4 接手提交 `c99e143092dbe0bddffc56880641bd694d829c59`。继续分支 `fix/r1-evidence-checkpoints` / PR #2。

已实现结构化未解析原因、外部声明边界修正、属性初始化候选、getter 返回值保护、通用分页诊断、HTML 分类/证据跳转和规则版本 3。CI 加入固定规则 2 工具，在同一样本和类型依赖目录进行对照，校验源码哈希和调用点集合不变。

本地实测 Node 22.16.0 / TypeScript 5.8.3：基线 57/57，本轮 92/92；新增 35 项回归。最初新分类夹具在旧实现上 15 fail / 3 pass，此后窄修复与新增正反例全部通过。独立 32-call 页面夹具通过 Chromium 24 项具名检查（--set-content），无页面异常或外部请求。

本记录保存时，锁定 TypeScript 5.9.3 的 Windows/Linux 与固定 Codex-Monitor CI 尚待核验。后续最新结果看 docs/CHECKPOINT.md 和 CP6；不得用以上本地结果代替锁定版本 CI。没有目标项目写入/执行、AI 调用、动态分析或增量声明。
