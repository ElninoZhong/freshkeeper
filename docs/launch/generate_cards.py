#!/usr/bin/env python3
"""Generate 6 Xiaohongshu cards for Freshkeeper launch post."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent / "cards"
OUT.mkdir(exist_ok=True)

W, H = 1080, 1350  # Xiaohongshu 3:4
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
MONO = "/System/Library/Fonts/Menlo.ttc"
EMOJI = "/System/Library/Fonts/Apple Color Emoji.ttc"
# Apple Color Emoji only allows sizes: 20, 32, 40, 48, 64, 96, 160

def font(size, path=FONT, idx=0):
    return ImageFont.truetype(path, size, index=idx)

def paste_emoji(img, emoji, target_size, center_x, top_y):
    """Render emoji at native size 160 then resize to target_size, paste at position."""
    em = Image.new("RGBA", (176, 176), (0, 0, 0, 0))
    d = ImageDraw.Draw(em)
    f = ImageFont.truetype(EMOJI, 160)
    d.text((8, 0), emoji, font=f, embedded_color=True)
    if target_size != 160:
        em = em.resize((target_size, target_size), Image.LANCZOS)
    img.paste(em, (center_x - target_size // 2, top_y), em)

def draw_centered(draw, text, y, fnt, fill="#1a1a1a"):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    w = bbox[2] - bbox[0]
    draw.text(((W - w) / 2, y), text, font=fnt, fill=fill)

def gradient_bg(color_top, color_bot):
    img = Image.new("RGB", (W, H), color_top)
    d = ImageDraw.Draw(img)
    r1, g1, b1 = color_top
    r2, g2, b2 = color_bot
    for y in range(H):
        t = y / H
        r = int(r1 + (r2 - r1) * t)
        g = int(g1 + (g2 - g1) * t)
        b = int(b1 + (b2 - b1) * t)
        d.line([(0, y), (W, y)], fill=(r, g, b))
    return img


# Card 1 — Cover
def card_1():
    img = gradient_bg((255, 98, 108), (255, 166, 107))
    d = ImageDraw.Draw(img)
    paste_emoji(img, "🦞", 300, W // 2, 160)
    d = ImageDraw.Draw(img)
    draw_centered(d, "一条命令", 560, font(120, idx=1), fill="#ffffff")
    draw_centered(d, "同步电脑里所有", 720, font(72, idx=1), fill="#ffffff")
    draw_centered(d, "AI 编程工具", 820, font(96, idx=1), fill="#ffffff")
    d.rectangle([(W // 2 - 200, 1000), (W // 2 + 200, 1003)], fill="#ffe5d0")
    draw_centered(d, "FRESHKEEPER", 1040, font(54, MONO, idx=1), fill="#ffffff")
    draw_centered(d, "v1.0.1 · 开源 · MIT", 1130, font(34), fill="#fff0e0")
    img.save(OUT / "card-1-cover.png")


# Card 2 — Problem
def card_2():
    img = Image.new("RGB", (W, H), "#f5f3ee")
    paste_emoji(img, "😮‍💨", 180, W // 2, 110)
    d = ImageDraw.Draw(img)
    draw_centered(d, "装 AI 工具一时爽", 340, font(66, idx=1), fill="#2a2a2a")
    draw_centered(d, "更新起来", 440, font(54, idx=1), fill="#2a2a2a")
    draw_centered(d, "真·酷刑", 530, font(96, idx=1), fill="#ff626c")

    items = [
        "Claude Code    →  claude update",
        "Claude Plugin  →  claude plugin update ×N",
        "Skills         →  npx skills update",
        "Codex          →  claude plugin update",
        "OpenClaw       →  openclaw update",
        "Hermes         →  hermes update",
    ]
    y = 750
    for item in items:
        d.text((90, y), item, font=font(32, MONO), fill="#555")
        y += 65
    draw_centered(d, "每次都要跑 6+ 次…", 1220, font(36), fill="#888")
    img.save(OUT / "card-2-problem.png")


# Card 3 — Solution
def card_3():
    img = gradient_bg((255, 235, 230), (255, 250, 245))
    d = ImageDraw.Draw(img)
    draw_centered(d, "我做了个开源工具", 200, font(56), fill="#666")

    paste_emoji(img, "🦞", 100, W // 2, 280)
    d = ImageDraw.Draw(img)
    draw_centered(d, "Freshkeeper", 410, font(110, idx=1), fill="#ff626c")

    d.rectangle([(W // 2 - 200, 560), (W // 2 + 200, 563)], fill="#e8b5a8")

    draw_centered(d, "它把这些更新动作", 630, font(52), fill="#2a2a2a")
    draw_centered(d, "全部收在一起", 720, font(60, idx=1), fill="#2a2a2a")
    draw_centered(d, "一条命令", 850, font(86, idx=1), fill="#ff626c")
    draw_centered(d, "就搞定了", 960, font(60, idx=1), fill="#2a2a2a")

    draw_centered(d, "不用记每个工具怎么更新", 1120, font(42), fill="#888")
    draw_centered(d, "也不用翻文档", 1190, font(42), fill="#888")
    img.save(OUT / "card-3-solution.png")


# Card 4 — Install command (terminal style)
def card_4():
    img = Image.new("RGB", (W, H), "#0f1419")
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([(80, 280), (1000, 900)], radius=16, fill="#1a1f26", outline="#2d333b", width=2)
    d.ellipse((110, 310, 140, 340), fill="#ff5f56")
    d.ellipse((155, 310, 185, 340), fill="#ffbd2e")
    d.ellipse((200, 310, 230, 340), fill="#27c93f")
    d.text((490, 318), "Terminal — freshkeeper", font=font(22), fill="#7d8590")

    d.text((120, 420), "$ ", font=font(38, MONO), fill="#7d8590")
    d.text((165, 420), "npx freshkeeper@latest init", font=font(38, MONO, idx=1), fill="#7ee787")

    outs = [
        ("✓", "#7ee787", "claude-code       2.1.116"),
        ("✓", "#7ee787", "claude-plugins    (4 plugins)"),
        ("✓", "#7ee787", "skills-cli        1.5.1"),
        ("✓", "#7ee787", "codex             0.122.0"),
        ("⚠", "#f0883e", "openclaw          (not installed)"),
        ("⚠", "#f0883e", "hermes            (not installed)"),
    ]
    y = 510
    for mark, color, text in outs:
        d.text((140, y), mark, font=font(30, MONO), fill=color)
        d.text((200, y), text, font=font(28, MONO), fill="#e6edf3")
        y += 52

    draw_centered(d, "就这一条。", 970, font(68, idx=1), fill="#ffffff")
    draw_centered(d, "扫描 + 更新 + 定时，全自动", 1070, font(38), fill="#9ba3af")
    draw_centered(d, "freshkeeper@1.0.1", 1200, font(32, MONO), fill="#7d8590")
    img.save(OUT / "card-4-install.png")


# Card 5 — Features (4 cards)
def card_5():
    img = Image.new("RGB", (W, H), "#fff9f5")
    d = ImageDraw.Draw(img)
    draw_centered(d, "它帮你做 4 件事", 130, font(70, idx=1), fill="#2a2a2a")
    d.rectangle([(W // 2 - 150, 240), (W // 2 + 150, 243)], fill="#ff626c")

    features = [
        ("🔍", "自动扫描", "看你装了哪些 AI 工具"),
        ("⚡", "一键更新", "CLI + plugin + skill 全覆盖"),
        ("⏰", "定时跑", "每周一早上 10 点自动执行"),
        ("📋", "Changelog", "更新完告诉你每个工具改了啥"),
    ]
    y = 330
    for emoji, title, desc in features:
        d.rounded_rectangle([(80, y), (1000, y + 180)], radius=24, fill="#ffffff", outline="#ffd6cc", width=2)
        paste_emoji(img, emoji, 96, 170, y + 42)
        d = ImageDraw.Draw(img)
        d.text((280, y + 35), title, font=font(58, idx=1), fill="#2a2a2a")
        d.text((280, y + 115), desc, font=font(34), fill="#666")
        y += 230
    img.save(OUT / "card-5-features.png")


# Card 6 — CTA
def card_6():
    img = gradient_bg((255, 98, 108), (255, 138, 124))
    paste_emoji(img, "🦞", 200, W // 2, 130)
    d = ImageDraw.Draw(img)
    draw_centered(d, "如果你也装了", 400, font(52), fill="#ffffff")
    draw_centered(d, "不止一个 AI agent", 470, font(52), fill="#ffffff")
    draw_centered(d, "真的会轻松很多", 600, font(72, idx=1), fill="#ffffff")

    d.rounded_rectangle([(120, 780), (960, 960)], radius=24, fill="#ffffff")
    paste_emoji(img, "⭐", 48, 170, 810)
    d = ImageDraw.Draw(img)
    d.text((230, 810), "GitHub", font=font(44, idx=1), fill="#ff626c")
    d.text((160, 880), "ElninoZhong/freshkeeper", font=font(38, MONO), fill="#2a2a2a")

    d.rounded_rectangle([(120, 990), (960, 1170)], radius=24, fill="#ffffff")
    paste_emoji(img, "📦", 48, 170, 1020)
    d = ImageDraw.Draw(img)
    d.text((230, 1020), "npm", font=font(44, idx=1), fill="#ff626c")
    d.text((160, 1090), "npmjs.com/package/freshkeeper", font=font(32, MONO), fill="#2a2a2a")

    draw_centered(d, "欢迎 star 或提 issue", 1230, font(38), fill="#ffffff")
    img.save(OUT / "card-6-cta.png")


if __name__ == "__main__":
    for fn in [card_1, card_2, card_3, card_4, card_5, card_6]:
        fn()
        print(f"✓ {fn.__name__}")
    print(f"\nSaved to {OUT}")
