-- Manually checked pilot mappings. Keep this list explicit and reviewable.
-- All other generated mappings remain private in suggested status.

insert into question_section_mappings (
  question_id, curriculum_section_id, coursebook_section_id,
  is_primary, confidence, status, reviewed_by, reviewed_at,
  source, similar_question_group, updated_at
)
select
  reviewed.question_id,
  reviewed.curriculum_section_id,
  reviewed.coursebook_section_id,
  true,
  1.0,
  'reviewed',
  (select id from users where role = 'admin' order by created_at limit 1),
  now(),
  'manual',
  left(md5(lower(regexp_replace(question.stem, '\s+', ' ', 'g'))), 20),
  now()
from (values
  ('CIE-IGCSE-0610-0610_s23_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s23_qp_23-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w23_qp_22-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w23_qp_23-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_m22_qp_22-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s22_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_m21_qp_22-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s21_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w21_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w21_qp_23-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_m20_qp_22-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s20_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w20_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w20_qp_23-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s19_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s19_qp_22-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_s19_qp_23-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w19_qp_21-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w19_qp_22-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w19_qp_23-01', '0610-2026-1.1.1', 'bio-igcse-4e-1.1'),
  ('CIE-IGCSE-0610-0610_w23_qp_22-03', '0610-2026-1.3.7', 'bio-igcse-4e-1.6')
) as reviewed(question_id, curriculum_section_id, coursebook_section_id)
join question_bank question on question.id = reviewed.question_id
on conflict (question_id, curriculum_section_id) do update set
  coursebook_section_id = excluded.coursebook_section_id,
  is_primary = true,
  confidence = excluded.confidence,
  status = 'reviewed',
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  source = excluded.source,
  similar_question_group = excluded.similar_question_group,
  updated_at = now();

update question_section_mappings mapping
set
  status = 'reviewed',
  is_primary = true,
  source = 'manual',
  reviewed_by = (select id from users where role = 'admin' order by created_at limit 1),
  reviewed_at = now(),
  updated_at = now()
where mapping.question_id = any(array[
  -- Chapter 1: classification, kingdoms, animal and plant groups.
  'CIE-IGCSE-0610-0610_m23_qp_22-01',
  'CIE-IGCSE-0610-0610_s23_qp_21-02',
  'CIE-IGCSE-0610-0610_w23_qp_21-02',
  'CIE-IGCSE-0610-0610_w23_qp_22-02',
  'CIE-IGCSE-0610-0610_w23_qp_23-02',
  'CIE-IGCSE-0610-0610_m22_qp_22-02',
  'CIE-IGCSE-0610-0610_m23_qp_22-02',
  'CIE-IGCSE-0610-0610_m21_qp_22-03',
  'CIE-IGCSE-0610-0610_m20_qp_22-03',
  'CIE-IGCSE-0610-0610_w19_qp_21-03',
  'CIE-IGCSE-0610-0610_s22_qp_21-02',
  'CIE-IGCSE-0610-0610_w20_qp_21-02',

  -- Chapter 2: cell structure, specialised cells and magnification.
  'CIE-IGCSE-0610-0610_s23_qp_22-03',
  'CIE-IGCSE-0610-0610_w23_qp_21-03',
  'CIE-IGCSE-0610-0610_w23_qp_22-04',
  'CIE-IGCSE-0610-0610_s21_qp_21-04',
  'CIE-IGCSE-0610-0610_s20_qp_21-03',
  'CIE-IGCSE-0610-0610_w19_qp_21-04',
  'CIE-IGCSE-0610-0610_s23_qp_21-39',
  'CIE-IGCSE-0610-0610_m21_qp_22-38',
  'CIE-IGCSE-0610-0610_s19_qp_21-38',
  'CIE-IGCSE-0610-0610_s23_qp_21-03',
  'CIE-IGCSE-0610-0610_w22_qp_21-03',
  'CIE-IGCSE-0610-0610_w22_qp_22-04',
  'CIE-IGCSE-0610-0610_m21_qp_22-05',
  'CIE-IGCSE-0610-0610_w21_qp_23-16',
  'CIE-IGCSE-0610-0610_m20_qp_22-06',
  'CIE-IGCSE-0610-0610_m20_qp_22-30',
  'CIE-IGCSE-0610-0610_s20_qp_21-29',
  'CIE-IGCSE-0610-0610_s22_qp_22-04',
  'CIE-IGCSE-0610-0610_w22_qp_23-04',
  'CIE-IGCSE-0610-0610_s21_qp_23-26',
  'CIE-IGCSE-0610-0610_s19_qp_21-05',
  'CIE-IGCSE-0610-0610_m23_qp_22-04',
  'CIE-IGCSE-0610-0610_s23_qp_21-04',
  'CIE-IGCSE-0610-0610_s23_qp_22-04',
  'CIE-IGCSE-0610-0610_w23_qp_21-05',
  'CIE-IGCSE-0610-0610_w23_qp_22-05',
  'CIE-IGCSE-0610-0610_w23_qp_23-05',
  'CIE-IGCSE-0610-0610_m22_qp_22-03',
  'CIE-IGCSE-0610-0610_s20_qp_23-04',
  'CIE-IGCSE-0610-0610_w19_qp_21-05',

  -- Chapter 3: diffusion, osmosis and active transport.
  'CIE-IGCSE-0610-0610_s22_qp_21-05',
  'CIE-IGCSE-0610-0610_w21_qp_21-07',
  'CIE-IGCSE-0610-0610_w21_qp_22-06',
  'CIE-IGCSE-0610-0610_w19_qp_21-15',
  'CIE-IGCSE-0610-0610_m23_qp_22-05',
  'CIE-IGCSE-0610-0610_s23_qp_22-05',
  'CIE-IGCSE-0610-0610_s23_qp_23-05',
  'CIE-IGCSE-0610-0610_w23_qp_22-06',
  'CIE-IGCSE-0610-0610_m20_qp_22-07',
  'CIE-IGCSE-0610-0610_w20_qp_21-05',
  'CIE-IGCSE-0610-0610_w20_qp_21-06',
  'CIE-IGCSE-0610-0610_s19_qp_22-07',
  'CIE-IGCSE-0610-0610_m22_qp_22-06',
  'CIE-IGCSE-0610-0610_s20_qp_21-06',
  'CIE-IGCSE-0610-0610_w22_qp_21-06',
  'CIE-IGCSE-0610-0610_w21_qp_21-06',
  'CIE-IGCSE-0610-0610_w23_qp_22-07',
  'CIE-IGCSE-0610-0610_w23_qp_23-07',
  'CIE-IGCSE-0610-0610_m21_qp_22-08',
  'CIE-IGCSE-0610-0610_m20_qp_22-08',
  'CIE-IGCSE-0610-0610_s19_qp_23-07'
]::text[])
and mapping.status = 'suggested';

update question_section_mappings suggestion
set
  status = 'rejected',
  is_primary = false,
  reviewed_by = primary_mapping.reviewed_by,
  reviewed_at = now(),
  updated_at = now()
from question_section_mappings primary_mapping
where primary_mapping.question_id = suggestion.question_id
  and primary_mapping.status = 'reviewed'
  and primary_mapping.is_primary = true
  and suggestion.status = 'suggested'
  and suggestion.curriculum_section_id <> primary_mapping.curriculum_section_id;
