-- New scenes are voiced: each narration word gets the time it starts, so the page lights words as they are spoken.
-- Run once in the Supabase SQL editor; schema.sql already has the result.
-- Old scenes stay empty and keep the sentence highlight.
alter table scenes add column word_starts_ms int[];
