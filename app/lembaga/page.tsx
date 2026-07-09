'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { 
  Building, Landmark, Save, ArrowLeft, LogOut
} from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import { useAksesGuard } from '@/lib/useAksesGuard'

export default function IdentitasLembagaPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('lembaga')
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  
  // State Identitas Lembaga Yayasan Induk (Pusat) - Input manual nama Mudir dihilangkan
  const [identitasInduk, setIdentitasInduk] = useState({
    nama: 'Lembaga / Yayasan Pusat', npsn: '', alamat: '', logo_utama: '', logo: '', kop: ''
  })
  
  // Master Unit Lembaga Cabang
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [cabangDipilih, setCabangDipilih] = useState<any>(null)
  const [npsnCabang, setNpsnCabang] = useState('')
  const [alamatCabang, setAlamatCabang] = useState('')
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
            alamat: parsed.alamat || '',
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
      ...item, npsn: npsnCabang || '', alamat: alamatCabang || '', logo: logoCabang || '', kop: kopCabang || ''
    } : item)

    setDaftarLembaga(updated)
    localStorage.setItem('daftar_lembaga', JSON.stringify(updated))
    alert(`Arsip identitas unit cabang ${cabangDipilih.nama} beserta NPSN berhasil diperbarui!`)
  }

  const handlePilihCabang = (id: string) => {
    const found = daftarLembaga.find(u => u.id === id)
    setCabangDipilih(found || null)
    setNpsnCabang(found?.npsn || '')
    setAlamatCabang(found?.alamat || '')
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

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Arsip Identitas...</div>
  if (diizinkanAkses === false) return null

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800 font-opensans">
      <Sidebar />

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

             <div>
                <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Alamat Lembaga Pusat</label>
                <textarea rows={2} placeholder="Cth: Jl. Contoh No. 1, Kecamatan, Kota" value={identitasInduk.alamat || ''} onChange={e => setIdentitasInduk({...identitasInduk, alamat: e.target.value})} className="w-full px-4 py-2.5 border rounded-xl text-sm font-medium bg-slate-50 outline-none focus:ring-2 focus:ring-[#8A3499] focus:bg-white resize-none" />
                <p className="text-[9px] text-slate-400 mt-1">Dipakai otomatis untuk kop dokumen cetak (Kaldik, Prota-Promes, dll) selama alamat unit di bawah belum diisi.</p>
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

                    <div>
                       <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Alamat Unit Cabang</label>
                       <textarea rows={2} placeholder="Kosongkan untuk memakai alamat Lembaga Pusat" value={alamatCabang || ''} onChange={e => setAlamatCabang(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499] resize-none" />
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