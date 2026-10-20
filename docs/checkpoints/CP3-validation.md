# CP3 — 本轮验证与交付记录

## 精确版本

- 实现 HEAD：`5f3b3498ca2f9142dc5d402e40309c55c5a8d906`。
- 基线 master：`3987fb218bdcff4973329c0d13fcc1ea9a341b52`。
- PR #2 分支：`fix/r1-evidence-checkpoints`。
- Verify #9：`39274258988`，已核查为 completed/success。
- CI 合并测试提交：`276152ef111d6d13442fe9a0f1b941a87523db80`。
- 本记录为随后添加的纯文档检查点，不将文档 HEAD 冒充为前述 CI 实际测试对象。

## 实际测试结果

| job | ID | 结果 |
| --- | --- | --- |
| unit (ubuntu-latest) | 118134302421 | Node 22.23.3，57 pass / 0 fail / 0 skip；构建与 viewer 语法检查成功 |
| unit (windows-latest) | 118134301990 | Node 22.23.3，54 pass / 0 fail / 3 skip；构建与 viewer 语法检查成功 |
| sample | 118134302480 | 固定样本静态断言和 Chromium 14 项页面检查成功 |

通过 `npm ci --ignore-scripts` 安装锁定依赖；TypeScript 为 5.9.3。Windows 的 3 项跳过是原有需要符号链接权限的用例，不是本轮新增测试被跳过。新增 15 项均执行并通过。

页面覆盖文件/符号选择、空搜索、状态筛选、关系证据、缩放复位、边界展示、窄屏布局、脚本注入哨兵、当前分析规则版本及旧版数据缺失版本时的显示。CI 使用 file:// 导航；本地因容器策略使用 --set-content 再次复核同一产物，返回 14 checks、0 browserErrors、0 外部网络请求，不替代 CI 导航检查。

## Codex-Monitor 只读样本

固定提交 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`。报告 `analysisRevision=2`，snapshot 为 `e74a96cf088b62297f7e6ffa80bc55dd1122844f9a1ae58b3bd1083813ef087e`。

- 131 个索引文件，2630 个非文件实体，12978 个显式调用点。
- 2835 bound、1723 candidate、2755 unresolved、5665 external；分母是调用点数量，不是人工确认的准确率。
- 31 个源码文件未索引，0 条编译诊断。未索引语言/范围仍在报告内列明。
- 验证了 `monitor-service.collect → collector.refresh`、`collector.scanLocal → local.scanLocal`、`local.inferStatus → rollout.inferStatus`，以及不伪造 IPC 直接调用的断言。
- CI 安装样本类型依赖时禁止生命周期脚本；没有运行样本应用或业务测试，没有写入目标仓库。

## 可复核产物

同一 Verify #9 提供：

| 产物 | artifact ID | ZIP SHA-256 |
| --- | --- | --- |
| checkpoint-source | 12196157762 | `e98a3db9842e9d76e27d6f75c2a3e130fa1d64f675ddf83ecdb8dc849a41dcb4` |
| codex-monitor-report | 12197570455 | `faf37d9b35ca52969e21a2bf33aaa5e46829fcb722f2afccad3b4f363659d650` |

下载后已校验上述 ZIP 哈希；从源码归档取出的 9 个代码/测试/文档修改文件与本地受测版本逐字节一致。报告包含 index.html、graph.json、summary.json 和真实 Chromium 截图，已打开截图检查。源码产物保留 30 天，Git 提交和检查点记录是长期接手依据。

实现提交全部已保存远端，不依赖助手临时目录。PR #2 的最终 HEAD/CI 可能继续包含本纯文档记录，请以 PR 页面状态识别后续提交，不把不同运行混在一起。
