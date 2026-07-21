import { createClient } from '@supabase/supabase-js'

// Kredensial dibaca dari environment variable (NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY) supaya local dev bisa diarahkan ke project
// Supabase TERPISAH (staging/dev) lewat file .env.local, tanpa menyentuh
// data asli yang dipakai versi online. Kalau env var tidak diisi (mis. di
// Vercel yang belum diatur), fallback ke project produksi yang sekarang
// supaya versi online tetap jalan seperti biasa.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://whnwipppzjauxkmdiqfv.supabase.co'
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_szkotq6gG7TVSfBfIumxJQ_92oC5eoH'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)