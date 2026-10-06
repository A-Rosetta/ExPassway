# ExPassway

ExPassway is a Cloudflare Worker application for international high school practice and
past-paper learning. Production runs at `https://expassway.com` with Cloudflare D1 for
application data and R2 for uploaded and published content.

## Current Subjects

- CIE IGCSE Biology 0610, Paper 2 MCQ: 41 papers / 1640 questions
- CIE IGCSE Chemistry 0620, Paper 2 MCQ: 6 papers / 240 questions
- CIE IGCSE Co-ordinated Sciences 0654, Paper 2 MCQ: 21 papers / 839 valid questions
- CIE IGCSE Economics 0455, Paper 1 MCQ: 1 paper / 30 questions
- CIE IGCSE Physics 0625, Paper 2 MCQ: 36 paper / 1436 questions
- CIE AS&Alevel 9618, Paper 1 MCQ: 12 paper / 80 questions

Question images and static fallback data are stored by subject under
`assets/exam-question-images/`. The homepage, practice pages, notebook, discussions, and
administrator tools use the Worker APIs and D1 catalogue in production.

## Local Development

Use Node.js 22 as specified by `.nvmrc`. Install dependencies from the lockfile on the current
operating system; do not copy `node_modules` between Linux, macOS, and Windows.

```bash
npm ci
npm run cloudflare:build
npx wrangler d1 migrations apply expassway-db --local
npx wrangler dev
```

Wrangler uses the D1 and R2 bindings declared in `wrangler.jsonc`. Use local Wrangler resources
for ordinary development. Add `--remote` only when an operation is intentionally aimed at
production.

The static frontend can also be opened directly for limited UI work, but same-origin `/api/*`
requests require Wrangler. The legacy IDE preview fallback uses `http://localhost:3002` when the
site is served on port 8080 or opened through the file protocol.

## Import CIE MCQ PDFs

1. Sign in at `pages/login.html` with an administrator account.
2. Open the administrator dashboard and register any new four-digit subject code.
3. Upload complete Question Paper / Mark Scheme pairs.
4. Run validation, review the report, and publish only when the job is validated.

Supported official filenames include:

```text
0654_s25_qp_22.pdf
0654_s25_ms_22.pdf
0455_s25_qp_12.pdf
0455_s25_ms_12.pdf
```

The scheduled importer is defined in `.github/workflows/cloudflare-pdf-import.yml`. It installs
PyMuPDF, runs `backend/scripts/cie-mcq-import.py`, and publishes validated data through D1 and R2.

## Commands

```bash
npm run check
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm run test:unit
npm run test:chat-browser
npm run cloudflare:build
npm run cloudflare:deploy
npm run cloudflare:import
npm run test:cloudflare-admin-api
npm run test:cloudflare-auth
npm run test:cloudflare-community-api
npm run test:cloudflare-content-api
npm run test:cloudflare-import-runner
npm run test:cloudflare-learning-api
npm run test:cloudflare-read-api
```

`check` runs linting, JavaScript project validation, all smoke tests, and the Cloudflare build.
ESLint caches results under `node_modules/.cache` for faster repeat runs. Prettier is available
separately because the existing source tree has not yet been normalized to a single format.
The JavaScript project configuration supplies Cloudflare Workers types to editors without
requiring an immediate strict TypeScript conversion of the existing JavaScript code.

The chat browser suite uses the real frontend, crypto Worker, D1, R2 and chat APIs.
It mocks the operating-system Passkey ceremony and exercises polling when realtime
is unavailable. Install Chromium with `npx playwright install chromium` if needed;
on Windows the suite also supports an installed Microsoft Edge. Real Passkey PRF
support still needs a manual check in the intended browser and authenticator.

Chat profiles support an editable nickname and a resized PNG, JPEG or WebP avatar.
These are account profile metadata visible to chat participants. Message bodies
and message attachments remain end-to-end encrypted. Historical chats can be
removed from one account's list across its browsers without removing another
participant's history. Realtime delivery falls back to a three-second cursor poll.

## Repository Map

- `index.html`, `pages/`, `scripts/`, `assets/`: static application
- `cloudflare/`: Worker API implementation
- `migrations/`: D1 migrations
- `tools/build-cloudflare-assets.mjs`: prepares deployable static assets
- `tools/run-cloudflare-import.mjs`: D1/R2 import runner
- `backend/scripts/cie-mcq-import.py`: PDF validation and extraction used by GitHub Actions
- `tests/`: Worker and UI smoke tests
- `wrangler.jsonc`: Worker, D1, R2, and static asset bindings

## Deployment

Apply pending D1 migrations before deploying code that requires them. Account-v2
chat requires `0015_chat_conversation_protocol.sql`; it adds the conversation
protocol column and keeps existing conversations as `signal-v1`.
Chat profile avatars and account-specific history removal also require
`0016_chat_profile_history.sql`.

```bash
npx wrangler d1 migrations apply expassway-db --remote
npm run cloudflare:deploy
```

The Worker name is `expassway`. Production resources are `expassway-db`,
`expassway-content`, and `expassway-private-imports`.
