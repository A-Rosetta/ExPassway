## Question Image Caching

Use different cache rules for versioned question images and mutable paper data.

- Path: `/assets/exam-question-images/cie-igcse-chemistry-0620/**`
  - Requirement: file names or query params must change when the image content changes
  - Response header: `Cache-Control: public, max-age=31536000, immutable`
  - Purpose: long-lived browser and CDN caching for stable image assets

- Path: `/backend/src/data/pymupdf-batch/*.structured.json`
- Path: `/backend/src/data/pymupdf-batch/answer-keys.json`
  - Do not use the same immutable cache rule as images
  - Recommended response header: `Cache-Control: public, max-age=60, stale-while-revalidate=300`
  - If deployment cannot support `stale-while-revalidate`, use short TTL or ETag/Last-Modified

- Rule: image assets and structured JSON must be versioned independently
  - Updating question text or answers must not require invalidating all cached images
  - Recutting images must change image URLs so old immutable responses are safe
