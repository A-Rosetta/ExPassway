import assert from "node:assert/strict";
import { addBasketItems, createPaperBuilderState } from "../scripts/paper-builder.js";

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

console.log("Paper builder bulk selection checks passed.");
