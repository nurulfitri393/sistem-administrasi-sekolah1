'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase } from '@/app/supabase'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { useRouter } from 'next/navigation'

type Status = 'menunggu' | 'jalan' | 'lulus' | 'gagal'

interface Langkah {
  id: string
  judul: string
  status: Status
  detail?: string
}

const LANGKAH_AWAL: Langkah[] = [
  { id: 'sesi', judul: '1) Cek sesi login saat ini', status: 'menunggu' },
  { id: 'select', judul: '2) Baca tabel app_storage (SELECT)', status: 'menunggu' },
  { id: 'insert', judul: '3) Tulis data uji ke app_storage (INSERT/UPSERT)', status: 'menunggu' },
  { id: 'select2', judul: '4) Baca kembali data uji yang baru ditulis', status: 'menunggu' },
  { id: 'delete', judul: '5) Hapus data uji (DELETE, membersihkan)', status: 'menunggu' },
  { id: 'patch', judul: '6) Uji alur ASLI aplikasi: localStorage.setItem → otomatis terkirim ke cloud?', status: 'menunggu' },
  { id: 'servicerole', judul: '7) Cek konfigurasi pembuatan akun Guru otomatis (SUPABASE_SERVICE_ROLE_KEY)', status: 'menunggu' },
]

export default function StatusSinkronisasiPage() {
  const diizinkanAkses = useAksesGuard('diagnostik')
  const [langkah, setLangkah] = useState<Langkah[]>(LANGKAH_AWAL)
  const [berjalan, setBerjalan] = useState(false)
  const [isAdminAsli, setIsAdminAsli] = useState<boolean | null>(null)
  const router = useRouter()

  useEffect(() => {
    // Lapisan tambahan: pastikan yang mengakses ini benar-benar akun yang
    // didaftarkan langsung di Supabase (bukan akun Guru), dicek dari
    // metadata akun sungguhan -- bukan cuma tanda lokal di browser.
    supabase.auth.getSession().then(({ data }) => {
      const role = (data.session?.user?.user_metadata as any)?.role
      const asli = !!data.session && role !== 'guru'
      setIsAdminAsli(asli)
      if (!asli) router.replace('/dashboard')
    })
  }, [router])

  const perbarui = (id: string, patch: Partial<Langkah>) => {
    setLangkah(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)))
  }

  const jalankanTes = async () => {
    setBerjalan(true)
    setLangkah(LANGKAH_AWAL.map(l => ({ ...l, status: 'menunggu', detail: undefined })))
    const kunciUji = `_tes_sinkronisasi_${Date.now()}`
    const nilaiUji = `nilai-uji-${Math.random().toString(36).slice(2, 8)}`

    // 1) Sesi login
    perbarui('sesi', { status: 'jalan' })
    try {
      const { data: sessionData, error } = await supabase.auth.getSession()
      if (error) throw error
      if (!sessionData.session) {
        perbarui('sesi', {
          status: 'gagal',
          detail: 'Tidak ada sesi login aktif. Anda harus login (Admin/Guru) sebelum uji tulis data bisa berhasil.',
        })
      } else {
        perbarui('sesi', {
          status: 'lulus',
          detail: `Login sebagai: ${sessionData.session.user.email}`,
        })
      }
    } catch (e: any) {
      perbarui('sesi', { status: 'gagal', detail: String(e?.message || e) })
    }

    // 2) SELECT
    perbarui('select', { status: 'jalan' })
    try {
      const { data, error } = await supabase.from('app_storage').select('key').limit(1)
      if (error) throw error
      perbarui('select', {
        status: 'lulus',
        detail: `Berhasil membaca tabel app_storage (contoh ${data?.length ?? 0} baris diambil).`,
      })
    } catch (e: any) {
      perbarui('select', {
        status: 'gagal',
        detail: `${e?.message || e}${e?.code ? ` (kode: ${e.code})` : ''} — kemungkinan tabel app_storage belum dibuat, atau nama project/anon key di app/supabase.ts salah.`,
      })
      setBerjalan(false)
      return // tidak ada gunanya lanjut kalau baca saja sudah gagal
    }

    // 3) INSERT/UPSERT
    perbarui('insert', { status: 'jalan' })
    try {
      const { error } = await supabase
        .from('app_storage')
        .upsert({ key: kunciUji, value: nilaiUji, updated_at: new Date().toISOString() })
      if (error) throw error
      perbarui('insert', { status: 'lulus', detail: 'Berhasil menulis baris uji.' })
    } catch (e: any) {
      perbarui('insert', {
        status: 'gagal',
        detail: `${e?.message || e}${e?.code ? ` (kode: ${e.code})` : ''} — kalau errornya soal RLS/permission, artinya kebijakan INSERT di Supabase mewajibkan login, tapi sesi Anda tidak terbaca sah oleh server. Kalau errornya "relation does not exist", tabel app_storage belum dibuat sama sekali di project ini.`,
      })
      setBerjalan(false)
      return
    }

    // 4) SELECT ulang utk verifikasi tulisan barusan
    perbarui('select2', { status: 'jalan' })
    try {
      const { data, error } = await supabase.from('app_storage').select('value').eq('key', kunciUji).single()
      if (error) throw error
      if (data?.value === nilaiUji) {
        perbarui('select2', { status: 'lulus', detail: 'Data uji yang baru ditulis berhasil terbaca kembali — tulis & baca ke cloud BERFUNGSI.' })
      } else {
        perbarui('select2', { status: 'gagal', detail: `Nilai tidak cocok. Diharapkan "${nilaiUji}", didapat "${data?.value}".` })
      }
    } catch (e: any) {
      perbarui('select2', { status: 'gagal', detail: String(e?.message || e) })
    }

    // 5) DELETE (bersih-bersih)
    perbarui('delete', { status: 'jalan' })
    try {
      const { error } = await supabase.from('app_storage').delete().eq('key', kunciUji)
      if (error) throw error
      perbarui('delete', { status: 'lulus', detail: 'Data uji berhasil dihapus.' })
    } catch (e: any) {
      perbarui('delete', {
        status: 'gagal',
        detail: `${e?.message || e} — data uji "${kunciUji}" tertinggal di tabel, boleh dihapus manual lewat Supabase Table Editor.`,
      })
    }

    // 6) Uji alur ASLI aplikasi: localStorage.setItem (yang sudah "disadap"
    //    oleh lib/cloudSync.ts) -- ini BEDA dari langkah 3 di atas yang
    //    memanggil Supabase langsung. Kalau langkah ini GAGAL padahal
    //    langkah 2-5 semua LULUS, artinya masalahnya ada di mekanisme
    //    penyadapan localStorage (lib/cloudSync.ts), BUKAN di Supabase.
    perbarui('patch', { status: 'jalan' })
    const kunciPatch = `_tes_localstorage_patch_${Date.now()}`
    const nilaiPatch = `nilai-patch-${Math.random().toString(36).slice(2, 8)}`
    try {
      window.localStorage.setItem(kunciPatch, nilaiPatch)
      // Tunggu lebih lama dari waktu debounce (400ms) di cloudSync.ts
      await new Promise(resolve => setTimeout(resolve, 1500))

      const { data, error } = await supabase.from('app_storage').select('value').eq('key', kunciPatch).maybeSingle()
      if (error) throw error

      if (data?.value === nilaiPatch) {
        perbarui('patch', {
          status: 'lulus',
          detail: 'localStorage.setItem berhasil otomatis terkirim ke cloud. Mekanisme sinkronisasi aplikasi BEKERJA dengan benar.',
        })
      } else {
        perbarui('patch', {
          status: 'gagal',
          detail: 'localStorage.setItem TIDAK terkirim ke cloud (data tidak ditemukan di tabel setelah 1.5 detik). Ini berarti mekanisme penyadapan localStorage di lib/cloudSync.ts tidak aktif/tidak berfungsi di build ini — walau koneksi Supabase-nya sendiri sehat (lihat langkah 2-5). Kemungkinan CloudSyncProvider tidak terpasang dengan benar di app/layout.tsx pada build yang sedang online ini.',
        })
      }
      window.localStorage.removeItem(kunciPatch)
      await supabase.from('app_storage').delete().eq('key', kunciPatch) // jaga-jaga kalau sempat kekirim tapi lambat
    } catch (e: any) {
      perbarui('patch', { status: 'gagal', detail: String(e?.message || e) })
    }

    // 7) Cek apakah SUPABASE_SERVICE_ROLE_KEY sudah dikonfigurasi -- ini
    //    yang dipakai untuk membuat akun login Guru otomatis. Kalau belum
    //    diisi, data guru tetap tersimpan tapi akunnya TIDAK PERNAH aktif.
    perbarui('servicerole', { status: 'jalan' })
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        perbarui('servicerole', { status: 'gagal', detail: 'Tidak ada sesi login, tidak bisa mengecek.' })
      } else {
        const res = await fetch('/api/admin/buat-akun-guru', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        if (!res.ok) {
          perbarui('servicerole', { status: 'gagal', detail: json?.error || 'Gagal mengecek konfigurasi.' })
        } else if (json.adaServiceRoleKey) {
          perbarui('servicerole', {
            status: 'lulus',
            detail: 'SUPABASE_SERVICE_ROLE_KEY sudah terkonfigurasi. Akun Guru otomatis seharusnya aktif saat disimpan/diimpor.',
          })
        } else {
          perbarui('servicerole', {
            status: 'gagal',
            detail: 'SUPABASE_SERVICE_ROLE_KEY BELUM diisi di environment variable server. Inilah sebabnya akun Guru tidak pernah benar-benar aktif walau datanya tersimpan. Tambahkan key ini di pengaturan Environment Variables Vercel Anda, lalu deploy ulang, lalu simpan ulang data guru yang bersangkutan.',
          })
        }
      }
    } catch (e: any) {
      perbarui('servicerole', { status: 'gagal', detail: String(e?.message || e) })
    }

    setBerjalan(false)
  }

  const warna = (s: Status) =>
    s === 'lulus' ? 'text-green-700 bg-green-50 border-green-200'
    : s === 'gagal' ? 'text-red-700 bg-red-50 border-red-200'
    : s === 'jalan' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-slate-500 bg-slate-50 border-slate-200'

  const label = (s: Status) =>
    s === 'lulus' ? '✅ Lulus' : s === 'gagal' ? '❌ Gagal' : s === 'jalan' ? '⏳ Berjalan...' : '⏸ Menunggu'

  if (diizinkanAkses === null || isAdminAsli === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat...</div>
  if (diizinkanAkses === false || isAdminAsli === false) return null

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800 font-opensans">
      <Sidebar />
      <main className="flex-1 p-8 overflow-y-auto max-w-3xl mx-auto space-y-6">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-baloo font-black text-slate-900">Status Sinkronisasi Cloud</h1>
          <p className="text-xs text-gray-500">
            Alat ini menguji langsung ke Supabase project Anda yang sesungguhnya (bukan simulasi) —
            gunakan untuk memastikan data benar-benar tersimpan &amp; terbaca dari cloud.
          </p>
        </header>

        <button
          onClick={jalankanTes}
          disabled={berjalan}
          className="bg-[#6A197D] hover:bg-[#571466] disabled:opacity-50 text-white font-baloo font-bold px-6 py-3 rounded-xl text-sm transition"
        >
          {berjalan ? 'Sedang menguji...' : 'Jalankan Tes Sinkronisasi'}
        </button>

        <div className="space-y-3">
          {langkah.map(l => (
            <div key={l.id} className={`border rounded-xl p-4 text-sm ${warna(l.status)}`}>
              <div className="flex justify-between items-center font-bold">
                <span>{l.judul}</span>
                <span>{label(l.status)}</span>
              </div>
              {l.detail && <p className="mt-1.5 text-xs leading-relaxed">{l.detail}</p>}
            </div>
          ))}
        </div>

        <div className="bg-[#FFFBEA] border border-[#FFEDA3] rounded-xl p-4 text-xs text-[#440F55] leading-relaxed">
          <strong className="block mb-1">Cara membaca hasil:</strong>
          Kalau langkah 2 (SELECT) gagal → tabel <code>app_storage</code> kemungkinan belum dibuat, jalankan lagi
          <code> supabase/migrations/001_app_storage.sql</code> di Supabase SQL Editor.<br />
          Kalau langkah 3 (INSERT) gagal soal permission/RLS → Anda perlu login dulu sebelum menguji, atau kebijakan
          RLS di Supabase belum sesuai dengan file migrasi terbaru.<br />
          <strong>Kalau langkah 2–5 semua LULUS tapi langkah 6 GAGAL</strong> → ini konfirmasi pasti bahwa
          masalahnya BUKAN di Supabase (koneksinya sehat), tapi di mekanisme penyadapan
          <code> localStorage</code> pada build aplikasi yang sedang online ini — beri tahu saya hasil ini persis
          supaya saya telusuri <code>components/CloudSyncProvider.tsx</code> dan <code>app/layout.tsx</code> lebih
          lanjut.
        </div>
      </main>
    </div>
  )
}
