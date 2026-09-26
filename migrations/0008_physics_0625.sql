INSERT INTO exam_subjects (
  code, board, qualification, name, name_zh, asset_key, active
) VALUES (
  '0625', 'CIE', 'IGCSE', 'Physics', '物理', 'physics-0625', 1
)
ON CONFLICT (code) DO UPDATE SET
  board = excluded.board,
  qualification = excluded.qualification,
  name = excluded.name,
  name_zh = excluded.name_zh,
  asset_key = excluded.asset_key,
  active = 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
