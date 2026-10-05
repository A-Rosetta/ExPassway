-- Invite links have been retired. Authenticated legacy routes return 410 and
-- no longer read this table. Preserve every other chat table and historical
-- migration so fresh databases still follow the same migration sequence.
DROP TABLE IF EXISTS chat_invites;
