import { sampleWrongLog } from "../data/questionBank.js";

function calcWrongRate(row) {
  const total = (row.correct || 0) + (row.wrong || 0);
  return total ? (row.wrong / total) * 100 : 0;
}

export function buildAnalysis(input = {}) {
  const language = input.language === "zh-CN" ? "zh-CN" : "en";
  const logs = Array.isArray(input.wrongLog) && input.wrongLog.length
    ? input.wrongLog
    : sampleWrongLog;
  const lastResult = input.lastResult || null;

  const bars = logs.map((row) => ({
    topic: row.topic,
    mistake: row.mistake,
    wrongRate: Number(calcWrongRate(row).toFixed(1)),
  }));

  const sorted = [...logs].sort((a, b) => calcWrongRate(b) - calcWrongRate(a));
  const weakTopics = sorted
    .slice(0, 2)
    .map((x) => x.topic)
    .join(language === "zh-CN" ? "、" : ", ") || (language === "zh-CN" ? "基础模块" : "core topics");

  const advices = language === "zh-CN"
    ? [
      `7天短期：优先复习 ${weakTopics}，每天20分钟概念回顾 + 4道定向训练。`,
      "30天长期：每周一次限时小测，建立错因标签（概念/计算/审题）并复盘。",
      "策略建议：先做基础题保证正确率，再逐步增加冲刺题比例至40%。",
    ]
    : [
      `Next 7 days: prioritize ${weakTopics} with 20 minutes of concept review and 4 targeted questions each day.`,
      "Next 30 days: take one timed quiz each week and review mistakes by concept, calculation, and question-reading errors.",
      "Strategy: secure accuracy on basic questions first, then gradually raise the share of challenge questions to 40%.",
    ];

  if (lastResult && typeof lastResult.accuracy === "number" && lastResult.accuracy < 60) {
    advices.unshift(language === "zh-CN"
      ? "本周建议先降难度到“基础/中等”，先把正确率稳定到70%以上，再冲刺高难题。"
      : "This week, use basic and medium questions until your accuracy is consistently above 70%, then return to harder questions.");
  }

  const hintUsedQuestions = Number(lastResult?.hintUsedQuestions || 0);
  const total = Number(lastResult?.total || 0);
  const hintRate = total ? (hintUsedQuestions / total) * 100 : 0;
  if (hintRate >= 50) {
    advices.unshift(language === "zh-CN"
      ? "提示依赖偏高：本周先进行 2 次无提示限时训练，再用提示做复盘对照。"
      : "Hint use is high: complete two timed sessions without hints this week, then use hints only when reviewing your work.");
  } else if (hintRate > 0) {
    advices.push(language === "zh-CN"
      ? "提示使用适中：建议先独立作答，只有卡住超过2分钟再查看下一条提示。"
      : "Hint use is moderate: work independently first and reveal another hint only after being stuck for more than two minutes.");
  }

  return {
    bars,
    weakTopics,
    advices,
    hintRate: Number(hintRate.toFixed(1)),
  };
}
