#!/usr/bin/env python3
import json
import re
from pathlib import Path

import fitz

PDF_DIR = Path("/home/ubuntu/chemis/pdf")
DATA_DIR = Path("/home/ubuntu/alevel-smart-practice/backend/src/data/pymupdf-batch")
IMAGE_ROOT = Path("/home/ubuntu/alevel-smart-practice/assets/exam-question-images/cie-igcse-chemistry-0620")
REPORT_PATH = DATA_DIR / "report.json"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def slugify_pdf_name(pdf_path: Path) -> str:
    return pdf_path.stem.replace(" ", "_").replace("(", "").replace(")", "")


def collect_question_anchors(doc):
    anchors = []
    for page_index, page in enumerate(doc):
        page_text = normalize_text(page.get_text("text"))
        if "Paper 2 Multiple Choice" in page_text and "INSTRUCTIONS" in page_text:
            continue
        words = page.get_text("words")
        for word in words:
            x0, y0, x1, y1, token = word[:5]
            token = str(token).strip()
            if not token.isdigit():
                continue
            q_no = int(token)
            if q_no < 1 or q_no > 40:
                continue
            if x0 > 90:
                continue
            if (y1 - y0) < 6:
                continue
            anchors.append((q_no, page_index, float(y0), float(y1), float(x0), float(x1)))

    first_seen = {}
    for row in sorted(anchors, key=lambda item: (item[0], item[1], item[2])):
        if row[0] not in first_seen:
            first_seen[row[0]] = row
    return [first_seen[q_no] for q_no in sorted(first_seen.keys())]


def trim_to_single_question(text: str, q_no: int) -> str:
    s = normalize_text(text)
    start_pattern = re.compile(rf"(^|\s){q_no}\s+")
    start_match = start_pattern.search(s)
    if start_match:
        s = s[start_match.end():].strip()
    if q_no < 40:
        next_pattern = re.compile(rf"(^|\s){q_no + 1}\s+")
        next_match = next_pattern.search(s)
        if next_match:
            s = s[:next_match.start()].strip()
    return s


def split_stem_and_options(text: str):
    compact = normalize_text(text)
    markers = {
        "A": compact.find(" A "),
        "B": compact.find(" B "),
        "C": compact.find(" C "),
        "D": compact.find(" D "),
    }
    if any(v < 0 for v in markers.values()):
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
    if not stem or any(not value for value in options.values()):
        return None
    return {"stem": stem, "options": options}


def cut_question_regions(doc, anchors, pdf_slug: str):
    rows = []
    image_dir = IMAGE_ROOT / pdf_slug
    image_dir.mkdir(parents=True, exist_ok=True)

    for idx, anchor in enumerate(anchors):
        q_no, page_index, y0, y1, _x0, _x1 = anchor
        page = doc[page_index]
        page_height = float(page.rect.height)

        if idx + 1 < len(anchors) and anchors[idx + 1][1] == page_index:
            next_y = anchors[idx + 1][2]
            bottom = max(y1 + 30, next_y - 8)
        else:
            bottom = page_height - 24

        top = max(0, y0 - 6)
        rect = fitz.Rect(20, top, page.rect.width - 20, bottom)
        text = trim_to_single_question(page.get_text("text", clip=rect), q_no)

        image_name = f"q{q_no:02d}.png"
        image_path = image_dir / image_name
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=rect, alpha=False)
        pix.save(image_path)

        rows.append(
            {
                "questionNo": q_no,
                "pageIndex": page_index,
                "top": round(top, 2),
                "bottom": round(bottom, 2),
                "text": text,
                "textLength": len(text),
                "imageUrl": f"/assets/exam-question-images/cie-igcse-chemistry-0620/{pdf_slug}/{image_name}",
            }
        )
    return rows


def build_structured_rows(rows):
    structured = []
    for row in rows:
        parsed = split_stem_and_options(row["text"])
        structured.append(
            {
                "questionNo": row["questionNo"],
                "pageIndex": row["pageIndex"],
                "imageUrl": row["imageUrl"],
                "rawText": row["text"],
                "parseStatus": "ok" if parsed else "needs_review",
                "stem": parsed["stem"] if parsed else "",
                "options": parsed["options"] if parsed else {},
            }
        )
    return structured


def process_pdf(pdf_path: Path):
    pdf_slug = slugify_pdf_name(pdf_path)
    cut_out = DATA_DIR / f"{pdf_slug}.cut.json"
    structured_out = DATA_DIR / f"{pdf_slug}.structured.json"

    doc = fitz.open(pdf_path)
    anchors = collect_question_anchors(doc)
    rows = cut_question_regions(doc, anchors, pdf_slug)
    structured = build_structured_rows(rows)

    cut_out.write_text(
        json.dumps({"pdf": str(pdf_path), "anchorCount": len(anchors), "rows": rows}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    structured_out.write_text(
        json.dumps({"pdf": str(pdf_path), "anchorCount": len(anchors), "rows": structured}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ok_count = sum(1 for row in structured if row["parseStatus"] == "ok")
    return {
        "pdf": pdf_path.name,
        "slug": pdf_slug,
        "anchorCount": len(anchors),
        "rowCount": len(rows),
        "structuredOk": ok_count,
        "structuredNeedsReview": len(structured) - ok_count,
        "cutOutput": str(cut_out),
        "structuredOutput": str(structured_out),
    }


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    pdf_files = sorted(PDF_DIR.glob("*.pdf"))
    report_rows = []
    for pdf_path in pdf_files:
        report_rows.append(process_pdf(pdf_path))

    REPORT_PATH.write_text(json.dumps({"pdfDir": str(PDF_DIR), "files": report_rows}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"processed={len(report_rows)}")
    print(f"report={REPORT_PATH}")
    for row in report_rows:
        print(f"{row['pdf']}: anchors={row['anchorCount']} rows={row['rowCount']} ok={row['structuredOk']} review={row['structuredNeedsReview']}")


if __name__ == "__main__":
    main()
