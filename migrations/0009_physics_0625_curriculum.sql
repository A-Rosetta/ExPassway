-- Cambridge IGCSE Physics (0625), syllabus 2023-2025.
UPDATE curriculum_versions SET active = 0
WHERE subject_code = '0625' AND id <> '0625-2023-2025-v1';

INSERT INTO curriculum_versions (id, subject_code, qualification, exam_year_start, exam_year_end, version, active)
VALUES ('0625-2023-2025-v1', '0625', 'IGCSE', 2023, 2025, '2023-2025', 1)
ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO curriculum_sections (id, curriculum_version_id, syllabus_code, title_en, title_zh, level, parent_id, core_level, sort_order) VALUES
  ('0625-s-1', '0625-2023-2025-v1', '1', 'Motion, forces and energy', '运动、力和能量', 'topic', NULL, 'core', 100),
  ('0625-s-1-1', '0625-2023-2025-v1', '1.1', 'Physical quantities and measurement techniques', '物理量和测量技术', 'section', '0625-s-1', 'core', 101),
  ('0625-s-1-2', '0625-2023-2025-v1', '1.2', 'Motion', '运动', 'section', '0625-s-1', 'core', 102),
  ('0625-s-1-3', '0625-2023-2025-v1', '1.3', 'Mass and weight', '质量和重量', 'section', '0625-s-1', 'core', 103),
  ('0625-s-1-4', '0625-2023-2025-v1', '1.4', 'Density', '密度', 'section', '0625-s-1', 'core', 104),
  ('0625-s-1-5-1', '0625-2023-2025-v1', '1.5.1', 'Effects of forces', '力的作用效果', 'statement', '0625-s-1', 'core', 105),
  ('0625-s-1-5-2', '0625-2023-2025-v1', '1.5.2', 'Turning effect of forces', '力的转动效应', 'statement', '0625-s-1', 'core', 106),
  ('0625-s-1-5-3', '0625-2023-2025-v1', '1.5.3', 'Centre of gravity', '重心', 'statement', '0625-s-1', 'core', 107),
  ('0625-s-1-6', '0625-2023-2025-v1', '1.6', 'Momentum', '动量', 'section', '0625-s-1', 'core', 108),
  ('0625-s-1-7-1', '0625-2023-2025-v1', '1.7.1', 'Energy', '能量', 'statement', '0625-s-1', 'core', 109),
  ('0625-s-1-7-2', '0625-2023-2025-v1', '1.7.2', 'Work', '功', 'statement', '0625-s-1', 'core', 110),
  ('0625-s-1-7-3', '0625-2023-2025-v1', '1.7.3', 'Energy resources', '能源', 'statement', '0625-s-1', 'core', 111),
  ('0625-s-1-7-4', '0625-2023-2025-v1', '1.7.4', 'Power', '功率', 'statement', '0625-s-1', 'core', 112),
  ('0625-s-1-8', '0625-2023-2025-v1', '1.8', 'Pressure', '压强', 'section', '0625-s-1', 'core', 113),
  ('0625-s-2', '0625-2023-2025-v1', '2', 'Thermal physics', '热学', 'topic', NULL, 'core', 200),
  ('0625-s-2-1-1', '0625-2023-2025-v1', '2.1.1', 'States of matter', '物态', 'statement', '0625-s-2', 'core', 201),
  ('0625-s-2-1-2', '0625-2023-2025-v1', '2.1.2', 'Particle model', '粒子模型', 'statement', '0625-s-2', 'core', 202),
  ('0625-s-2-2-1', '0625-2023-2025-v1', '2.2.1', 'Thermal expansion', '热膨胀', 'statement', '0625-s-2', 'core', 203),
  ('0625-s-2-2-2', '0625-2023-2025-v1', '2.2.2', 'Specific heat capacity', '比热容', 'statement', '0625-s-2', 'core', 204),
  ('0625-s-2-2-3', '0625-2023-2025-v1', '2.2.3', 'Melting, boiling and evaporation', '熔化、沸腾和蒸发', 'statement', '0625-s-2', 'core', 205),
  ('0625-s-2-3-1', '0625-2023-2025-v1', '2.3.1', 'Conduction', '传导', 'statement', '0625-s-2', 'core', 206),
  ('0625-s-2-3-2', '0625-2023-2025-v1', '2.3.2', 'Convection', '对流', 'statement', '0625-s-2', 'core', 207),
  ('0625-s-2-3-3', '0625-2023-2025-v1', '2.3.3', 'Radiation', '热辐射', 'statement', '0625-s-2', 'core', 208),
  ('0625-s-2-3-4', '0625-2023-2025-v1', '2.3.4', 'Consequences of energy transfer', '能量传递的影响', 'statement', '0625-s-2', 'core', 209),
  ('0625-s-3', '0625-2023-2025-v1', '3', 'Waves', '波', 'topic', NULL, 'core', 300),
  ('0625-s-3-1', '0625-2023-2025-v1', '3.1', 'General properties of waves', '波的基本性质', 'section', '0625-s-3', 'core', 301),
  ('0625-s-3-2-1', '0625-2023-2025-v1', '3.2.1', 'Reflection of light', '光的反射', 'statement', '0625-s-3', 'core', 302),
  ('0625-s-3-2-2', '0625-2023-2025-v1', '3.2.2', 'Refraction of light', '光的折射', 'statement', '0625-s-3', 'core', 303),
  ('0625-s-3-2-3', '0625-2023-2025-v1', '3.2.3', 'Thin lenses', '薄透镜', 'statement', '0625-s-3', 'core', 304),
  ('0625-s-3-2-4', '0625-2023-2025-v1', '3.2.4', 'Dispersion of light', '光的色散', 'statement', '0625-s-3', 'core', 305),
  ('0625-s-3-3', '0625-2023-2025-v1', '3.3', 'Electromagnetic spectrum', '电磁波谱', 'section', '0625-s-3', 'core', 306),
  ('0625-s-3-4', '0625-2023-2025-v1', '3.4', 'Sound', '声音', 'section', '0625-s-3', 'core', 307),
  ('0625-s-4', '0625-2023-2025-v1', '4', 'Electricity and magnetism', '电和磁', 'topic', NULL, 'core', 400),
  ('0625-s-4-1', '0625-2023-2025-v1', '4.1', 'Simple phenomena of magnetism', '磁现象', 'section', '0625-s-4', 'core', 401),
  ('0625-s-4-2', '0625-2023-2025-v1', '4.2', 'Electrical quantities', '电学量', 'section', '0625-s-4', 'core', 402),
  ('0625-s-4-3', '0625-2023-2025-v1', '4.3', 'Electric circuits', '电路', 'section', '0625-s-4', 'core', 403),
  ('0625-s-4-4', '0625-2023-2025-v1', '4.4', 'Digital electronics', '数字电子学', 'section', '0625-s-4', 'core', 404),
  ('0625-s-4-5-1', '0625-2023-2025-v1', '4.5.1', 'Electromagnetic induction', '电磁感应', 'statement', '0625-s-4', 'core', 405),
  ('0625-s-4-5-2', '0625-2023-2025-v1', '4.5.2', 'The a.c. generator', '交流发电机', 'statement', '0625-s-4', 'core', 406),
  ('0625-s-4-5-3', '0625-2023-2025-v1', '4.5.3', 'Magnetic effect of a current', '电流的磁效应', 'statement', '0625-s-4', 'core', 407),
  ('0625-s-4-5-4', '0625-2023-2025-v1', '4.5.4', 'Force on a current-carrying conductor', '通电导体在磁场中受力', 'statement', '0625-s-4', 'core', 408),
  ('0625-s-4-5-5', '0625-2023-2025-v1', '4.5.5', 'The d.c. motor', '直流电动机', 'statement', '0625-s-4', 'core', 409),
  ('0625-s-4-5-6', '0625-2023-2025-v1', '4.5.6', 'The transformer', '变压器', 'statement', '0625-s-4', 'core', 410),
  ('0625-s-5', '0625-2023-2025-v1', '5', 'Nuclear physics', '原子核物理', 'topic', NULL, 'core', 500),
  ('0625-s-5-1-1', '0625-2023-2025-v1', '5.1.1', 'The atom', '原子', 'statement', '0625-s-5', 'core', 501),
  ('0625-s-5-1-2', '0625-2023-2025-v1', '5.1.2', 'The nucleus', '原子核', 'statement', '0625-s-5', 'core', 502),
  ('0625-s-5-2-1', '0625-2023-2025-v1', '5.2.1', 'Detection of radioactivity', '放射性探测', 'statement', '0625-s-5', 'core', 503),
  ('0625-s-5-2-2', '0625-2023-2025-v1', '5.2.2', 'The radioactive emissions', '放射性辐射', 'statement', '0625-s-5', 'core', 504),
  ('0625-s-5-2-3', '0625-2023-2025-v1', '5.2.3', 'Radioactive decay', '放射性衰变', 'statement', '0625-s-5', 'core', 505),
  ('0625-s-5-2-4', '0625-2023-2025-v1', '5.2.4', 'Half-life', '半衰期', 'statement', '0625-s-5', 'core', 506),
  ('0625-s-5-2-5', '0625-2023-2025-v1', '5.2.5', 'Safety precautions', '安全防护', 'statement', '0625-s-5', 'core', 507),
  ('0625-s-6', '0625-2023-2025-v1', '6', 'Space physics', '太空物理', 'topic', NULL, 'core', 600),
  ('0625-s-6-1-1', '0625-2023-2025-v1', '6.1.1', 'The Earth', '地球', 'statement', '0625-s-6', 'core', 601),
  ('0625-s-6-1-2', '0625-2023-2025-v1', '6.1.2', 'The Solar System', '太阳系', 'statement', '0625-s-6', 'core', 602),
  ('0625-s-6-2-1', '0625-2023-2025-v1', '6.2.1', 'The Sun as a star', '作为恒星的太阳', 'statement', '0625-s-6', 'core', 603),
  ('0625-s-6-2-2', '0625-2023-2025-v1', '6.2.2', 'Stars', '恒星', 'statement', '0625-s-6', 'core', 604),
  ('0625-s-6-2-3', '0625-2023-2025-v1', '6.2.3', 'The Universe', '宇宙', 'statement', '0625-s-6', 'core', 605)
ON CONFLICT(id) DO UPDATE SET
  title_en = excluded.title_en, title_zh = excluded.title_zh, level = excluded.level,
  parent_id = excluded.parent_id, core_level = excluded.core_level, sort_order = excluded.sort_order,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO coursebook_chapters (id, book_key, chapter_no, title_en, title_zh, sort_order) VALUES
  ('0625-c-1', 'physics-0625-2023-2025', 1, 'Motion, forces and energy', '运动、力和能量', 1),
  ('0625-c-2', 'physics-0625-2023-2025', 2, 'Thermal physics', '热学', 2),
  ('0625-c-3', 'physics-0625-2023-2025', 3, 'Waves', '波', 3),
  ('0625-c-4', 'physics-0625-2023-2025', 4, 'Electricity and magnetism', '电和磁', 4),
  ('0625-c-5', 'physics-0625-2023-2025', 5, 'Nuclear physics', '原子核物理', 5),
  ('0625-c-6', 'physics-0625-2023-2025', 6, 'Space physics', '太空物理', 6)
ON CONFLICT(id) DO UPDATE SET title_en = excluded.title_en, title_zh = excluded.title_zh, sort_order = excluded.sort_order;

INSERT INTO coursebook_sections (id, coursebook_chapter_id, section_code, title_en, title_zh, sort_order)
SELECT '0625-b-' || replace(syllabus_code, '.', '-'),
  '0625-c-' || substr(syllabus_code, 1, 1), syllabus_code, title_en, title_zh, sort_order
FROM curriculum_sections
WHERE curriculum_version_id = '0625-2023-2025-v1' AND level <> 'topic'
ON CONFLICT(coursebook_chapter_id, section_code) DO UPDATE SET
  title_en = excluded.title_en, title_zh = excluded.title_zh, sort_order = excluded.sort_order;

INSERT OR IGNORE INTO coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
SELECT '0625-b-' || replace(syllabus_code, '.', '-'), id
FROM curriculum_sections
WHERE curriculum_version_id = '0625-2023-2025-v1' AND level <> 'topic';
