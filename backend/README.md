# Backend Service

Express backend for A-Level Smart Practice.

## Quick Start

```bash
npm install
npm run dev
```

`npm run dev` starts at `http://localhost:3001` by default. The deployed service runs on port `3002` behind Nginx `/api/*`.

## Run As Persistent Service (systemd)

Service name: `alevel-backend-3002.service`

```bash
sudo systemctl status alevel-backend-3002.service
sudo systemctl restart alevel-backend-3002.service
sudo systemctl stop alevel-backend-3002.service
sudo systemctl start alevel-backend-3002.service
sudo systemctl enable alevel-backend-3002.service
sudo journalctl -u alevel-backend-3002.service -f
```

## PostgreSQL Setup

1. Create database (example name: `alevel_smart_practice`).
2. Set `DATABASE_URL` in environment (or copy from `.env.example`).
3. Apply schema:

```bash
npm run db:schema
```

When `DATABASE_URL` is set, backend uses PostgreSQL for paper/session persistence.
If `DATABASE_URL` is not set, backend falls back to in-memory storage.

For an existing database that already contains the legacy Chemistry 0620 or Co-ordinated Sciences
0654 rows, register them in the dynamic catalogue once:

```bash
npm run catalog:migrate
```

The migration is idempotent and only fills missing catalogue data. It does not overwrite papers
that were later published through the administrator importer.

## Generic CIE MCQ Import

Use the import section of `pages/admin.html`; all import endpoints require an authenticated admin.
The workflow is:

```text
uploading -> processing -> validated -> published
                         -> failed
```

- Register unknown four-digit subject codes before creating a job.
- Upload official QP/MS pairs such as `0654_s25_qp_22.pdf` / `0654_s25_ms_22.pdf` or
  `0455_s25_qp_12.pdf` / `0455_s25_ms_12.pdf`.
- Science Paper 2 MCQ and Economics 0455 Paper 1 MCQ are accepted; each PDF must be no larger
  than 12 MB.
- Processing happens under `backend/imports/<job-id>/` and does not change live assets or rows.
- A paper must contain the expected 30 or 40 ordered question anchors and complete A-D Mark
  Scheme entries.
- Official `Question Discounted` entries are allowed and remain absent from active practice.
- Publishing uses a database transaction and temporary asset swap. Re-import keeps IDs by
  `(paper_slug, question_no)` and marks questions no longer valid as inactive.
- Published images and per-paper JSON are stored under
  `../assets/exam-question-images/cie-igcse-<asset-key>/`.

After deploying backend code or schema changes:

```bash
npm run db:schema
sudo systemctl restart alevel-backend-3002.service
```

## Co-ordinated Sciences Import

The processed `0654` Paper 2 data is stored in
`../assets/exam-question-images/cie-igcse-coordinated-sciences-0654/`. Import or refresh its
839 valid questions without replacing existing Chemistry rows:

```bash
npm run import:coordinated-sciences
```

The command uses an idempotent upsert. It excludes the official discounted question 17 from
`0654_s23_qp_22` and rejects an unexpected source question count.

## API Overview

1. `GET /health`: health check
2. `GET /api/meta/curriculum`: curriculum tree
3. `GET /api/meta/stats`: question bank statistics
4. `GET /api/meta/storage`: current persistence mode
5. `POST /api/papers/generate`: generate a paper and return `paperId`
6. `POST /api/papers/submit`: submit answers by `paperId`
7. `POST /api/analysis`: build analysis from wrong-log payload
8. `GET /api/users`: list users (DB mode)
9. `POST /api/users`: create user (DB mode)
10. `GET /api/users/:userId`: get user by id (DB mode)
11. `GET /api/users/:userId/practices`: list user practice records (DB mode)
12. `GET /api/admin/records`: dashboard-like latest users and practices (DB mode)
13. `GET /api/catalog/subjects`: published subjects
14. `GET /api/catalog/subjects/:subjectCode/papers`: published MCQ catalogue
15. `GET /api/catalog/papers/:paperSlug/questions`: active questions in original number order
16. `GET/POST /api/admin/subjects`: administrator subject registry
17. `GET/POST /api/admin/imports` and `POST /api/admin/imports/:jobId/{files,process,publish}`

## Notes

1. In-memory records expire automatically (default: 6 hours).
2. In DB mode, generated papers and submitted results are persisted in `practice_sessions`.

## Minimal DB Flow Example

1. Create user:

```bash
curl -X POST http://localhost:3001/api/users \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alice","email":"alice@example.com","role":"student","grade":"AS","targetScore":85}'
```

2. Generate paper (use user id):

```bash
curl -X POST http://localhost:3001/api/papers/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"<USER_ID>",
    "selection":{"grade":"AS","board":"CIE","subject":"Mathematics","paper":"P1"},
    "options":{"count":5,"difficulty":"中等","topics":["Functions","Trigonometry"]}
  }'
```

3. Submit answers:

```bash
curl -X POST http://localhost:3001/api/papers/submit \
  -H "Content-Type: application/json" \
  -d '{"paperId":"<PAPER_ID>","answers":[0,1,2,0,3]}'
```

4. List this user's records:

```bash
curl http://localhost:3001/api/users/<USER_ID>/practices
```

5. View recent access data (admin-friendly):

```bash
curl "http://localhost:3001/api/admin/records?usersLimit=10&practicesLimit=20"
```
