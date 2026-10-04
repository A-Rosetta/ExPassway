import assert from "node:assert/strict";
import { addBasketItem, addBasketItems, createPaperBuilderState, normalizeBuilderQuestion, serializeSavedPaper } from "../scripts/paper-builder.js";

const state = createPaperBuilderState();
state.subjectCode = "0625";
state.items.push({ id: "q1", subjectCode: "0625" });
const question = (id, subjectCode = "0625") => ({
  id, subjectCode, sectionId: "physics-motion", sectionCode: "1.2", mappingStatus: "reviewed",
});

assert.equal(addBasketItems(state, [question("q1"), question("q2"), question("q2"), question("q3")]), 2);
assert.deepEqual(state.items.map((item) => item.id), ["q1", "q2", "q3"]);
assert.equal(state.items[1].sectionId, "physics-motion");
assert.equal(state.items[1].mappingStatus, "reviewed");

const full = createPaperBuilderState();
full.subjectCode = "0625";
full.items = Array.from({ length: 199 }, (_, index) => question(`existing-${index}`));
assert.throws(() => addBasketItems(full, [question("new-1"), question("new-2")]), /paperBuilderBasketLimit/);
assert.equal(full.items.length, 199);

assert.throws(() => addBasketItems(state, [question("q4"), question("other", "0610")]), /paperBuilderSameSubject/);
assert.deepEqual(state.items.map((item) => item.id), ["q1", "q2", "q3"]);

const empty = createPaperBuilderState();
assert.throws(() => addBasketItems(empty, [question("q1"), question("other", "0610")]), /paperBuilderSameSubject/);
assert.equal(empty.items.length, 0);

const structured = createPaperBuilderState();
const parent = {
  id: "9618-parent", subjectCode: "9618", questionType: "structured", maxMarks: 9, marks: 1,
  content: { blocks: [{ type: "text", text: "Explain the purpose of a processor." }] },
  markScheme: { blocks: [{ type: "text", text: "Award marks for fetch, decode and execute." }] },
};
assert.equal(addBasketItems(structured, [parent, { ...parent, id: "part-a", parentQuestionId: parent.id }]), 1);
assert.equal(structured.items[0].marks, 9);
assert.equal(structured.items[0].maxMarks, 9);
assert.equal(structured.items[0].answer, null);
assert.equal(serializeSavedPaper(structured).items[0].marks, 9);

for (const difficulty of [undefined, null, "", "unmarked", " UNKNOWN "]) {
  assert.equal(normalizeBuilderQuestion({ ...parent, difficulty }).difficulty, null);
}
assert.equal(normalizeBuilderQuestion({ ...parent, difficulty: "foundation" }).difficulty, "foundation");
assert.equal(normalizeBuilderQuestion({ questionType: "mcq", difficulty: "unknown" }).difficulty, "unknown");

for (const maxMarks of [undefined, null, 0, -1, 1.5, "8", NaN, Infinity]) {
  const invalid = { ...parent, id: "invalid-official-marks", maxMarks, marks: 8 };
  const normalized = normalizeBuilderQuestion(invalid);
  if (maxMarks == null) assert.equal(normalized.maxMarks, null);
  else assert.equal(normalized.maxMarks, maxMarks);
  const fresh = createPaperBuilderState();
  assert.throws(() => addBasketItem(fresh, invalid), (error) => (
    error.message === "paperBuilderMissingOfficialMarks" && error.questionId === invalid.id
  ));
  assert.equal(fresh.items.length, 0);
  assert.equal(fresh.subjectCode, "");
  assert.equal(fresh.dirty, false);
  assert.throws(() => addBasketItems(fresh, [parent, invalid]), /paperBuilderMissingOfficialMarks/);
  assert.equal(fresh.items.length, 0, "Invalid official marks must reject the complete bulk addition.");
}

console.log("Paper builder bulk selection checks passed.");
