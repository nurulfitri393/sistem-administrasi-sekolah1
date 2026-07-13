import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// WAJIB jalan di Node.js runtime (butuh service_role key, tidak boleh di edge/browser).
export const runtime = 'nodejs'

// Ikuti project Supabase yang sama dengan app/supabase.ts (lihat catatan di
// sana): pakai env var kalau diatur (mis. saat uji coba lokal memakai
// project Supabase terpisah), kalau tidak baru jatuh ke project produksi.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://whnwipppzjauxkmdiqfv.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_szkotq6gG7TVSfBfIumxJQ_92oC5eoH'

/**
 * POST /api/admin/buat-akun-guru
 * body: { email: string, password: string, nama?: string }
 *
 * Dipanggil otomatis oleh halaman "Kelola Data Guru" setiap kali Admin
 * menambah/mengedit satu guru ATAU mengimpor CSV — TIDAK PERNAH dipanggil
 * langsung oleh guru itu sendiri.
 *
 * Memakai auth.admin.createUser({ email_confirm: true }) supaya akun
 * langsung aktif TANPA mengirim email verifikasi sama sekali — ini yang
 * menghindari "Email rate limit exceeded" pada tier gratis Supabase.
 *
 * Kalau akun dengan email tsb sudah ada sebelumnya (mis. NPSN sekolah
 * berubah, atau guru di-import ulang), password-nya otomatis diperbarui
 * (bukan gagal/duplicate error).
 */
export async function POST(request: NextRequest) {
  try {
    // 1) Pastikan yang memanggil adalah Admin yang benar-benar sedang login
    //    (verifikasi access token dari sesi Supabase Auth admin di browser).
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return NextResponse.json(
        { error: 'Sesi Admin tidak ditemukan. Silakan login ulang.' },
        { status: 401 }
      )
    }

    const supabaseSebagaiPemanggil = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: dataUser, error: errorUser } = await supabaseSebagaiPemanggil.auth.getUser(token)
    if (errorUser || !dataUser?.user) {
      return NextResponse.json(
        { error: 'Sesi Admin tidak valid/kedaluwarsa. Silakan login ulang.' },
        { status: 401 }
      )
    }
    // Catatan: akun Guru yang memang diberi wewenang mengelola Kelola Data
    // Guru (lewat Pembagian Peran) SENGAJA tetap boleh memicu pembuatan akun
    // guru lain -- selama dia sudah lolos useAksesGuard('guru') di halaman
    // itu. Yang penting: password baru selalu ditentukan/dilihat sendiri
    // oleh pembuatnya saat itu juga (lewat form), bukan disimpan untuk
    // dilihat kembali nanti -- lihat catatan keamanan di app/peran/guru/page.tsx.

    // 2) Pastikan service_role key sudah diatur di server (.env.local / env hosting).
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            'SUPABASE_SERVICE_ROLE_KEY belum diatur di environment server. ' +
            'Ambil dari Supabase Dashboard > Project Settings > API > service_role, ' +
            'lalu tambahkan ke file .env.local (JANGAN pernah dipakai di kode frontend).',
        },
        { status: 500 }
      )
    }

    const body = await request.json()
    const email: string = (body?.email || '').trim().toLowerCase()
    const password: string = String(body?.password || '')
    const nama: string = body?.nama || ''

    if (!email || !password) {
      return NextResponse.json({ error: 'Email dan sandi wajib diisi.' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Sandi (NPSN sekolah) minimal 6 karakter agar diterima Supabase Auth.' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createClient(SUPABASE_URL, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 3) Coba buat akun baru. Tidak mengirim email verifikasi sama sekali
    //    karena email_confirm: true.
    const { data: dataBuat, error: errorBuat } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nama, role: 'guru' },
    })

    if (!errorBuat) {
      return NextResponse.json({ ok: true, mode: 'dibuat', userId: dataBuat.user?.id })
    }

    // 4) Kalau errornya "email sudah terdaftar", perbarui saja sandinya
    //    (misalnya NPSN sekolah baru saja diganti Admin).
    const sudahAda =
      errorBuat.message?.toLowerCase().includes('already') ||
      errorBuat.message?.toLowerCase().includes('registered') ||
      (errorBuat as any).status === 422

    if (sudahAda) {
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 })
      }
      const userLama = listData.users.find(u => u.email?.toLowerCase() === email)
      if (!userLama) {
        return NextResponse.json({ error: errorBuat.message }, { status: 400 })
      }
      const { error: errorUpdate } = await supabaseAdmin.auth.admin.updateUserById(userLama.id, {
        password,
        email_confirm: true,
        user_metadata: { nama, role: 'guru' },
      })
      if (errorUpdate) {
        return NextResponse.json({ error: errorUpdate.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, mode: 'diperbarui', userId: userLama.id })
    }

    return NextResponse.json({ error: errorBuat.message }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

/**
 * GET /api/admin/buat-akun-guru
 * Dipakai HANYA oleh halaman /status-sinkronisasi untuk mengecek apakah
 * SUPABASE_SERVICE_ROLE_KEY sudah diisi di server -- TIDAK membocorkan isi
 * key-nya sama sekali, cuma bilang ada/tidak ada.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 })
  }
  const supabaseSebagaiPemanggil = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: dataUser, error: errorUser } = await supabaseSebagaiPemanggil.auth.getUser(token)
  if (errorUser || !dataUser?.user) {
    return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 })
  }
  const adaServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  return NextResponse.json({ ok: true, adaServiceRoleKey })
}
