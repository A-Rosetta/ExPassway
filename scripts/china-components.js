/**
 * Cambridge China mainland (administrative Zone 5) component reference.
 *
 * This is intentionally separate from the paper catalogue: it describes the
 * component numbers used when making an entry, while the catalogue describes
 * the files that are available for practice.
 */
export const CHINA_COMPONENT_SOURCES = Object.freeze([
  {
    label: "Cambridge 2026 Guide to Making Entries",
    labelZh: "剑桥 2026 报名指南",
    url: "https://www.cambridgeinternational.org/Images/724211-guide-to-making-entries.pdf",
    note: "The guide labels China as administrative Zone 5 and lists the component codes.",
    noteZh: "该指南将中国标为行政区域 5，并列出组件号码。",
  },
  {
    label: "2024 June entry-code guide",
    labelZh: "2024 年 6 月报名代码指南",
    url: "https://www.britishcouncil.org.tw/sites/default/files/cambridge_june_2024_ias_ial_entry_codes.pdf",
    note: "British Council Taiwan copy of the Cambridge 2024 entry-code guide.",
    noteZh: "英国文化协会台湾保存的剑桥 2024 报名代码指南副本。",
  },
  {
    label: "Cambridge China exam security guidance",
    labelZh: "剑桥中国考试安全说明",
    url: "https://www.cambridgeinternational.org/exam-administration/cambridge-exams-officers-guide/phase-4-before-the-exam/exam-security-regulations-china/",
    note: "Use the China-specific entry and timetable instructions for a live registration.",
    noteZh: "实际报名时应以中国专用报名及时间表说明为准。",
  },
]);

const SUBJECTS = Object.freeze({
  "9700": {
    name: "Biology", nameZh: "生物", slug: "biology-9700", type: "science",
    paperNames: {
      1: ["Multiple Choice", "选择题"], 2: ["AS Structured Questions", "AS 结构化题"],
      3: ["Advanced Practical Skills", "高级实践技能"], 4: ["A2 Structured Questions", "A2 结构化题"],
      5: ["Planning, Analysis and Evaluation", "实验设计、分析与评价"],
    },
  },
  "9701": {
    name: "Chemistry", nameZh: "化学", slug: "chemistry-9701", type: "science",
    paperNames: {
      1: ["Multiple Choice", "选择题"], 2: ["AS Structured Questions", "AS 结构化题"],
      3: ["Advanced Practical Skills", "高级实践技能"], 4: ["A2 Structured Questions", "A2 结构化题"],
      5: ["Planning, Analysis and Evaluation", "实验设计、分析与评价"],
    },
  },
  "9702": {
    name: "Physics", nameZh: "物理", slug: "physics-9702", type: "science",
    paperNames: {
      1: ["Multiple Choice", "选择题"], 2: ["AS Structured Questions", "AS 结构化题"],
      3: ["Advanced Practical Skills", "高级实践技能"], 4: ["A2 Structured Questions", "A2 结构化题"],
      5: ["Planning, Analysis and Evaluation", "实验设计、分析与评价"],
    },
  },
  "9708": {
    name: "Economics", nameZh: "经济学", slug: "economics-9708", type: "economics",
    paperNames: {
      1: ["Multiple Choice", "选择题"], 2: ["AS Data Response", "AS 数据响应题"],
      3: ["A2 Multiple Choice", "A2 选择题"], 4: ["A2 Data Response", "A2 数据响应题"],
    },
  },
  "9696": {
    name: "Geography", nameZh: "地理", slug: "geography-9696", type: "geography",
    paperNames: {
      1: ["Core Physical Geography", "核心自然地理"], 2: ["Core Human Geography", "核心人文地理"],
      3: ["Advanced Physical Geography", "高级自然地理"], 4: ["Advanced Human Geography", "高级人文地理"],
    },
  },
  "9618": {
    name: "Computer Science", nameZh: "计算机科学", slug: "computer-science-9618", type: "computer",
    paperNames: {
      1: ["Theory Fundamentals", "理论基础"], 2: ["Fundamental Problem-solving and Programming", "基础问题解决与编程"],
      3: ["Advanced Theory", "高级理论"], 4: ["Advanced Problem-solving and Programming", "高级问题解决与编程"],
    },
  },
});

const COMPONENTS = Object.freeze({
  "9700": { 2024: ["12", "22", "33", "34", "42", "52"], 2025: ["14", "24", "37", "38", "44", "54"], 2026: ["14", "24", "37", "38", "44", "54"] },
  "9701": { 2024: ["12", "22", "33", "34", "42", "52"], 2025: ["14", "24", "37", "38", "44", "54"], 2026: ["14", "24", "37", "38", "44", "54"] },
  "9702": { 2024: ["12", "22", "33", "34", "42", "52"], 2025: ["14", "24", "37", "38", "44", "54"], 2026: ["14", "24", "37", "38", "44", "54"] },
  "9708": { 2024: ["12", "22", "32", "42"], 2025: ["14", "24", "34", "44"], 2026: ["14", "24", "34", "44"] },
  "9696": { 2024: ["12", "22", "32", "42"], 2025: ["12", "22", "32", "42"], 2026: ["12", "22", "32", "42"] },
  "9618": { 2024: ["13", "23", "33", "43"], 2025: ["13", "23", "33", "43"], 2026: ["13", "23", "33", "43"] },
});

const SCIENCE_CODES = new Set(["9700", "9701", "9702"]);

function paperNumber(component) {
  return Number.parseInt(String(component).slice(0, 1), 10);
}

function levelForPaper(paper) {
  return paper <= 2 ? "AS" : "A2";
}

function sourceBasis(year) {
  if (year === 2024) return "2024 entry-code guide; original May/June papers cross-checked in the archive.";
  if (year === 2025) return "Archived 2025 China component reference; original May/June papers cross-checked in the archive.";
  return "2026 Cambridge entry guide; China is administrative Zone 5.";
}

export function chinaSubjects() {
  return Object.entries(SUBJECTS).map(([code, subject]) => ({ code, ...subject }));
}

export function getChinaComponentSession(code, year, season = "May/June") {
  const subject = SUBJECTS[String(code)];
  const numericYear = Number(year);
  const components = season === "May/June" ? COMPONENTS[String(code)]?.[numericYear] : null;
  if (!subject || !components) return null;
  const rows = components.map((component) => {
    const paper = paperNumber(component);
    return {
      component,
      paper,
      level: levelForPaper(paper),
      title: subject.paperNames[paper]?.[0] || `Paper ${paper}`,
      titleZh: subject.paperNames[paper]?.[1] || `试卷 ${paper}`,
      alternative: (SCIENCE_CODES.has(String(code)) && paper === 3),
    };
  });
  return {
    code: String(code),
    year: numericYear,
    season,
    name: subject.name,
    nameZh: subject.nameZh,
    slug: subject.slug,
    rows,
    sourceBasis: sourceBasis(numericYear),
    zone: "China mainland · administrative Zone 5",
    notice: SCIENCE_CODES.has(String(code))
      ? "Paper 3 has alternative components (33/34 in 2024, 37/38 in 2025–2026). A candidate normally takes the component assigned by the centre, not both alternatives."
      : "The list shows the components used for this China entry route; it does not mean that every candidate takes every component.",
    noticeZh: SCIENCE_CODES.has(String(code))
      ? "第 3 卷有替代组件（2024 为 33/34，2025–2026 为 37/38）。考生通常按考点分配参加其中一套，不是两套都参加。"
      : "列表显示中国报名路线使用的组件，并不表示每位考生都要参加全部组件。",
    paperListing: `https://pastpapers.papacambridge.com/papers/caie/as-and-a-level-${subject.slug}-${numericYear}-may-june`,
  };
}

export function groupChinaRows(session) {
  if (!session) return [];
  const groups = new Map();
  session.rows.forEach((row) => {
    const current = groups.get(row.paper) || { ...row, components: [] };
    current.components.push(row.component);
    current.alternative = current.alternative || row.alternative;
    groups.set(row.paper, current);
  });
  return [...groups.values()].map((row) => ({ ...row, component: row.components.join(" / ") }));
}
