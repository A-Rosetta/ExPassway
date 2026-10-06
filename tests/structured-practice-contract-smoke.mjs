import assert from "node:assert/strict";
import { normalizeStructuredAnswers, structuredAnswerParts, STRUCTURED_ANSWER_IMAGE_MAX_BYTES } from "../shared/structured-practice.js";

const question = { id: "q1", maxMarks: 7, content: { parts: [
  { id: "a", label: "(a)", maxMarks: 7, prompt: [{ type: "text", text: "Shared context" }], children: [
    { id: "ai", label: "(i)", maxMarks: 3, prompt: [{ type: "code", text: "IF x THEN\n    OUTPUT x" }] },
    { id: "aii", label: "(ii)", maxMarks: 4, prompt: [] },
  ] },
] } };
const targets = structuredAnswerParts(question);
assert.deepEqual(targets.map(({ partId, label, maxMarks }) => ({ partId, label, maxMarks })), [
  { partId: "ai", label: "(a)(i)", maxMarks: 3 }, { partId: "aii", label: "(a)(ii)", maxMarks: 4 },
]);
assert.equal(targets[0].prompt[1].text, "IF x THEN\n    OUTPUT x");
assert.deepEqual(normalizeStructuredAnswers(question, [{ partId: "ai", text: "  code\n    indentation  " }]), [
  { partId: "ai", text: "  code\n    indentation  " }, { partId: "aii", text: "" },
]);
for (const answers of [null, [{ partId: "unknown", text: "answer" }], [{ partId: "ai", text: 1 }], [{ partId: "ai", text: "x" }, { partId: "ai", text: "y" }], [{ partId: "ai", text: "x".repeat(10001) }]]) {
  assert.throws(() => normalizeStructuredAnswers(question, answers), { code: "INVALID_STRUCTURED_ANSWERS" });
}
assert.deepEqual(structuredAnswerParts({ id: "whole", maxMarks: 3, content: {} }).map(({ partId, maxMarks }) => ({ partId, maxMarks })), [{ partId: "whole", maxMarks: 3 }]);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=";
assert.equal(normalizeStructuredAnswers(question, [{ partId: "ai", text: "", imageDataUrl: png }])[0].imageDataUrl, png);
for (const imageDataUrl of ["data:image/svg+xml;base64,PHN2Zy8+", "https://outside.test/image.png", "data:image/png;base64,YmFk", `data:image/png;base64,${Buffer.alloc(STRUCTURED_ANSWER_IMAGE_MAX_BYTES + 1).toString("base64")}`]) {
  assert.throws(() => normalizeStructuredAnswers(question, [{ partId: "ai", text: "", imageDataUrl }]), { code: "INVALID_STRUCTURED_ANSWERS" });
}
const choice = { id: "choice", maxMarks: 1, content: { parts: [{ id: "a", label: "", maxMarks: 1, answerFormat: "choice", choices: ["A", "B", "C", "D"] }] } };
assert.deepEqual(normalizeStructuredAnswers(choice, [{ partId: "a", text: " b " }]), [{ partId: "a", text: "B" }]);
assert.throws(() => normalizeStructuredAnswers(choice, [{ partId: "a", text: "A or B" }]), { code: "INVALID_STRUCTURED_ANSWERS" });
assert.throws(() => normalizeStructuredAnswers(choice, [{ partId: "a", text: "A", imageDataUrl: png }]), { code: "INVALID_STRUCTURED_ANSWERS" });
console.log("Structured practice answer contract checks passed.");
