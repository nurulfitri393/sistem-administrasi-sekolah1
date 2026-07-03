'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../supabase'
import { 
  ArrowLeft, Landmark, Download, Users, BookOpen, UserPlus, LogOut 
} from 'lucide-react'

export default function UnduhDataGuruPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')
  const [npsnSekolah, setNpsnSekolah] = useState('12345678')

  const [daftarGuru, setDaftarGuru] = useState<any[]>([])
  const router = useRouter()

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
      } else {
        setUserEmail(session.user.email || 'Admin')
        
        const storedInduk = localStorage.getItem('identitas_induk')
        if (storedInduk) {
          const parsed = JSON.parse(storedInduk)
          setNamaInduk(parsed.nama || 'Lembaga / Yayasan Pusat')
          setLogoInduk(parsed.logo_utama || parsed.logo || '')
          
          const npsnVal = parsed.npsn || parsed.nomor_statistik || parsed.NPSN || parsed.nomorStatistik
          if (npsnVal) setNpsnSekolah(String(npsnVal).trim())
        }

        const storedGuru = localStorage.getItem('master_guru')
        if (storedGuru) {
          const parsedGuru = JSON.parse(storedGuru).map((g: any) => {
            const namaPembersihan = g.nama.split(',')[0] || g.nama
            const namaTanpaGelar = namaPembersihan.trim().toLowerCase().replace(/[^a-z]/g, '')
            
            const emailAuto = `${namaTanpaGelar || 'guru'}@abs.sch.id`
            const passwordAuto = npsnSekolah
            
            return {
              ...g,
              email_abs: emailAuto,
              password_abs: passwordAuto
            }
          })
          setDaftarGuru(parsedGuru)
        }

        setLoading(false)
      }
    }
    checkAuth()
  }, [router, npsnSekolah])

  const handleUnduhCsv = () => {
    if (daftarGuru.length === 0) {
      alert('Belum ada data guru untuk diunduh.')
      return
    }

    const headers = ['Nama Lengkap', 'NIP', 'Email Login', 'Password Akses']
    
    const rows = daftarGuru.map(g => [
      `"${g.nama.replace(/"/g, '""')}"`,
      `"${(g.nip || '-').replace(/"/g, '""')}"`,
      `"${g.email_abs}"`,
      `"${g.password_abs}"`
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(e => e.join(','))
    ].join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Data_Kredensial_Guru_${namaInduk.replace(/[^a-z0-9]/gi, '_')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Halaman Distribusi Data Guru...</div>

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 font-opensans">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="h-20 flex flex-col justify-center px-6 border-b border-slate-200 bg-[#F7ECFA]/40">
             <div className="flex items-center gap-3">
                {logoInduk ? (
                  <img src={logoInduk} alt="Logo Utama" className="w-8 h-8 object-contain shrink-0" />
                ) : (
                  <Landmark className="w-6 h-6 text-[#6A197D] shrink-0" />
                )}
                <h2 className="text-xs font-baloo font-black text-[#22072B] uppercase tracking-widest truncate">{namaInduk}</h2>
             </div>
          </div>
          
          <nav className="p-4 space-y-1">
            <Link href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <ArrowLeft className="w-4 h-4" /> Kembali ke Dasbor
            </Link>
            
            <div className="pt-2 pb-1 px-4 text-[9px] font-baloo font-black text-slate-400 uppercase tracking-widest">Sub-menu Folder Peran</div>
            <Link href="/peran" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <Users className="w-4 h-4" /> Pembagian Peran
            </Link>
            <Link href="/peran/mapel" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <BookOpen className="w-4 h-4" /> Kelola Mata Pelajaran
            </Link>
            <Link href="/peran/guru" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <UserPlus className="w-4 h-4" /> Kelola Data Guru
            </Link>
            
            <div className="pt-4 pb-1 px-4 text-[9px] font-baloo font-black text-slate-400 uppercase tracking-widest">Pusat Distribusi Akun</div>
            <Link href="/peran/guru/unduh" className="flex items-center gap-3 px-4 py-3 text-sm font-baloo font-bold text-[#6A197D] bg-[#FFDE59] rounded-xl shadow-md shadow-[#FFF6D1]">
               <Download className="w-4 h-4" /> Unduh Kredensial Guru
            </Link>
          </nav>
        </div>
        
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => { supabase.auth.signOut(); router.push('/') }} className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-baloo font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition">
            <LogOut className="w-4 h-4" /> Keluar Sistem
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto space-y-6">
        <header className="flex justify-between items-start flex-wrap gap-4">
           <div className="space-y-1.5">
              <h1 className="text-2xl font-baloo font-black text-slate-900">Unduh Profil & Kredensial Akun Pendidik</h1>
              <p className="text-xs text-gray-500">Daftar akun guru beserta email login domain @abs.sch.id dan kata sandi NPSN institusi siap didistribusikan secara massal.</p>
           </div>
           <button onClick={handleUnduhCsv} className="flex items-center gap-2 bg-[#FFDE59] hover:bg-[#E6C850] text-[#6A197D] font-baloo font-extrabold px-5 py-3 rounded-xl shadow-sm text-xs transition">
              <Download className="w-4 h-4" /> Unduh Data Guru (.CSV)
           </button>
        </header>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
           <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                 <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-baloo font-black text-slate-400 uppercase tracking-wider">
                       <th className="py-4 px-6">No</th>
                       <th className="py-4 px-6">Nama Lengkap Guru</th>
                       <th className="py-4 px-6">NIP</th>
                       <th className="py-4 px-6">Email Login Sistem</th>
                       <th className="py-4 px-6 font-mono">Kata Sandi (NPSN)</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {daftarGuru.map((item, index) => (
                      <tr key={item.id} className="hover:bg-slate-50/60 transition">
                         <td className="py-3.5 px-6">{index + 1}</td>
                         <td className="py-3.5 px-6 font-baloo font-bold text-slate-900">{item.nama}</td>
                         <td className="py-3.5 px-6 font-mono text-slate-500">{item.nip || '-'}</td>
                         <td className="py-3.5 px-6 font-mono text-[#57146A] select-all font-semibold tracking-wide">{item.email_abs}</td>
                         <td className="py-3.5 px-6 font-mono font-baloo font-black text-[#440F55] select-all tracking-widest">{item.password_abs}</td>
                      </tr>
                    ))}
                    {daftarGuru.length === 0 && (
                      <tr>
                         <td colSpan={5} className="py-16 text-center text-slate-400 font-semibold text-sm">Belum ada data pendidik yang terdaftar pada sistem database.</td>
                      </tr>
                    )}
                 </tbody>
              </table>
           </div>
        </section>

        <div className="bg-[#FFFBEA] border border-[#FFEDA3] rounded-xl p-4 text-[10px] font-baloo font-bold text-[#440F55] leading-relaxed max-w-2xl tracking-wide">
           <strong className="block uppercase tracking-wider mb-0.5 text-[9px]">Catatan Distribusi Akun Login:</strong>
           Pastikan untuk menginformasikan kepada para guru bahwa kata sandi seragam menggunakan Nomor Pokok Sekolah Nasional (NPSN/Nomor Statistik) sekolah induk yang berlaku.
        </div>
      </main>
    </div>
  )
}