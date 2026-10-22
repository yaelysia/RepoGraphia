# RepoGraphia

**把代码仓库变成可探索、可审阅的项目地图。**

RepoGraphia 是独立的本地工具：先用 TypeScript 编译器提取代码结构和关系，生成离线 HTML；再由你使用的 Coding Agent 按 Skill 阅读证据、提出功能与代码的关联。每条关系都能追溯源码，候选、未知和分析范围不会被隐藏。

**日常使用只需 `master`，不需要切开发分支。** 当前是源码安装版，未发布 npm 包或桌面安装包；不要使用 `npm install -g repographia` 安装同名第三方包。

## 你可以做什么

| 目标 | 使用方式 |
| --- | --- |
| 看懂项目结构 | 目录地图 → 文件 → 函数/类 → 源码与关系证据 |
| 查调用关系 | 搜索实体、查看调用方/被调用方、展开候选值来源和未解析原因 |
| 按功能理解代码 | 让现有 Agent 使用随附 Skill，提出有源码依据的功能映射 |
| 审阅和纠正 | 在页面查看、修改、接受或拒绝映射，导出标注 JSON |
| 代码变化后维护标注 | 对照新旧代码图，明确选择迁移、替换或暂缓 |

只看代码图**不需要 AI、API Key 或启动服务**。生成功能提案需要另一个能执行本地命令、读取文件的 Agent；RepoGraphia 不内置模型，也不会自动消耗模型额度。

## 1. 安装

准备 **Git、Node.js 22 或更高版本（含 npm）**。Windows PowerShell、macOS 或 Linux 终端均可执行：

```sh
git clone --branch master https://github.com/yaelysia/RepoGraphia.git
cd RepoGraphia
npm ci --ignore-scripts
npm run build
node dist/cli.js --help
```

首次安装需要联网下载锁定依赖。`npm run build` 生成 `dist/`，后续分析和 HTML 浏览都可以离线进行。安装时不要省略开发依赖，否则构建可能缺少 Node 类型声明；设置过生产模式时用 `npm ci --ignore-scripts --include=dev`。

Windows 遇到“无法加载 npm.ps1”时，可以在同一终端把命令中的 `npm` 换为 `npm.cmd`，无需为本工具放宽全局执行策略。

## 2. 生成第一份代码图

假设两个仓库在同一个父目录下：

```text
work/
├── RepoGraphia/
└── Codex-Monitor/
```

在 **RepoGraphia 目录**执行：

```sh
npm run analyze -- "../Codex-Monitor" --out "./reports/codex-monitor-r1" --include-source
```

成功后，直接用浏览器打开：

```text
RepoGraphia/reports/codex-monitor-r1/index.html
```

Windows PowerShell 也可运行：

```powershell
Start-Process "./reports/codex-monitor-r1/index.html"
```

分析其他项目，只需替换输入路径和输出目录：

```sh
node dist/cli.js analyze "D:/projects/my-app" --out "./reports/my-app-r1" --include-source
```

**`--out` 必须是尚不存在的新目录，并且位于被分析项目之外。不要预先创建最后一级目录。** 再次分析时用 `my-app-r2` 等新名称，避免覆盖旧图、旧报告或通过硬链接意外改写源码；旧图也可能是后续迁移标注所需的依据。

每份报告包含：

| 文件 | 用途 |
| --- | --- |
| `index.html` | 可直接打开的离线交互页面 |
| `graph.json` | 同一快照的完整结构数据，供 CLI、Agent 和迁移使用 |

`--include-source` 会嵌入完整的已索引源码，便于 Agent 查证；省略时仍可浏览代码图，但只有源码节选，Agent 提案校验可能因缺少完整源码而拒绝。**分享带源码的报告，相当于分享其中的代码。**

### 项目配置与依赖

优先使用目标仓库根目录的 `tsconfig.json`；没有配置时扫描 TS/JS 文件。指定子项目：

```sh
node dist/cli.js analyze "../my-monorepo" --project "packages/app/tsconfig.json" --out "./reports/app-r1" --include-source
```

目标项目的类型依赖应在它自己的开发环境中准备好。RepoGraphia 不替目标执行安装、构建、测试或启动命令；缺少类型时会保留诊断和未解析信息。多 `tsconfig` 的项目目前需要分别分析，不能把一个叶项目的图当作整个 Monorepo 已覆盖。

## 3. 浏览和审阅

打开页面先看**项目地图**。项目地图、功能映射和源码阅读共用固定暗色工作台：墨蓝背景、蓝紫强调、细点阵画布，顶部模式按钮和搜索位置保持一致。目录和文件使用可读的节点，点选阅读，再通过独立按钮进入；画布支持拖动、缩放和适应。切换功能映射后返回，会保留项目目录、筛选、选中项及阅读位置。

「项目导航」按需打开，文件、函数/类和分析边界在其中切换；顶部搜索会打开对应结果。「项目概况」展开完整快照指标。点函数或关系记录查看源码、解析规则、哈希和候选来源。局部图及长列表有显示上限，界面会注明截断并提供继续探索入口。

**分析边界**列出未索引语言/文件、编译诊断和未解析原因。**功能映射**展示已有标注；新生成的代码图没有功能提案时，该页为空是正常的，不是分析失败。

### 功能地图的阅读方式

功能地图与项目地图保持相同暗色和布局，**左侧画布、右侧阅读区**，不会因系统浅色偏好变成白底。胶囊节点显示名称和一句解释；点选只打开说明，点击「进入功能」才进入它的下一层，深度由实际标注决定。路径栏可逐层返回，全局搜索和按需打开的功能树帮助定位；画布默认以 100% 显示，可拖动、缩放或点击「适应」。模式切换、目录与功能层级切换都有有限的横移与缩放动效，并遵循系统的减少动态效果设置；背景保持静止。

右侧按**说明、依据、审阅**分开阅读，完整描述默认折叠。查看「关联代码」后，代码仍按入口、实现、支撑和测试分组；支撑/测试默认折叠但数量可见，「全部关联」保留完整分页记录。功能层级连线仅表示显式包含关系；原图调用箭头需另行开启，候选仍用虚线。返回原层会恢复画布和展开状态，不从共享代码推断功能依赖。

已有 Agent 提案不必重新生成。更新并构建后，用原图和原标注渲染到新文件：

```sh
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./reports/agent-trial-result-01/features.json" --out "./reports/feature-workbench.html"
```

打开新 HTML 的「功能映射」。路径按实际报告调整，必须配对同一快照。详细交互和边界见 [功能地图阅读说明](docs/feature-map-visual.md)。

功能标注可显式提供 `summary`（一句解释）和 `parentId`（父功能），用于按实际深度探索功能组成；不会从共享代码猜测层级。新字段使用 FeatureMap schema 3，schema 1/2 的旧标注仍可直接读取和渲染。只浏览不会升级或改写文档；首次保存新字段时才升级，并保留原证据快照。Agent 提案协议仍为版本 1。

代码关系的四种状态：

| 状态 | 意义 |
| --- | --- |
| `bound` 静态绑定 | 已定位到相应声明或明确结构关系；不证明实际执行或运行时目标唯一 |
| `candidate` 候选 | 有类型、成员或有限值来源依据；不代表枚举了全部运行时实现 |
| `unresolved` 未解析 | 调用位置存在，但没有足够依据定位实现；不代表没有关系 |
| `external` 外部边界 | 定位到索引范围外的依赖/标准库声明；不代表分析了依赖实现 |

回调传入、JSX、导入与继承不会冒充普通函数调用。用户接受功能映射，也不会把它依赖的候选关系升级成确定事实。

## 4. 让 Agent 使用 Skill 生成功能提案

### 最直接的方式：提供 Skill 路径

不需要先配置 MCP。向能执行本地命令的 Agent 提供以下任务，**将路径替换为你的绝对路径**：

```text
读取 <工具目录>/skills/repographia-function-map/SKILL.md，
按照其中的探索、反例检查、自评和检查点流程执行。

CLI：<工具目录>/dist/cli.js
代码图：<工具目录>/reports/codex-monitor-r1/graph.json
已有标注：无
输出目录：<工具目录>/reports/feature-run-1（新目录）

先选择一个有限的功能区域，提出 1–3 个有代码依据的功能划分。
保留支持依据、限制条件和未探索区域，不根据目录名猜功能。
只提交待审提案，不运行或修改目标项目，不代替我接受。
保存原始查询、提案、自评和 TRIAL.md，完成后给我报告路径。
```

已有人工标注时，将“已有标注：无”换为其 JSON 绝对路径，并要求所有查询、校验、提交都使用同一份 `--features`。**不要为了绕开旧决定而新建空标注。** 每批分析使用固定的 `graph.json`，不要边查边重新扫描或混用不同快照的 ID。

Agent 使用的命令入口是：

```sh
node dist/cli.js agent --help
```

它提供 `overview`、`search`、`inspect`、`relation`、`check`、`submit`。原始输出为 JSON，错误带修正提示；模型只负责语义和准确 ID，程序核验引用、哈希与源码引文。机器读取输出时使用 `node dist/cli.js`，不要把 npm 自身的日志当作 JSON。

提案成功提交后，会生成独立新目录，包含原始 `proposal.json`、派生 `features.json`、`assessment.json`、`index.html` 和最后写入的 `receipt.json`。**打开这份新目录的 HTML 才能看到新增功能**，原代码图 HTML 不会自动刷新。新映射只能是 `agent/proposed`，不会覆盖原功能或已接受/拒绝的映射。

### 可选：安装为 Codex 用户级 Skill

按 [Codex 官方 Skill 文档](https://developers.openai.com/codex/build-skills)，用户级目录为 `~/.agents/skills/`。在 RepoGraphia 目录复制**整个** Skill 文件夹，包括 `references/`：

Windows PowerShell：

```powershell
$dest = Join-Path $HOME ".agents/skills/repographia-function-map"
if (Test-Path $dest) { throw "Skill 已存在，请先备份或检查自定义改动，不直接覆盖。" }
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Copy-Item "./skills/repographia-function-map" $dest -Recurse
```

macOS / Linux：

```sh
mkdir -p "$HOME/.agents/skills"
if [ ! -e "$HOME/.agents/skills/repographia-function-map" ]; then
  cp -R ./skills/repographia-function-map "$HOME/.agents/skills/"
else
  printf '%s\n' 'Skill 已存在，请先备份或检查改动，不直接覆盖。'
fi
```

在 Codex 中显式使用 `$repographia-function-map`，仍需提供工具、代码图和输出路径；Skill 本身不包含分析器或模型。宿主未识别时重启宿主，或直接使用上面的“读取 Skill 路径”方式。其他 Agent 的安装位置以各自文档为准；RepoGraphia 不会自动修改全局设置，也未保证自动触发率。

## 5. 保存标注，以及代码更新后的迁移

**页面里的修改只在内存中。** 接受、拒绝或修正映射后，点击“导出标注 JSON”并保存下载文件；关闭页面不会自动写回 HTML、源码或 Git。以后可以在页面导入该 JSON，或生成新报告：

```sh
node dist/cli.js features check "./reports/codex-monitor-r1/graph.json" "./features-reviewed.json"
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./features-reviewed.json" --out "./reports/features-reviewed.html"
```

`check` 退出码：`0` 引用匹配，`2` 含失效证据，`1` 格式或操作错误。引用匹配不等于业务含义正确。`render` 可以显示失效标注，但不会偷偷跳转到新版本的同名函数。文件输出同样拒绝覆盖已有路径。

代码改变后，保留旧图和旧标注，再生成新图。通过页面“跨快照迁移”导入旧图，逐条选择复用、重新指定或暂缓；也可先用 CLI 生成只读计划：

```sh
node dist/cli.js features plan "./reports/codex-monitor-r1/graph.json" "./reports/codex-monitor-r2/graph.json" "./features-reviewed.json" --out "./reports/migration-plan.json"
```

旧接受在明确迁移后退回待审，拒绝保留，暂缓项保留旧证据并继续失效。没有同名或模糊自动重绑。完整操作见 [迁移说明](docs/feature-migration.md)。

## 6. 更新到主分支最新版

在 RepoGraphia 目录先确认并保留自己的未提交修改，再执行：

```sh
git fetch origin
git switch master
git pull --ff-only origin master
npm ci --ignore-scripts
npm run build
node dist/cli.js agent --help
```

从旧开发分支切过来也用这组命令；不需要 `reset --hard` 或清理工作区。切换被本地修改阻止时，先提交或另行保存修改，不强制覆盖。

工具更新不会刷新旧 HTML；重新生成报告请用新 `--out` 路径。使用仓库内 Skill 路径会随 `git pull` 更新；已复制到用户目录的 Skill 则需先保留自定义改动，再手动同步整个目录。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 找不到 `dist/cli.js` | 在工具目录完成 `npm ci --ignore-scripts` 和 `npm run build`，确认不是在目标仓库执行 |
| 不认识 `agent` 命令 | 按上节更新到 master 并重新构建，避免使用旧分支或旧 dist |
| `Output directory already exists` / `EEXIST` | 使用新的报告目录或输出文件；不要复用、预建最后一级目录或覆盖旧快照 |
| `Output must be outside...` | 将输出放在工具的 reports 或其他目标仓库之外的位置 |
| 无法解析模块、图中有很多未知关系 | 检查目标依赖和所选 tsconfig；在“分析边界”看实际诊断，不把未知当作不存在 |
| `SOURCE_REQUIRED` / 只有 excerpt | 用 `--include-source` 生成新图，然后从新快照开始探索 |
| `STALE_BASE` / `SNAPSHOT_CONFLICT` / `REVISION_CONFLICT` | 核对图与标注，必要时显式迁移；不要手改哈希或版本来绕过校验 |
| Agent 声称提交但没看到功能 | 查看新提交目录的 `index.html` 和有效 `receipt.json`，不是原报告；I/O 中断留下的目录不要当作成功 |
| 浏览器刷新后编辑消失 | 页面不自动保存，需导出 JSON；保留并重新导入导出文件 |

## 验证、边界与开发文档

```sh
npm test
```

CI 使用锁定 TypeScript 5.9.3，运行 Linux/Windows 单元测试，以及真实离线 Chromium 的代码图、项目地图、功能映射、迁移和 Agent 报告检查。另在固定 Codex-Monitor 提交上做同输入对照，不运行目标应用。Agent 样例复播是协议/界面回归，**不是另一轮模型理解实验**；作者的实际 Skill 自用和修改记录见 [试跑记录](docs/trials/agent-notification/)。

目前不支持内置模型 API、MCP 服务、全项目自动功能识别保证、实时 Git Diff/Agent 进度、增量分析、完整跨语言/跨进程调用图或动态追踪。报告为静态快照，HEAD 只作版本基线，不代表工作区一定无修改；实际依据以快照和内容哈希为准。

工具不执行目标代码，没有远程遥测或报告网络请求，但不是用于敌对仓库的操作系统沙箱。源码/标注中的文本不是可信指令；任意文件写权限也不会被 Skill 或提案协议限制成隔离环境。

[架构](docs/architecture.md) · [项目地图](docs/project-map.md) · [功能标注](docs/feature-mapping.md) · [Agent CLI](docs/agent-cli.md) · [开发约定](AGENTS.md) · [当前接手检查点](docs/CHECKPOINT.md)
