-- Jalankan skrip ini di Supabase Dashboard > SQL Editor.
-- Skrip ini AMAN dijalankan berkali-kali (idempotent) -- tidak akan error
-- walau tabel/policy/publication-nya sudah pernah dibuat sebelumnya.

create table if not exists public.app_storage (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

-- RLS: baca (SELECT) tetap dibuka untuk siapapun -- ini SENGAJA, karena
-- halaman login Guru perlu mencari email guru di data ini SEBELUM guru
-- tsb berhasil login (ayam-telur: butuh data untuk bisa login). Sesuai
-- arahan bahwa data sekolah ini tidak tergolong sangat rahasia.
--
-- Yang benar-benar ditutup adalah TULIS/UBAH/HAPUS -- wajib sudah login
-- (Admin atau Guru, karena akun Guru sekarang juga akun Supabase Auth asli,
-- lihat app/api/admin/buat-akun-guru/route.ts) supaya pengunjung anonim
-- tidak bisa merusak/menghapus data sekolah.
alter table public.app_storage enable row level security;

drop policy if exists "app_storage_select" on public.app_storage;
create policy "app_storage_select" on public.app_storage
  for select using (true);

drop policy if exists "app_storage_insert" on public.app_storage;
create policy "app_storage_insert" on public.app_storage
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "app_storage_update" on public.app_storage;
create policy "app_storage_update" on public.app_storage
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "app_storage_delete" on public.app_storage;
create policy "app_storage_delete" on public.app_storage
  for delete using (auth.role() = 'authenticated');

-- Aktifkan realtime -- dibungkus pengecekan supaya TIDAK ERROR walau
-- tabel ini sudah pernah ditambahkan ke publication sebelumnya (ini yang
-- menyebabkan error di percobaan Anda barusan, karena baris ini sempat
-- dijalankan dua kali).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_storage'
  ) then
    alter publication supabase_realtime add table public.app_storage;
  end if;
end $$;

-- Verifikasi cepat: kalau baris di bawah ini berhasil menampilkan hasil
-- (bukan error), berarti tabel app_storage sudah benar-benar ada & siap.
select count(*) as jumlah_baris_saat_ini from public.app_storage;
