export function evaluatePaper(questions, answers, input = {}) {
  let correct = 0;
  const details = [];

  questions.forEach((question, idx) => {
    const rawSelected = answers[idx];
    const selectedIndex = Number.isInteger(rawSelected) ? rawSelected : -1;
    const isCorrect = selectedIndex === question.answer;

    if (isCorrect) {
      correct += 1;
    }

    details.push({
      id: question.id,
      topic: question.topic,
      skills: Array.isArray(question.skills) ? question.skills : [],
      mistakeType: question.mistakeType || "concept",
      correct: isCorrect,
      starred: Boolean(input.starred?.[idx]),
      selectedIndex,
      answer: question.answer,
      hintsUsed: 0,
    });
  });

  const total = questions.length;
  return {
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? (correct / total) * 100 : 0,
    details,
    submittedAt: new Date().toISOString(),
  };
}

export function buildWrongLog(details) {
  const map = new Map();
  details.forEach((item) => {
    if (!map.has(item.topic)) {
      map.set(item.topic, {
        topic: item.topic,
        mistake: item.mistakeType,
        correct: 0,
        wrong: 0,
      });
    }
    const row = map.get(item.topic);
    if (item.correct) {
      row.correct += 1;
    } else {
      row.wrong += 1;
    }
  });
  return [...map.values()];
}
