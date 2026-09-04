import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const subjects = {
  // Biology 0610 already has reviewed mappings managed by its existing curriculum workflow.
  "0620": {
    root: "assets/exam-question-images/cie-igcse-chemistry-0620/data",
    version: "0620-2023-2025-v1",
    codes: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    rules: [
      ["1", /solid|liquid|gas|diffusion|melting|boiling|sublim/],
      ["2", /atom|element|compound|isotope|ionic|covalent|electron|bond/],
      ["3", /mole|molar|relative atomic|formula|equation|stoichiometr|concentration|titration/],
      ["4", /electrolys|electrode|anode|cathode|fuel cell/],
      ["5", /exothermic|endothermic|activation energy|bond energy/],
      ["6", /rate of reaction|catalyst|reversible|equilibrium|oxidation|reduction|redox/],
      ["7", /acid|alkali|base|salt|pH|neutralis|indicator/],
      ["8", /periodic table|group|period|outer[- ]shell|halogen|noble gas/],
      ["9", /metal|alloy|ore|rust|corrosion|reactivity series/],
      ["10", /air|water treatment|pollution|greenhouse|climate|fertili[sz]er/],
      ["11", /alkane|alkene|ethene|ethanol|organic|polymer|carboxylic|ester/],
      ["12", /chromatograph|filtration|distillation|separation|test for|analysis|apparatus/],
    ],
  },
  "0654": {
    root: "assets/exam-question-images/cie-igcse-coordinated-sciences-0654/data",
    version: "0654-2023-2024-v1",
    codes: ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
    rules: [
      ["B2", /cell|nucleus|microscop|mitosis/], ["B3", /osmosis|diffusion|active transport/],
      ["B4", /protein|carbohydrate|lipid|food test|biuret|iodine/], ["B5", /enzyme/],
      ["B6", /photosynthesis|chlorophyll|leaf|stoma/], ["B7", /digestion|balanced diet|vitamin|nutrition/],
      ["B8", /xylem|phloem|transpiration/], ["B9", /heart|blood|artery|vein|circulation/],
      ["B10", /pathogen|disease|antibody|immune|vaccin/], ["B11", /alveoli|gas exchange|breathing|respiration/],
      ["B12", /hormone|reflex|nervous|coordination|homeostasis/], ["B13", /reproduction|fertilis|menstrual|pregnan/],
      ["C2", /experiment|apparatus|chromatograph|filtration|distillation|test for/],
      ["C3", /atom|element|compound|isotope|ionic|covalent|electron/], ["C4", /mole|formula|equation|concentration/],
      ["C5", /electrolys|electrode|anode|cathode/], ["C6", /exothermic|endothermic|energy change/],
      ["C7", /rate of reaction|catalyst|reversible|oxidation|reduction/], ["C8", /acid|alkali|base|salt|pH/],
      ["C9", /periodic table|group|period|halogen|noble gas/], ["C10", /metal|alloy|ore|rust|corrosion/],
      ["C11", /air|water|pollution|greenhouse/], ["C12", /sulfur|sulphur|sulfur dioxide|sulphur dioxide/],
      ["C13", /carbonate|limewater|carbon dioxide/], ["C14", /alkane|alkene|ethene|ethanol|organic|polymer/],
      ["P2", /work done|kinetic energy|potential energy|power|efficiency/], ["P3", /temperature|thermal|conduction|convection|evaporation/],
      ["P4", /wave|wavelength|frequency|amplitude|light|sound/], ["P5", /current|voltage|resistance|circuit|ammeter|voltmeter/],
      ["P6", /magnet|magnetic|electromagnet|motor|transformer/], ["P7", /radioactiv|alpha|beta|gamma|half-life|nucleus/],
      ["P8", /planet|solar system|star|galaxy|universe|orbit/], ["P1", /speed|velocity|acceleration|force|momentum|density|pressure/],
    ],
  },
  "0455": {
    root: "assets/exam-question-images/cie-igcse-economics-0455/data",
    version: "0455-2023-2025-v1",
    codes: ["1", "2", "3", "4", "5", "6"],
    rules: [
      ["1", /scarcity|opportunity cost|factor of production|production possibility|capital goods|consumer goods/],
      ["2", /demand|supply|equilibrium|elasticity|price mechanism|market|subsidy/],
      ["3", /firm|household|worker|trade union|bank|cost|revenue|profit|productivity/],
      ["4", /inflation|unemployment|economic growth|fiscal|monetary|tax|government|interest rate/],
      ["5", /economic development|living standard|poverty|population|income distribution|development/],
      ["6", /international trade|globalisation|exchange rate|balance of payments|multinational|specialisation|tariff/],
    ],
  },
};

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function classify(row, config) {
  const text = [row.stem, row.rawText, ...Object.values(row.options || {})].join(" ").toLowerCase();
  const match = config.rules.find(([, pattern]) => pattern.test(text));
  return match
    ? { code: match[0], confidence: row.parseStatus === "image_only" ? 0.72 : 0.9, matched: true }
    : { code: config.codes[0], confidence: 0.2, matched: false };
}

const records = [];
for (const [subjectCode, config] of Object.entries(subjects)) {
  for (const file of await readdir(config.root)) {
    if (!file.endsWith(".json") || file.endsWith(".cut.json") || file.includes("answer")) continue;
    const paperSlug = file.replace(/\.structured\.json$|\.json$/i, "");
    const payload = JSON.parse(await readFile(`${config.root}/${file}`, "utf8"));
    for (const row of payload.rows || []) {
      if (!Number.isInteger(row.questionNo)) continue;
      records.push({ subjectCode, version: config.version, paperSlug, questionNo: row.questionNo, ...classify(row, config) });
    }
  }
}

const sql = ["-- Generated by tools/classify-all-subjects.mjs. Re-run after importing new questions."];
for (const record of records) {
  const sectionId = `${record.subjectCode}-s-${record.code.replaceAll(".", "-")}`;
  const bookId = `${record.subjectCode}-b-${record.code.replaceAll(".", "-")}`;
  sql.push(`
INSERT INTO question_section_mappings (
  question_id, curriculum_section_id, coursebook_section_id, is_primary, confidence, status, source
)
SELECT question.id, ${sqlValue(sectionId)}, ${sqlValue(bookId)},
  ${record.matched ? 1 : 0}, ${record.confidence}, ${record.matched ? "'reviewed'" : "'suggested'"}, 'rule'
FROM question_bank question
JOIN curriculum_sections syllabus ON syllabus.id = ${sqlValue(sectionId)}
JOIN coursebook_sections book ON book.id = ${sqlValue(bookId)}
WHERE question.subject_code = ${sqlValue(record.subjectCode)}
  AND question.paper_slug = ${sqlValue(record.paperSlug)}
  AND question.question_no = ${Number(record.questionNo)}
ON CONFLICT(question_id, curriculum_section_id) DO UPDATE SET
  coursebook_section_id = excluded.coursebook_section_id,
  is_primary = excluded.is_primary, confidence = excluded.confidence,
  status = excluded.status, source = excluded.source,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE question_section_mappings.source = 'rule';`);
}

await mkdir(".d1-export", { recursive: true });
await writeFile(".d1-export/all-subject-chapter-mappings.sql", `${sql.join("\n")}\n`, "utf8");
const summary = Object.fromEntries(Object.keys(subjects).map((code) => {
  const rows = records.filter((record) => record.subjectCode === code);
  return [code, { total: rows.length, reviewed: rows.filter((row) => row.matched).length, suggested: rows.filter((row) => !row.matched).length }];
}));
await writeFile(".d1-export/all-subject-chapter-mappings.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
