'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { 
  Building, Landmark, Save, ArrowLeft, LogOut
} from 'lucide-react'
import Sidebar from '@/components/Sidebar'

export default function IdentitasLembagaPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  
  // State Identitas Lembaga Yayasan Induk (Pusat) - Input manual nama Mudir dihilangkan
  const [identitasInduk, setIdentitasInduk] = useState({
    nama: 'Lembaga / Yayasan Pusat', npsn: '', logo_utama: '', logo: '', kop: ''
  })
  
  // Master Unit Lembaga Cabang
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [cabangDipilih, setCabangDipilih] = useState<any>(null)
  const [npsnCabang, setNpsnCabang] = useState('')
  const [logoCabang, setLogoCabang] = useState('')
  const [kopCabang, setKopCabang] = useState('')

  // State Referensi Guru & Peran
  const [daftarGuru, setDaftarGuru] = useState<any[]>([])
  const [daftarPeran, setDaftarPeran] = useState<any[]>([])

  const router = useRouter()

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) router.push('/')
      else {
        setUserEmail(session.user.email || 'Admin')
        
        const storedInduk = localStorage.getItem('identitas_induk')
        if (storedInduk) {
          const parsed = JSON.parse(storedInduk)
          setIdentitasInduk({
            nama: parsed.nama || '',
            npsn: parsed.npsn || '',
            logo_utama: parsed.logo_utama || '',
            logo: parsed.logo || '',
            kop: parsed.kop || ''
          })
          setNamaInduk(parsed.nama || 'Lembaga / Yayasan Pusat')
        }

        const storedLembaga = localStorage.getItem('daftar_lembaga')
        if (storedLembaga) setDaftarLembaga(JSON.parse(storedLembaga))

        const storedGuru = localStorage.getItem('master_guru')
        if (storedGuru) setDaftarGuru(JSON.parse(storedGuru))

        const storedPeran = localStorage.getItem('master_peran')
        if (storedPeran) setDaftarPeran(JSON.parse(storedPeran))

        setLoading(false)
      }
    }
    checkAuth()
  }, [router])

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return null
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `img_${Date.now()}.${fileExt}`
      const { error } = await supabase.storage.from('assets').upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      })
      if (error) {
        console.error('Supabase upload error:', error)
        alert('Gagal upload: ' + error.message)
        return null
      }
      const { data } = supabase.storage.from('assets').getPublicUrl(fileName)
      return data.publicUrl
    } catch (err: any) {
      console.error('Unexpected upload error:', err)
      alert('Terjadi kesalahan saat upload: ' + (err?.message || String(err)))
      return null
    } finally {
      // reset agar file yang sama bisa dipilih ulang
      e.target.value = ''
    }
  }

  const handleSimpanIdentitasInduk = (e: React.FormEvent) => {
    e.preventDefault()
    localStorage.setItem('identitas_induk', JSON.stringify(identitasInduk))
    setNamaInduk(identitasInduk.nama)
    alert('Konfigurasi Identitas Lembaga Pusat beserta NPSN berhasil disimpan!')
  }

  const handleSimpanDetailCabang = (e: React.FormEvent) => {
    e.preventDefault()
    if (!cabangDipilih) return

    const updated = daftarLembaga.map(item => item.id === cabangDipilih.id ? {
      ...item, npsn: npsnCabang || '', logo: logoCabang || '', kop: kopCabang || ''
    } : item)

    setDaftarLembaga(updated)
    localStorage.setItem('daftar_lembaga', JSON.stringify(updated))
    alert(`Arsip identitas unit cabang ${cabangDipilih.nama} beserta NPSN berhasil diperbarui!`)
  }

  const handlePilihCabang = (id: string) => {
    const found = daftarLembaga.find(u => u.id === id)
    setCabangDipilih(found || null)
    setNpsnCabang(found?.npsn || '')
    setLogoCabang(found?.logo || '')
    setKopCabang(found?.kop || '')
  }

  // --- DETEKSI OTOMATIS: NAMA MUDIR PUSAT ---
  const getNamaMudirPusat = () => {
    const peranMudir = daftarPeran.find(
      p => p.nama.toLowerCase().includes('mudir') || p.nama.toLowerCase().includes('pimpinan yayasan')
    )
    if (!peranMudir) return 'Belum ada data Peran Mudir'

    // Deteksi guru yang bertugas di 'lembaga-induk' dan memegang peran Mudir
    const mudirPusat = daftarGuru.find(
      g => g.unitIds?.includes('lembaga-induk') && g.peranIds?.includes(peranMudir.id)
    )

    return mudirPusat ? mudirPusat.nama : 'Data Mudir belum diatur / ditugaskan di menu Kelola Data Guru'
  }

  // --- DETEKSI OTOMATIS: NAMA KEPALA SEKOLAH UNIT ---
  const getKepalaSekolahUnit = (unitId: string) => {
    const peranKepsek = daftarPeran.find(
      p => p.nama.toLowerCase().includes('kepala sekolah') || p.nama.toLowerCase().includes('pimpinan unit')
    )
    if (!peranKepsek) return 'Belum ada data Peran Kepala Sekolah'

    const kepsek = daftarGuru.find(
      g => g.unitIds?.includes(unitId) && g.peranIds?.includes(peranKepsek.id)
    )

    return kepsek ? kepsek.nama : 'Data Kepala Sekolah belum diatur di menu Kelola Data Guru'
  }

  if (loading) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Arsip Identitas...</div>

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 font-opensans">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="h-16 flex items-center px-6 border-b border-slate-200 bg-[#F7ECFA]/50">
            <Landmark className="w-6 h-6 text-[#6A197D] mr-3 shrink-0" />
            <h2 className="text-xs font-baloo font-black text-[#330B40] uppercase tracking-widest truncate max-w-[170px]">{namaInduk}</h2>
          </div>
          <nav className="p-4 space-y-1">
            <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <ArrowLeft className="w-4 h-4" /> Kembali ke Dasbor
            </a>
            <a href="/lembaga" className="flex items-center gap-3 px-4 py-3 text-sm font-baloo font-bold text-white bg-[#6A197D] rounded-xl shadow-md">
              <Building className="w-4 h-4" /> Identitas Lembaga
            </a>
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => { supabase.auth.signOut(); router.push('/') }} className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-baloo font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition">
            <LogOut className="w-4 h-4" /> Keluar Sistem
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto space-y-8">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-baloo font-black text-slate-900">Arsip Konfigurasi Identitas Lembaga</h1>
           <p className="text-xs text-gray-500">Pusat kelola data personal Mudir yayasan, Kepala Sekolah unit, nomor NPSN, kop surat instansi, dan penyertaan logo.</p>
        </header>

        {/* Identitas Yayasan Pusat (Otomatis Mudir) */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
             <Landmark className="w-5 h-5 text-[#6A197D]" />
             <h2 className="font-baloo font-bold text-slate-800">Identitas Lembaga Yayasan Induk (Pusat)</h2>
          </div>
          <form onSubmit={handleSimpanIdentitasInduk} className="p-6 space-y-5">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                   <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nama Yayasan / Lembaga Induk</label>
                   <input type="text" value={identitasInduk.nama || ''} onChange={e => setIdentitasInduk({...identitasInduk, nama: e.target.value})} className="w-full px-4 py-2.5 border rounded-xl text-sm font-medium bg-slate-50 outline-none focus:ring-2 focus:ring-[#8A3499] focus:bg-white" required />
                </div>
                <div>
                   <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nomor Pokok Sekolah Nasional (NPSN) Pusat</label>
                   <input type="text" placeholder="Masukkan Nomor NPSN Pusat" value={identitasInduk.npsn || ''} onChange={e => setIdentitasInduk({...identitasInduk, npsn: e.target.value})} className="w-full px-4 py-2.5 border rounded-xl text-sm font-medium bg-slate-50 outline-none focus:ring-2 focus:ring-[#8A3499] focus:bg-white" />
                </div>
             </div>
             
             {/* Blok Informasi Otomatis Mudir */}
             <div className="bg-[#FFFBEA]/40 p-4 rounded-xl border border-[#FFF6D1]/60 space-y-1">
                <p className="text-[9px] font-baloo font-black text-[#6A197D] uppercase tracking-widest">Otomatis Terdeteksi Pimpinan / Mudir Pusat:</p>
                <p className="text-sm font-baloo font-black text-slate-900">{getNamaMudirPusat()}</p>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-2 block">Logo Utama (Tampil di Dasbor)</label>
                  <input type="file" accept="image/*" onChange={async (e) => { const url = await handleUploadFile(e); if(url) setIdentitasInduk({...identitasInduk, logo_utama: url}) }} className="text-xs file:bg-[#F7ECFA] file:text-[#57146A] file:border-0 file:rounded-lg file:px-3 file:py-1.5" />
                  {identitasInduk.logo_utama && <img src={identitasInduk.logo_utama} alt="Logo Utama" className="h-10 mt-2 object-contain border p-1 rounded-lg bg-white" />}
                </div>
                <div>
                  <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-2 block">Logo Sekunder Yayasan</label>
                  <input type="file" accept="image/*" onChange={async (e) => { const url = await handleUploadFile(e); if(url) setIdentitasInduk({...identitasInduk, logo: url}) }} className="text-xs file:bg-[#F7ECFA] file:text-[#57146A] file:border-0 file:rounded-lg file:px-3 file:py-1.5" />
                  {identitasInduk.logo && <img src={identitasInduk.logo} alt="Logo" className="h-10 mt-2 object-contain border p-1 rounded-lg bg-white" />}
                </div>
                <div>
                  <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-2 block">Kop Surat Induk</label>
                  <input type="file" accept="image/*" onChange={async (e) => { const url = await handleUploadFile(e); if(url) setIdentitasInduk({...identitasInduk, kop: url}) }} className="text-xs file:bg-[#F7ECFA] file:text-[#57146A] file:border-0 file:rounded-lg file:px-3 file:py-1.5" />
                  {identitasInduk.kop && <img src={identitasInduk.kop} alt="Kop" className="h-10 mt-2 object-contain border p-1 rounded-lg bg-white" />}
                </div>
             </div>
             <button type="submit" className="w-full bg-[#6A197D] hover:bg-[#57146A] text-white py-3 rounded-xl font-baloo font-bold shadow-md transition-all flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Simpan Konfigurasi Pusat
             </button>
          </form>
        </section>

        {/* Identitas Unit Lembaga Cabang (Kepala Sekolah Deteksi Otomatis) */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
             <Building className="w-5 h-5 text-[#6A197D]" />
             <h2 className="font-baloo font-bold text-slate-800">Detail Identitas Unit Cabang</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="border border-slate-100 bg-slate-50/30 p-4 rounded-xl space-y-2 h-fit">
                <p className="text-xs font-baloo font-black text-slate-400 uppercase tracking-wider block mb-2">Pilih Unit Cabang</p>
                {daftarLembaga.map(u => (
                  <button 
                    key={u.id} 
                    onClick={() => handlePilihCabang(u.id)} 
                    className={`w-full text-left p-3 rounded-xl text-xs font-baloo font-bold border transition-all ${cabangDipilih?.id === u.id ? 'bg-[#F7ECFA] border-[#DEB3EA] text-[#440F55]' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
                  >
                     {u.nama}
                  </button>
                ))}
                {daftarLembaga.length === 0 && <p className="text-xs text-slate-400 py-3">Belum ada unit cabang.</p>}
             </div>
             
             <div className="md:col-span-2">
               {cabangDipilih ? (
                 <form onSubmit={handleSimpanDetailCabang} className="space-y-5">
                    <div className="bg-[#F7ECFA]/30 p-4 rounded-xl border border-[#F7ECFA] space-y-1">
                       <p className="text-[10px] text-[#57146A] font-baloo font-extrabold uppercase tracking-widest">Konfigurasi Unit Cabang:</p>
                       <p className="text-sm font-baloo font-black text-[#330B40]">{cabangDipilih.nama || ''}</p>
                       <div className="pt-2 border-t border-[#EFD9F5]/60 mt-2">
                          <p className="text-[9px] font-baloo font-bold text-slate-500 uppercase">Otomatis Terdeteksi Kepala Sekolah Unit:</p>
                          <p className="text-xs font-baloo font-black text-slate-800 mt-0.5">{getKepalaSekolahUnit(cabangDipilih.id)}</p>
                       </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                          <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nomor Pokok Sekolah Nasional (NPSN) Unit</label>
                          <input type="text" placeholder="Masukkan Nomor NPSN Unit Cabang" value={npsnCabang || ''} onChange={e => setNpsnCabang(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                          <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-2 block">Logo Cabang</label>
                          <input type="file" accept="image/*" onChange={async (e) => { const url = await handleUploadFile(e); if(url) setLogoCabang(url) }} className="text-xs file:bg-[#F7ECFA] file:text-[#57146A] file:border-0 file:rounded-lg file:px-3 file:py-1.5" />
                          {logoCabang && <img src={logoCabang} alt="Logo Cabang" className="h-10 mt-2 border p-0.5 rounded-lg object-contain bg-white" />}
                       </div>
                       <div>
                          <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-2 block">Kop Surat Resmi Cabang</label>
                          <input type="file" accept="image/*" onChange={async (e) => { const url = await handleUploadFile(e); if(url) setKopCabang(url) }} className="text-xs file:bg-[#F7ECFA] file:text-[#57146A] file:border-0 file:rounded-lg file:px-3 file:py-1.5" />
                          {kopCabang && <img src={kopCabang} alt="Kop Surat Cabang" className="h-10 mt-2 border p-0.5 rounded-lg object-contain bg-white" />}
                       </div>
                    </div>
                    <button type="submit" className="w-full bg-[#6A197D] hover:bg-[#57146A] text-white py-3 rounded-xl font-baloo font-bold shadow-md transition-all">
                       Simpan Perubahan Identitas Unit
                    </button>
                 </form>
               ) : (
                 <div className="h-full flex items-center justify-center border border-dashed rounded-xl p-8 text-center text-slate-400 font-medium text-xs">
                    Silakan klik salah satu tombol unit cabang di kolom sebelah kiri untuk menyunting kelengkapan unit (NPSN, Logo, dan Kop Surat cabang).
                 </div>
               )}
             </div>
          </div>
        </section>
      </main>
    </div>
  )
}