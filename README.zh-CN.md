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
现在很多人电脑里会同时装好几个 AI coding 工具，像 Claude Code、Codex、OpenClaw、Hermes，再加上一堆 plugin、skill 和本地 MCP 组件。问题是，装完以后很容易就忘了更新，结果不同工具版本越拖越乱。Freshkeeper 就是把这件事收拢成一条命令：一次帮你更新具备安全更新路径的组件，再把高风险跳过项和 changelog 明确列出来。

## 安装与第一次运行
最省事的方式是直接运行：

```bash
npx freshkeeper@latest init
```

它会先自动检查你电脑上已经装了哪些受支持的工具，然后帮你跑第一次更新。跑完之后，还会问你要不要顺手配一个每周自动执行的计划，后面基本就不用自己记了。

## Agent Skill

可以直接从本仓库安装两条职责独立的 Freshkeeper Skill：

```bash
npx skills add ElninoZhong/freshkeeper --skill freshkeeper-check -g -y
npx skills add ElninoZhong/freshkeeper --skill freshkeeper-update -g -y
```

这两条 Agent Skill 管理的是用户已经安装的 Skill 库，不是 Freshkeeper CLI，也不是 AI coding 工具本体。它们优先使用 Universal 共享库；如果共享库不存在，就自动检查 Claude Code、Codex、OpenClaw 和 Hermes 各自的用户级 Skill 库。v1.2 起，`$freshkeeper-check` 会从已核验目录和本地证据恢复缺失的 GitHub 来源，比较整个 Skill 目录，并回溯上游历史，把干净旧版与本地定制区分开。`$freshkeeper-update` 会先完整备份，只自动处理能够证明安全的 clean-old 和 current-subset，通过三方校验更新。带本地扩展、需要合并、本地领先或已被上游删除的 Skill 都会保留并单独报告。

v1.5 的 `$freshkeeper-check` 会先确认所有选中 Skill 的本地版本与目录指纹，再查询线上版本。支持官方 well-known 文件清单比较；明确要求“补全缺失版本号和来源追踪”时，可先预览、备份，再原子写入有依据的来源与内容版本。普通检查保持只读，已安装版本与线上版本分别记录，补全模式不更新 Skill 内容。

## 命令
| 命令 | 作用 |
|---|---|
| `freshkeeper init` | 分别选择主要 Agent 与 claude-mem provider，保存 adapter 计划并执行第一次更新，可选安装每周计划任务（`--agent ... --memory-provider codex|claude|gemini|openrouter`） |
| `freshkeeper list [component]` | 查看 `all`、`agent`、`plugins`、`skills` 或 `mcp` 的安装状态；省略时为 `all` |
| `freshkeeper check [component]` | 对指定部件执行非写入式检查，并逐项标明完整可检查、部分可检查或无法预检；覆盖不完整时绝不宣称全部最新 |
| `freshkeeper update [component]` | 更新指定部件，报告显式跳过项并输出 changelog；例如 `freshkeeper update plugins` |
| `freshkeeper lock` | 把当前项目的精确版本写入 `freshkeeper.lock.json` |
| `freshkeeper restore` | 按最近一层项目锁恢复并校验版本 |
| `freshkeeper update --respect-lock` | 遵守项目锁，不越过已锁定版本 |
| `freshkeeper schedule <cron>` | 安装一条 crontab 定时任务；用 `schedule off` 删除 |

## 支持的工具
| 适配器 ID | 显示名称 | 安装方式 | 会更新什么 |
|---|---|---|---|
| `mcp-components` | MCP Components | 按用户选择的所有者发现 | 检查 `claude-mem`、`mcp-remote`、`gbrain`；目前只自动更新并验证所选所有者的 `claude-mem` |
| `claude-code` | Claude Code CLI | 官方安装器 | `claude update` |
| `claude-plugins` | Claude Code Plugins | 通过 `claude plugin install` 安装 | 每个插件用 `claude plugin update <name>` 更新 |
| `codex-plugins` | Codex Plugins | Codex Plugin marketplace | 刷新用户管理的 Git marketplace，并通过幂等 `codex plugin add` 更新或修复已安装 Plugin；宿主管理的 Plugin 只报告，MCP Plugin 交给 MCP adapter |
| `skills-cli` | Skills CLI (`skills.sh`) | `npm i -g skills` 或固定版本的 `npx` 回退 | 只刷新有效 `skills-lock.json` 中列出的 GitHub skill；lock 缺失或损坏时 fail closed |
| `codex` | OpenAI Codex CLI | standalone 或 npm 安装 | 解析 npm 精确最新版本，调用当前 PATH 生效 CLI 的 `codex update`，并复核最终 `codex --version` |
| `openclaw` | OpenClaw | `npm install -g openclaw@latest` | `openclaw update --channel stable` + `openclaw skills update` |
| `hermes` | Hermes Agent | `curl` 安装脚本 | `hermes update` + `hermes skills update` |

## 配置文件
位置：`~/.freshkeeper/config.json`

```json
{
  "primaryAgent": "codex",
  "memoryProvider": "codex",
  "enabledAdapters": ["mcp-components", "codex-plugins", "skills-cli", "codex"],
  "schedule": { "enabled": true, "cron": "0 10 * * 1" },
  "notify": { "enabled": true, "macNotification": false }
}
```

`freshkeeper init` 会分别询问 Freshkeeper 管理哪个 Agent、由哪个 provider 生成 claude-mem 观察。`primaryAgent` 决定 MCP 所有者；`memoryProvider` 传给受管的 claude-mem 安装器；`enabledAdapters` 仍是真实执行边界。未知 ID 会明确报错，不会静默忽略。

初始化前不启用任何 Agent adapter；这个 fail-closed 默认保证 Freshkeeper 不会替用户猜测该管理 Claude、Codex 还是其它已安装工具。

已有配置不会被新版本静默扩大。升级到包含 `codex-plugins` 的版本后，重新运行 `freshkeeper init --agent codex --memory-provider <provider>`，确认后才会把 Plugin adapter 加入执行计划。

### Check 与 Update 契约

- `check` 会给每个已安装、已启用的 adapter 标注 `complete`、`partial` 或 `unavailable`，并显示覆盖统计。
- 已确认的新版本还会标明 `update` 或 `skip`；例如高风险 MCP 会在检查阶段就说明更新时将被跳过及原因。
- 只有所有 adapter 都完整可检查且没有候选更新时，才会输出“没有待更新项”。
- 覆盖不完整时，输出是“没有确认到更新”，而不是“全部最新”。
- 具备确定性预检的 adapter 会让 `update` 执行同一份版本判断；例如 Codex 已是最新时不会重复安装。
- `update` 会把真实版本或内容哈希变化计入 `updated`，把命令执行成功但状态未变化计入 `already current`，两者不再混报。

记忆 provider 的费用边界：

| Provider | 认证与费用 |
|---|---|
| `codex` | 复用 ChatGPT OAuth；不需要额外 API key 或 API 账单，但消耗 ChatGPT/Codex 套餐额度 |
| `claude` | 订阅 OAuth 消耗 Claude 套餐额度；API key / gateway 模式另行计费 |
| `gemini` | 需要 Gemini API key，受免费层限制或单独计费 |
| `openrouter` | 需要 OpenRouter key 与余额；免费模型除外 |

## 项目级锁定

在项目根目录运行 `freshkeeper lock`，会生成可审查、可提交到仓库的 `freshkeeper.lock.json`。第一版锁定范围包括 Claude Code 精确版本、已安装 Claude plugins 清单、Skills CLI 精确版本，以及同时记录 40 位 Git commit 和 SHA-256 内容哈希的 GitHub skills。

`freshkeeper restore` 会向上寻找最近一层项目锁；`freshkeeper update --respect-lock` 走同一条恢复链，显式遵守锁的更新不会悄悄越过项目声明的版本。`enabledAdapters` 中已关闭的 adapter 仍然不会被触碰；普通的全局 `freshkeeper update` 行为保持不变。

Skills 会先安装到临时项目，核对 commit 和内容哈希，再备份、应用并做一次落盘后校验。中途任一步失败，都会恢复原来的项目 skill 和 `skills-lock.json`。

Claude Code 支持安装精确版本。Claude plugins 官方命令没有通用的降级能力：Freshkeeper 会在锁定版本仍可获得时完成安装或升级，并校验最终版本和启用状态；如果需要降级或 marketplace 已不再提供该版本，就明确失败，不会假装恢复成功。额外的全局 plugin 不会被删除。

### Skills 安全规则

- Freshkeeper 会从当前目录向上寻找最近的 `skills-lock.json`；也可以用 `FRESHKEEPER_SKILLS_CWD` 显式指定。
- 没有 lock 时安全跳过；lock 格式错误时报告失败，绝不会扩大更新范围。
- 只有显式设置 `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1`，才允许执行宽泛的 `skills update -y`。
- 自动 npx 回退使用固定版本的 Skills CLI，不再选择 npm 缓存里修改时间最新的副本。

### MCP 组件安全规则

- Freshkeeper 先判断 MCP 的所有者，不把所有服务器都当成 npm 包。
- `claude-mem` 跟随 `primaryAgent`：Codex 走官方定版 npm 安装器和 Codex 自有 worker，Claude 走 Claude 插件管理器；两条路径都会复核安装版本和运行健康。
- `mcp-remote` 在具备分阶段安装、真实 `initialize`/`tools/list` 验证、配置切换和回滚之前只报告并跳过。
- `gbrain` 在备份数据与配置、执行迁移并通过 `doctor` 和 MCP 探针之前只报告并跳过。
- 远程 HTTP MCP，以及随 App/插件分发的 MCP，由其所有者更新，本 adapter 不会本地覆盖。

### Codex Plugin 安全规则

- Freshkeeper 把 Plugin 视为可能同时携带 Skills、MCP、Hook、浏览器扩展和任务模板的完整组件，不直接改写其缓存目录。
- 用户管理的 Git marketplace 先通过 `codex plugin marketplace upgrade` 刷新，再用幂等 `codex plugin add` 重装已安装 Plugin，并复核版本与缓存清单。
- 用户管理的本地 marketplace 只有在源版本变化或缓存损坏时才重装；无版本变化的健康缓存不重复写入。
- `openai-bundled`、`openai-primary-runtime`、官方远程 Plugin 等 Codex／ChatGPT 宿主管理内容只报告，不和宿主争夺所有权。
- `claude-mem` 等由 MCP adapter 承担重启和健康检查的 Plugin，不会被 Plugin adapter 重复更新。

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
A：先运行 `freshkeeper init --agent <名称>`，再检查生成的 `enabledAdapters`。Skills lock 与 crontab 会 fail closed，但启用的 adapter 仍然会执行真实的第三方更新命令。

**Q：Freshkeeper 会更新所有已配置 MCP 吗？**
A：不会。它先判断所有权。目前只有 `claude-mem` 具备自动更新与验证链；高风险本地迁移会显式跳过，远程或宿主管理的 MCP 只报告状态。

**Q：可以只更新 Plugin，不动其它部件吗？**

A：可以。使用 `freshkeeper check plugins` 和 `freshkeeper update plugins`。同理也可以单独选择 `agent`、`skills` 或 `mcp`。

**Q：为什么有些部件显示“无法预检”？**

A：对应上游只提供会产生写入的更新命令，没有可靠的只读最新版本接口。Freshkeeper 会明确保留这个未知状态；执行 `update` 后再通过版本或内容哈希确认到底是否发生变化。

**Q：那 Cursor / Windsurf / Aider 呢？**  
A：仍在路线图中。

## 路线图
正在推进，欢迎在 issue 里一起讨论。

- [x] [#1 项目级 lockfile 支持](https://github.com/ElninoZhong/freshkeeper/issues/1)——按项目锁定、恢复并遵守 Claude Code、plugin、Skills CLI 与 GitHub skill 的精确版本
- [x] 面向用户已安装 Skill 库的 `freshkeeper-check` 与 `freshkeeper-update` Agent Skills——支持来源恢复、历史匹配、三方更新、备份和非破坏边界
- [x] MCP 组件所有权盘点、`claude-mem` 自动更新验证和高风险显式跳过
- [x] Codex Plugin 所有权盘点、用户 marketplace 更新、缓存修复和按部件执行命令
- [ ] Cursor / Windsurf / Aider / Gemini CLI 适配器
- [ ] 更新完自动发 macOS 原生通知
- [ ] Windows 支持（走 Task Scheduler）
- [x] GitHub Actions OIDC + Trusted Publisher 自动发版

## 参与贡献
当前权威与安全边界见 [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) 和 [`CONTEXT.md`](CONTEXT.md)。新增 adapter 请从 [`src/adapters/types.ts`](src/adapters/types.ts)、[`src/adapters/catalog.ts`](src/adapters/catalog.ts) 和 [`tests/adapters/`](tests/adapters/) 开始；[`docs/plan.md`](docs/plan.md) 是历史初始施工计划，不是现役接入指南。

## 许可证
MIT
