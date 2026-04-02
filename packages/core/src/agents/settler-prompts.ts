import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { ledgerSchemaInstruction } from "../utils/ledger-schema.js";

export function buildSettlerSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  language?: "zh" | "en",
): string {
  const resolvedLang = language ?? genreProfile.language;
  const isEnglish = resolvedLang === "en";
  const numericalBlock = `\n- 你必须在 UPDATED_LEDGER 中追踪正文中出现的所有资源变动（金钱、物品、伤势、人脉、情报等）
- 数值验算铁律：期初 + 增量 = 期末，三项必须可验算`;

  const hookRules = `
## 伏笔追踪规则（严格执行）

- 新伏笔：只有当正文中出现一个会延续到后续章节、且有具体回收方向的未解问题时，才新增 hook_id。不要为旧 hook 的换说法、重述、抽象总结再开新 hook
- 提及伏笔：已有伏笔在本章被提到，但没有新增信息、没有改变读者或角色对该问题的理解 → 放入 mention 数组，不要更新最近推进
- 推进伏笔：已有伏笔在本章出现了新的事实、证据、关系变化、风险升级或范围收缩 → **必须**更新"最近推进"列为当前章节号，更新状态和备注
- 回收伏笔：伏笔在本章被明确揭示、解决、或不再成立 → 状态改为"已回收"，备注回收方式
- 延后伏笔：超过5章未推进 → 标注"延后"，备注原因
- **铁律**：不要把“再次提到”“换个说法重述”“抽象复盘”当成推进。只有状态真的变了，才更新最近推进。只是出现过的旧 hook，放进 mention 数组。`;

  const fullCastBlock = bookRules?.enableFullCastTracking
    ? `\n## 全员追踪\nPOST_SETTLEMENT 必须额外包含：本章出场角色清单、角色间关系变动、未出场但被提及的角色。`
    : "";

  const langPrefix = isEnglish
    ? `【LANGUAGE OVERRIDE】ALL output (state card, hooks, summaries, subplots, emotional arcs, character matrix) MUST be in English. The === TAG === markers remain unchanged.\n\n`
    : "";

  return `${langPrefix}你是状态追踪分析师。给定新章节正文和当前 truth 文件，你的任务是产出更新后的 truth 文件。

## 工作模式

你不是在写作。你的任务是：
1. 仔细阅读正文，提取所有状态变化
2. 基于"当前追踪文件"做增量更新
3. 严格按照 === TAG === 格式输出

## 分析维度

从正文中提取以下信息：
- 角色出场、退场、状态变化（受伤/突破/死亡等）
- 位置移动、场景转换
- 物品/资源的获得与消耗
- 伏笔的埋设、推进、回收
- 情感弧线变化
- 支线进展
- 角色间关系变化、新的信息边界

## 书籍信息

- 标题：${book.title}
- 题材：${genreProfile.name}（${book.genre}）
- 平台：${book.platform}
${numericalBlock}
${hookRules}${fullCastBlock}

## 输出格式（必须严格遵循）

${buildSettlerOutputFormat(genreProfile, resolvedLang)}

## 关键规则

1. 状态卡和伏笔池必须基于"当前追踪文件"做增量更新，不是从零开始
2. 正文中的每一个事实性变化都必须反映在对应的追踪文件中
3. 不要遗漏细节：数值变化、位置变化、关系变化、信息变化都要记录
4. 角色交互矩阵中的"信息边界"要准确——角色只知道他在场时发生的事`;
}

function buildSettlerOutputFormat(gp: GenreProfile, language: "zh" | "en" = "zh"): string {
  const chapterTypeExample = gp.chapterTypes.length > 0
    ? gp.chapterTypes[0]
    : "主线推进";

  return `=== POST_SETTLEMENT ===
（简要说明本章有哪些状态变动、伏笔推进、结算注意事项；允许 Markdown 表格或要点）

=== RUNTIME_STATE_DELTA ===
（必须输出 JSON，不要输出 Markdown，不要加解释）
\`\`\`json
{
  "chapter": 12,
  "currentStatePatch": {
    "currentLocation": "可选",
    "protagonistState": "可选",
    "currentGoal": "可选",
    "currentConstraint": "可选",
    "currentAlliances": "可选",
    "currentConflict": "可选"
  },
  "hookOps": {
    "upsert": [
      {
        "hookId": "mentor-oath",
        "startChapter": 8,
        "type": "relationship",
        "status": "progressing",
        "lastAdvancedChapter": 12,
        "expectedPayoff": "揭开师债真相",
        "notes": "本章为何推进/延后/回收"
      }
    ],
    "mention": ["本章只是被提到、没有真实推进的 hookId"],
    "resolve": ["已回收的 hookId"],
    "defer": ["需要标记延后的 hookId"]
  },
  "chapterSummary": {
    "chapter": 12,
    "title": "本章标题",
    "characters": "角色1,角色2",
    "events": "一句话概括关键事件",
    "stateChanges": "一句话概括状态变化",
    "hookActivity": "mentor-oath advanced",
    "mood": "紧绷",
    "chapterType": "${chapterTypeExample}"
  },
  "subplotOps": [],
  "emotionalArcOps": [],
  "characterMatrixOps": [],
  "notes": []
}
\`\`\`

${ledgerSchemaInstruction(language)}

=== UPDATED_SUBPLOTS ===
（输出完整的最新支线进度板 Markdown；即使本章无新增支线，也要输出沿用后的完整表格，不能留空）

=== UPDATED_EMOTIONAL_ARCS ===
（输出完整的最新情感弧线 Markdown；即使本章变化很小，也要保留完整表格）

=== UPDATED_CHARACTER_MATRIX ===
（输出完整的最新角色交互矩阵 Markdown；即使本章仅补充信息边界，也要输出完整矩阵）

规则：
1. RUNTIME_STATE_DELTA 只负责 current_state、hooks、chapterSummary 的增量 JSON；UPDATED_LEDGER（如有）、UPDATED_SUBPLOTS、UPDATED_EMOTIONAL_ARCS、UPDATED_CHARACTER_MATRIX 必须输出完整最新 Markdown
2. 所有章节号字段都必须是整数，不能写自然语言
3. 如果旧 hook 只是被提到、没有真实状态变化，把它放进 mention，不要更新 lastAdvancedChapter
4. 如果本章推进了旧 hook，lastAdvancedChapter 必须等于当前章号
5. 如果回收或延后 hook，必须放在 resolve / defer 数组里
6. chapterSummary.chapter 必须等于当前章节号
7. 如果当前文件不存在或只有表头，也必须输出一个可直接写回磁盘的完整骨架`;
}

export function buildSettlerUserPrompt(params: {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
  readonly observations?: string;
  readonly selectedEvidenceBlock?: string;
  readonly governedControlBlock?: string;
}): string {
  const ledgerBlock = params.ledger
    ? `\n## 当前资源账本\n${params.ledger}\n`
    : "";

  const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
    ? `\n## 已有章节摘要\n${params.chapterSummaries}\n`
    : "";

  const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
    ? `\n## 当前支线进度板\n${params.subplotBoard}\n`
    : "";

  const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
    ? `\n## 当前情感弧线\n${params.emotionalArcs}\n`
    : "";

  const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
    ? `\n## 当前角色交互矩阵\n${params.characterMatrix}\n`
    : "";

  const observationsBlock = params.observations
    ? `\n## 观察日志（由 Observer 提取，包含本章所有事实变化）\n${params.observations}\n\n基于以上观察日志和正文，更新所有追踪文件。确保观察日志中的每一项变化都反映在对应的文件中。\n`
    : "";
  const selectedEvidenceBlock = params.selectedEvidenceBlock
    ? `\n## 已选长程证据\n${params.selectedEvidenceBlock}\n`
    : "";
  const controlBlock = params.governedControlBlock ?? "";
  const outlineBlock = controlBlock.length === 0
    ? `\n## 卷纲\n${params.volumeOutline}\n`
    : "";

  return `请分析第${params.chapterNumber}章「${params.title}」的正文，更新所有追踪文件。
${observationsBlock}
## 本章正文

${params.content}
${controlBlock}

## 当前状态卡
${params.currentState}
${ledgerBlock}
## 当前伏笔池
${params.hooks}
${selectedEvidenceBlock}${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
${outlineBlock}

请严格按照 === TAG === 格式输出结算结果。`;
}

export function buildSettlerRepairPrompt(params: {
  readonly language: "zh" | "en";
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly missingSections: ReadonlyArray<string>;
  readonly chapterSummary?: string;
  readonly originalLedger: string;
  readonly originalSubplots: string;
  readonly originalEmotionalArcs: string;
  readonly originalCharacterMatrix: string;
}): string {
  const requested = params.missingSections.join(", ");
  const summaryBlock = params.chapterSummary
    ? params.language === "en"
      ? `\n## Chapter Summary\n${params.chapterSummary}\n`
      : `\n## 本章摘要\n${params.chapterSummary}\n`
    : "";
  const sectionBlocks = params.missingSections.map((section) => {
    switch (section) {
      case "UPDATED_LEDGER":
        return params.language === "en"
          ? `## Current Ledger\n${params.originalLedger}\n`
          : `## 当前资源账本\n${params.originalLedger}\n`;
      case "UPDATED_SUBPLOTS":
        return params.language === "en"
          ? `## Current Subplot Board\n${params.originalSubplots}\n`
          : `## 当前支线进度板\n${params.originalSubplots}\n`;
      case "UPDATED_EMOTIONAL_ARCS":
        return params.language === "en"
          ? `## Current Emotional Arcs\n${params.originalEmotionalArcs}\n`
          : `## 当前情感弧线\n${params.originalEmotionalArcs}\n`;
      case "UPDATED_CHARACTER_MATRIX":
        return params.language === "en"
          ? `## Current Character Matrix\n${params.originalCharacterMatrix}\n`
          : `## 当前角色交互矩阵\n${params.originalCharacterMatrix}\n`;
      default:
        return "";
    }
  }).filter(Boolean).join("\n");

  if (params.language === "en") {
    return `Your previous settlement response omitted these required sections: ${requested}.
Return ONLY the missing sections using exact === TAG === headers.
Do not repeat sections that were already present. Do not output explanations or notes.
Ledger/subplot/emotional/matrix sections must be complete markdown that can be written directly to disk.
${summaryBlock}
## Chapter ${params.chapterNumber}: ${params.title}
${params.content}

${sectionBlocks}`;
  }

  return `你上一条结算回复缺少这些必填 section：${requested}。
现在只输出缺失的 section，并保留精确的 === TAG === 标题。
不要重复已经存在的 section，不要输出解释、备注或结束语。
账本/支线/情感弧线/角色矩阵必须给出可直接落盘的完整 Markdown。
${summaryBlock}
## 第${params.chapterNumber}章《${params.title}》正文
${params.content}

${sectionBlocks}`;
}
