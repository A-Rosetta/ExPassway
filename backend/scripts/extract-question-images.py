#!/usr/bin/env python3
import json
import re
from pathlib import Path

import fitz

PDF_PATH = Path('/home/ubuntu/chemis/0620_s23_qp_21.pdf')
OUT_DIR = Path('/home/ubuntu/alevel-smart-practice/assets/question-images/0620_s23_qp_21')
MAP_PATH = Path('/home/ubuntu/alevel-smart-practice/backend/scripts/image-map.auto.json')

OUT_DIR.mkdir(parents=True, exist_ok=True)

doc = fitz.open(PDF_PATH)
anchors = []

for page_idx, page in enumerate(doc):
    # Prefer word-level anchors: isolated question number near the left margin.
    words = page.get_text("words")
    for w in words:
        x0, y0, x1, y1, token = w[:5]
        token = token.strip()
        if not token.isdigit():
            continue
        q_no = int(token)
        if not (1 <= q_no <= 40):
            continue
        if x0 > 90:  # question index is usually at the left side
            continue
        if (y1 - y0) < 6:
            continue
        anchors.append((q_no, page_idx, y0))

seen = {}
for q_no, p, y in sorted(anchors, key=lambda x: (x[0], x[1], x[2])):
    if q_no not in seen:
        seen[q_no] = (p, y)

ordered = [(q, *seen[q]) for q in sorted(seen.keys())]
image_map = {}

for idx, (q_no, page_idx, y_top) in enumerate(ordered):
    page = doc[page_idx]
    page_h = page.rect.height

    if idx + 1 < len(ordered) and ordered[idx + 1][1] == page_idx:
        y_bottom = ordered[idx + 1][2] - 10
    else:
        y_bottom = page_h - 28

    y1 = max(0, y_top - 10)
    y2 = min(page_h, max(y_bottom, y1 + 120))

    clip = fitz.Rect(24, y1, page.rect.width - 24, y2)
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)

    name = f'q{q_no:02d}_full.png'
    dest = OUT_DIR / name
    pix.save(dest)

    image_map[str(q_no)] = [f'/assets/question-images/0620_s23_qp_21/{name}']

MAP_PATH.write_text(json.dumps(image_map, indent=2, ensure_ascii=False), encoding='utf-8')

print(f'anchors={len(ordered)}')
print(f'images={len(image_map)}')
print(f'map={MAP_PATH}')
