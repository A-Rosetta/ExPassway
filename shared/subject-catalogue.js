/** Subjects that share the syllabus and past-paper resource hub. */
export const SUBJECT_HUBS = Object.freeze({
  "9618": { name: "Computer Science", nameZh: "计算机科学", structuredPractice: true },
  "9702": { name: "Physics", nameZh: "物理", structuredPractice: false },
  "9701": { name: "Chemistry", nameZh: "化学", structuredPractice: false },
  "9708": { name: "Economics", nameZh: "经济学", structuredPractice: false },
  "9700": { name: "Biology", nameZh: "生物", structuredPractice: false },
  "9696": { name: "Geography", nameZh: "地理", structuredPractice: false },
});

export function subjectHubDefinition(code) {
  return SUBJECT_HUBS[String(code)] || null;
}

export function usesSubjectHub(code) {
  return subjectHubDefinition(code) !== null;
}
