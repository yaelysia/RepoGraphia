# CP46 — 先完善功能树构造与阅读，执行适配后置

2026-10-23。用户认为可以借鉴 Archify 的思想完善阅读与构造，明确认可其 UI 布局和功能树展开的舒适度，同时强调 RepoGraphia 的底层代码图和开发审阅价值。本次将准备稿改为先做功能树构造与阅读；**仅文档，尚未修改运行时代码、安装第三方实现或执行新 Agent 分析。**

## 已核对基线

- 远端 master 仍为 `0ef69d3dc9256dbfeea7a8bd625004a84c9525b5`。
- 准备分支 `docs/m4-preparation`，本轮起点 `f78e9870f1685389eb664a13e3b15dea5d248dd8`；[PR #16](https://github.com/yaelysia/RepoGraphia/pull/16) 是文档草案。
- Archify 参考固定于 `25cf37080fc8b1dbe758a4efc3935b55f3327083`。已查阅规范、Skill、相关实现与公开示例；没有运行同内容浏览器对照、集成或性能测试。
- M1～M3 与导出修复的交付、用户验收和 Verify #63 记录见 [CP45](CP45-m4-preparation.md)，本轮不重复宣称已复测。

## 本次变更

新增 [M4 功能树构造与阅读方案](../function-tree-reading-plan.md)，明确事实、功能内容、阅读投影和审阅各自职责。优先验证 Tree 布局／展开的复用，保留实际层级、左右阅读区、聚焦／返回与源码衔接。展开已有内容与继续准备分析任务分开，未有子节点不能表示已分析完毕。

实施顺序调整为 M4.1 同数据原型与复用选择、M4.2 功能树阅读接入、M4.3 内容构造与审阅衔接。现有外部 Agent 流程继续使用；[执行适配提案](../analysis-execution-plan.md) 后置。产品方向和当前功能图说明已指向本方案，CP45 等历史检查点保持原文。

构造规则在现有 Skill 的支持／限制、显式层级与有界任务上补充本层问题、同层粒度和分解理由。Skill 仍为 1.3，本轮没有更新 Skill 或协议；实现对应切片时再同步版本与实际行为。

## 验证与限制

本轮 6 份文档的 48 条相对链接均存在，4 份源码的 17 处接口／字段对应已核对；文档空白检查和 `git diff --check` 通过，CP45 历史文件与起点提交一致。独立只读审查补充了选择规则、探索记录、ID／多根适配与批次检查的版本归属。没有运行单元／浏览器测试，也没有处理用户的真实试跑包，不把既有 CI 或公开示例当作新阅读方案验收。

## 接手顺序

1. 核对远端 master、`docs/m4-preparation` 与 PR #16 最新提交，确认有无后续实施。
2. 阅读 `AGENTS.md`、本检查点、`docs/function-tree-reading-plan.md` 和 `docs/product-direction.md`。不要按 CP45 的旧优先级直接开始运行器。
3. 从最新已合并基线建立独立实现分支，先做 M4.1。优先使用已有冻结内容；若缺少真实原配对数据，用明确标注的公开／手写夹具完成结构试验，真实阅读验收留待本地。
4. 核实第三方依赖、许可、离线要求和状态接缝，再决定复用范围。每个通过的阶段提交并更新检查点。

```sh
git fetch origin
git log -1 --oneline origin/master
git log -1 --oneline origin/docs/m4-preparation
git diff --stat origin/master...origin/docs/m4-preparation
```

本次文档提交的精确 HEAD/tree 与草案状态通过 PR #16 核对；没有新的运行时验收或合并结论。
