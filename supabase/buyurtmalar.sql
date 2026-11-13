-- KishMish: buyurtmalar jadvali.
-- Supabase → SQL Editor'da bir marta ishga tushiring.

create table if not exists public.buyurtmalar (
  id         bigint generated always as identity primary key,
  yaratilgan timestamptz not null default now(),
  ism        text not null,
  telefon    text not null,
  izoh       text,
  taomlar    jsonb not null,          -- [{ "nomi", "miqdor_kg", "narx", "summa" }]
  jami       bigint not null check (jami > 0),
  holat      text not null default 'yangi',
  rozilik    boolean not null check (rozilik = true)
);

-- Jadval avvalroq «holat» ustunisiz yaratilgan bo'lsa, shu qatorni bir marta ishga tushiring:
alter table public.buyurtmalar add column if not exists holat text not null default 'yangi';

-- RLS yoqilgan va hech qanday policy yo'q: brauzerdan (anon kalit bilan)
-- jadvalni o'qib ham, yozib ham bo'lmaydi. Netlify funksiyasi
-- SUPABASE_SECRET_KEY bilan ishlaydi va RLS'dan o'tadi.
alter table public.buyurtmalar enable row level security;

-- Maxfiylik siyosatida 12 oy deyilgan. Eski yozuvlarni qo'lda o'chirish:
-- delete from public.buyurtmalar where yaratilgan < now() - interval '12 months';
