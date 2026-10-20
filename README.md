# RepoGraphia

**以代码证据为基础的项目可视化与探索工具。**

独立的 TypeScript/JavaScript 静态分析器、离线 HTML 项目地图，以及可审阅的功能/代码映射。Agent 可以通过 CLI 和 Skill 查询代码事实并提交功能提案，不需要 MCP 服务或内置模型 API。

开发接手先读 [当前检查点](docs/CHECKPOINT.md)。静态分析、项目地图、功能映射、跨快照迁移与 Agent 接入分阶段提交；代码是否已进入 master 以对应 PR 状态为准，不把功能分支的能力当作默认分支已有能力。

## 安装与分析

需要 Node.js 22+。TypeScript 锁定 5.9.3，首次安装下载依赖；分析与报告浏览可离线完成。

```sh
npm ci --ignore-scripts
npm run build
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
```

这里假设两个仓库处于同一级目录。用浏览器打开 `reports/codex-monitor/index.html`，不需要启动服务器。`--out` 必须在被分析项目外；有空格的路径请加引号，Windows 可用 `D:/projects/example`。

```sh
node dist/cli.js analyze /path/to/project --project packages/app/tsconfig.json --out /path/to/report --include-source
```

优先使用目标已有 tsconfig，没有配置时扫描 TS/JS。多项目引用暂不递归展开，应指定叶项目配置；JavaScript遵循allowJs。缺少目标依赖时保留诊断和未解析，不会自动安装目标依赖或运行其构建、测试、插件与应用。

## 现在可以使用的三个视角

**项目地图：** 按真实目录聚合，逐层进入文件、函数和源码；连接可展开到原始关系。截断、未索引和范围外关联明确披露。目录不是AI自动识别的业务模块。

**代码关系：** 文件、函数、类、接口、继承、显式调用、模块导入、JSX及回调传入分别记录。每条关系附源码位置、规则和哈希；部分参数/解构来源可沿证据追踪。

**功能映射：** 多对多的显式语义标注，支持人工说明、接受/拒绝、反向导航与JSON导入导出。没有sidecar就不编造功能。页面编辑仅在内存，需导出保存，不自动写回HTML或Git。

| 状态 | 表示什么 | 不表示什么 |
| --- | --- | --- |
| bound | 编译器静态声明绑定 | 已执行或运行目标唯一 |
| candidate | 有声明/值来源候选 | 已穷举所有运行实现 |
| unresolved | 调用点存在但目标未解析 | 不存在调用 |
| external | 定位到索引外声明 | 已分析其实现 |

`accepted` 是自述的人工语义选择，不升级候选调用、不证明业务正确。调用、导入、类型关系与回调传入不能混同。所有代码ID均为快照内身份，不保证跨编辑稳定。

## 给 Agent 使用

```sh
node dist/cli.js agent --help
node dist/cli.js agent overview reports/codex-monitor/graph.json
node dist/cli.js agent search reports/codex-monitor/graph.json notification --scope electron
node dist/cli.js agent inspect reports/codex-monitor/graph.json "准确节点ID"
node dist/cli.js agent check reports/codex-monitor/graph.json proposal.json --author my-agent
node dist/cli.js agent submit reports/codex-monitor/graph.json proposal.json --author my-agent --out reports/proposal-batch-1
```

扩展已有标注时，每个操作都加同一 `--features features.json`。不要直接执行上面的“准确节点ID”占位符，要从search结果复制。提案使用overview的header；不会让模型手写源码坐标或哈希。

Skill入口是 [SKILL.md](skills/repographia-function-map/SKILL.md)，协议和自评参考一起放在该目录。它指导固定快照、按能力探索、核查主要行为及负向分支、保留不确定性和中断检查点，而不只是命令说明。可以明确要求Agent读取并遵循，或将整个目录复制到宿主支持的Skill目录；本项目不自动修改全局配置。

提案通道只追加agent/proposed，不接受review操作、不覆盖原标注；通过校验只意味着引用/原始引文匹配，不证明模型推理正确。详见 [Agent CLI接入](docs/agent-cli.md)。

## 查询、审阅与迁移

```sh
node dist/cli.js query reports/codex-monitor/graph.json callees scanLocal --depth 2
node dist/cli.js query reports/codex-monitor/graph.json diagnostics
node dist/cli.js features init graph.json --out features.json
node dist/cli.js features check graph.json features.json
node dist/cli.js features render graph.json features.json --out feature-report.html
node dist/cli.js features plan old-graph.json new-graph.json features.json --out migration-plan.json
```

名称有歧义时查询报错，不会猜选函数；候选遍历必须显式开启。查询保留预算和缺失端点边界。

跨快照不会自动按同名函数重绑：迁移计划区分可复用、需审阅、无匹配，明确选择carry/replace/defer后更新依据。暂缓条目继续失效；旧接受退回待审。普通FeatureMap创建为schema1，迁移输出schema2，新工具可读两种；旧工具不支持schema2。`features check` 对失效返回2、格式错误返回1。Agent和features写命令拒绝覆盖已有输出；请保留旧图与原标注。

## 验证与边界

```sh
npm test
```

CI使用锁定依赖在Linux/Windows构建测试，并在Chromium以实际file://打开报告。Windows上3项需要符号链接权限的既有测试明确跳过。真实只读样本固定为Codex-Monitor `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，不运行样本应用或业务测试。GitHub Actions保留报告和精确受测源码归档；长期恢复以提交与检查点为准，不依赖临时产物。

Skill进行了作者自用：先冻结v1.0、实际探索通知区域、审查初稿不足、修订v1.1并补查。记录见 [试跑自评](docs/trials/agent-notification/review-v2.md)。CI复播该固定提案只检验协议/UI，不是独立模型试验，也不说明小模型或全项目语义准确率。

报告含源码片段，`--include-source` 含完整已索引文件，分享报告相当于分享代码。页面无外部资源与遥测，源文本使用转义和textContent，配合脚本哈希CSP。分析器不运行git status等可能调用目标辅助程序的操作；dirty为null，HEAD不能证明工作区干净，以实际快照和文件哈希为准。本工具不是不可信仓库的操作系统级沙箱。

目前仍为单配置全量分析，没有增量正确性保证、跨语言完整解析、动态追踪、自动全项目功能归纳、Git Diff叠加或Agent任务调度。

## 设计文档

[架构与解释边界](docs/architecture.md) · [项目地图](docs/project-map.md) · [功能映射](docs/feature-mapping.md) · [显式迁移](docs/feature-migration.md) · [Agent CLI](docs/agent-cli.md) · [开发约定](AGENTS.md)
