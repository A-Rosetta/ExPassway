-- Cambridge IGCSE Biology 0610 chapter-practice pilot: coursebook Chapters 1-3.
-- Page references are metadata only; no coursebook prose or images are published.

update curriculum_versions
set active = false, updated_at = now()
where subject_code = '0610' and id <> '0610-2026-2028-v2';

insert into curriculum_versions (
  id, subject_code, qualification, exam_year_start, exam_year_end, version, active
) values (
  '0610-2026-2028-v2', '0610', 'Cambridge IGCSE Biology', 2026, 2028, 'v2', true
)
on conflict (id) do update set
  qualification = excluded.qualification,
  exam_year_start = excluded.exam_year_start,
  exam_year_end = excluded.exam_year_end,
  version = excluded.version,
  active = excluded.active,
  updated_at = now();

insert into curriculum_sections (
  id, curriculum_version_id, syllabus_code, title_en, title_zh,
  level, parent_id, core_level, sort_order
) values
  ('0610-2026-1', '0610-2026-2028-v2', '1', 'Characteristics and classification of living organisms', '生物的特征与分类', 'topic', null, null, 1000),
  ('0610-2026-1.1', '0610-2026-2028-v2', '1.1', 'Characteristics of living organisms', '生物的特征', 'section', '0610-2026-1', null, 1100),
  ('0610-2026-1.2', '0610-2026-2028-v2', '1.2', 'Concept and uses of classification systems', '分类系统的概念与用途', 'section', '0610-2026-1', null, 1200),
  ('0610-2026-1.3', '0610-2026-2028-v2', '1.3', 'Features of organisms', '生物类群的特征', 'section', '0610-2026-1', null, 1300),
  ('0610-2026-2', '0610-2026-2028-v2', '2', 'Organisation of the organism', '生物体的组织层次', 'topic', null, null, 2000),
  ('0610-2026-2.1', '0610-2026-2028-v2', '2.1', 'Cell structure', '细胞结构', 'section', '0610-2026-2', null, 2100),
  ('0610-2026-2.2', '0610-2026-2028-v2', '2.2', 'Size of specimens', '生物标本的大小', 'section', '0610-2026-2', null, 2200),
  ('0610-2026-3', '0610-2026-2028-v2', '3', 'Movement into and out of cells', '物质进出细胞', 'topic', null, null, 3000),
  ('0610-2026-3.1', '0610-2026-2028-v2', '3.1', 'Diffusion', '扩散', 'section', '0610-2026-3', null, 3100),
  ('0610-2026-3.2', '0610-2026-2028-v2', '3.2', 'Osmosis', '渗透', 'section', '0610-2026-3', null, 3200),
  ('0610-2026-3.3', '0610-2026-2028-v2', '3.3', 'Active transport', '主动运输', 'section', '0610-2026-3', null, 3300)
on conflict (id) do update set
  title_en = excluded.title_en,
  title_zh = excluded.title_zh,
  level = excluded.level,
  parent_id = excluded.parent_id,
  core_level = excluded.core_level,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into curriculum_sections (
  id, curriculum_version_id, syllabus_code, title_en, title_zh,
  level, parent_id, core_level, sort_order
) values
  ('0610-2026-1.1.1', '0610-2026-2028-v2', '1.1.1', 'Describe the seven characteristics of living organisms', '描述生物的七项生命特征', 'statement', '0610-2026-1.1', 'core', 1101),
  ('0610-2026-1.2.1', '0610-2026-2028-v2', '1.2.1', 'Classify organisms by shared features', '按共同特征对生物分类', 'statement', '0610-2026-1.2', 'core', 1201),
  ('0610-2026-1.2.2', '0610-2026-2028-v2', '1.2.2', 'Describe a species', '描述物种的含义', 'statement', '0610-2026-1.2', 'core', 1202),
  ('0610-2026-1.2.3', '0610-2026-2028-v2', '1.2.3', 'Describe the binomial naming system', '描述双名法命名系统', 'statement', '0610-2026-1.2', 'core', 1203),
  ('0610-2026-1.2.4', '0610-2026-2028-v2', '1.2.4', 'Construct and use dichotomous keys', '构建和使用二歧检索表', 'statement', '0610-2026-1.2', 'core', 1204),
  ('0610-2026-1.2.5', '0610-2026-2028-v2', '1.2.5', 'Explain evolutionary relationships in classification', '解释分类中的进化关系', 'statement', '0610-2026-1.2', 'supplement', 1205),
  ('0610-2026-1.2.6', '0610-2026-2028-v2', '1.2.6', 'Use DNA base sequences for classification', '使用 DNA 碱基序列进行分类', 'statement', '0610-2026-1.2', 'supplement', 1206),
  ('0610-2026-1.2.7', '0610-2026-2028-v2', '1.2.7', 'Relate DNA similarity to common ancestry', '根据 DNA 相似度判断共同祖先', 'statement', '0610-2026-1.2', 'supplement', 1207),
  ('0610-2026-1.3.1', '0610-2026-2028-v2', '1.3.1', 'Identify features of animal and plant kingdoms', '识别动物界和植物界的主要特征', 'statement', '0610-2026-1.3', 'core', 1301),
  ('0610-2026-1.3.2', '0610-2026-2028-v2', '1.3.2', 'Identify vertebrate and arthropod groups', '识别脊椎动物和节肢动物类群', 'statement', '0610-2026-1.3', 'core', 1302),
  ('0610-2026-1.3.3', '0610-2026-2028-v2', '1.3.3', 'Classify animals using group features', '使用类群特征对动物分类', 'statement', '0610-2026-1.3', 'core', 1303),
  ('0610-2026-1.3.4', '0610-2026-2028-v2', '1.3.4', 'Identify features of the five kingdoms', '识别五界的主要特征', 'statement', '0610-2026-1.3', 'supplement', 1304),
  ('0610-2026-1.3.5', '0610-2026-2028-v2', '1.3.5', 'Identify fern, monocot and dicot features', '识别蕨类、单子叶和双子叶植物特征', 'statement', '0610-2026-1.3', 'supplement', 1305),
  ('0610-2026-1.3.6', '0610-2026-2028-v2', '1.3.6', 'Classify organisms using kingdom features', '使用界和植物类群特征进行分类', 'statement', '0610-2026-1.3', 'supplement', 1306),
  ('0610-2026-1.3.7', '0610-2026-2028-v2', '1.3.7', 'State the features of viruses', '说明病毒的特征', 'statement', '0610-2026-1.3', 'supplement', 1307),
  ('0610-2026-2.1.1', '0610-2026-2028-v2', '2.1.1', 'Compare plant and animal cell structures', '比较植物细胞和动物细胞结构', 'statement', '0610-2026-2.1', 'core', 2101),
  ('0610-2026-2.1.2', '0610-2026-2028-v2', '2.1.2', 'Describe bacterial cell structure', '描述细菌细胞结构', 'statement', '0610-2026-2.1', 'core', 2102),
  ('0610-2026-2.1.3', '0610-2026-2028-v2', '2.1.3', 'Identify structures in cell diagrams and images', '在图像中识别细胞结构', 'statement', '0610-2026-2.1', 'core', 2103),
  ('0610-2026-2.1.4', '0610-2026-2028-v2', '2.1.4', 'Describe cell structure functions', '描述细胞结构的功能', 'statement', '0610-2026-2.1', 'core', 2104),
  ('0610-2026-2.1.5', '0610-2026-2028-v2', '2.1.5', 'State that cells arise by cell division', '说明新细胞由已有细胞分裂产生', 'statement', '0610-2026-2.1', 'core', 2105),
  ('0610-2026-2.1.6', '0610-2026-2028-v2', '2.1.6', 'Relate specialised cells to their functions', '说明特化细胞与功能的关系', 'statement', '0610-2026-2.1', 'core', 2106),
  ('0610-2026-2.1.7', '0610-2026-2028-v2', '2.1.7', 'Describe levels of organisation', '描述细胞到生物体的组织层次', 'statement', '0610-2026-2.1', 'core', 2107),
  ('0610-2026-2.2.1', '0610-2026-2028-v2', '2.2.1', 'Use the magnification formula', '使用放大倍数公式', 'statement', '0610-2026-2.2', 'core', 2201),
  ('0610-2026-2.2.2', '0610-2026-2028-v2', '2.2.2', 'Calculate magnification and specimen size', '计算放大倍数和标本大小', 'statement', '0610-2026-2.2', 'core', 2202),
  ('0610-2026-2.2.3', '0610-2026-2028-v2', '2.2.3', 'Convert millimetres and micrometres', '换算毫米与微米', 'statement', '0610-2026-2.2', 'supplement', 2203),
  ('0610-2026-3.1.1', '0610-2026-2028-v2', '3.1.1', 'Describe diffusion down a concentration gradient', '描述沿浓度梯度发生的扩散', 'statement', '0610-2026-3.1', 'core', 3101),
  ('0610-2026-3.1.2', '0610-2026-2028-v2', '3.1.2', 'Relate diffusion energy to random movement', '说明扩散能量来自粒子随机运动', 'statement', '0610-2026-3.1', 'core', 3102),
  ('0610-2026-3.1.3', '0610-2026-2028-v2', '3.1.3', 'State that substances diffuse through cell membranes', '说明物质通过细胞膜扩散', 'statement', '0610-2026-3.1', 'core', 3103),
  ('0610-2026-3.1.4', '0610-2026-2028-v2', '3.1.4', 'Describe the importance of diffusion', '描述扩散对生物的重要性', 'statement', '0610-2026-3.1', 'core', 3104),
  ('0610-2026-3.1.5', '0610-2026-2028-v2', '3.1.5', 'Investigate factors affecting diffusion', '探究影响扩散的因素', 'statement', '0610-2026-3.1', 'core', 3105),
  ('0610-2026-3.2.1', '0610-2026-2028-v2', '3.2.1', 'Describe water as a solvent in organisms', '描述水作为生物体内溶剂的作用', 'statement', '0610-2026-3.2', 'core', 3201),
  ('0610-2026-3.2.2', '0610-2026-2028-v2', '3.2.2', 'State that water diffuses through partially permeable membranes', '说明水通过部分透性膜扩散', 'statement', '0610-2026-3.2', 'core', 3202),
  ('0610-2026-3.2.3', '0610-2026-2028-v2', '3.2.3', 'State that water enters and leaves cells by osmosis', '说明水通过渗透进出细胞', 'statement', '0610-2026-3.2', 'core', 3203),
  ('0610-2026-3.2.4', '0610-2026-2028-v2', '3.2.4', 'Investigate osmosis with dialysis tubing', '使用透析袋探究渗透', 'statement', '0610-2026-3.2', 'core', 3204),
  ('0610-2026-3.2.5', '0610-2026-2028-v2', '3.2.5', 'Investigate osmosis in plant tissues', '探究不同浓度溶液对植物组织的影响', 'statement', '0610-2026-3.2', 'core', 3205),
  ('0610-2026-3.2.6', '0610-2026-2028-v2', '3.2.6', 'Relate cell water pressure to plant support', '说明细胞内水压对植物支撑的作用', 'statement', '0610-2026-3.2', 'core', 3206),
  ('0610-2026-3.2.7', '0610-2026-2028-v2', '3.2.7', 'Describe osmosis using water potential', '使用水势描述渗透', 'statement', '0610-2026-3.2', 'supplement', 3207),
  ('0610-2026-3.2.8', '0610-2026-2028-v2', '3.2.8', 'Explain osmosis effects on plant cells', '解释渗透对植物细胞的影响', 'statement', '0610-2026-3.2', 'supplement', 3208),
  ('0610-2026-3.2.9', '0610-2026-2028-v2', '3.2.9', 'Explain the importance of water potential and osmosis', '解释水势和渗透对生物的重要性', 'statement', '0610-2026-3.2', 'supplement', 3209),
  ('0610-2026-3.3.1', '0610-2026-2028-v2', '3.3.1', 'Describe active transport', '描述主动运输', 'statement', '0610-2026-3.3', 'core', 3301),
  ('0610-2026-3.3.2', '0610-2026-2028-v2', '3.3.2', 'Explain the importance of active transport', '解释主动运输的重要性', 'statement', '0610-2026-3.3', 'supplement', 3302),
  ('0610-2026-3.3.3', '0610-2026-2028-v2', '3.3.3', 'State the role of carrier proteins', '说明载体蛋白在主动运输中的作用', 'statement', '0610-2026-3.3', 'supplement', 3303)
on conflict (id) do update set
  title_en = excluded.title_en,
  title_zh = excluded.title_zh,
  level = excluded.level,
  parent_id = excluded.parent_id,
  core_level = excluded.core_level,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into coursebook_chapters (
  id, book_key, chapter_no, title_en, title_zh,
  pdf_start_page, pdf_end_page, printed_start_page, printed_end_page, sort_order
) values
  ('bio-igcse-4e-ch1', 'biology-igcse-coursebook-4e', 1, 'Characteristics and classification of living organisms', '生物的特征与分类', 10, 54, 1, 45, 1),
  ('bio-igcse-4e-ch2', 'biology-igcse-coursebook-4e', 2, 'Cells', '细胞', 55, 75, 46, 66, 2),
  ('bio-igcse-4e-ch3', 'biology-igcse-coursebook-4e', 3, 'Movement into and out of cells', '物质进出细胞', 76, 96, 67, 87, 3)
on conflict (id) do update set
  title_en = excluded.title_en,
  title_zh = excluded.title_zh,
  pdf_start_page = excluded.pdf_start_page,
  pdf_end_page = excluded.pdf_end_page,
  printed_start_page = excluded.printed_start_page,
  printed_end_page = excluded.printed_end_page,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into coursebook_sections (
  id, coursebook_chapter_id, section_code, title_en, title_zh,
  pdf_start_page, pdf_end_page, printed_start_page, printed_end_page, sort_order
) values
  ('bio-igcse-4e-1.1', 'bio-igcse-4e-ch1', '1.1', 'Characteristics of organisms', '生物的特征', 12, 14, 3, 5, 101),
  ('bio-igcse-4e-1.2', 'bio-igcse-4e-ch1', '1.2', 'The biological classification system', '生物分类系统', 15, 16, 6, 7, 102),
  ('bio-igcse-4e-1.3', 'bio-igcse-4e-ch1', '1.3', 'Keys', '检索表', 17, 19, 8, 10, 103),
  ('bio-igcse-4e-1.4', 'bio-igcse-4e-ch1', '1.4', 'Kingdoms', '生物界', 20, 30, 11, 21, 104),
  ('bio-igcse-4e-1.5', 'bio-igcse-4e-ch1', '1.5', 'Groups within the animal and plant kingdoms', '动物界和植物界中的类群', 31, 47, 22, 38, 105),
  ('bio-igcse-4e-1.6', 'bio-igcse-4e-ch1', '1.6', 'Viruses', '病毒', 48, 48, 39, 39, 106),
  ('bio-igcse-4e-2.1', 'bio-igcse-4e-ch2', '2.1', 'Animal and plant cells', '动物细胞和植物细胞', 57, null, 48, null, 201),
  ('bio-igcse-4e-2.2', 'bio-igcse-4e-ch2', '2.2', 'Bacterial cells', '细菌细胞', null, null, null, null, 202),
  ('bio-igcse-4e-2.3', 'bio-igcse-4e-ch2', '2.3', 'Specialised cells', '特化细胞', null, 67, null, 58, 203),
  ('bio-igcse-4e-2.4', 'bio-igcse-4e-ch2', '2.4', 'Sizes of specimens', '生物标本的大小', 68, 69, 59, 60, 204),
  ('bio-igcse-4e-3.1', 'bio-igcse-4e-ch3', '3.1', 'Diffusion', '扩散', 78, 82, 69, 73, 301),
  ('bio-igcse-4e-3.2', 'bio-igcse-4e-ch3', '3.2', 'Osmosis', '渗透', 83, 90, 74, 81, 302),
  ('bio-igcse-4e-3.3', 'bio-igcse-4e-ch3', '3.3', 'Active transport', '主动运输', 91, 96, 82, 87, 303)
on conflict (id) do update set
  title_en = excluded.title_en,
  title_zh = excluded.title_zh,
  pdf_start_page = excluded.pdf_start_page,
  pdf_end_page = excluded.pdf_end_page,
  printed_start_page = excluded.printed_start_page,
  printed_end_page = excluded.printed_end_page,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
select mapping.coursebook_section_id, statement.id
from (values
  ('bio-igcse-4e-1.1', '1.1'),
  ('bio-igcse-4e-1.2', '1.2'),
  ('bio-igcse-4e-1.3', '1.2.4'),
  ('bio-igcse-4e-1.4', '1.3.1|1.3.4'),
  ('bio-igcse-4e-1.5', '1.3.2|1.3.3|1.3.5|1.3.6'),
  ('bio-igcse-4e-1.6', '1.3.7'),
  ('bio-igcse-4e-2.1', '2.1.1|2.1.3|2.1.4|2.1.5'),
  ('bio-igcse-4e-2.2', '2.1.2|2.1.3|2.1.4'),
  ('bio-igcse-4e-2.3', '2.1.6|2.1.7'),
  ('bio-igcse-4e-2.4', '2.2'),
  ('bio-igcse-4e-3.1', '3.1'),
  ('bio-igcse-4e-3.2', '3.2'),
  ('bio-igcse-4e-3.3', '3.3')
) as mapping(coursebook_section_id, syllabus_prefix)
join curriculum_sections statement
  on statement.curriculum_version_id = '0610-2026-2028-v2'
 and statement.level = 'statement'
 and (
   statement.syllabus_code = any(string_to_array(mapping.syllabus_prefix, '|'))
   or (
     position('|' in mapping.syllabus_prefix) = 0
     and statement.syllabus_code like mapping.syllabus_prefix || '.%'
   )
 )
on conflict do nothing;
