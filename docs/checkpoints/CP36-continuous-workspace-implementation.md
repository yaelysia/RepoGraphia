# CP36 — 持续工作区 M1 实现与本地验收

2026-10-22。用户已授权按 CP35 分阶段建设；本阶段交付 M1 的持续工作区、任务起点和代码事实比较。对话中断后继续同一工作树，未重做已完成 UI。

## 基线与提交

- PR #11 的计划已合入 master，开发基线为 `6f482f514965be44fb0a55c67d809f31aa5f3d56`。
- 实现分支：`feat/continuous-workspace`。本地受测实现与本检查点一起提交，远端精确实现 HEAD、tree 和 CI 链接记录于该分支 PR。
- 本检查点记录本地已完成结果；提交后的 Windows/Linux CI、固定样本与合并状态必须另行核对，不能沿用 CP34/35 的 CI。

## 已交付行为

新增 `workspace <repository> --out <workspace-directory>`，通过只绑定 `127.0.0.1` 的本机服务打开已确认的暗色工作台。保存目录位于目标源码树之外，绑定实际根路径与所选 tsconfig；再次运行同一命令恢复已保存的代码图、标注、任务起点及精确阅读上下文。

代码观察使用文件通知、默认 300 ms 合并事件和 10 秒定期核对。后台 Worker 完整重建代码图，不执行目标仓库脚本。统一捕获每轮源码、根/继承配置、类型和模块解析相关读取及查询，发布前核对两次；持续编辑或失败时保留上一份有效图。输入核对不是文件系统原子快照，也不是局部增量提取。当前范围仍为所选配置下的 TS/JS，编辑器未保存内容不在范围内。

“开始一轮开发”请求新的一轮采集，包含当时工作树中已有的已保存未提交修改；不把 Git HEAD 当作起点。代码图、任务起点和正在审阅的版本分别记录。新版本只提示可切换，未应用表单不会丢失；已应用标注只有实际落盘成功且 ACK 对应当前编辑才显示已保存。多窗口保存采用版本比较，冲突保留当前草稿并支持导出。

比较页左侧列文件，右侧显示固定起点与审阅版本的源码差异、声明/关系变化、编译诊断及范围。文件进入/离开分析索引不直接等同文件创建/删除；快照内 ID 不作为跨版本稳定身份。源码未变但解析记录变化单独显示，候选/未知/截断及证据出处保留。该页不能推断 Agent 身份、意图、运行步骤或功能行为已通过验收。

新代码图仍配对原依据的功能标注并明确提示复核，未自动重基或转移人工接受。M2 再补功能引用局部核对、粗图任务、可修订 Agent 提案与审阅。既有离线报告、Agent CLI 和 Skill 协议继续保留；M1 没有修改模型调用或 Agent 提案协议。

## 持久化与恢复

代码快照和标注文件不可变，`workspace.json` 通过临时文件、文件 fsync 和同目录 rename 发布。代码文件有独立存储摘要，标注按规范化内容摘要核对；损坏的数据不会被普通刷新标为 current，也不会被强制分析悄悄覆盖。失败发布的孤儿文件仅在完整内容及输入核对等价后复用。

工作区单写者锁保护落盘；额外独占获取锁序列化死 PID 锁恢复。中断时残留的获取锁明确要求检查，不能通过不安全的自动删除产生第二写者。已关闭实例不能继续保存标注或阅读状态。配置被删除后仍可打开旧图，新分析明确报错。保存失败和后台错误不移动成功版本指针。

父页和报告 iframe 使用各自 CSP，报告保留哈希脚本策略和 `connect-src 'none'`。固定版本报告通过只读随机 ticket 提供；API 写入 token 只在父页会话存储，地址片段初始化后移除，报告内不包含 token。双向消息核对同源、窗口和实例，旧 iframe 的迟到消息不能清掉新编辑。

## 实际本地验证

| 检查 | 实际结果 |
| --- | --- |
| TypeScript 5.9.3 构建 | 通过 |
| Linux / Node 22.18.0 完整 `--test tests/*.test.mjs` | 382 pass / 0 fail / 0 skip |
| 新工作区核心与真实 HTTP 服务 | 12 项通过，包含 Worker、起点、重开、保存冲突、失败恢复与访问校验 |
| 新异常恢复 | 8 项通过；直接 Node 24.19.0 与完整 Node 22 套件均执行 |
| 新输入捕获 / 比较 / 报告桥接 | 分别 11 / 16 / 3 项，包含于上述 382 项 |
| 真实本机服务 + Chromium 131 工作区 | 14 组通过，包含真实保存、后台更新、历史只读、重开、冲突、离线导出、390 px 与减少动效 |
| 原离线报告启动/CSP | 4 个换行正例正常启动；wrong-hash/tampered 两负例按预期阻断 |
| 浏览器异常 / 外网请求 | 0 / 0 |

浏览器使用真实 loopback 服务与 file:// 报告，没有用 set_content 替代安全策略验证。此环境执行本地监听和 Chromium 需要沙箱提升；执行已获准。Host 校验的测试使用 `node:http` 发送真实 Host 头，避免受部分 Node fetch 对该头的归一化影响。

本轮没有运行 Codex-Monitor 应用、目标构建或模型；目标项目只是静态分析输入。用户上传的报告、源码和本地临时浏览器产物没有进入提交。

## 精确继续方式

先核对远端 PR/HEAD，再拉取对应分支。使用 Node 22+ 和锁定依赖：

```sh
npm ci --ignore-scripts
npm run build
npm test
node --check viewer/workspace.js
node --check viewer/workspace-bridge.js
python scripts/check-workspace.py reports/workspace
```

浏览器需要安装 CI 指定版本的 Playwright/Chromium；普通使用不需要这些测试依赖。CI 已接入新的工作区脚本与两份浏览器脚本语法检查，Linux/Windows 均会执行，固定真实样本仍沿用原静态验证链。

本地最终验收命令使用 Node `/tmp/repographia-python-qa/playwright/driver/node`（22.18.0）、`PYTHONPATH=/tmp/repographia-python-qa`、`FONTCONFIG_FILE=/tmp/repographia-dark-fonts.conf` 及 Chromium `/tmp/rg-ui-browser131/chrome-headless-shell-linux64/chrome-headless-shell`。工作区输出 `/tmp/repographia-m1-final-workspace-qa`，CSP 夹具 `/tmp/repographia-m1-final-report-csp`；临时目录不是远端接手依赖，CI 会重新生成并上传受测产物。

接下来完成本轮 PR 的 Windows/Linux 与固定样本验收，按实际结果更新检查点。M1 合并后用户仍直接使用 master。M2 按产品方向继续，不把当前自动完整重建或保留旧基线功能图宣传为功能增量已完成。
