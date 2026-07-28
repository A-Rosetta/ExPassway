import { query } from "../db/client.js";
import { createHash } from "node:crypto";

const RULES = [
  { statement: "3.3.1", book: "3.3", confidence: 0.99, pattern: /\bactive transport|against (?:a |the )?concentration gradient\b/i },
  { statement: "3.2.7", book: "3.2", confidence: 0.98, pattern: /\bwater potential\b/i },
  { statement: "3.2.8", book: "3.2", confidence: 0.97, pattern: /\b(turgid|turgor|plasmolysis|plasmolysed|flaccid)\b/i },
  { statement: "3.2.2", book: "3.2", confidence: 0.96, pattern: /\b(osmosis|partially permeable|dialysis tubing)\b/i },
  { statement: "3.1.1", book: "3.1", confidence: 0.96, pattern: /\bdiffusion|down (?:a |the )?concentration gradient\b/i },
  { statement: "1.1.1", book: "1.1", confidence: 0.96, pattern: /\b(characteristic(?:s)? (?:of|shown by|not shown by) (?:a |all )?(?:living )?organisms?|characteristic(?:s)? of living things)\b/i },
  { statement: "1.2.4", book: "1.3", confidence: 0.95, pattern: /\b(dichotomous|identification key|use the key)\b/i },
  { statement: "1.2.3", book: "1.2", confidence: 0.94, pattern: /\b(binomial|genus|scientific name)\b/i },
  { statement: "1.2.2", book: "1.2", confidence: 0.90, pattern: /\bspecies\b/i },
  { statement: "1.2.1", book: "1.2", confidence: 0.76, pattern: /\bclassif(?:y|ied|ication)\b/i },
  { statement: "1.3.7", book: "1.6", confidence: 0.99, pattern: /\bwhich feature is found in viruses?\b/i },
  { statement: "1.3.5", book: "1.5", confidence: 0.96, pattern: /\b(monocot|dicot|fern)\w*/i },
  { statement: "1.3.2", book: "1.5", confidence: 0.92, pattern: /\b(vertebrate|mammal|bird|reptile|amphibian|arthropod|insect|arachnid|crustacean|myriapod)\w*/i },
  { statement: "1.3.4", book: "1.4", confidence: 0.91, pattern: /\b(kingdom|fungus|fungi|prokaryote|protoctist)\w*/i },
  { statement: "2.2.1", book: "2.4", confidence: 0.98, pattern: /\bmagnif(?:y|ied|ication)|actual size|image size\b/i },
  { statement: "2.2.3", book: "2.4", confidence: 0.96, pattern: /\b(micrometre|micrometer|millimetre|millimeter|μm)\b/i },
  { statement: "2.1.2", book: "2.2", confidence: 0.95, pattern: /\b(bacterial cell|bacterium|plasmid|circular DNA)\b/i },
  { statement: "2.1.6", book: "2.3", confidence: 0.91, pattern: /\b(specialised cell|specialized cell|root hair|palisade|neurone|neuron|red blood cell|sperm cell|egg cell|gamete)\w*/i },
  { statement: "2.1.7", book: "2.3", confidence: 0.90, pattern: /\b(tissue|organ system|level of organisation)\b/i },
  { statement: "2.1.1", book: "2.1", confidence: 0.86, pattern: /\b(cell wall|cell membrane|nucleus|cytoplasm|chloroplast|ribosome|mitochondr|vacuole)\w*/i },
];

export async function generateBiologyMappingSuggestions(limit = 300) {
  const [questionResult, curriculumResult, bookResult] = await Promise.all([
    query(`
      select id, stem
      from question_bank
      where subject_code = '0610'
        and active = true
        and year ~ '^\\d{4}$'
        and year::integer between 2019 and 2023
      order by year desc, paper_slug, question_no
    `),
    query(`
      select id, syllabus_code
      from curriculum_sections
      where curriculum_version_id = '0610-2026-2028-v2' and level = 'statement'
    `),
    query(`
      select id, section_code
      from coursebook_sections
      where coursebook_chapter_id in ('bio-igcse-4e-ch1', 'bio-igcse-4e-ch2', 'bio-igcse-4e-ch3')
    `),
  ]);
  const curriculumByCode = new Map(curriculumResult.rows.map((row) => [row.syllabus_code, row.id]));
  const bookByCode = new Map(bookResult.rows.map((row) => [row.section_code, row.id]));
  const suggestions = [];

  questionResult.rows.forEach((question) => {
    const rule = RULES.find((candidate) => candidate.pattern.test(question.stem || ""));
    if (!rule) return;
    const curriculumSectionId = curriculumByCode.get(rule.statement);
    const coursebookSectionId = bookByCode.get(rule.book);
    if (!curriculumSectionId || !coursebookSectionId) return;
    suggestions.push({
      questionId: question.id,
      curriculumSectionId,
      coursebookSectionId,
      confidence: rule.confidence,
      similarQuestionGroup: createHash("sha256")
        .update(String(question.stem || "").toLowerCase().replace(/\s+/g, " ").trim())
        .digest("hex")
        .slice(0, 20),
    });
  });

  let created = 0;
  for (const suggestion of suggestions.slice(0, limit)) {
    const result = await query(`
      insert into question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source, similar_question_group
      )
      select $1, $2, $3, true, $4, 'suggested', 'rule', $5
      where not exists (
        select 1
        from question_section_mappings existing
        where existing.question_id = $1
          and existing.status in ('reviewed', 'rejected')
      )
      on conflict (question_id, curriculum_section_id) do nothing
    `, [
      suggestion.questionId,
      suggestion.curriculumSectionId,
      suggestion.coursebookSectionId,
      suggestion.confidence,
      suggestion.similarQuestionGroup,
    ]);
    created += Number(result.rowCount || 0);
    if (!result.rowCount) {
      await query(`
        update question_section_mappings
        set similar_question_group = $3, updated_at = now()
        where question_id = $1
          and curriculum_section_id = $2
          and status = 'suggested'
      `, [
        suggestion.questionId,
        suggestion.curriculumSectionId,
        suggestion.similarQuestionGroup,
      ]);
    }
  }
  return {
    matched: suggestions.length,
    considered: Math.min(limit, suggestions.length),
    created,
  };
}
