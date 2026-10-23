# CP41 — M3 开发过程与结果审阅已完成本地验收

2026-10-23（Asia/Shanghai），分支 `feat/development-review`。从 M2 合并提交 `a89d60e5203e84b318e5033026c8402cdf588017` 开始；CP40 保存开始范围，其远端阶段提交为 `07f2f727b00e36d07cd47d538fff6e28cbbaee05`。M2 合并后 [Verify #57](https://github.com/yaelysia/RepoGraphia/actions/runs/39879719496) 也已 completed/success。

## 已完成切片

- 开发起点可固定目标、来源、明确功能范围和逐项验收点，旧标题任务兼容；建立起点的输入核对推进至 manifest 临时文件 fsync 后、唯一发布 rename 前。
- 纯核心固定前后代码与标注，分离功能说明、关联内容、原关联决定、引用核对与代码变化。对起点标注在起点／终点、终点标注在终点分别核对，起点已有失效不会变成本轮新增问题。
- 声明范围仅包括明确选定的功能；无变化目标仍可见，范围外功能提示人工核对。原标注路径相交只是检查线索；完整未归属检查不受 M1 40 条预览预算影响，也不把文件关联继承给所有实体。
- 人工代码审阅、外部核验结果自述、补充解释分开追加到固定比较，绑定任务、前后 snapshot／annotation digest 与比较摘要。新版本无继承审阅，历史保持只读；记录、源码和标注决定互不替代。
- 固定报告先写入不可变文件，记录与报告元数据一次发布。代码／标注／输入／记录序号冲突、存储失败、关闭状态拒绝写入；读取检查字节摘要、目标声明、记录对象归属与顺序。
- 暗色左右「开发审阅」保留名称与一句解释，支持固定功能／代码跳转、按对象记录、历史与 JSON 导出。草稿可在同一比较的源码与起点地图间往返；普通任务／版本切换仍保护草稿。延迟历史响应与轮询不能换绑或隐藏新输入。

功能使用与数据边界见 [开发过程与结果审阅](../development-review.md)。本轮没有运行目标项目、构建／测试或 Agent，没有改写用户试跑结果，没有修改 Codex-Monitor。新增验证命令／日志只作为带来源的文本记录；工具未独立执行或认证它们。

## 实际本地验收

| 检查 | 结果 |
| --- | --- |
| Linux / Node **22.18.0** / 锁定 TypeScript **5.9.3** 构建 | 通过 |
| 最终完整单元（标准 `node --test tests/*.test.mjs`） | **511 pass / 0 fail / 0 skip** |
| 新 M3 真 loopback + Chromium | **18 组全部通过** |
| 原 M1 真工作区回归 | **14 组全部通过** |
| 原 M2 功能建设回归 | **13 组全部通过** |
| 上述浏览器异常／外网请求 | 均 **0 / 0** |
| 修改／新增 JavaScript、Python 语法与 Git 空白检查 | 通过 |

浏览器环境：Playwright **1.55.0**，Chromium **140.0.7339.16**，中文 Noto CJK。独立服务与 headless 浏览器，没有操作用户现有浏览器。桌面、736px 左右布局、390px 无横溢及减少动效均验证，桌面和移动截图已实际查看。

新增 41 个单元用例：纯差异核心 22、工作区持久化 16、真实 HTTP 3。覆盖精确引用与 ID 重排、同路径新实体、缺少历史、原有失效、候选／截断、文件关联不传递、超过预览预算的归属、目标范围、UTF-8 记录预算、跨页 CAS、代码及仅标注变化、固定比较／对象伪造、关闭、损坏和失败恢复。持久化回归实际在 manifest 临时文件写入后修改源码，确认起点和审阅记录都不能发布。

独立审查修复并验证了两项边界：重开后记录对象需要继续核实属于原固定报告；读取历史的 HTTP 响应返回前新输入草稿时不能替换页面。浏览器用实际延迟响应验收后者。服务重启恢复原比较的 **5 条记录**，另一个代码版本独立保留 **1 条记录**，后续仅标注变化的比较仍没有继承记录。

## 本地证据位置与复跑

- 完整最终日志：`/tmp/repographia-m3-final-full.log`。
- M3：`/tmp/repographia-m3-review-complete-qa/development-review-checks.json`；同目录有桌面、移动、迟到表单截图和导出／恢复数据。
- M1：`/tmp/repographia-m3-m1-regression/workspace-checks.json`。
- M2：`/tmp/repographia-m3-m2-regression/feature-task-checks.json`。

```sh
npm ci --ignore-scripts
npm run build
npm test
python -m pip install playwright==1.55.0
python -m playwright install --with-deps chromium
python scripts/check-development-review.py reports/development-review
python scripts/check-workspace.py reports/workspace
python scripts/check-feature-tasks.py reports/feature-tasks
```

临时路径可能清理，源码、fixture 和脚本已纳入阶段提交；CI 会保存两平台报告和精确源码归档。生成报告、截图、临时工作区、源码样本及第三方依赖不提交公共仓库。

## 远端门禁与接手

上述结果是本地验收，**尚不能代替 M3 Windows/Linux/sample CI**。发布核对本地提交 tree 与 GitHub tree 一致，精确最终 HEAD/tree、PR、实际运行和合并状态记录在本轮 PR 描述。三个 job 对同一 HEAD 全部成功后合入 master；用户继续使用主分支。若只剩 CI 运行，记录实际状态，不阻塞等待或宣称已合入。

接手先核对最新远端分支、PR 与 CI；不要因聊天中断重做 M3。现有 CodeGraph/FeatureMap schema、分析规则、Agent 协议／Skill 1.3、旧离线评估与迁移保持兼容。界面启动 Agent、过程执行控制、自动判定目标完成和真实局部代码提取均不属于本阶段。
