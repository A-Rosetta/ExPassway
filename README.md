# A-Level Smart Practice (Frontend + Backend)

A lightweight full-stack scaffold for international high school students studying A-Level.

## Features

1. Grade pathway selection: `G1`, `G2`, `AS`, `A2`
2. Exam board + subject + paper/module filtering (example preset includes `CIE Mathematics P1/P2/P3/P4`)
3. Mock exam generation with controls:
   - Number of questions
   - Difficulty level
   - Knowledge points
4. Wrong-question analysis page:
   - Error distribution by knowledge point
   - Weakness diagnosis
   - Actionable study suggestions
5. Mini-program prompting templates included

## Current Past-Paper Subjects

- `CIE IGCSE Biology 0610`, Paper 2 MCQ: 41 papers / 1640 questions
- `CIE IGCSE Chemistry 0620`, Paper 2 MCQ: 6 papers / 240 questions
- `CIE IGCSE Co-ordinated Sciences 0654`, Paper 2 MCQ: 21 papers / 839 valid questions
- `CIE IGCSE Economics 0455`, Paper 1 MCQ: 1 paper / 30 questions

Question images are stored by subject under `assets/exam-question-images/`. The official
discounted question 17 in `0654_s23_qp_22` is retained in the source audit data but is not
offered for practice or scoring.

The homepage, paper picker, practice page, and discussion filters now read their subject and
paper lists from PostgreSQL. New published subjects therefore appear without editing frontend
catalogue arrays.

## Import More CIE MCQ PDFs

1. Sign in through the normal login page with an administrator account, then open the admin
   dashboard.
2. If the four-digit subject code is new, register its English name, Chinese name, and lowercase
   asset key first.
3. Select the subject and upload one or more complete Question Paper / Mark Scheme pairs.
4. Run validation and review the report. Publish only after the job status is `validated`.

Accepted official filenames use this exact pattern:

```text
0654_s25_qp_22.pdf
0654_s25_ms_22.pdf
0455_s25_qp_12.pdf
0455_s25_ms_12.pdf
```

The importer supports CIE IGCSE science Paper 2 MCQ with 40 questions and Economics 0455
Paper 1 MCQ with 30 questions. Each PDF is limited to 12 MB. It requires ordered question
anchors and a Mark Scheme entry for every question; official `Question
Discounted` entries are excluded, while a missing or conflicting answer rejects that paper.
Re-importing the same paper reuses existing question IDs, so practice history, stars, wrong-answer
records, and discussions remain linked.

## Run Frontend

Open `index.html` directly in browser, or use a static server.
Frontend now prefers backend APIs (`/api/*`) and falls back to local mock data if backend is unavailable.

## Run Backend

```bash
cd backend
npm install
npm run dev
```

Default backend URL: `http://localhost:3001`

## PostgreSQL (Optional but Recommended)

```bash
cd backend
cp .env.example .env
# edit DATABASE_URL in .env
npm run db:schema
npm run catalog:migrate
npm run dev
```

If `DATABASE_URL` is configured, generated papers and submitted practice records are persisted in PostgreSQL.

## Frontend API Base URL

Default API base is:
1. Same-origin `/api/*` when served from the deployed site
2. `http://localhost:3002` for the IDE static preview on port `8080` or when opened via the file protocol

You can override it from browser console:

```js
localStorage.setItem("alevel.apiBase", "http://your-server-ip:3002");
location.reload();
```

## Backend API

1. `GET /health`
2. `GET /api/meta/curriculum`
3. `GET /api/meta/stats`
4. `GET /api/meta/storage`
5. `POST /api/papers/generate`
6. `POST /api/papers/submit`
7. `POST /api/analysis`
8. `GET /api/users`
9. `POST /api/users`
10. `GET /api/users/:userId`
11. `GET /api/users/:userId/practices`
12. `GET /api/admin/records`
13. `GET /api/catalog/subjects`
14. `GET /api/catalog/subjects/:subjectCode/papers`
15. `GET /api/catalog/papers/:paperSlug/questions`
16. `POST /api/admin/imports` and `/api/admin/imports/:jobId/*` (administrator only)

### Example: Generate Paper

```bash
curl -X POST http://localhost:3001/api/papers/generate \
  -H "Content-Type: application/json" \
  -d '{
    "selection": {
      "grade": "AS",
      "board": "CIE",
      "subject": "Mathematics",
      "paper": "P1"
    },
    "userId": "optional-user-id",
    "options": {
      "count": 5,
      "difficulty": "中等",
      "topics": ["Trigonometry", "Functions"]
    }
  }'
```

### Example: Submit Answers

```bash
curl -X POST http://localhost:3001/api/papers/submit \
  -H "Content-Type: application/json" \
  -d '{
    "paperId": "REPLACE_WITH_PAPER_ID",
    "answers": [0, 1, 0, 2, 3]
  }'
```

## File Map

- `index.html`: Home/selection page
- `pages/generate.html`: Mock paper generation page
- `pages/analysis.html`: Wrong-question analysis page
- `pages/admin.html`: Admin data dashboard page
- `scripts/data.js`: Curriculum and question bank seed data
- `scripts/api.js`: Frontend API client
- `scripts/app.js`: Shared logic
- `scripts/generate.js`: Generator logic
- `scripts/analysis.js`: Analysis logic
- `scripts/admin.js`: Admin dashboard logic
- `PROMPTS.md`: Prompt templates for generating a mini-program
- `backend/`: Express API service

## Next Step Suggestions

- Replace local question bank with backend API and database.
- Add login/role support for student/teacher/parent.
- Persist wrong-question history across sessions.
- Add bilingual content (EN/ZH) and adaptive recommendation engine.
