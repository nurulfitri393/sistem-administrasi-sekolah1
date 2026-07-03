'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
// ⚠️ SESUAIKAN path import supabase ini dengan lokasi file app/supabase.ts di project Anda.
//    Kalau folder ini (components/) ada di root project (sejajar dengan app/), pakai:
import { supabase } from '@/app/supabase'
import {
  Landmark, LogOut, Shield, BookOpen, Home, Building,
  CalendarDays, BarChart2, FileText, FileSpreadsheet, Clock,
  UserPlus, LucideIcon,
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
  { moduleId: 'kaldik',         href: '/kaldik',         label: 'Kalender Pendidikan',  icon: CalendarDays, sectionBefore: 'Modul Administrasi' },
  { moduleId: 'jadwal',         href: '/jadwal',         label: 'Jadwal Pelajaran',     icon: Clock },
  { moduleId: 'minggu_efektif', href: '/minggu-efektif', label: 'Minggu Efektif',       icon: BarChart2 },
  { moduleId: 'cp_tp_atp',      href: '/cp-tp-atp',      label: 'CP, TP & ATP',         icon: FileText },
  { moduleId: 'prota_promes',   href: '/prota-promes',   label: 'Prota & Promes',       icon: FileSpreadsheet },
  { moduleId: 'rpp',            href: '/rpp',            label: 'RPP / Modul Ajar',     icon: BookOpen },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')
  const [akses, setAkses] = useState<AksesInfo | null>(null)

  useEffect(() => {
    const si = localStorage.getItem('identitas_induk')
    if (si) {
      try {
        const p = JSON.parse(si)
        setNamaInduk(p.nama || 'Lembaga / Yayasan Pusat')
        setLogoInduk(p.logo_utama || p.logo || '')
      } catch { /* abaikan */ }
    }
    setAkses(getAksesInfo())
  }, [pathname])

  const handleLogout = async () => {
    const isGuru = !!localStorage.getItem('sesi_guru_login')
    if (isGuru) {
      localStorage.removeItem('sesi_guru_login')
      router.push('/')
    } else {
      await supabase.auth.signOut()
      router.push('/')
    }
  }

  const bisaLihat = (moduleId: string | null) => {
    if (moduleId === null) return true
    if (!akses) return false // masih memuat -> sembunyikan dulu supaya tidak flicker
    if (!akses.isGuru) return true // Admin: semua modul terlihat
    if (akses.aksesMap === 'all') return true
    return !!akses.aksesMap[moduleId]?.read
  }

  return (
    <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
      <div className="overflow-y-auto">
        <div className="h-20 flex flex-col justify-center px-6 border-b border-slate-200 bg-indigo-50/40">
          <div className="flex items-center gap-3">
            {logoInduk
              ? <img src={logoInduk} alt="Logo" className="w-8 h-8 object-contain shrink-0" />
              : <Landmark className="w-6 h-6 text-indigo-600 shrink-0" />}
            <h2 className="text-xs font-black text-indigo-950 uppercase tracking-widest truncate">{namaInduk}</h2>
          </div>
        </div>

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
                  <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {item.sectionBefore}
                  </div>
                )}
                <a
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 text-sm rounded-xl transition ${
                    aktif
                      ? 'font-bold text-white bg-indigo-600 shadow-md shadow-indigo-200'
                      : 'font-medium text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {item.label}
                </a>
              </div>
            )
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 bg-slate-50">
        {akses?.isGuru && (
          <p className="px-1 pb-2 text-[10px] text-slate-400">
            Masuk sebagai: <span className="font-bold text-slate-600">{akses.namaGuru}</span>
          </p>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition"
        >
          <LogOut className="w-4 h-4" /> Keluar Sistem
        </button>
      </div>
    </aside>
  )
}
