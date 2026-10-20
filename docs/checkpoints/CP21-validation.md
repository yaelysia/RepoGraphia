# CP21 — Agent CLI 与 Skill 验证记录

## 精确实现与流水线

分支feat/agent-cli-skill-r1 / PR#6；基线CP18 801c47d70e045ce4b6e70c410b70f4a03b440725。
完整实现HEAD：0b5eb39956ce5de3ae5efefb93141a5101517b81；tree aa519945a014284d851c177d542cb1aa67ca5466。
Verify#30：39409249812，completed/success；实际CI合并提交109a01f3e0d29ce75cc9be5586bd4bfec86dcfc9。

| 任务 | job ID | 实际结果 |
| --- | --- | --- |
| Linux | 118582653719 | npm test 272 pass / 0 fail / 0 skip |
| Windows | 118582653900 | npm test 269 pass / 0 fail / 3既有权限skip |
| 固定样本与页面 | 118582654053 | 所有静态对照、迁移、Agent复播及5套浏览器脚本成功 |

Node22.23.3，npm ci安装锁定TS5.9.3。单元结果已阅读原始Linux/Windows日志，非借用基线计数。新增37项Agent回归和3项Skill/试跑清单lint；lint不衡量宿主自动触发率。

Verify#29（39408671262）Windows曾因Skill头部regexp只接受LF而失败，实际268pass/1fail/3skip；CP20c修正为兼容LF/CRLF，并新增错误名称/缺描述负例，没有跳过或删除用例。#30为修正后的独立运行。本地Node22.16.0/TS5.8.3的新40项通过仅是辅助验证，不等于本地锁定全量npm test已运行。

## 自用与复播必须分开

**作者真实自用**：按冻结Skill1.0执行25条CLI命令，输出源码/原关系/候选停止依据，保留初稿。首稿2功能5映射4引文格式检查通过，但表达仍有缺陷。Skill1.1增加逐主张证据表、用户动作对照、适用条件前置、关键候选停止页检查；补查19-22，修订为2功能7映射13引文，最终check和submit成功。

新功能为桌面告警展示与点击处理、前台会话弹窗抑制。没有重复旧采集提案，原3功能6映射及9条历史原样保留。新增仍agent/proposed；最终5功能13映射，文档revision18，accepted=0。功能正确性不能由引用核验推出。作者认为该有限区域初审质量基本满意，匿名回调命名与跨模型泛化仍不足。

自用输入graph字节SHA256：df3a3dd58267d5d5afe2d4b49a470cf75dcf943dfd3da89949e3b6489be57ad4。
原sidecar字节SHA256：df9f6d35c06d0bc3c1b500fc98fcb89a609bdb73b1d05ac315e37cdd9f89a9f7。
解析后baseDigest：e255fe3f832e7cf5e650987afadd376a8862cf4cd44cc0d6c76851b0654fe35a，revision9。
固定snapshot：18dbe44a94c58882d91a6cfb13b550f7a96ad37b7453e3d5336952e40f05776b。
Skill1.0原文SHA256：134957df53020fad1c64fbcf9313f02707d025bb9af9890a1f295f16e8f37006。
Skill1.1受测原文SHA256：b4db7cf040d376f49441d5711c6bf32bc0a60c5f788056400993cd346f024190。

`docs/trials/agent-notification/commands.json`记录25条实际命令及stdout哈希；下载交付包可查看原始queries和commands.jsonl。25条输出已逐一核验摘要。仓库的提案压缩了JSON空白，但与实际试跑提案逐字段相等。仅manifest并非完整原输出的Git备份，清楚区分恢复代码与复核当时对话的需求。

**CI确定性复播**：scripts/verify-agent.mjs固定样本提交/规则及三个实际源码哈希，读取冻结提案语义部分，显式使用当前CI图和sidecar头部。此步骤仅限固定输入测试，生产Agent不得自行换snapshot。复播11次CLI（包含拒绝重复输出的预期失败），核验旧标注历史、只追加proposed和原始输入不变。它没有调用模型，不是独立第二次语义试验。CI graph字节SHA256为68da4f4d4925d211aeebe24aebbfca844362860f38dcfea03df96801b5da9dda；生成时间等元数据使字节不等于自用输入，不能混称原文件。

## 浏览器与分析不变性

既有源码/来源30、项目地图24、功能映射32、迁移25项全部脚本成功；新Agent报告14项成功，实际file://导航，无异常与外部网络请求。新检查包含两种交互区别、适用条件、proposed/candidate保留、共享实体反向功能入口和源码导航。自用报告本地用set-content辅助检查14项，不能代替CI真正file://验证。

固定Codex-Monitor：490d822a9593d8d4b78a9188dd0daa0ae791eaf6。与CP18分析器在同一源码及类型依赖目录中比较files/nodes/relations/coverage/diagnostics完全一致：131文件、2630实体、12978调用点、363未解析、0诊断。新旧snapshot因分析器安装位置不同不相等，不把它说成业务代码改变。目标应用/业务测试未执行，Codex-Monitor未被修改。

## 受测产物

| 产物 | ID | 下载后ZIP SHA256 |
| --- | --- | --- |
| checkpoint-source | 12258836290 | 83932fc9c9f655b6b2120804ee7e0e599522beff3b4c9f8db1f7b09301951635 |
| codex-monitor-report | 12258179429 | 1f368a153d53f249d5fbd0cb442ccc2505ebfe39c4c120a27ba1e80003f6409b |

两个ZIP均已验证哈希。源码归档的11个主要实现/测试/Skill文件与本地受测字节相等；提案/命令清单与实际记录语义相等。报告131个源码哈希、自用与CI两个HTML的内嵌图/标注与对应独立JSON、13个UTF16引文位置以及旧标注/历史前缀均复核通过。已打开真实CI审阅截图。

试用包排除其他浏览器测试生成的manual决策文件及负例页面，只包含作者原始全proposed提案、报告、输入、Skill和实际试跑记录；CI摘要单独标记。精确测试源码归档30天到期，长期恢复依靠远端提交；原始作者输出随完整试跑包交付。

本CP21纯文档提交之后的最终HEAD/CI状态记录在PR#6，不将这个新增文档提交冒充#30实际被测HEAD。
