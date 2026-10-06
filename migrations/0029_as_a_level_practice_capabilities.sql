-- Practice requires published, reviewed question-bank records as well as these
-- component capabilities. Original component metadata and existing attempts
-- remain intact. MCQs use official answer keys rather than AI judgement.
UPDATE exam_subject_components
SET capabilities = json_object(
  'manualPaperBuilder', json('false'),
  'smartPaperBuilder', json('false'),
  'onlinePractice', json('true'),
  'structuredAiGrading', CASE WHEN paper_type = 'mcq' THEN json('false') ELSE json('true') END,
  'officialAnswerKeyGrading', CASE WHEN paper_type = 'mcq' THEN json('true') ELSE json('false') END,
  'aiHints', json('false')
)
WHERE subject_code IN ('9702', '9701', '9708', '9700', '9696');
