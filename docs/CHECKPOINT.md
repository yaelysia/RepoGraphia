# RepoGraphia 当前检查点

## CP17：显式跨快照迁移已实现，等待锁定 CI

2026-10-20；分支 `feat/feature-migration-r1`，基于 CP15 `206dd363dcc023a8ab88590878cdabb62b44fcd8` / PR #4。先读 AGENTS.md、docs/feature-migration.md、docs/feature-mapping.md，再核对本分支之后的提交。CP16 计划提交 `b95fbecd956cf1938d8ca66299e0ad975a3b803f`。上游 #2/#3/#4 仍按顺序依赖；本轮没有合并或覆盖它们，也没有修改 Codex-Monitor。

## 本提交内容

纯 plan/apply、精确引用/邻域比较、显式 carry/replace/defer、版本及双基线检查、schema 2 每映射 provenance、保留旧记录、旧接受退回待审和拒绝保留。CLI、离线预览/确认、人工选择当前实体、暂缓保留失效、关联修正表单及新测试/验证脚本均已落地。分析规则4、CodeGraph1、目录投影1不变。

## 本地实际验证

Node22.16.0 / 可用 TypeScript5.8.3，全部测试文件分别运行为232项通过（新增迁移34项）；辅助浏览器新迁移25项、旧功能映射32项通过（系统Chromium/set-content）。完整 npm test 在助手容器多次超时，未把逐文件执行冒充标准命令成功；CI须使用正常 npm test、锁定TypeScript5.9.3验证。

旧图来自实际CI报告，6条原始功能提案引用可复用。独立源码夹具真正修改/删除文件得到1可复用、2需审阅、1无匹配。不把夹具或安装目录变化称作Codex-Monitor业务变更，所有示例保持agent/proposed。

## 下一步 / CP18

创建本分支PR并检查Windows/Linux、同输入静态图、原30+24+32浏览器检查和新增25项迁移检查。修复实际回归后再记录完整测试提交/run、产物哈希和当前PR状态。交付包排除自动浏览器产生的人工标签测试草稿。

```sh
git fetch origin
git switch feat/feature-migration-r1
npm ci --ignore-scripts
npm test
node dist/cli.js features plan old-graph.json new-graph.json features.json --out migration-plan.json
```

无本地分支时使用 git switch --track origin/feat/feature-migration-r1；不得reset/clean覆盖用户工作。迁移操作必须在旧图与新图均有留存时执行。页面只编辑内存，需导出JSON。不要加入自动AI归纳、GitDiff、运行时追踪或增量分析；尚未启动这些范围。
