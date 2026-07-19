#!/usr/bin/env python3
import json
import re
from pathlib import Path

import fitz

SOURCE_ROOT = Path("/home/ubuntu/ig_coorinate_science")
ASSET_ROOT = Path(
    "/home/ubuntu/alevel-smart-practice/assets/exam-question-images/"
    "cie-igcse-coordinated-sciences-0654"
)
DATA_ROOT = ASSET_ROOT / "data"
PUBLIC_ROOT = "/assets/exam-question-images/cie-igcse-coordinated-sciences-0654"
REPORT_PATH = ASSET_ROOT / "report.json"
ANSWER_KEYS_PATH = ASSET_ROOT / "answer-keys.json"
QP_PATTERN = re.compile(r"^0654_[msw]\d{2}_qp_2[123]\.pdf$", re.IGNORECASE)
EXPECTED_QUESTIONS = tuple(range(1, 41))
LETTER_TO_INDEX = {"A": 0, "B": 1, "C": 2, "D": 3}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def collect_question_anchors(doc):
    anchors = []
    for page_index, page in enumerate(doc):
        page_text = normalize_text(page.get_text("text"))
        if "Paper 2 Multiple Choice" in page_text and "INSTRUCTIONS" in page_text:
            continue

        for word in page.get_text("words"):
            x0, y0, x1, y1, token = word[:5]
            token = str(token).strip()
            if not token.isdigit():
                continue
            question_no = int(token)
            if question_no not in EXPECTED_QUESTIONS or x0 > 90 or (y1 - y0) < 6:
                continue
            anchors.append(
                (question_no, page_index, float(y0), float(y1), float(x0), float(x1))
            )

    first_seen = {}
    for anchor in sorted(anchors, key=lambda item: (item[0], item[1], item[2])):
        first_seen.setdefault(anchor[0], anchor)
    return [first_seen[question_no] for question_no in EXPECTED_QUESTIONS if question_no in first_seen]


def trim_to_single_question(text: str, question_no: int) -> str:
    value = normalize_text(text)
    start = re.search(rf"(^|\s){question_no}\s+", value)
    if start:
        value = value[start.end():].strip()
    if question_no < EXPECTED_QUESTIONS[-1]:
        end = re.search(rf"(^|\s){question_no + 1}\s+", value)
        if end:
            value = value[:end.start()].strip()
    return value


def split_stem_and_options(text: str):
    compact = normalize_text(text)
    markers = {letter: compact.find(f" {letter} ") for letter in "ABCD"}
    if any(position < 0 for position in markers.values()):
        return None
    if not (markers["A"] < markers["B"] < markers["C"] < markers["D"]):
        return None

    stem = compact[:markers["A"]].strip()
    options = {
        "A": compact[markers["A"] + 3:markers["B"]].strip(),
        "B": compact[markers["B"] + 3:markers["C"]].strip(),
        "C": compact[markers["C"] + 3:markers["D"]].strip(),
        "D": compact[markers["D"] + 3:].strip(),
    }
    if not stem or any(not option for option in options.values()):
        return None
    return {"stem": stem, "options": options}


def extract_mark_scheme(mark_scheme_path: Path):
    with fitz.open(mark_scheme_path) as doc:
        text = " ".join(page.get_text("text") for page in doc)

    answers = {}
    for match in re.finditer(
        r"(?:^|\s)([1-9]|[12]\d|3\d|40)\s+([ABCD])\s+1(?=\s|$)", text
    ):
        question_no = int(match.group(1))
        answer = match.group(2)
        previous = answers.get(question_no)
        if previous is not None and previous != answer:
            raise ValueError(
                f"Conflicting answers for question {question_no} in {mark_scheme_path.name}"
            )
        answers[question_no] = answer

    discounted = {
        int(match.group(1))
        for match in re.finditer(
            r"(?:^|\s)([1-9]|[12]\d|3\d|40)\s+Question\s+Discounted(?=\s|$)",
            text,
            re.IGNORECASE,
        )
    }
    overlap = set(answers) & discounted
    if overlap:
        raise ValueError(
            f"Questions have both answers and discounted status in {mark_scheme_path.name}: "
            f"{sorted(overlap)}"
        )

    missing = [
        question_no
        for question_no in EXPECTED_QUESTIONS
        if question_no not in answers and question_no not in discounted
    ]
    if missing:
        raise ValueError(f"Missing mark scheme entries in {mark_scheme_path.name}: {missing}")
    return answers, discounted


def cut_questions(question_paper_path: Path, answers, discounted):
    slug = question_paper_path.stem.lower()
    image_dir = ASSET_ROOT / slug
    image_dir.mkdir(parents=True, exist_ok=True)

    with fitz.open(question_paper_path) as doc:
        anchors = collect_question_anchors(doc)
        found = {anchor[0] for anchor in anchors}
        missing = [question_no for question_no in EXPECTED_QUESTIONS if question_no not in found]
        if missing or len(anchors) != len(EXPECTED_QUESTIONS):
            raise ValueError(
                f"Expected 40 question anchors in {question_paper_path.name}; "
                f"found {len(anchors)}, missing {missing}"
            )

        rows = []
        for index, anchor in enumerate(anchors):
            question_no, page_index, y0, y1, _x0, _x1 = anchor
            page = doc[page_index]
            if index + 1 < len(anchors) and anchors[index + 1][1] == page_index:
                bottom = max(y1 + 30, anchors[index + 1][2] - 8)
            else:
                bottom = float(page.rect.height) - 24

            top = max(0, y0 - 6)
            clip = fitz.Rect(20, top, page.rect.width - 20, bottom)
            raw_text = trim_to_single_question(page.get_text("text", clip=clip), question_no)
            parsed = split_stem_and_options(raw_text)
            image_name = f"q{question_no:02d}.png"
            image_path = image_dir / image_name
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
            pixmap.save(image_path)

            answer_letter = answers.get(question_no)
            rows.append(
                {
                    "questionNo": question_no,
                    "pageIndex": page_index,
                    "top": round(top, 2),
                    "bottom": round(bottom, 2),
                    "imageUrl": f"{PUBLIC_ROOT}/{slug}/{image_name}",
                    "rawText": raw_text,
                    "parseStatus": "ok" if parsed else "image_only",
                    "stem": parsed["stem"] if parsed else "",
                    "options": parsed["options"] if parsed else {},
                    "answer": LETTER_TO_INDEX[answer_letter] if answer_letter else None,
                    "answerLetter": answer_letter,
                    "answerStatus": "discounted" if question_no in discounted else "valid",
                }
            )
    return rows


def find_question_papers():
    return sorted(
        path for path in SOURCE_ROOT.rglob("*.pdf") if QP_PATTERN.fullmatch(path.name)
    )


def process_paper(question_paper_path: Path):
    mark_scheme_path = question_paper_path.with_name(
        question_paper_path.name.replace("_qp_", "_ms_")
    )
    if not mark_scheme_path.is_file():
        raise FileNotFoundError(
            f"No matching mark scheme for {question_paper_path.name}: {mark_scheme_path}"
        )

    answers, discounted = extract_mark_scheme(mark_scheme_path)
    rows = cut_questions(question_paper_path, answers, discounted)
    slug = question_paper_path.stem.lower()
    output_path = DATA_ROOT / f"{slug}.json"
    output_path.write_text(
        json.dumps(
            {
                "questionPaper": str(question_paper_path),
                "markScheme": str(mark_scheme_path),
                "questionCount": len(rows),
                "discountedQuestions": sorted(discounted),
                "rows": rows,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    return {
        "paper": slug,
        "questionPaper": question_paper_path.name,
        "markScheme": mark_scheme_path.name,
        "questionCount": len(rows),
        "answerCount": len(answers),
        "discountedQuestions": sorted(discounted),
        "textParseOk": sum(row["parseStatus"] == "ok" for row in rows),
        "imageOnly": sum(row["parseStatus"] == "image_only" for row in rows),
        "dataFile": str(output_path),
    }, {
        str(question_no): LETTER_TO_INDEX[answers[question_no]] if question_no in answers else None
        for question_no in EXPECTED_QUESTIONS
    }


def main():
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    question_papers = find_question_papers()
    if not question_papers:
        raise FileNotFoundError(f"No 0654 Paper 2 question papers found under {SOURCE_ROOT}")

    reports = []
    answer_keys = {}
    for question_paper_path in question_papers:
        report, answer_key = process_paper(question_paper_path)
        reports.append(report)
        answer_keys[report["paper"]] = answer_key
        print(
            f"{report['paper']}: questions={report['questionCount']} "
            f"answers={report['answerCount']} discounted={report['discountedQuestions']} "
            f"text-ok={report['textParseOk']} image-only={report['imageOnly']}"
        )

    ANSWER_KEYS_PATH.write_text(
        json.dumps(answer_keys, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    REPORT_PATH.write_text(
        json.dumps(
            {
                "sourceRoot": str(SOURCE_ROOT),
                "assetRoot": str(ASSET_ROOT),
                "syllabus": "0654",
                "subject": "CIE IGCSE Co-ordinated Sciences",
                "paper": "Paper 2 Multiple Choice",
                "paperCount": len(reports),
                "questionImageCount": sum(row["questionCount"] for row in reports),
                "validAnswerCount": sum(row["answerCount"] for row in reports),
                "discountedQuestionCount": sum(
                    len(row["discountedQuestions"]) for row in reports
                ),
                "files": reports,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"answer keys: {ANSWER_KEYS_PATH}")
    print(f"report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
