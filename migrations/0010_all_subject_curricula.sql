-- Cambridge IGCSE chapter catalogues for the subjects currently published in ExPassway.

INSERT INTO exam_subjects (code, board, qualification, name, name_zh, asset_key, active) VALUES
  ('0620', 'CIE', 'IGCSE', 'Chemistry', '化学', 'chemistry-0620', 1),
  ('0654', 'CIE', 'IGCSE', 'Co-ordinated Sciences', '协调科学', 'coordinated-sciences-0654', 1),
  ('0455', 'CIE', 'IGCSE', 'Economics', '经济', 'economics-0455', 1)
ON CONFLICT(code) DO UPDATE SET
  board = excluded.board, qualification = excluded.qualification,
  name = excluded.name, name_zh = excluded.name_zh, asset_key = excluded.asset_key,
  active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

UPDATE curriculum_versions SET active = 0 WHERE subject_code IN ('0620', '0654', '0455');

INSERT INTO curriculum_versions (id, subject_code, qualification, exam_year_start, exam_year_end, version, active) VALUES
  ('0620-2023-2025-v1', '0620', 'IGCSE', 2023, 2025, '2023-2025', 1),
  ('0654-2023-2024-v1', '0654', 'IGCSE', 2023, 2024, '2023-2024', 1),
  ('0455-2023-2025-v1', '0455', 'IGCSE', 2023, 2025, '2023-2025', 1)
ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO curriculum_sections (id, curriculum_version_id, syllabus_code, title_en, title_zh, level, parent_id, core_level, sort_order) VALUES
  ('0620-s-1', '0620-2023-2025-v1', '1', 'States of matter', '物质状态', 'topic', NULL, 'core', 101),
  ('0620-s-2', '0620-2023-2025-v1', '2', 'Atoms, elements and compounds', '原子、元素和化合物', 'topic', NULL, 'core', 102),
  ('0620-s-3', '0620-2023-2025-v1', '3', 'Stoichiometry', '化学计量', 'topic', NULL, 'core', 103),
  ('0620-s-4', '0620-2023-2025-v1', '4', 'Electrochemistry', '电化学', 'topic', NULL, 'core', 104),
  ('0620-s-5', '0620-2023-2025-v1', '5', 'Chemical energetics', '化学能量学', 'topic', NULL, 'core', 105),
  ('0620-s-6', '0620-2023-2025-v1', '6', 'Chemical reactions', '化学反应', 'topic', NULL, 'core', 106),
  ('0620-s-7', '0620-2023-2025-v1', '7', 'Acids, bases and salts', '酸、碱和盐', 'topic', NULL, 'core', 107),
  ('0620-s-8', '0620-2023-2025-v1', '8', 'The Periodic Table', '元素周期表', 'topic', NULL, 'core', 108),
  ('0620-s-9', '0620-2023-2025-v1', '9', 'Metals', '金属', 'topic', NULL, 'core', 109),
  ('0620-s-10', '0620-2023-2025-v1', '10', 'Chemistry of the environment', '环境化学', 'topic', NULL, 'core', 110),
  ('0620-s-11', '0620-2023-2025-v1', '11', 'Organic chemistry', '有机化学', 'topic', NULL, 'core', 111),
  ('0620-s-12', '0620-2023-2025-v1', '12', 'Experimental techniques and chemical analysis', '实验技术和化学分析', 'topic', NULL, 'core', 112),
  ('0654-s-b1', '0654-2023-2024-v1', 'B1', 'Characteristics of living organisms', '生物体的特征', 'section', NULL, 'core', 101),
  ('0654-s-b2', '0654-2023-2024-v1', 'B2', 'Cells', '细胞', 'section', NULL, 'core', 102),
  ('0654-s-b3', '0654-2023-2024-v1', 'B3', 'Movement into and out of cells', '物质进出细胞', 'section', NULL, 'core', 103),
  ('0654-s-b4', '0654-2023-2024-v1', 'B4', 'Biological molecules', '生物分子', 'section', NULL, 'core', 104),
  ('0654-s-b5', '0654-2023-2024-v1', 'B5', 'Enzymes', '酶', 'section', NULL, 'core', 105),
  ('0654-s-b6', '0654-2023-2024-v1', 'B6', 'Plant nutrition', '植物营养', 'section', NULL, 'core', 106),
  ('0654-s-b7', '0654-2023-2024-v1', 'B7', 'Human nutrition', '人体营养', 'section', NULL, 'core', 107),
  ('0654-s-b8', '0654-2023-2024-v1', 'B8', 'Transport in plants', '植物运输', 'section', NULL, 'core', 108),
  ('0654-s-b9', '0654-2023-2024-v1', 'B9', 'Transport in animals', '动物运输', 'section', NULL, 'core', 109),
  ('0654-s-b10', '0654-2023-2024-v1', 'B10', 'Diseases and immunity', '疾病和免疫', 'section', NULL, 'core', 110),
  ('0654-s-b11', '0654-2023-2024-v1', 'B11', 'Gas exchange in humans', '人体气体交换', 'section', NULL, 'core', 111),
  ('0654-s-b12', '0654-2023-2024-v1', 'B12', 'Coordination and response', '协调和反应', 'section', NULL, 'core', 112),
  ('0654-s-b13', '0654-2023-2024-v1', 'B13', 'Reproduction', '生殖', 'section', NULL, 'core', 113),
  ('0654-s-c1', '0654-2023-2024-v1', 'C1', 'The particulate nature of matter', '物质的微粒本质', 'section', NULL, 'core', 201),
  ('0654-s-c2', '0654-2023-2024-v1', 'C2', 'Experimental techniques', '实验技术', 'section', NULL, 'core', 202),
  ('0654-s-c3', '0654-2023-2024-v1', 'C3', 'Atoms, elements and compounds', '原子、元素和化合物', 'section', NULL, 'core', 203),
  ('0654-s-c4', '0654-2023-2024-v1', 'C4', 'Stoichiometry', '化学计量', 'section', NULL, 'core', 204),
  ('0654-s-c5', '0654-2023-2024-v1', 'C5', 'Electricity and chemistry', '电与化学', 'section', NULL, 'core', 205),
  ('0654-s-c6', '0654-2023-2024-v1', 'C6', 'Chemical energetics', '化学能量学', 'section', NULL, 'core', 206),
  ('0654-s-c7', '0654-2023-2024-v1', 'C7', 'Chemical reactions', '化学反应', 'section', NULL, 'core', 207),
  ('0654-s-c8', '0654-2023-2024-v1', 'C8', 'Acids, bases and salts', '酸、碱和盐', 'section', NULL, 'core', 208),
  ('0654-s-c9', '0654-2023-2024-v1', 'C9', 'The Periodic Table', '元素周期表', 'section', NULL, 'core', 209),
  ('0654-s-c10', '0654-2023-2024-v1', 'C10', 'Metals', '金属', 'section', NULL, 'core', 210),
  ('0654-s-c11', '0654-2023-2024-v1', 'C11', 'Air and water', '空气和水', 'section', NULL, 'core', 211),
  ('0654-s-c12', '0654-2023-2024-v1', 'C12', 'Sulfur', '硫', 'section', NULL, 'core', 212),
  ('0654-s-c13', '0654-2023-2024-v1', 'C13', 'Carbonates', '碳酸盐', 'section', NULL, 'core', 213),
  ('0654-s-c14', '0654-2023-2024-v1', 'C14', 'Organic chemistry', '有机化学', 'section', NULL, 'core', 214),
  ('0654-s-p1', '0654-2023-2024-v1', 'P1', 'Motion', '运动', 'section', NULL, 'core', 301),
  ('0654-s-p2', '0654-2023-2024-v1', 'P2', 'Work, energy and power', '功、能量和功率', 'section', NULL, 'core', 302),
  ('0654-s-p3', '0654-2023-2024-v1', 'P3', 'Thermal physics', '热学', 'section', NULL, 'core', 303),
  ('0654-s-p4', '0654-2023-2024-v1', 'P4', 'Properties of waves', '波的性质', 'section', NULL, 'core', 304),
  ('0654-s-p5', '0654-2023-2024-v1', 'P5', 'Electricity', '电学', 'section', NULL, 'core', 305),
  ('0654-s-p6', '0654-2023-2024-v1', 'P6', 'Magnetism', '磁学', 'section', NULL, 'core', 306),
  ('0654-s-p7', '0654-2023-2024-v1', 'P7', 'Radioactivity and particles', '放射性和粒子', 'section', NULL, 'core', 307),
  ('0654-s-p8', '0654-2023-2024-v1', 'P8', 'Astrophysics and cosmology', '天体物理和宇宙学', 'section', NULL, 'core', 308),
  ('0455-s-1', '0455-2023-2025-v1', '1', 'The basic economic problem', '基本经济问题', 'topic', NULL, 'core', 101),
  ('0455-s-2', '0455-2023-2025-v1', '2', 'The allocation of resources', '资源配置', 'topic', NULL, 'core', 102),
  ('0455-s-3', '0455-2023-2025-v1', '3', 'Microeconomic decision makers', '微观经济决策者', 'topic', NULL, 'core', 103),
  ('0455-s-4', '0455-2023-2025-v1', '4', 'Government and the macroeconomy', '政府和宏观经济', 'topic', NULL, 'core', 104),
  ('0455-s-5', '0455-2023-2025-v1', '5', 'Economic development', '经济发展', 'topic', NULL, 'core', 105),
  ('0455-s-6', '0455-2023-2025-v1', '6', 'International trade and globalisation', '国际贸易和全球化', 'topic', NULL, 'core', 106)
ON CONFLICT(id) DO UPDATE SET
  title_en = excluded.title_en, title_zh = excluded.title_zh, level = excluded.level,
  sort_order = excluded.sort_order, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO coursebook_chapters (id, book_key, chapter_no, title_en, title_zh, sort_order) VALUES
  ('0620-c-1', 'chemistry-0620-2023-2025', 1, 'States of matter', '物质状态', 1),
  ('0620-c-2', 'chemistry-0620-2023-2025', 2, 'Atoms, elements and compounds', '原子、元素和化合物', 2),
  ('0620-c-3', 'chemistry-0620-2023-2025', 3, 'Stoichiometry', '化学计量', 3),
  ('0620-c-4', 'chemistry-0620-2023-2025', 4, 'Electrochemistry', '电化学', 4),
  ('0620-c-5', 'chemistry-0620-2023-2025', 5, 'Chemical energetics', '化学能量学', 5),
  ('0620-c-6', 'chemistry-0620-2023-2025', 6, 'Chemical reactions', '化学反应', 6),
  ('0620-c-7', 'chemistry-0620-2023-2025', 7, 'Acids, bases and salts', '酸、碱和盐', 7),
  ('0620-c-8', 'chemistry-0620-2023-2025', 8, 'The Periodic Table', '元素周期表', 8),
  ('0620-c-9', 'chemistry-0620-2023-2025', 9, 'Metals', '金属', 9),
  ('0620-c-10', 'chemistry-0620-2023-2025', 10, 'Chemistry of the environment', '环境化学', 10),
  ('0620-c-11', 'chemistry-0620-2023-2025', 11, 'Organic chemistry', '有机化学', 11),
  ('0620-c-12', 'chemistry-0620-2023-2025', 12, 'Experimental techniques and chemical analysis', '实验技术和化学分析', 12),
  ('0654-c-1', 'coordinated-sciences-0654-2023-2024', 1, 'Biology', '生物学', 1),
  ('0654-c-2', 'coordinated-sciences-0654-2023-2024', 2, 'Chemistry', '化学', 2),
  ('0654-c-3', 'coordinated-sciences-0654-2023-2024', 3, 'Physics', '物理学', 3),
  ('0455-c-1', 'economics-0455-2023-2025', 1, 'The basic economic problem', '基本经济问题', 1),
  ('0455-c-2', 'economics-0455-2023-2025', 2, 'The allocation of resources', '资源配置', 2),
  ('0455-c-3', 'economics-0455-2023-2025', 3, 'Microeconomic decision makers', '微观经济决策者', 3),
  ('0455-c-4', 'economics-0455-2023-2025', 4, 'Government and the macroeconomy', '政府和宏观经济', 4),
  ('0455-c-5', 'economics-0455-2023-2025', 5, 'Economic development', '经济发展', 5),
  ('0455-c-6', 'economics-0455-2023-2025', 6, 'International trade and globalisation', '国际贸易和全球化', 6)
ON CONFLICT(id) DO UPDATE SET title_en = excluded.title_en, title_zh = excluded.title_zh, sort_order = excluded.sort_order;

INSERT INTO coursebook_sections (id, coursebook_chapter_id, section_code, title_en, title_zh, sort_order)
SELECT CASE curriculum_version_id
    WHEN '0620-2023-2025-v1' THEN '0620'
    WHEN '0654-2023-2024-v1' THEN '0654'
    ELSE '0455' END || '-b-' || replace(syllabus_code, '.', '-'),
  CASE curriculum_version_id
    WHEN '0620-2023-2025-v1' THEN '0620-c-' || syllabus_code
    WHEN '0654-2023-2024-v1' THEN '0654-c-' || CASE substr(syllabus_code, 1, 1) WHEN 'B' THEN '1' WHEN 'C' THEN '2' ELSE '3' END
    ELSE '0455-c-' || syllabus_code END,
  syllabus_code, title_en, title_zh, sort_order
FROM curriculum_sections
WHERE curriculum_version_id IN ('0620-2023-2025-v1', '0654-2023-2024-v1', '0455-2023-2025-v1')
ON CONFLICT(coursebook_chapter_id, section_code) DO UPDATE SET
  title_en = excluded.title_en, title_zh = excluded.title_zh, sort_order = excluded.sort_order;

INSERT OR IGNORE INTO coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
SELECT CASE curriculum_version_id
    WHEN '0620-2023-2025-v1' THEN '0620'
    WHEN '0654-2023-2024-v1' THEN '0654'
    ELSE '0455' END || '-b-' || replace(syllabus_code, '.', '-'), id
FROM curriculum_sections
WHERE curriculum_version_id IN ('0620-2023-2025-v1', '0654-2023-2024-v1', '0455-2023-2025-v1');
