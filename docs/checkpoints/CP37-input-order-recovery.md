# CP37 — 输入读取顺序与 M1 样本回归修复

2026-10-22。用户授权继续 M2；接手先核对 M1 PR #12，发现 Verify #53 的 Linux/Windows job 成功而固定样本项目地图比较失败。M1 暂不合并，先完成正确性修复。

## 根因与修复

`inputReader.getDirectories/readDirectory` 原先返回了排序后的目录结果，改变 TypeScript 的原始遍历顺序。关系 ID 含快照内生成顺序，因此数组原样比较失败；独立 18 调用点、16 调用点预算的夹具进一步证明候选选择也会变化，不能只放松验收断言。

读取器现在缓存并返回 TypeScript 原始顺序，向调用者返回副本；只有输入捕获记录的副本排序。`verify-project-map.mjs` 同时改为严格关系事实多重集比较，只排除关系 ID 与外层数组位置。owner、targets、kind、status、typeOnly、完整源码证据、value-origin 路径/停止/visited/limits/truncated 和重复数仍须一致；原始完全相等另行报告。投影不能改写输入图的断言保留。

## 验证证据

- 修复前新增 3 项输入回归全部失败，原 11 项通过。
- 修复后 Node 22.18.0 / TypeScript 5.9.3 构建通过；输入 14 项及比较脚本 6 项（含 33 次 CLI 正反场景）全部通过，0 skip。
- Node 24.19.0 同样通过上述 20 项。
- Node 22.18.0 完整本地套件 **391 通过 / 0 失败 / 0 跳过**；包括真实 loopback 服务测试。
- CP9 `801c47d70e045ce4b6e70c410b70f4a03b440725` 原始分析模块与当前模块，共用同一锁定 TypeScript，在同一个 22 文件 / 41 节点 / 37 关系夹具上独立分析：files、nodes、原始 relations、coverage、diagnostics 全部直接 deepEqual；16 来源、open-callers/caller-budget/truncated 一致，snapshot 因新输入契约不同。
- `git diff --check` 通过。对照产物位于被忽略的 `reports/ci-input-order-validation/`，未提交。

## 接续

修复在 `feat/continuous-workspace` 上提交并更新 PR #12。该修复的完整本地套件与新 CI 状态记录于 PR，只有精确修复 HEAD 的 Windows/Linux/sample 都成功后合并。旧 Verify #53 的成功单元不能替代样本修复验收。

M2 工作树位于 `RepoGraphia-m2`，分支 `feat/feature-incremental`；已开始独立引用核对、任务包/修订协议和功能建设 UI。将本修复合入 M2 后继续，保持旧 Agent v1、旧 assess/migration 规则不变。M2 尚未验收完成，不提前按已交付宣传。
