'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
// ⚠️ SESUAIKAN path import supabase ini dengan lokasi file app/supabase.ts di project Anda.
//    Kalau folder ini (components/) ada di root project (sejajar dengan app/), pakai:
import { supabase } from '@/app/supabase'
import {
  Landmark, LogOut, Shield, BookOpen, Home, Building,
  CalendarDays, BarChart2, FileText, FileSpreadsheet, Clock,
  UserPlus, LucideIcon, Activity, Menu, X,
} from 'lucide-react'
import { getAksesInfo, AksesInfo } from '@/lib/aksesPeran'

interface MenuItem {
  moduleId: string | null   // null = selalu tampil untuk siapapun yang login
  href: string
  label: string
  icon: LucideIcon
  sectionBefore?: string    // judul grup kecil yang ditampilkan sebelum item ini
}

// Satu sumber kebenaran untuk seluruh menu navigasi aplikasi.
// moduleId HARUS SAMA PERSIS dengan id modul di daftarModulSistem (halaman /peran).
const MENU_ITEMS: MenuItem[] = [
  { moduleId: null,             href: '/dashboard',      label: 'Beranda Dasbor',       icon: Home },
  { moduleId: 'lembaga',        href: '/lembaga',        label: 'Identitas Lembaga',    icon: Building },
  { moduleId: 'peran',          href: '/peran',          label: 'Pembagian Peran',      icon: Shield },
  { moduleId: 'guru',           href: '/peran/guru',     label: 'Kelola Data Guru',     icon: UserPlus },
  { moduleId: 'guru',           href: '/peran/mapel',    label: 'Mata Pelajaran',       icon: BookOpen },
  { moduleId: 'kaldik',         href: '/kaldik',         label: 'Kalender Pendidikan',  icon: CalendarDays, sectionBefore: 'Modul Administrasi' },
  { moduleId: 'jadwal',         href: '/jadwal',         label: 'Jadwal Pelajaran',     icon: Clock },
  { moduleId: 'cp_tp_atp',      href: '/cp-tp-atp',      label: 'CP, TP & ATP',         icon: FileText },
  { moduleId: 'minggu_efektif', href: '/minggu-efektif', label: 'Analisis Alokasi Waktu', icon: BarChart2 },
  { moduleId: 'prota_promes',   href: '/prota-promes',   label: 'Prota & Promes',       icon: FileSpreadsheet },
  { moduleId: 'rpp',            href: '/rpp',            label: 'RPP / Modul Ajar',     icon: BookOpen },
  { moduleId: 'diagnostik',     href: '/status-sinkronisasi', label: 'Status Sinkronisasi', icon: Activity, sectionBefore: 'Sistem' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')
  const [akses, setAkses] = useState<AksesInfo | null>(null)
  // Dicek LANGSUNG dari metadata akun Supabase Auth (bukan cuma tanda lokal
  // 'sesi_guru_login') -- supaya menu diagnostik/sinkronisasi HANYA terlihat
  // untuk akun yang didaftarkan langsung di Supabase (admin sungguhan),
  // bukan akun Guru yang dibuat otomatis oleh sistem (walau entah bagaimana
  // caranya akun Guru itu login).
  const [isAdminAsli, setIsAdminAsli] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    const muatSemua = () => {
      const si = localStorage.getItem('identitas_induk')
      if (si) {
        try {
          const p = JSON.parse(si)
          setNamaInduk(p.nama || 'Lembaga / Yayasan Pusat')
          setLogoInduk(p.logo_utama || p.logo || '')
        } catch { /* abaikan */ }
      }
      setAkses(getAksesInfo())
    }
    muatSemua()

    supabase.auth.getSession().then(({ data }) => {
      const role = (data.session?.user?.user_metadata as any)?.role
      setIsAdminAsli(!!data.session && role !== 'guru')
    })

    // AKAR MASALAH "sidebar/menu hilang di perangkat berbeda, baru muncul
    // setelah refresh manual": muatSemua() di atas cuma jalan SEKALI saat mount
    // -- kalau saat itu penarikan data dari cloud (lihat CloudSyncProvider)
    // belum benar-benar selesai (koneksi lambat), master_guru/master_peran yang
    // dibaca getAksesInfo() masih belum lengkap, membuat menu terlihat kosong/
    // hilang. CloudSyncProvider mengirim sinyal 'cloud-sync-selesai' begitu
    // penariakan itu SUNGGUH selesai (walau sudah lewat batas waktu tampil
    // halamannya) -- dengarkan sinyal itu supaya menu dihitung ulang otomatis
    // tanpa pengguna perlu refresh manual.
    window.addEventListener('cloud-sync-selesai', muatSemua)
    return () => window.removeEventListener('cloud-sync-selesai', muatSemua)
  }, [pathname])

  const handleLogout = async () => {
    localStorage.removeItem('sesi_guru_login')
    await supabase.auth.signOut()
    router.push('/')
  }

  const bisaLihat = (moduleId: string | null) => {
    if (moduleId === 'diagnostik') return isAdminAsli
    if (moduleId === null) return true
    if (!akses) return false // masih memuat -> sembunyikan dulu supaya tidak flicker
    if (!akses.isGuru) return true // Admin: semua modul terlihat
    if (akses.aksesMap === 'all') return true
    return !!akses.aksesMap[moduleId]?.read
  }

  const renderNav = () => (
    <nav className="p-4 space-y-1">
      {MENU_ITEMS.map(item => {
        if (!bisaLihat(item.moduleId)) return null
        const aktif = item.href === '/dashboard'
          ? pathname === '/dashboard'
          : pathname === item.href || pathname?.startsWith(item.href + '/')
        const Icon = item.icon
        return (
          <div key={item.href}>
            {item.sectionBefore && (
              <div className="font-baloo pt-6 pb-2 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {item.sectionBefore}
              </div>
            )}
            <Link
              href={item.href}
              className={`font-opensans flex items-center gap-3 px-4 py-3 text-sm rounded-xl transition ${
                aktif
                  ? 'font-bold text-white bg-[#6A197D] shadow-md shadow-[#E3C2ED]'
                  : 'font-medium text-slate-600 hover:bg-[#F7ECFA]'
              }`}
            >
              <Icon className="w-4 h-4" /> {item.label}
            </Link>
          </div>
        )
      })}
    </nav>
  )

  const renderLogoutBlock = () => (
    <div className="p-4 border-t border-slate-200 bg-slate-50">
      {akses?.isGuru && (
        <p className="px-1 pb-2 text-[10px] text-slate-400">
          Masuk sebagai: <span className="font-bold text-slate-600">{akses.namaGuru}</span>
        </p>
      )}
      <button
        onClick={handleLogout}
        className="font-opensans flex items-center gap-3 px-4 py-2.5 w-full text-sm font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition"
      >
        <LogOut className="w-4 h-4" /> Keluar Sistem
      </button>
    </div>
  )

  return (
    <>
      {/* ── TOP BAR KHUSUS HP/TABLET (md ke bawah) ── */}
      <div className="font-opensans md:hidden sticky top-0 z-40 flex items-center gap-3 min-h-[64px] py-2 px-4 bg-white border-b-2 border-[#FFDE59] shadow-sm">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 rounded-lg text-[#6A197D] hover:bg-[#F7ECFA] transition shrink-0"
          aria-label="Buka menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        {logoInduk
          ? <img src={logoInduk} alt="Logo" className="w-7 h-7 object-contain shrink-0" />
          : <Landmark className="w-5 h-5 text-[#6A197D] shrink-0" />}
        <h2 className="font-baloo text-xs font-bold text-[#220729] uppercase tracking-widest leading-tight line-clamp-2 min-w-0">{namaInduk}</h2>
      </div>

      {/* ── DRAWER MENU UNTUK HP/TABLET ── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative font-opensans w-72 max-w-[85vw] bg-white flex flex-col justify-between h-full overflow-y-auto shadow-2xl animate-in slide-in-from-left">
            <div>
              <div className="min-h-[64px] flex items-center justify-between px-4 py-2.5 border-b-2 border-[#FFDE59] bg-[#F7ECFA]/40">
                <div className="flex items-center gap-2.5 min-w-0">
                  {logoInduk
                    ? <img src={logoInduk} alt="Logo" className="w-7 h-7 object-contain shrink-0" />
                    : <Landmark className="w-5 h-5 text-[#6A197D] shrink-0" />}
                  <h2 className="font-baloo text-xs font-bold text-[#220729] uppercase tracking-widest leading-tight line-clamp-2 min-w-0">{namaInduk}</h2>
                </div>
                <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 shrink-0" aria-label="Tutup menu">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {renderNav()}
            </div>
            {renderLogoutBlock()}
          </aside>
        </div>
      )}

      {/* ── SIDEBAR TETAP UNTUK DESKTOP (md ke atas) ── */}
      <aside className="font-opensans w-72 bg-white border-r border-slate-200 flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="min-h-[80px] flex flex-col justify-center px-6 py-3 border-b-2 border-[#FFDE59] bg-[#F7ECFA]/40">
            <div className="flex items-center gap-3">
              {logoInduk
                ? <img src={logoInduk} alt="Logo" className="w-8 h-8 object-contain shrink-0" />
                : <Landmark className="w-6 h-6 text-[#6A197D] shrink-0" />}
              <h2 className="font-baloo text-xs font-bold text-[#220729] uppercase tracking-widest leading-tight line-clamp-2 min-w-0">{namaInduk}</h2>
            </div>
          </div>
          {renderNav()}
        </div>
        {renderLogoutBlock()}
      </aside>
    </>
  )
}
