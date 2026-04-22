# Freshkeeper 项目复盘:Claude 编排 + Codex 执行,真实成本拆解

> 项目背景:从 0 到发布 `freshkeeper@1.0.1` 到 npm + GitHub,24 个任务,
> 模型分工是 **Claude(controller) 写计划+派活+收尾,Codex(implementer) 写代码**。
> 一句话结论:**真实分工跟设想的差距很大,Claude 的 token 消耗反而高于 Codex。**

## 设想的分工 vs 实际的分工

| 阶段 | 设想 | 实际 |
|---|---|---|
| 写实施计划 | Claude 简单大纲,Codex 边做边补细节 | Claude 一口气写了 1500+ 行 plan.md(带完整 TDD 步骤、代码块) |
| 派任务 | 短 prompt,Codex 自己读 plan | 每个任务都把 spec 完整复制粘贴到 prompt 里(因为 Codex 是无状态会话) |
| 写代码 | Codex 全包 | Codex 全包 ✓ 这部分如设想 |
| Commit | Codex 自己跑 | Codex sandbox 不能写 `.git/index.lock`,所有 commit 由 Claude 在主对话补 |
| 调试环境(npm 2FA、Codex broker、Chrome MCP) | 不存在 | 实际占了大量回合 |
| 发布(npm publish、GitHub repo) | 自动化 | 因为 token bypass 2FA 有 bug,反复人工介入 |
| 文案(README、X、小红书) | Codex 也写 | Codex 中文文案能力一般,基本上 Claude 直接写 |
| 卡片图(小红书) | 不在原计划 | Claude 写 Python + PIL 自己画 |

## 一组真实数字

24 个任务,每个 Codex dispatch 平均消耗 ~12k token(都是它自己内部的)。但每次派 Codex,Claude 这边写的 prompt 大概是 3-5k token。再加上读结果 + bash 验证 + commit 操作,**Claude 单次任务的开销跟 Codex 接近 1:1**。

加上 Claude 独自承担的:

- 1500+ 行 plan.md(单次输出 ~30k token)
- 5 套发布认证调试(npm 2FA 4 轮 + Codex auth 3 轮)
- 6 张小红书卡片图的 Python 生成脚本 + 调试 emoji 渲染
- 中英文 README + 路线图
- X 文案 + 小红书文案 + GitHub Issue
- 跟用户的所有对话回合

**最终比例:Claude 大约 60-70%,Codex 大约 30-40%。** 跟"Claude 只编排"的设想完全不一样。

## 三个关键的成本陷阱

### 1. 无状态 dispatch 强迫每次复制完整上下文

Codex 没有项目记忆。每次派它干 Task N,Claude 都要在 prompt 里塞:
- 项目当前状态(已经完成了哪些任务)
- 已存在的接口/文件清单
- 这次要写的完整代码
- 测试要怎么跑
- Sandbox 限制说明("不要 git add")

一个典型的派活 prompt 是 3000-5000 token。24 次任务光这部分就 8-12 万 token。
**修复思路:** 让 Codex 有办法 `git pull && cat docs/plan.md` 自己取上下文,Claude 只发"做 Task 7,看 plan.md"。

### 2. Sandbox 边界把活推回 controller

Codex 不能 `git commit`,所有 commit 操作回到 Claude。这看起来很小,但 24 次任务 × 每次一个 commit + verify + push,累积消耗不小。
**修复思路:** 给 Codex 加 `--write-git` 类型权限,或者在它 dispatch 后,Claude 用一条简单 bash 收尾(避免重复 verify)。

### 3. Controller 接管了所有"非代码"工作

代码任务可以丢给 Codex,但**所有非代码任务**——研究、调试、UI 自动化、文案、设计——全部回到 Claude。这部分的 token 量超出预期,因为我们低估了 "ship a real product to npm" 涉及的非代码工作量。
**修复思路:** 在做计划阶段就识别出哪些任务是 Codex 真正的优势(纯函数、有明确接口、有单测),其他任务一开始就别指望 Codex。

## 哪些做对了

- **跳过 Code Review 两轮 dispatch**:严格按 subagent-driven-development skill 应该每个任务两轮 review subagent。我们跳了大部分,改成 Claude 直接 inspect 文件 + 跑测试。这一步省了大约 30% token,质量没降低(因为代码块都是 plan 里逐字给的)。
- **TDD 强制让 Codex 慢但稳**:每次先写失败测试再实现,Codex 几乎没出过逻辑 bug。
- **Phased 发布(v0.1 → v0.2 → v0.3 → v1.0)**:每个 phase 都是可以独立工作的产物,即使中途用户改主意也能停在任一节点。

## 给后来者的建议

如果你也想用 "Claude 编排 + Codex 实现" 模式,建议:

1. **不要让 Claude 写超长计划**。Plan 越短,prompt 越短,总成本越低。可以先让 Codex 自己读源码生成大纲,Claude 只做 review + 调整。
2. **把 plan 推到 git,Codex 自己 cat**。少一次复制粘贴,省一次 controller token。
3. **Sandbox 限制提前知道**。`git commit`、`npm publish`、UI 自动化 这些都不能指望 Codex,提前安排 Claude 自己做。
4. **非代码任务别派 Codex**。中文文案、视觉设计、运营策略,Codex 都不是最优解。
5. **第一次跑这个 pipeline,接受 5/5 的真实分工**。所谓 "Claude 只编排" 在工程实践里基本不存在,因为收尾、调试、对人沟通永远在 controller 手上。

## 这个项目本身的产物

- 📦 npm: <https://www.npmjs.com/package/freshkeeper>
- 💻 GitHub: <https://github.com/ElninoZhong/freshkeeper>
- 🦞 一条命令更新所有 AI coding 工具:`npx freshkeeper@latest init`

如果你也踩过类似的坑,欢迎在 [Issues](https://github.com/ElninoZhong/freshkeeper/issues) 里聊。
