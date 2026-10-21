# CP24：Windows 离线报告空白修复

2026-10-21。基线 master `54c8f583f8dda5bd1b5e02401000752b007b4949`，实现分支 `fix/windows-report-csp`。

## 实际复现与根因

用户的 analyze 成功，报告中有 138 文件、2892 非文件实体、14187 显式调用点、411 未解析调用；HTML 只有静态框架。上传 HTML 与 graph.json 的完整图数据一致。

HTML 中唯一可执行脚本含 716 个 CRLF。生成器按原始文本计算 SHA-256，得到 `cnhuYVknGHi0QE3vXX5OXAKmFgqQw9X3BXn1Q3FylSY=`；浏览器解析 HTML 时先把 CRLF/CR 规范化为 LF，实际计算为 `Ft64Kh07Q3C/hb8hdKQs49m8zhR9OaOiN3wXlmWVFQA=`，因此 CSP 拒绝执行。并非空图、缺少模型、缺少服务或用户安装步骤有误。

在 Chromium 144.0.7559.96 中加载上传原文件字节，复现 CSP console error，项目名/指标为空、目录节点数 0。只规范化运行脚本并更新其哈希后，原图不变，项目名、全部统计、6 个顶层节点及文件/实体/边界/功能页切换恢复，无页面异常或外部请求。该容器阻止 file:// 导航，采用保留字节的 set_content；这不是 Windows 实机 file:// 验证。

## 实现

- 在 src/report.ts 中规范化完整可执行脚本后，再把同一字符串用于哈希与嵌入，覆盖 viewer 文件和编译后纯工厂的 toString()；不只处理某个 JS 文件。
- 不修改 safeJson、graph.json、源码字符串、源码哈希、提取规则或映射语义；继续保留 hash-only script-src 与 connect-src none，没有增加 unsafe-inline/unsafe-eval 脚本权限。
- 静态启动提示仅在界面初始化完成后移除。脚本被拦截或初始化失败时不再只留无说明空白。
- 5 个 Node 回归测试使用隔离副本转换 viewer 与 dist JS，覆盖 LF、CRLF、CR、混合换行；校验浏览器规范化后的哈希、源码数据不变、注入文本仅为数据及错误哈希负例。不修改并行测试所用工作树。
- Linux 和 Windows 的 unit job 均增加实际 Chromium file:// 启动检查：4 种换行正例、旧版错误 CRLF 哈希及脚本篡改 2 个负例。正例检验目录、指标、各导航页和无异常/网络；负例必须被 CSP 拦截且显示静态提示。
- set_content 测试通过 read_bytes().decode('utf-8') 读取，不能使用会自动转换换行的 Python read_text()；错误 CRLF 哈希用例同时检查测试加载器不会掩盖原故障。

## 验证与追踪

本地 Node 22.16.0 / TypeScript 5.8.3（环境现有版本）构建及标准 npm test 成功：284 通过、0 失败、0 跳过；新 5 项 Node 回归及 6 个浏览器场景通过。锁定 TypeScript 5.9.3 的标准 npm test、Windows/Linux 实际 file:// 与固定真实样本由本次 PR 的 Verify 执行；最终受测 SHA、job 结果和合并 SHA 记录在 PR，不把本地替代验证称为锁定版本验证。

上传报告只用于本次会话内复现与修复，不把用户上传的源码、图数据或报告提交到 Git；CI 使用独立小型夹具及仓库已有固定样本。Codex-Monitor 未修改或执行。

## 更新使用

在 RepoGraphia 目录更新 master 并构建，重新生成新目录的 HTML：

```sh
git switch master
git pull --ff-only origin master
npm ci --ignore-scripts
npm run build
npm run analyze -- "../Codex-Monitor" --out "./reports/codex-monitor-r2" --include-source
```

打开新报告，不是旧 r1/index.html；若 r2 已存在则另用新名字。不要求关闭浏览器安全设置，也不需要启动 Web 服务。已有标注先导出保留，更新工具不会改写已有 HTML。
