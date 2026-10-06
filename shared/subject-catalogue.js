/** Subjects that share the syllabus and past-paper resource hub. */
export const SUBJECT_HUBS = Object.freeze({
  "9618": { name: "Computer Science", nameZh: "计算机科学", assetKey: "computer-science-9618", structuredPractice: true },
  "9702": { name: "Physics", nameZh: "物理", assetKey: "physics-9702", structuredPractice: true, manualPaperBuilder: false },
  "9701": { name: "Chemistry", nameZh: "化学", assetKey: "chemistry-9701", structuredPractice: true, manualPaperBuilder: false },
  "9708": { name: "Economics", nameZh: "经济学", assetKey: "economics-9708", structuredPractice: true, manualPaperBuilder: false },
  "9700": { name: "Biology", nameZh: "生物", assetKey: "biology-9700", structuredPractice: true, manualPaperBuilder: false },
  "9696": { name: "Geography", nameZh: "地理", assetKey: "geography-9696", structuredPractice: true, manualPaperBuilder: false },
});

export function subjectHubDefinition(code) {
  if (typeof code !== "string" && typeof code !== "number") return null;
  return SUBJECT_HUBS[String(code)] || null;
}

export function usesSubjectHub(code) {
  return subjectHubDefinition(code) !== null;
}

export function supportsPreparedPractice(code, paperNumber, paperType = "structured") {
  const subject = subjectHubDefinition(code);
  if (!subject?.structuredPractice || !Number.isInteger(paperNumber)) return false;
  if (String(code) === "9618") return paperNumber >= 1 && paperNumber <= 3 && paperType === "structured";
  const maximum = ["9700", "9701", "9702"].includes(String(code)) ? 5 : 4;
  return Number.isInteger(paperNumber) && paperNumber >= 1 && paperNumber <= maximum
    && ["mcq", "structured", "practical"].includes(paperType);
}
