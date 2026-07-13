import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONEKSI SUPABASE (project ONLINE/PRODUKSI vs project LOKAL/UJI COBA)
// ============================================================
// SEBELUMNYA: URL & anon key project Supabase PRODUKSI ditulis langsung
// (hardcode) di sini -- artinya menjalankan `npm run dev` di komputer
// mana pun (termasuk saat sedang uji coba fitur baru) tetap terhubung ke
// database ONLINE yang sama dengan situs yang sudah dipakai sekolah.
// Akibatnya data uji coba ikut tersimpan/tercampur ke data sungguhan.
//
// SEKARANG: nilai ini diambil dari environment variable
// (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) dulu. Kalau
// belum diatur di komputer ini, baru dipakai nilai project PRODUKSI di
// bawah sebagai cadangan -- supaya deployment yang sudah berjalan di
// Vercel TIDAK langsung rusak walau env var belum ditambahkan di sana.
//
// SUPAYA UJI COBA LOKAL (npm run dev / localhost:3000) TIDAK IKUT MENGUBAH
// DATA ONLINE:
//   1) Buat SATU project Supabase BARU khusus untuk uji coba (gratis) di
//      https://supabase.com/dashboard -> New Project.
//   2) Jalankan isi file supabase/migrations/001_app_storage.sql di
//      SQL Editor project BARU itu (bukan project produksi).
//   3) Salin file .env.local.example di root proyek ini menjadi .env.local,
//      lalu isi NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY
//      dengan URL/anon key project BARU (Project Settings -> API).
//   4) Jalankan ulang `npm run dev`. Selama file .env.local ini ADA di
//      komputer lokal, semua data yang diketik/diuji di localhost:3000
//      akan masuk ke project uji coba tsb -- TIDAK menyentuh data online
//      sama sekali. File .env.local ini juga tidak pernah ikut ter-commit
//      ke git (lihat .gitignore), jadi tidak bisa "tidak sengaja" ikut
//      dideploy ke Vercel/produksi.
//   5) Project Vercel (situs online sungguhan) TETAP memakai project
//      Supabase PRODUKSI seperti biasa -- baik lewat env var yang diatur
//      di dashboard Vercel, maupun (kalau belum diatur) lewat nilai
//      cadangan di bawah ini.
const SUPABASE_URL_PRODUKSI = 'https://whnwipppzjauxkmdiqfv.supabase.co'
const SUPABASE_ANON_KEY_PRODUKSI = 'sb_publishable_szkotq6gG7TVSfBfIumxJQ_92oC5eoH'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL_PRODUKSI
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_PRODUKSI

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
