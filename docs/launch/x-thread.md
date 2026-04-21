1/7 I got tired of updating Claude Code, Codex, OpenClaw, and Hermes one by one, so I built Freshkeeper. One command sets up a unified updater: `npx freshkeeper@latest init` @nousresearch @AnthropicAI @OpenAI

2/7 This matters if you use more than one AI coding tool — which is increasingly normal now. People mix assistants, CLIs, plugins, and skills, but maintenance is still fragmented and easy to ignore.

3/7 What it does:
- list / check / update your installed tools
- run scheduled update checks
- aggregate changelogs so you can see what changed without digging through everything

4/7 Current scope includes Claude Code, Codex, OpenClaw, and Hermes — plus related plugins and skills. The goal is simple: fewer scattered update flows, less version drift, less tool babysitting.

5/7 Install is one line. Copy, paste, done:
`npx freshkeeper@latest init`

6/7 Why open source? Because tool maintenance should be inspectable, forkable, and easy to extend. If you're already building your own stack, you should be able to own the update layer too.

7/7 Repo: https://github.com/ElninoZhong/freshkeeper
Package: https://www.npmjs.com/package/freshkeeper
