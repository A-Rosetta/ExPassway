import assert from "node:assert/strict";
import {
  buildBlueprintIssues,
  buildPaperBlueprint,
  compareEquivalentPapers,
} from "../shared/paper-blueprint.js";

const items = [
  {
    id: "q1",
    answer: 0,
    marks: 1,
    paperSlug: "0625_s24_qp_22",
    year: 2024,
    season: "s",
    difficulty: "foundation",
    sectionId: "motion",
    sectionCode: "1.2",
    sourceGroup: "g1",
    estimatedSeconds: 60,
  },
  {
    id: "q2",
    answer: 0,
    marks: 2,
    paperSlug: "0625_s24_qp_22",
    year: 2024,
    season: "s",
    difficulty: null,
    sectionId: "motion",
    sectionCode: "1.2",
    sourceGroup: "g1",
    estimatedSeconds: 75,
  },
  {
    id: "q3",
    answer: 2,
    marks: 1,
    paperSlug: "0625_w23_qp_21",
    year: 2023,
    season: "w",
    difficulty: "extended",
    sectionId: "energy",
    sectionCode: "1.7",
    sourceGroup: "g3",
    estimatedSeconds: 90,
  },
];

const blueprint = buildPaperBlueprint(items);
assert.equal(blueprint.questionCount, 3);
assert.equal(blueprint.totalMarks, 4);
assert.equal(blueprint.estimatedSeconds, 225);
assert.deepEqual(blueprint.answerDistribution, { A: 2, B: 0, C: 1, D: 0, unknown: 0 });
assert.equal(blueprint.sections.motion.count, 2);
assert.equal(blueprint.sections.motion.marks, 3);
assert.equal(blueprint.sources["0625_s24_qp_22"].count, 2);
assert.equal(blueprint.difficulty.known, 2);
assert.equal(blueprint.difficulty.coverage, 2 / 3);

const issues = buildBlueprintIssues(blueprint, {
  targetSections: { motion: 3, energy: 1 },
  difficultyCoverageMinimum: 0.7,
});
assert.ok(issues.some((issue) => issue.code === "SIMILAR_GROUP_REPEAT"));
assert.ok(issues.some((issue) => issue.code === "SOURCE_CONCENTRATION"));
assert.ok(issues.some((issue) => issue.code === "SECTION_TARGET_MISSING" && issue.blocking));
assert.ok(issues.some((issue) => issue.code === "DIFFICULTY_DATA_INSUFFICIENT"));
assert.ok(!issues.some((issue) => issue.code === "ANSWER_DISTRIBUTION_IMBALANCE"));

const imbalanced = buildPaperBlueprint(Array.from({ length: 20 }, (_, index) => ({
  id: `answer-${index}`,
  answer: index < 9 ? 0 : index % 4,
  marks: 1,
  paperSlug: `0625_s24_qp_${20 + index}`,
  sectionId: "motion",
  sourceGroup: `answer-group-${index}`,
})));
const imbalancedIssues = buildBlueprintIssues(imbalanced);
assert.ok(imbalancedIssues.some((issue) => issue.code === "ANSWER_DISTRIBUTION_IMBALANCE"));

const comparison = compareEquivalentPapers(
  [
    { id: "a1", marks: 1, sectionId: "motion", sourceGroup: "g1", year: 2024, estimatedSeconds: 60 },
    { id: "a2", marks: 2, sectionId: "energy", sourceGroup: "g2", year: 2023, estimatedSeconds: 90 },
  ],
  [
    { id: "b1", marks: 1, sectionId: "motion", sourceGroup: "g3", year: 2024, estimatedSeconds: 65 },
    { id: "b2", marks: 2, sectionId: "energy", sourceGroup: "g4", year: 2022, estimatedSeconds: 85 },
  ],
);
assert.equal(comparison.questionCountMatch, true);
assert.equal(comparison.totalMarksMatch, true);
assert.equal(comparison.sectionCountsMatch, true);
assert.deepEqual(comparison.repeatedQuestionIds, []);
assert.deepEqual(comparison.repeatedSourceGroups, []);
assert.equal(comparison.estimatedSecondsDifference, 0);

console.log("Paper blueprint checks passed.");
