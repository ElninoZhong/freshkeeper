# 🦞 Freshkeeper

> **一条命令，更新你电脑上所有 AI coding 工具**——OpenClaw、Hermes、Claude Code、Codex 以及它们的 plugin 和 skill。

[English](README.md) | 中文

🌏 [English](README.md)

The unified update keeper for OpenClaw, Hermes, Claude Code, and Codex users.

![npm](https://img.shields.io/npm/v/freshkeeper)
![CI](https://img.shields.io/github/actions/workflow/status/ElninoZhong/freshkeeper/ci.yml)
![License](https://img.shields.io/github/license/ElninoZhong/freshkeeper)
![Node](https://img.shields.io/node/v/freshkeeper)

> 📹 Demo GIF 即将补上

## 为什么要用 Freshkeeper？
现在很多人电脑里会同时装好几个 AI coding 工具，像 Claude Code、Codex、OpenClaw、Hermes，再加上一堆 plugin 和 skill。问题是，装完以后很容易就忘了更新，结果不同工具版本越拖越乱。Freshkeeper 就是把这件事收拢成一条命令：一次帮你把这些工具更新完，再顺手把 changelog 汇总出来，你不用自己一个个进去看。

## 安装与第一次运行
最省事的方式是直接运行：

```bash
npx freshkeeper@latest init
```

它会先自动检查你电脑上已经装了哪些受支持的工具，然后帮你跑第一次更新。跑完之后，还会问你要不要顺手配一个每周自动执行的计划，后面基本就不用自己记了。

## 命令
| 命令 | 作用 |
|---|---|
| `freshkeeper init` | 交互式初始化：检测已安装工具、执行第一次更新、安装每周计划任务 |
| `freshkeeper list` | 查看当前支持的工具里，哪些已经安装，以及各自版本 |
| `freshkeeper check` | 检查有没有可更新内容（支持的地方会尽量用 dry-run） |
| `freshkeeper update` | 更新所有已安装工具，然后输出本次更新到的 changelog |
| `freshkeeper schedule <cron>` | 安装一条 crontab 定时任务；用 `schedule off` 删除 |

## 支持的工具
| 适配器 ID | 显示名称 | 安装方式 | 会更新什么 |
|---|---|---|---|
| `claude-code` | Claude Code CLI | 官方安装器 | `claude update` |
| `claude-plugins` | Claude Code Plugins | 通过 `claude plugin install` 安装 | 每个插件用 `claude plugin update <name>` 更新 |
| `skills-cli` | Skills CLI (`skills.sh`) | `npm i -g skills` 或固定版本的 `npx` 回退 | 只刷新有效 `skills-lock.json` 中列出的 GitHub skill；lock 缺失或损坏时 fail closed |
| `codex` | OpenAI Codex CLI | Claude 插件 `codex@openai-codex` | `claude plugin update codex@openai-codex` |
| `openclaw` | OpenClaw | `npm install -g openclaw@latest` | `openclaw update --channel stable` + `openclaw skills update` |
| `hermes` | Hermes Agent | `curl` 安装脚本 | `hermes update` + `hermes skills update` |

## 配置文件
位置：`~/.freshkeeper/config.json`

```json
{
  "enabledAdapters": ["claude-code", "claude-plugins", "skills-cli", "codex", "openclaw", "hermes"],
  "schedule": { "enabled": true, "cron": "0 10 * * 1" },
  "notify": { "enabled": true, "macNotification": false }
}
```

`enabledAdapters` 是真实执行边界：未写入数组的 adapter 不会被检测或更新；未知 ID 会明确报错，不会静默忽略。

### Skills 安全规则

- Freshkeeper 会从当前目录向上寻找最近的 `skills-lock.json`；也可以用 `FRESHKEEPER_SKILLS_CWD` 显式指定。
- 没有 lock 时安全跳过；lock 格式错误时报告失败，绝不会扩大更新范围。
- 只有显式设置 `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1`，才允许执行宽泛的 `skills update -y`。
- 自动 npx 回退使用固定版本的 Skills CLI，不再选择 npm 缓存里修改时间最新的副本。

## 定时更新
```bash
freshkeeper schedule "0 10 * * 1"   # 每周一上午 10 点
freshkeeper schedule off            # 删除定时任务
```

Freshkeeper 会校验单行 cron 表达式，保留其它 crontab 内容，并通过 stdin 写入托管区块，不再拼接 shell 命令。

## 常见问题
**Q：这会取代 `claude plugin update` 或 `npx skills update` 吗？**  
A：不会。Freshkeeper 只是把这些原本就有的命令打包起来，集中一次跑完。

**Q：Freshkeeper 怎么更新项目里的 skills？**  
A：只有找到有效 `skills-lock.json` 时，才会对其中 GitHub 来源的 skill 执行 `skills add <source> --skill <name> --agent universal -y`。没有 lock 就不写 skills；全局刷新必须显式设置环境变量授权。

**Q：可以放心开自动运行吗？**  
A：先配置好 `enabledAdapters`，并确认每个启用的更新器都符合你的预期。Skills lock 与 crontab 现在会 fail closed，但启用的 adapter 仍然会执行真实的第三方更新命令。

**Q：那 Cursor / Windsurf / Aider 呢？**  
A：已经在 v1.1 的路线图里。

## 路线图
正在推进，欢迎在 issue 里一起讨论。

- [ ] [#1 项目级 lockfile 支持](https://github.com/ElninoZhong/freshkeeper/issues/1)——把一个项目依赖的 CLI + plugin + skill 版本锁住，避免版本错配被误判为模型问题
- [ ] Cursor / Windsurf / Aider / Gemini CLI 适配器（v1.1）
- [ ] 更新完自动发 macOS 原生通知
- [ ] Windows 支持（走 Task Scheduler）
- [ ] GitHub Actions OIDC + Trusted Publisher 自动发版

## 参与贡献
如果你想了解项目结构、实现思路，先看 [`docs/`](docs/)。如果你想新增一个适配器，建议从 [`docs/plan.md`](docs/plan.md) 开始。

## 许可证
MIT
