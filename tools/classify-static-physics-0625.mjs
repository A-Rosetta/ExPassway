import { mkdir, readFile, writeFile } from "node:fs/promises";

const assetRoot = "assets/exam-question-images/cie-igcse-physics-0625";
const outputFile = ".d1-export/physics-0625-chapter-mappings.sql";
const reportFile = ".d1-export/physics-0625-chapter-mappings.json";
const manifest = JSON.parse(await readFile(`${assetRoot}/manifest.json`, "utf8"));

const rules = [
  ["5.2.4", /half[- ]life/],
  ["5.2.3", /radioactive decay|decay constant/],
  ["5.2.1", /geiger|counter tube|detector.*radiation|detect.*radiation/],
  ["5.2.5", /radioactive.*safety|radiation.*safety|shielding|dose|hazard/],
  ["5.2.2", /alpha|beta|gamma|ionis|radioactiv/],
  ["6.2.3", /red[- ]shift|hubble|big bang|galaxy|universe|light[- ]year/],
  ["6.2.2", /supernova|protostar|white dwarf|red giant|star.*life|stellar/],
  ["6.2.1", /sun.*star|solar flare|sunspot/],
  ["6.1.2", /solar system|planet|satellite|orbit/],
  ["6.1.1", /earth.*axis|earth.*rotation|earth.*orbit|eclipse|moon/],
  ["4.4", /logic gate|\b(and|or|not|nand) gate\b|truth table|digital|binary/],
  ["4.5.6", /transformer|step[- ]up|step[- ]down|primary coil|secondary coil/],
  ["4.5.5", /d\.c\. motor|electric motor|motor.*coil/],
  ["4.5.2", /a\.c\. generator|alternating current.*generator/],
  ["4.5.1", /electromagnetic induction|induced emf|induced current/],
  ["4.5.4", /current[- ]carrying conductor|force.*conductor.*magnetic|fleming.*left/],
  ["4.5.3", /solenoid|electromagnet|magnetic field.*current|relay|loudspeaker/],
  ["4.1", /magnet|magnetic pole|induced magnetism|magnetic material|compass/],
  ["4.3", /series circuit|parallel circuit|ammeter|voltmeter|circuit diagram|thermistor|light-dependent resistor|\bldr\b|fuse|diode/],
  ["4.2", /potential difference|\bemf\b|\bohm'?s law\b|\bresistance\b|electric charge|\bcurrent\b|\bvoltage\b|kilowatt-hour|electrical power/],
  ["3.2.4", /dispersion|prism|rainbow|spectrum.*colour/],
  ["3.2.3", /converging lens|diverging lens|focal length|thin lens|magnif|lens.*image/],
  ["3.2.2", /refraction|refractive|critical angle|total internal reflection|optical fibre/],
  ["3.2.1", /plane mirror|reflection.*light|angle of incidence|angle of reflection/],
  ["3.3", /electromagnetic spectrum|radio wave|microwave|infrared|ultraviolet|\bx-ray|x ray/],
  ["3.4", /\bsound\b|ultrasound|echo|pitch|loudness|audible/],
  ["3.1", /wavelength|wave speed|wavefront|transverse|longitudinal|\bfrequency\b|\bamplitude\b/],
  ["2.3.3", /thermal radiation|infrared.*emit|infrared.*absorb|black.*surface/],
  ["2.3.2", /convection|convection current/],
  ["2.3.1", /conduction|thermal conduct|thermal conductor|insulator/],
  ["2.3.4", /double glazing|cavity wall|greenhouse effect|energy.*transfer.*building/],
  ["2.2.2", /specific heat capacity|heat capacity/],
  ["2.2.1", /thermal expansion|expand.*heat|bimetallic/],
  ["2.2.3", /melting|boiling|evaporation|condensation|latent heat/],
  ["2.1.1", /solid.*liquid.*gas|state.*matter/],
  ["2.1.2", /particle model|brownian|diffusion|gas pressure|particle.*kinetic/],
  ["1.6", /momentum|\bimpulse\b|collision.*conserv/],
  ["1.5.2", /\bmoment\b|turning effect|pivot|lever|seesaw|balanced beam/],
  ["1.5.3", /centre of gravity|center of gravity|stability.*centre|stability.*center/],
  ["1.5.1", /resultant force|friction|drag force|spring constant|hooke|newton.*law|\bforce\b/],
  ["1.7.4", /\bpower\b|watt|kilowatt/],
  ["1.7.3", /fossil fuel|renewable|non-renewable|hydroelectric|wind turbine|solar cell|energy resource/],
  ["1.7.2", /\bwork done\b|work.*force.*distance/],
  ["1.7.1", /kinetic energy|gravitational potential|energy transfer|efficiency|conservation of energy/],
  ["1.8", /\bpressure\b|hydraulic|force.*area/],
  ["1.4", /\bdensity\b|mass.*volume|float.*water|sink.*water/],
  ["1.3", /gravitational field strength|\bweight\b|\bmass\b/],
  ["1.2", /acceleration|deceleration|terminal velocity|distance[- ]time|speed[- ]time|\bvelocity\b|\bspeed\b|free fall/],
  ["1.1", /measuring cylinder|metre rule|meter rule|vernier|stopwatch|scalar|vector|significant figure|\bmeasure/],
  ["5.1.2", /nucleus|nucleon|proton|neutron|isotope|atomic number|mass number/],
  ["5.1.1", /statement about an atom|atom.*neutral|ion.*atom|electron.*nucleus/],
];

function questionId(paperSlug, questionNo) {
  return `CIE-IGCSE-0625-${paperSlug}-${String(questionNo).padStart(2, "0")}`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function classify(row) {
  const text = [row.stem, row.rawText, ...Object.values(row.options || {})].join(" ").toLowerCase();
  const match = rules.find(([, pattern]) => pattern.test(text));
  return match
    ? { sectionCode: match[0], confidence: row.imageOnly ? 0.72 : 0.9, matched: true }
    : { sectionCode: "1.1", confidence: 0.2, matched: false };
}

const records = [];
for (const paper of manifest.papers.filter((paper) => paper.status === "validated")) {
  const payload = JSON.parse(await readFile(`${assetRoot}/data/${paper.slug}.json`, "utf8"));
  for (const row of payload.rows) {
    if (!Number.isInteger(row.answer) || row.answer < 0 || row.answer > 3) continue;
    records.push({ id: questionId(paper.slug, Number(row.questionNo)), ...classify(row) });
  }
}

const counts = Object.fromEntries([...new Set(records.map((record) => record.sectionCode))]
  .sort()
  .map((sectionCode) => [sectionCode, records.filter((record) => record.sectionCode === sectionCode).length]));
const unmatched = records.filter((record) => !record.matched).map((record) => record.id);
const sql = [
  "-- Generated by tools/classify-static-physics-0625.mjs. Do not edit manually.",
  ...records.map((record) => `
INSERT INTO question_section_mappings (
  question_id, curriculum_section_id, coursebook_section_id, is_primary, confidence, status, source
) VALUES (
  ${sqlValue(record.id)},
  '0625-s-' || replace(${sqlValue(record.sectionCode)}, '.', '-'),
  '0625-b-' || replace(${sqlValue(record.sectionCode)}, '.', '-'),
  ${record.matched ? 1 : 0}, ${record.confidence}, ${record.matched ? "'reviewed'" : "'suggested'"}, 'rule'
)
ON CONFLICT(question_id, curriculum_section_id) DO UPDATE SET
  coursebook_section_id = excluded.coursebook_section_id,
  is_primary = excluded.is_primary,
  confidence = excluded.confidence,
  status = excluded.status,
  source = excluded.source,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE question_section_mappings.source = 'rule';`).join("\n"),
].join("\n");

await mkdir(".d1-export", { recursive: true });
await writeFile(outputFile, sql, "utf8");
await writeFile(reportFile, `${JSON.stringify({ total: records.length, reviewed: records.length - unmatched.length, suggested: unmatched.length, counts, unmatched }, null, 2)}\n`, "utf8");

console.log(`Prepared ${records.length} mappings: ${records.length - unmatched.length} reviewed, ${unmatched.length} suggested.`);
console.log(`SQL: ${outputFile}`);
console.log(`Report: ${reportFile}`);
