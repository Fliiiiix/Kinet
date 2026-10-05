-- Identifiant IMDb de chaque carte (ex. tt6751668, nm0000000), renseigné une
-- fois par le script hors-ligne supabase/scripts/tcg-rarity.js (--fetch-imdb).
-- Sert à rapprocher une carte des datasets IMDb pour calculer sa rareté
-- (voir ce script). Jamais demandé ni modifié par le client.
alter table public.tcg_cards add column if not exists imdb_id text;
create index if not exists tcg_cards_imdb_id_idx on public.tcg_cards (imdb_id);
