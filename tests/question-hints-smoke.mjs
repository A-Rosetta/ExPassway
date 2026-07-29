import assert from "node:assert/strict";
import http from "node:http";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to an isolated test database.");

const requests = [];
let responseCount = 0;
const mockServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests.push({ url: req.url, authorization: req.headers.authorization, body });
  responseCount += 1;

  const hints = responseCount === 1
    ? ["The correct answer is option B.", "Compare the structures carefully.", "Apply the relevant cell concept."]
    : ["Identify the cell structure involved in this process.", "Connect that structure to its main biological role.", "Use the diagram evidence to eliminate incompatible choices."];
  const payload = JSON.stringify({ hints });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    id: `resp_test_${responseCount}`,
    output: [{ content: [{ type: "output_text", text: payload }] }],
  }));
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockPort = mockServer.address().port;
process.env.OPENAI_API_KEY = "test-only-secret";
process.env.OPENAI_HINT_MODEL = "test-vision-model";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mockPort}`;
process.env.AI_HINT_MODE = "live";

const { query, getPool } = await import("../backend/src/db/client.js");
const {
  fingerprintQuestion,
  getBiologyHintSampleReviewStatus,
  getOrGenerateQuestionHints,
  HINT_PROMPT_VERSION,
} = await import("../backend/src/services/questionHints.service.js");
const {
  getQuestionHintSet,
  upsertQuestionHintSet,
} = await import("../backend/src/db/repositories/questionHints.repository.js");

const imageUrl = "/assets/exam-question-images/cie-igcse-biology-0610/0610_m21_qp_22/q01.png";
const baseQuestion = {
  id: "TEST-HINT-QUESTION-01",
  board: "CIE",
  subject: "IGCSE Biology",
  subjectCode: "0610",
  paper: "MCQ",
  paperSlug: "0610_m21_qp_22",
  questionNo: 1,
  stem: "Which structure is involved in the process shown?",
  options: ["cell wall", "chloroplast", "ribosome", "vacuole"],
  answer: 1,
  images: [{ url: imageUrl }],
  active: true,
};

try {
  await query(`
    insert into question_bank (
      id, board, subject, paper, stem, options, answer, images,
      subject_code, paper_slug, question_no, active
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, true)
  `, [
    baseQuestion.id,
    baseQuestion.board,
    baseQuestion.subject,
    baseQuestion.paper,
    baseQuestion.stem,
    JSON.stringify(baseQuestion.options),
    baseQuestion.answer,
    JSON.stringify(baseQuestion.images),
    baseQuestion.subjectCode,
    baseQuestion.paperSlug,
    baseQuestion.questionNo,
  ]);

  const { fingerprint } = await fingerprintQuestion(baseQuestion);
  await upsertQuestionHintSet({
    questionId: baseQuestion.id,
    language: "zh-CN",
    promptVersion: HINT_PROMPT_VERSION,
    questionFingerprint: fingerprint,
    hints: ["待审核提示一", "待审核提示二", "待审核提示三"],
    status: "pending_review",
    model: "test-review-model",
    responseId: "resp_pending",
  });

  await assert.rejects(
    getOrGenerateQuestionHints(baseQuestion, { language: "zh-CN", allowGeneration: false }),
    (error) => error.code === "AI_HINT_PENDING_REVIEW"
  );

  const generated = await getOrGenerateQuestionHints(baseQuestion, {
    language: "zh-CN",
    allowGeneration: true,
    status: "approved",
  });
  assert.equal(generated.source, "generated");
  assert.equal(generated.hints.length, 3);
  assert.equal(requests.length, 2, "unsafe first output should trigger one validation retry");
  assert.equal(requests[0].url, "/responses");
  assert.equal(requests[0].authorization, "Bearer test-only-secret");
  assert.equal(requests[0].body.model, "test-vision-model");
  assert.equal(requests[0].body.text.format.type, "json_schema");
  const imagePart = requests[0].body.input[0].content.find((part) => part.type === "input_image");
  assert.match(imagePart.image_url, /^data:image\/png;base64,/);
  assert.ok(imagePart.image_url.length > 1000, "question image was not sent to the model");

  const requestCountAfterGeneration = requests.length;
  const cached = await getOrGenerateQuestionHints(baseQuestion, {
    language: "zh-CN",
    allowGeneration: false,
  });
  assert.equal(cached.source, "cache");
  assert.equal(requests.length, requestCountAfterGeneration, "cache hit called OpenAI again");

  const [englishA, englishB] = await Promise.all([
    getOrGenerateQuestionHints(baseQuestion, { language: "en", allowGeneration: true, status: "approved" }),
    getOrGenerateQuestionHints(baseQuestion, { language: "en", allowGeneration: true, status: "approved" }),
  ]);
  assert.deepEqual(englishA.hints, englishB.hints);
  assert.equal(requests.length, requestCountAfterGeneration + 1, "concurrent requests were not deduplicated");

  const storedEnglish = await getQuestionHintSet({
    questionId: baseQuestion.id,
    language: "en",
    promptVersion: HINT_PROMPT_VERSION,
    questionFingerprint: fingerprint,
  });
  assert.equal(storedEnglish.status, "approved");
  assert.equal(storedEnglish.model, "test-vision-model");

  const sampleStatus = await getBiologyHintSampleReviewStatus();
  assert.equal(sampleStatus.expected, 24);
  assert.equal(sampleStatus.ready, false);
  assert.equal(sampleStatus.missing, 24);

  const blockedQuestion = { ...baseQuestion, id: "TEST-HINT-QUESTION-02", questionNo: 2 };
  await query(`
    insert into question_bank (
      id, board, subject, paper, stem, options, answer, images,
      subject_code, paper_slug, question_no, active
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, true)
  `, [
    blockedQuestion.id,
    blockedQuestion.board,
    blockedQuestion.subject,
    blockedQuestion.paper,
    blockedQuestion.stem,
    JSON.stringify(blockedQuestion.options),
    blockedQuestion.answer,
    JSON.stringify(blockedQuestion.images),
    blockedQuestion.subjectCode,
    blockedQuestion.paperSlug,
    blockedQuestion.questionNo,
  ]);
  const { fingerprint: blockedFingerprint } = await fingerprintQuestion(blockedQuestion);
  await upsertQuestionHintSet({
    questionId: blockedQuestion.id,
    language: "en",
    promptVersion: HINT_PROMPT_VERSION,
    questionFingerprint: blockedFingerprint,
    hints: ["Inspect the diagram.", "Compare the structures.", "Apply the relevant concept."],
    status: "approved",
    model: "test-review-model",
    responseId: "resp_approved_before_gate",
  });
  await assert.rejects(
    getOrGenerateQuestionHints(blockedQuestion, {
      language: "en",
      allowGeneration: false,
      requireSampleApproval: true,
      status: "approved",
    }),
    (error) => error.code === "AI_HINT_SAMPLE_NOT_APPROVED" && error.details?.expected === 24
  );
  assert.equal(requests.length, requestCountAfterGeneration + 1, "review gate called OpenAI");

  const serializedRows = JSON.stringify((await query("select * from question_hint_sets")).rows);
  assert.equal(serializedRows.includes("test-only-secret"), false, "API key was stored in the database");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    openaiRequests: requests.length,
    validationRetry: true,
    concurrentDeduplication: true,
    sampleReviewGate: sampleStatus,
  })}\n`);
} finally {
  await getPool()?.end();
  await new Promise((resolve) => mockServer.close(resolve));
}
