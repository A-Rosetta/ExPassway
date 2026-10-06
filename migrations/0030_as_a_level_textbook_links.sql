-- Official, link-only coursebook metadata for the existing 9618 catalogue.
-- The Cambridge International page identifies the title as endorsed and says
-- it supports the full syllabus for examination from 2021. Cambridge's
-- 2027-2029 syllabus says resources endorsed from 2021 remain suitable.
-- No textbook bytes are stored or copied by this migration.

INSERT INTO subject_resources (
  id, subject_code, kind, title, title_zh, version,
  exam_year_start, exam_year_end, paper_slug, storage_key, content_type,
  metadata, status
)
VALUES (
  '9618-endorsed-coursebook-9781108733755',
  '9618',
  'textbook',
  'Computer Science for Cambridge International AS & A Level',
  '计算机科学 9618 官方认可教材',
  'Second Edition (2019); endorsed for examination from 2021',
  2027,
  2029,
  NULL,
  'external-links/9618/endorsed-coursebook-9781108733755.json',
  'application/json',
  '{
    "resourceType": "endorsed_coursebook_links",
    "linkOnly": true,
    "authors": ["Sylvia Langfield", "Dave Duddell"],
    "edition": "Second Edition",
    "publishedYear": 2019,
    "isbn": "9781108733755",
    "digitalIsbn": "9781108700412",
    "publisher": "Cambridge University Press",
    "sourceUrl": "https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-computer-science-9618/published-resources/",
    "publisherUrl": "https://www.cambridge.org/9781108733755",
    "syllabusUrl": "https://www.cambridgeinternational.org/Images/721397-2027-2029-syllabus.pdf",
    "syllabusCoverage": {
      "subjectCode": "9618",
      "examYearStart": 2027,
      "examYearEnd": 2029,
      "endorsedForExaminationFrom": 2021,
      "includes2027": true
    },
    "compatibilityNote": "Cambridge lists this coursebook as supporting the full 9618 syllabus for examination from 2021. The current 2027-2029 syllabus states that textbooks endorsed from 2021 remain suitable.",
    "externalLinks": [
      {
        "title": "Cambridge official published resources",
        "titleZh": "Cambridge 官方认可教材目录",
        "url": "https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-computer-science-9618/published-resources/",
        "accessType": "official_endorsement",
        "note": "Cambridge International identifies the title, publisher, 2019 publication year and full-syllabus support from 2021."
      },
      {
        "title": "Publisher purchase information",
        "titleZh": "出版社正版购买入口",
        "url": "https://www.cambridge.org/9781108733755",
        "accessType": "purchase",
        "note": "Cambridge University Press product page; purchase and entitlement are handled externally."
      },
      {
        "title": "Official digital coursebook",
        "titleZh": "官方数字教材",
        "url": "https://www.cambridge.org/9781108700412",
        "accessType": "digital",
        "note": "Digital ISBN 9781108700412; paid Cambridge Elevate access, normally two years."
      }
    ],
    "evidence": [
      {
        "url": "https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-computer-science-9618/published-resources/",
        "type": "official_published_resources",
        "finding": "Computer Science for Cambridge International AS & A Level; Cambridge University Press; published 2019; supports the full syllabus for examination from 2021; ISBN 9781108733755."
      },
      {
        "url": "https://www.cambridgeinternational.org/Images/721397-2027-2029-syllabus.pdf",
        "type": "official_syllabus",
        "finding": "The 2027-2029 syllabus states that textbooks endorsed to support the syllabus for examination from 2021 remain suitable."
      }
    ]
  }',
  'published'
)
ON CONFLICT(id) DO UPDATE SET
  subject_code = excluded.subject_code,
  kind = excluded.kind,
  title = excluded.title,
  title_zh = excluded.title_zh,
  version = excluded.version,
  exam_year_start = excluded.exam_year_start,
  exam_year_end = excluded.exam_year_end,
  paper_slug = excluded.paper_slug,
  storage_key = excluded.storage_key,
  content_type = excluded.content_type,
  metadata = excluded.metadata,
  status = excluded.status,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
