#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz

EXPECTED_QUESTIONS = tuple(range(1, 41))
LETTER_TO_INDEX = {"A": 0, "B": 1, "C": 2, "D": 3}
FILE_PATTERN = re.compile(
    r"^(?P<subject>\d{4})_(?P<season>[msw])(?P<year>\d{2})_"
    r"(?P<kind>qp|ms)_(?P<paper>2)(?P<variant>[1-9])\.pdf$",
    re.IGNORECASE,
)


def normalize_text(value):
    return re.sub(r"\s+", " ", value or "").strip()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_file_name(path, subject_code):
    match = FILE_PATTERN.fullmatch(path.name)
    if not match or match.group("subject") != subject_code:
        return None
    data = match.groupdict()
    data["paper_slug"] = (
        f"{data['subject']}_{data['season'].lower()}{data['year']}_"
        f"qp_{data['paper']}{data['variant']}"
    )
    return data


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
    return [first_seen[number] for number in EXPECTED_QUESTIONS if number in first_seen]


def trim_to_single_question(text, question_no):
    value = normalize_text(text)
    start = re.search(rf"(^|\s){question_no}\s+", value)
    if start:
        value = value[start.end():].strip()
    if question_no < 40:
        end = re.search(rf"(^|\s){question_no + 1}\s+", value)
        if end:
            value = value[:end.start()].strip()
    return value


def split_stem_and_options(text):
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


def extract_mark_scheme(mark_scheme_path):
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
            raise ValueError(f"Conflicting answers for question {question_no}")
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
        raise ValueError(f"Questions have answers and discounted status: {sorted(overlap)}")
    missing = [number for number in EXPECTED_QUESTIONS if number not in answers and number not in discounted]
    if missing:
        raise ValueError(f"Missing mark scheme entries: {missing}")
    return answers, discounted


def cut_questions(qp_path, paper_slug, answers, discounted, output_root, public_root):
    image_dir = output_root / "papers" / paper_slug
    image_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    with fitz.open(qp_path) as doc:
        anchors = collect_question_anchors(doc)
        found = {anchor[0] for anchor in anchors}
        missing = [number for number in EXPECTED_QUESTIONS if number not in found]
        if len(anchors) != 40 or missing:
            raise ValueError(f"Expected 40 question anchors; found {len(anchors)}, missing {missing}")
        locations = [(anchor[1], anchor[2]) for anchor in anchors]
        if locations != sorted(locations):
            raise ValueError("Question anchors are not in document order")
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
            if image_path.stat().st_size < 100:
                raise ValueError(f"Question {question_no} produced an empty image")
            letter = answers.get(question_no)
            rows.append({
                "questionNo": question_no,
                "pageIndex": page_index,
                "imageUrl": f"{public_root}/{paper_slug}/{image_name}",
                "rawText": raw_text,
                "parseStatus": "ok" if parsed else "image_only",
                "stem": parsed["stem"] if parsed else "",
                "options": parsed["options"] if parsed else {},
                "answer": LETTER_TO_INDEX[letter] if letter else None,
                "answerLetter": letter,
                "answerStatus": "discounted" if question_no in discounted else "valid",
            })
    return rows


def issue(code, message, paper_slug=None, details=None):
    return {
        "severity": "error",
        "code": code,
        "message": message,
        "paperSlug": paper_slug,
        "details": details or {},
    }


def main():
    parser = argparse.ArgumentParser(description="Validate and cut CIE Paper 2 MCQ PDFs")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--subject-code", required=True)
    parser.add_argument("--asset-key", required=True)
    args = parser.parse_args()
    input_root = Path(args.input).resolve()
    output_root = Path(args.output).resolve()
    subject_code = args.subject_code
    if not re.fullmatch(r"\d{4}", subject_code):
        raise ValueError("Subject code must contain four digits")
    output_root.mkdir(parents=True, exist_ok=True)
    public_root = f"/assets/exam-question-images/cie-igcse-{args.asset_key}"

    papers = {}
    issues = []
    input_files = sorted(input_root.glob("*.pdf"))
    for path in input_files:
        meta = parse_file_name(path, subject_code)
        if not meta:
            issues.append(issue("INVALID_FILE_NAME", f"Unsupported file name: {path.name}"))
            continue
        entry = papers.setdefault(meta["paper_slug"], {"meta": meta})
        if meta["kind"] in entry:
            issues.append(issue("DUPLICATE_DOCUMENT", f"Duplicate {meta['kind']} for {meta['paper_slug']}", meta["paper_slug"]))
            continue
        entry[meta["kind"]] = path

    manifests = []
    for paper_slug, entry in sorted(papers.items()):
        if "qp" not in entry or "ms" not in entry:
            missing = "qp" if "qp" not in entry else "ms"
            issues.append(issue("MISSING_PAIR", f"Missing {missing} for {paper_slug}", paper_slug))
            manifests.append({"slug": paper_slug, "status": "rejected", "issues": ["MISSING_PAIR"]})
            continue
        try:
            answers, discounted = extract_mark_scheme(entry["ms"])
            rows = cut_questions(
                entry["qp"], paper_slug, answers, discounted, output_root, public_root
            )
            meta = entry["meta"]
            data_path = output_root / "data" / f"{paper_slug}.json"
            data_path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "questionPaper": entry["qp"].name,
                "markScheme": entry["ms"].name,
                "questionCount": 40,
                "discountedQuestions": sorted(discounted),
                "rows": rows,
            }
            data_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
            manifests.append({
                "slug": paper_slug,
                "status": "validated",
                "subjectCode": subject_code,
                "year": 2000 + int(meta["year"]),
                "season": meta["season"].lower(),
                "paperNumber": 2,
                "variant": int(meta["variant"]),
                "sourceQuestionCount": 40,
                "validQuestionCount": len(answers),
                "discountedQuestions": sorted(discounted),
                "qpFileName": entry["qp"].name,
                "msFileName": entry["ms"].name,
                "qpSha256": sha256_file(entry["qp"]),
                "msSha256": sha256_file(entry["ms"]),
                "dataFile": str(data_path),
                "paperImageDir": str(output_root / "papers" / paper_slug),
                "dataUrl": f"{public_root}/data/{paper_slug}.json",
                "textParseOk": sum(row["parseStatus"] == "ok" for row in rows),
                "imageOnly": sum(row["parseStatus"] == "image_only" for row in rows),
            })
        except Exception as error:
            issues.append(issue("PAPER_VALIDATION_FAILED", str(error), paper_slug))
            manifests.append({"slug": paper_slug, "status": "rejected", "issues": ["PAPER_VALIDATION_FAILED"]})

    validated = [paper for paper in manifests if paper["status"] == "validated"]
    manifest = {
        "version": 1,
        "subjectCode": subject_code,
        "assetKey": args.asset_key,
        "publicRoot": public_root,
        "inputFileCount": len(input_files),
        "paperCount": len(manifests),
        "validatedPaperCount": len(validated),
        "rejectedPaperCount": len(manifests) - len(validated),
        "validQuestionCount": sum(paper["validQuestionCount"] for paper in validated),
        "discountedQuestionCount": sum(len(paper["discountedQuestions"]) for paper in validated),
        "papers": manifests,
        "issues": issues,
    }
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), **{key: manifest[key] for key in (
        "paperCount", "validatedPaperCount", "rejectedPaperCount", "validQuestionCount"
    )}}))
    if not validated:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
