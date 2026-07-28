import { createHash } from "node:crypto";
import { query, getPool } from "../db/client.js";

const RULES = [
  ["21.3.3", "20.2", 0.99, /restriction enzyme|sticky end|dna ligase|recombinant plasmid/i],
  ["21.3.1", "20.2", 0.97, /genetic(?:ally)? modif|insert(?:ed|ing)? (?:a |the )?gene|transgenic/i],
  ["21.2.7", "20.1", 0.97, /fermenter|large.scale production.*(?:bacteria|fungi)/i],
  ["21.2.6", "20.1", 0.96, /mycoprotein|penicillin production|insulin production/i],
  ["21.2.5", "20.1", 0.98, /lactose.free|lactase/i],
  ["21.2.3", "20.1", 0.98, /pectinase|fruit juice production/i],
  ["21.2.2", "20.1", 0.96, /bread.making|dough.*yeast|yeast.*dough/i],
  ["21.2.1", "20.1", 0.95, /biofuel|ethanol.*yeast|yeast.*ethanol/i],
  ["20.4.8", "19.2", 0.98, /captive breeding|artificial insemination|in vitro fertilisation/i],
  ["20.4.4", "19.2", 0.97, /endangered species|seed bank|conservation programme|conserve.*species/i],
  ["20.4.2", "19.2", 0.95, /fish stock|sustainable.*(?:forest|fishing)|mesh size|fishing quota/i],
  ["20.3.1", "19.1", 0.98, /eutrophication|algal bloom|fertili[sz]er.*(?:river|lake|water)/i],
  ["20.2.2", "19.1", 0.96, /deforestation|forest.*clear|tropical forest/i],
  ["20.1.1", "19.1", 0.92, /food supply|monoculture|intensive livestock|food production/i],
  ["19.4.4", "18.3", 0.96, /sigmoid|logistic.*growth|carrying capacity/i],
  ["19.4.1", "18.3", 0.91, /population (?:size|growth)|birth rate|death rate/i],
  ["19.3.2", "18.2", 0.98, /nitrogen cycle|nitrif|denitrif|nitrogen.fix/i],
  ["19.3.1", "18.2", 0.97, /carbon cycle|carbon.*cycle/i],
  ["19.2.5", "18.1", 0.98, /trophic level/i],
  ["19.2.6", "18.1", 0.97, /pyramid of (?:numbers|biomass)/i],
  ["19.2.9", "18.1", 0.97, /energy transfer|energy flow|energy.*food chain/i],
  ["19.2.1", "18.1", 0.94, /food (?:chain|web)|producer|consumer|herbivore|carnivore/i],
  ["19.1.1", "18.1", 0.92, /sun.*principal source of energy|energy.*sun/i],
  ["18.3.1", "17.2", 0.98, /natural selection|selective breeding|artificial selection/i],
  ["18.2.1", "17.2", 0.96, /adaptive feature|adapted to|adaptation/i],
  ["15.1.5", "17.2", 0.98, /antibiotic resistant|antibiotic resistance|resistant bacteria|mrsa/i],
  ["18.1.2", "17.1", 0.98, /continuous variation/i],
  ["18.1.3", "17.1", 0.98, /discontinuous variation/i],
  ["18.1.6", "17.1", 0.95, /mutation|mutagen|ionising radiation/i],
  ["18.1.1", "17.1", 0.87, /variation|phenotypic variation/i],
  ["17.4.16", "16.2", 0.98, /sex.linked|colour blindness|color blindness/i],
  ["17.4.14", "16.2", 0.98, /codominan|blood group/i],
  ["17.4.10", "16.2", 0.96, /pedigree/i],
  ["17.4.11", "16.2", 0.95, /punnett|monohybrid|homozyg|heterozyg|dominant allele|recessive allele|genotype.*phenotype/i],
  ["17.3.2", "16.1", 0.98, /meiosis|reduction division/i],
  ["17.2.1", "16.1", 0.97, /mitosis|daughter cells|stem cell/i],
  ["17.1.10", "16.1", 0.96, /haploid|diploid|chromosome number/i],
  ["17.1.8", "16.3", 0.98, /messenger rna|mrna|protein synthesis|ribosome.*amino acid/i],
  ["17.1.4", "16.2", 0.98, /\b[xy] chromosome|inheritance of sex|male.*female.*chromosome/i],
  ["17.1.2", "16.3", 0.93, /gene.*codes? for|sequence of bases.*amino acid/i],
  ["17.1.1", "16.1", 0.89, /chromosome|genetic information|\ballele\b/i],
  ["16.6.2", "15.2", 0.99, /\bhiv\b|\baids\b|sexually transmitted/i],
  ["16.5.4", "15.1", 0.98, /menstrual cycle|\bfsh\b|luteinising|progesterone.*oestrogen/i],
  ["16.4.9", "15.1", 0.98, /placenta|umbilical|amniotic|fetus|foetus/i],
  ["16.4.4", "15.1", 0.96, /sperm.*(?:flagellum|acrosome|mitochondria)|egg cell.*jelly/i],
  ["16.4.1", "15.1", 0.93, /testis|testes|ovary|oviduct|uterus|cervix|reproductive system/i],
  ["16.3.8", "14.2", 0.98, /germinat|seed.*(?:water|oxygen|temperature)/i],
  ["16.3.9", "14.2", 0.96, /self.pollination|cross.pollination/i],
  ["16.3.5", "14.2", 0.96, /pollination|pollen.*stigma|wind.pollinated|insect.pollinated/i],
  ["16.3.1", "14.2", 0.94, /anther|stigma|ovule|sepal|petal|flower.*(?:part|structure)/i],
  ["16.2.1", "14.1", 0.90, /sexual reproduction|fusion.*gamete|zygote/i],
  ["16.1.1", "14.1", 0.93, /asexual reproduction|genetically identical offspring|one parent/i],
  ["15.1.2", "10.2", 0.97, /antibiotic.*(?:bacterial|infection)|antibiotics kill/i],
  ["14.5.5", "12.4", 0.98, /auxin/i],
  ["14.5.1", "12.4", 0.97, /tropism|phototrop|gravitrop|geotrop/i],
  ["14.4.8", "13.2", 0.98, /vasodilat|vasoconstrict/i],
  ["14.4.7", "13.2", 0.96, /body temperature|sweat|shiver|thermoregulat/i],
  ["14.4.4", "13.2", 0.98, /blood glucose|insulin.*glucagon|glucagon.*insulin|diabetes/i],
  ["14.4.1", "13.2", 0.92, /homeostasis|internal environment/i],
  ["14.3.1", "12.3", 0.93, /hormone|endocrine|adrenaline|testosterone|oestrogen/i],
  ["14.2.6", "12.2", 0.98, /accommodation|ciliary muscle|suspensory ligament|near object|distant object/i],
  ["14.2.4", "12.2", 0.97, /pupil reflex|circular.*radial.*muscle/i],
  ["14.2.2", "12.2", 0.94, /retina|optic nerve|cornea|iris|pupil|lens.*eye|blind spot|rod.*cone/i],
  ["14.1.8", "12.1", 0.98, /synapse|neurotransmitter/i],
  ["14.1.5", "12.1", 0.97, /reflex arc|reflex action/i],
  ["14.1.4", "12.1", 0.92, /neurone|neuron|nerve impulse|central nervous|spinal cord|receptor.*effector/i],
  ["13.1.5", "13.1", 0.98, /nephron|glomerulus|kidney tubule|ultrafiltration|selective reabsorption/i],
  ["13.1.3", "13.1", 0.95, /kidney|ureter|bladder|urethra|dialysis|urine/i],
  ["13.1.8", "13.1", 0.97, /deamination|urea.*liver|excess amino acid/i],
  ["12.3.6", "11.1", 0.98, /oxygen debt|lactic acid.*(?:muscle|exercise)/i],
  ["12.3.1", "11.1", 0.96, /anaerobic respiration/i],
  ["12.2.1", "11.1", 0.95, /aerobic respiration|glucose.*oxygen.*carbon dioxide.*water/i],
  ["12.1.1", "11.1", 0.84, /energy.*(?:muscle contraction|protein synthesis|active transport|growth)/i],
  ["11.1.8", "11.2", 0.98, /intercostal|diaphragm.*(?:contract|relax)|thorax/i],
  ["11.1.2", "11.2", 0.94, /alveol|bronchiole|trachea|lung|gas exchange|inspired air|expired air|breathing rate/i],
  ["10.1.16", "10.1", 0.99, /cholera/i],
  ["10.1.11", "10.2", 0.98, /vaccin|memory cell/i],
  ["10.1.8", "10.2", 0.97, /antibody|antigen|active immunity|passive immunity|lymphocyte/i],
  ["10.1.4", "10.2", 0.91, /body defence|mucus.*pathogen|skin.*pathogen|white blood cell.*pathogen/i],
  ["10.1.3", "10.1", 0.94, /transmissible|pathogen.*transmit|spread of disease|infectious disease/i],
  ["9.4.3", "9.4", 0.96, /red blood cell|white blood cell|platelet|plasma|haemoglobin|phagocyt|blood clot/i],
  ["9.3.3", "9.3", 0.97, /vena cava|aorta|pulmonary artery|pulmonary vein|renal artery|hepatic portal/i],
  ["9.3.1", "9.3", 0.93, /artery|vein|capillar|blood vessel/i],
  ["9.2.5", "9.2", 0.98, /coronary heart disease|coronary artery|atheroma/i],
  ["9.2.1", "9.2", 0.94, /heart|ventricle|atrium|atria|septum|semilunar|pulse rate|ecg/i],
  ["9.1.3", "9.1", 0.94, /double circulation|single circulation|circulatory system/i],
  ["8.4.1", "8.3", 0.99, /translocation|source.*sink|phloem.*sucrose|sucrose.*phloem/i],
  ["8.3.1", "8.2", 0.97, /transpiration|potometer|water vapour.*stomata|wilting/i],
  ["8.2.1", "8.2", 0.93, /root hair|water uptake|pathway.*water.*root/i],
  ["8.1.1", "8.1", 0.95, /xylem|phloem|vascular bundle/i],
  ["7.5.3", "7.4", 0.98, /villus|villi|microvilli|lacteal/i],
  ["7.4.8", "7.3", 0.98, /bile.*neutral|alkaline.*duodenum/i],
  ["7.4.3", "7.3", 0.96, /amylase|protease|lipase|maltase|pepsin|trypsin|chemical digestion/i],
  ["7.3.3", "7.2", 0.96, /incisor|canine|premolar|molar|tooth|teeth/i],
  ["7.2.1", "7.2", 0.92, /alimentary canal|digestive system|stomach|small intestine|large intestine|oesophagus/i],
  ["7.1.3", "7.1", 0.98, /scurvy|rickets/i],
  ["7.1.2", "7.1", 0.93, /balanced diet|vitamin|dietary|malnutrition|calcium|iron|fibre|roughage/i],
  ["6.2.2", "6.2", 0.98, /palisade mesophyll|spongy mesophyll|guard cell|leaf.*(?:cross.section|structure)/i],
  ["6.1.11", "6.3", 0.97, /limiting factor.*photosynthesis|photosynthesis.*limiting factor/i],
  ["6.1.8", "6.3", 0.93, /rate of photosynthesis|light intensity.*photosynthesis|carbon dioxide concentration.*photosynthesis/i],
  ["6.1.7", "6.1", 0.97, /test.*(?:leaf|starch)|destarch|variegated leaf/i],
  ["6.1.6", "6.1", 0.96, /nitrate ion|magnesium ion|mineral deficiency/i],
  ["6.1.2", "6.1", 0.94, /photosynthesis|chlorophyll|carbon dioxide.*water.*glucose.*oxygen/i],
  ["5.1.5", "5.2", 0.97, /optimum.*(?:temperature|ph)|denatur|effect.*temperature.*enzyme|effect.*ph.*enzyme/i],
  ["5.1.4", "5.1", 0.95, /enzyme|active site|substrate|biological catalyst/i],
  ["4.1.3", "4.1", 0.98, /benedict|biuret|iodine solution|emulsion test|dcpip|food test/i],
  ["4.1.4", "4.2", 0.97, /double helix|dna molecule|base pair|adenine.*thymine/i],
  ["4.1.2", "4.1", 0.92, /starch|glycogen|cellulose|fatty acid|glycerol|amino acid.*protein/i],
  ["3.3.1", "3.3", 0.99, /active transport|against (?:a |the )?concentration gradient/i],
  ["3.2.7", "3.2", 0.98, /water potential/i],
  ["3.2.8", "3.2", 0.97, /turgid|turgor|plasmolysis|plasmolysed|flaccid/i],
  ["3.2.2", "3.2", 0.96, /osmosis|partially permeable|dialysis tubing/i],
  ["3.1.1", "3.1", 0.96, /diffusion|down (?:a |the )?concentration gradient/i],
  ["2.2.1", "2.4", 0.98, /magnif(?:y|ied|ication)|actual size|image size/i],
  ["2.2.3", "2.4", 0.96, /micrometre|micrometer|millimetre|millimeter|μm|µm/i],
  ["2.1.2", "2.2", 0.95, /bacterial cell|bacterium|plasmid|circular dna/i],
  ["2.1.6", "2.3", 0.91, /specialised cell|specialized cell|root hair|palisade|neurone|neuron|red blood cell|sperm cell|egg cell|gamete/i],
  ["2.1.7", "2.3", 0.90, /tissue|organ system|level of organisation/i],
  ["2.1.1", "2.1", 0.86, /cell wall|cell membrane|nucleus|cytoplasm|chloroplast|ribosome|mitochondr|vacuole/i],
  ["1.2.4", "1.3", 0.98, /dichotomous|identification key|use the key/i],
  ["1.2.3", "1.2", 0.96, /binomial|scientific name|genus.*species/i],
  ["1.3.7", "1.6", 0.99, /virus|viruses/i],
  ["1.3.5", "1.5", 0.96, /monocot|dicot|fern/i],
  ["1.3.2", "1.5", 0.94, /vertebrate|mammal|bird|reptile|amphibian|arthropod|insect|arachnid|crustacean|myriapod/i],
  ["1.3.4", "1.4", 0.93, /kingdom|fungus|fungi|prokaryote|protoctist/i],
  ["1.2.2", "1.2", 0.92, /\bspecies\b/i],
  ["1.2.1", "1.2", 0.82, /classif(?:y|ied|ication)/i],
  ["1.1.1", "1.1", 0.96, /characteristic(?:s)? (?:of|shown by|not shown by) (?:a |all )?(?:living )?(?:organisms?|things?)/i],
].map(([statement, book, confidence, pattern]) => ({ statement, book, confidence, pattern }));

const POSITION_FALLBACK = [
  [1, "1.1.1", "1.1"], [2, "1.3.2", "1.5"], [3, "2.1.1", "2.1"],
  [4, "2.1.6", "2.3"], [5, "2.2.1", "2.4"], [6, "3.2.2", "3.2"],
  [7, "4.1.2", "4.1"], [8, "5.1.4", "5.1"], [9, "5.1.5", "5.2"],
  [10, "6.1.2", "6.1"], [11, "6.2.2", "6.2"], [12, "7.1.2", "7.1"],
  [13, "7.2.1", "7.2"], [14, "7.4.3", "7.3"], [15, "8.2.1", "8.2"],
  [16, "8.3.1", "8.2"], [17, "8.4.1", "8.3"], [18, "9.1.3", "9.1"],
  [19, "9.2.1", "9.2"], [20, "10.1.3", "10.1"], [21, "11.1.2", "11.2"],
  [22, "12.2.1", "11.1"], [23, "14.1.4", "12.1"], [24, "14.2.2", "12.2"],
  [25, "13.1.3", "13.1"], [26, "14.4.1", "13.2"], [27, "16.1.1", "14.1"],
  [28, "16.3.5", "14.2"], [29, "16.4.1", "15.1"], [30, "17.1.10", "16.1"],
  [31, "17.4.11", "16.2"], [32, "18.1.1", "17.1"], [33, "18.2.1", "17.2"],
  [34, "18.3.1", "17.2"], [35, "19.2.1", "18.1"], [36, "19.3.1", "18.2"],
  [37, "19.4.1", "18.3"], [38, "20.1.1", "19.1"], [39, "20.3.1", "19.1"],
  [40, "20.4.4", "19.2"],
];

function normalizedQuestionText(question) {
  return String(question.stem || "").replace(/\s+/g, " ").trim();
}

export function classifyBiologyQuestion(question) {
  const text = normalizedQuestionText(question);
  const rule = RULES.find((candidate) => candidate.pattern.test(text));
  if (rule) return { ...rule, evidence: "keyword" };
  const questionNumber = Math.max(1, Math.min(40, Number(question.question_no || 1)));
  const [, statement, book] = POSITION_FALLBACK[questionNumber - 1];
  return { statement, book, confidence: 0.35, evidence: "question-position" };
}

function similarQuestionGroup(stem) {
  return createHash("sha256")
    .update(String(stem || "").toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 20);
}

export async function generateBiologyMappingSuggestions(limit = 2000) {
  const [questionResult, curriculumResult, bookResult] = await Promise.all([
    query(`
      select id, stem, options, year, paper_slug, question_no
      from question_bank
      where subject_code = '0610'
        and active = true
        and year ~ '^\\d{4}$'
        and year::integer between 2019 and 2024
      order by year desc, paper_slug, question_no
    `),
    query(`
      select id, syllabus_code
      from curriculum_sections
      where curriculum_version_id = '0610-2026-2028-v2' and level = 'statement'
    `),
    query(`
      select book_section.id, book_section.section_code
      from coursebook_sections book_section
      join coursebook_chapters chapter on chapter.id = book_section.coursebook_chapter_id
      where chapter.book_key = 'biology-igcse-coursebook-4e'
    `),
  ]);
  const curriculumByCode = new Map(curriculumResult.rows.map((row) => [row.syllabus_code, row.id]));
  const bookByCode = new Map(bookResult.rows.map((row) => [row.section_code, row.id]));
  const suggestions = questionResult.rows.slice(0, limit).map((question) => {
    const classification = classifyBiologyQuestion(question);
    const curriculumSectionId = curriculumByCode.get(classification.statement);
    const coursebookSectionId = bookByCode.get(classification.book);
    if (!curriculumSectionId || !coursebookSectionId) {
      throw new Error(`Unknown Biology mapping ${classification.statement} -> ${classification.book}.`);
    }
    return {
      questionId: question.id,
      curriculumSectionId,
      coursebookSectionId,
      confidence: classification.confidence,
      evidence: classification.evidence,
      similarQuestionGroup: similarQuestionGroup(question.stem),
    };
  });

  const client = await getPool().connect();
  let created = 0;
  let existing = 0;
  try {
    await client.query("begin");
    for (const suggestion of suggestions) {
      const humanDecision = await client.query(`
        select 1 from question_section_mappings
        where question_id = $1 and status in ('reviewed', 'rejected')
      `, [suggestion.questionId]);
      if (humanDecision.rowCount) continue;
      await client.query(`
        delete from question_section_mappings
        where question_id = $1
          and status = 'suggested'
          and curriculum_section_id <> $2
      `, [suggestion.questionId, suggestion.curriculumSectionId]);
      const result = await client.query(`
        insert into question_section_mappings (
          question_id, curriculum_section_id, coursebook_section_id,
          is_primary, confidence, status, source, similar_question_group
        ) values ($1, $2, $3, true, $4, 'suggested', 'rule', $5)
        on conflict (question_id, curriculum_section_id) do update set
          coursebook_section_id = excluded.coursebook_section_id,
          is_primary = true,
          confidence = excluded.confidence,
          source = excluded.source,
          similar_question_group = excluded.similar_question_group,
          updated_at = case
            when question_section_mappings.coursebook_section_id is distinct from excluded.coursebook_section_id
              or question_section_mappings.is_primary is distinct from true
              or question_section_mappings.confidence is distinct from excluded.confidence
              or question_section_mappings.similar_question_group is distinct from excluded.similar_question_group
            then now()
            else question_section_mappings.updated_at
          end
        where question_section_mappings.status = 'suggested'
        returning (xmax = 0) as inserted
      `, [
        suggestion.questionId,
        suggestion.curriculumSectionId,
        suggestion.coursebookSectionId,
        suggestion.confidence,
        suggestion.similarQuestionGroup,
      ]);
      if (result.rows[0]?.inserted) created += 1;
      else if (result.rowCount) existing += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {
    matched: suggestions.length,
    considered: suggestions.length,
    created,
    existing,
    keywordMatches: suggestions.filter((suggestion) => suggestion.evidence === "keyword").length,
    positionFallbacks: suggestions.filter((suggestion) => suggestion.evidence === "question-position").length,
  };
}
