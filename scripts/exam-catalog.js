(function () {
  const chemistryPapers = [
    "0620_s23_qp_21",
    "0620_s23_qp_22",
    "0620_s23_qp_23",
    "0620_w23_qp_211",
    "0620_w23_qp_221",
    "0620_w23_qp_231",
  ];

  const coordinatedSciencesPapers = [
    "0654_m23_qp_22",
    "0654_s23_qp_21",
    "0654_s23_qp_22",
    "0654_s23_qp_23",
    "0654_w23_qp_21",
    "0654_w23_qp_22",
    "0654_w23_qp_23",
    "0654_m24_qp_22",
    "0654_s24_qp_21",
    "0654_s24_qp_22",
    "0654_s24_qp_23",
    "0654_w24_qp_21",
    "0654_w24_qp_22",
    "0654_w24_qp_23",
    "0654_m25_qp_22",
    "0654_s25_qp_21",
    "0654_s25_qp_22",
    "0654_s25_qp_23",
    "0654_w25_qp_21",
    "0654_w25_qp_22",
    "0654_w25_qp_23",
  ];

  window.EXAM_CATALOG = {
    "IGCSE Chemistry": {
      syllabus: "0620",
      idPrefix: "CIE-IGCHEM-SET",
      displayName: "Chemistry (0620)",
      paperLabel: "Chemistry",
      dataRoot: "backend/src/data/pymupdf-batch",
      dataSuffix: ".structured.json",
      answerKeys: "backend/src/data/pymupdf-batch/answer-keys.json",
      papers: chemistryPapers.map((slug) => ({ slug, questions: 40 })),
    },
    "IGCSE Co-ordinated Sciences": {
      syllabus: "0654",
      idPrefix: "CIE-IGCOORD-SET",
      displayName: "Co-ordinated Sciences (0654)",
      paperLabel: "Co-ordinated Sciences",
      dataRoot: "assets/exam-question-images/cie-igcse-coordinated-sciences-0654/data",
      dataSuffix: ".json",
      answerKeys: "assets/exam-question-images/cie-igcse-coordinated-sciences-0654/answer-keys.json",
      papers: coordinatedSciencesPapers.map((slug) => ({
        slug,
        questions: slug === "0654_s23_qp_22" ? 39 : 40,
      })),
    },
  };
})();
