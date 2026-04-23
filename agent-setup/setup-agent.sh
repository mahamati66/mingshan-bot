#!/bin/bash
# AI 分身起始助手 by 雷小蒙 — Mac 一鍵安裝腳本
# 角色：創業者 / 一人公司 / 主管
# 生成日期：2026-04-22

set -e

AGENT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents/my-agent"

echo "=== AI 分身起始助手 by 雷小蒙 ==="
echo "建立資料夾：$AGENT_DIR"
echo ""

# Section B-1：核心骨架
mkdir -p "$AGENT_DIR/000_Agent/skills"
mkdir -p "$AGENT_DIR/000_Agent/workflows"
mkdir -p "$AGENT_DIR/000_Agent/memory/daily"
mkdir -p "$AGENT_DIR/100_Todo/drafts"
mkdir -p "$AGENT_DIR/100_Todo/projects"
mkdir -p "$AGENT_DIR/100_Todo/archive"
mkdir -p "$AGENT_DIR/200_Reference/writing-samples"
mkdir -p "$AGENT_DIR/200_Reference/past-work"
mkdir -p "$AGENT_DIR/200_Reference/templates"

# Q3：社群媒體
mkdir -p "$AGENT_DIR/100_Todo/drafts/social-posts"
mkdir -p "$AGENT_DIR/200_Reference/writing-samples/social"

# Q4：日記功能啟用
mkdir -p "$AGENT_DIR/300_Journal/$(date +%Y-%m)"

echo "✅ 資料夾骨架建立完成"

# Section B-1.5：說明卡
cat > "$AGENT_DIR/000_Agent/skills/README.md" << 'EOF'
# skills/ — 你的 AI 工作手冊

這個資料夾放「AI 遇到某類任務的完整 How-to」。每個子資料夾是一個 skill，裡面必須有一個 `SKILL.md`。

## 你的第一個 skill 怎麼建？

在 Claude Code 對話裡說：
> `/skill-creator` 幫我建一個 skill，我想讓 AI 自動 [具體任務]

建好之後你打 `/skill-name` 就會觸發。
EOF

cat > "$AGENT_DIR/000_Agent/workflows/README.md" << 'EOF'
# workflows/ — 你每天主動喊的固定儀式

這個資料夾放「你手動打一次、AI 就跑一整套流程」的多步驟工作流，例如 `/morning`、`/journal`。

- **skills**：方法論 + SOP，會被其他任務引用
- **workflows**：每天的固定儀式，串接多個 skill 一次跑完
EOF

echo "✅ 說明卡建立完成"

# Section B-5：Skills Symlink
SKILLS_TARGET="$AGENT_DIR/000_Agent/skills"
SKILLS_LINK="$HOME/.claude/skills"

mkdir -p "$HOME/.claude"

if [ -L "$SKILLS_LINK" ]; then
    CURRENT=$(readlink "$SKILLS_LINK")
    echo "⚠️  ~/.claude/skills 已經是 symlink，指向：$CURRENT"
    echo "請手動決定要不要改指向 $SKILLS_TARGET"
elif [ -d "$SKILLS_LINK" ] && [ -n "$(ls -A "$SKILLS_LINK" 2>/dev/null)" ]; then
    echo "⚠️  ~/.claude/skills 裡面已有 skills，請手動處理"
    echo "   建議：mv ~/.claude/skills ~/.claude/skills.bak && ln -s \"$SKILLS_TARGET\" \"$SKILLS_LINK\""
elif [ -d "$SKILLS_LINK" ]; then
    rmdir "$SKILLS_LINK"
    ln -s "$SKILLS_TARGET" "$SKILLS_LINK"
    echo "✅ Skills symlink 建立完成"
else
    ln -s "$SKILLS_TARGET" "$SKILLS_LINK"
    echo "✅ Skills symlink 建立完成"
fi

# 複製 CLAUDE.md 和 MEMORY.md
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/CLAUDE.md" "$AGENT_DIR/CLAUDE.md"
cp "$SCRIPT_DIR/MEMORY.md" "$AGENT_DIR/000_Agent/memory/MEMORY.md"

# 複製 workflows（如果有的話）
if [ -d "$SCRIPT_DIR/workflows" ]; then
    cp -R "$SCRIPT_DIR/workflows/"* "$AGENT_DIR/000_Agent/workflows/" 2>/dev/null || true
    echo "✅ Workflows 已複製"
fi

# 複製 Reference 素材（如果有的話）
if [ -d "$SCRIPT_DIR/200_Reference" ]; then
    cp -Rn "$SCRIPT_DIR/200_Reference/"* "$AGENT_DIR/200_Reference/" 2>/dev/null || true
    echo "✅ Reference 素材已複製"
fi

# 今天的 daily log
cat > "$AGENT_DIR/000_Agent/memory/daily/$(date +%Y-%m-%d).md" << EOF
# $(date +%Y-%m-%d) Session Log

## 今天做了什麼
- 跑了「AI 分身起始助手 by 雷小蒙」初始化 AI 分身資料層
- 建立 000_Agent / 100_Todo / 200_Reference / 300_Journal 骨架
- 設定 Skills symlink：~/.claude/skills → 000_Agent/skills/
- 寫入「AI 分身起始助手紀錄」到 CLAUDE.md / MEMORY.md

## 明天的作業
- 把 5-10 篇得意的社群貼文丟進 200_Reference/writing-samples/social/
- 開新對話安裝官方 skill-creator
EOF

echo ""
echo "=== 完成！==="
echo ""
echo "資料夾位置：$AGENT_DIR"
echo ""
echo "接下來請做兩件事："
echo "1. 開新的 Claude Code 對話（讓 CLAUDE.md 生效）"
echo "2. 把你得意的社群貼文丟進："
echo "   $AGENT_DIR/200_Reference/writing-samples/social/"
echo ""
echo "🔗 更多設定：https://cc.lifehacker.tw"
