'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../supabase'
import { 
  Home, CalendarDays, Layers, BookOpen, LogOut,
  Building, FileText, Clock, BarChart2, FileSpreadsheet, Edit2,
  Shield, Landmark, Plus, Trash2, Save
} from 'lucide-react'

export default function DashboardPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  
  // State Tambahan untuk Identifikasi Guru
  const [isGuru, setIsGuru] = useState(false)
  const [namaGuru, setNamaGuru] = useState('')

  // State Identitas Lembaga Pusat - Fleksibel sebagai Form Isian
  const [logoUtama, setLogoUtama] = useState('')
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  
  // Master Tahun Ajaran 
  const [daftarTa, setDaftarTa] = useState<any[]>([])
  const [namaTa, setNamaTa] = useState('')
  const [editTaId, setEditTaId] = useState<string | null>(null)

  // Master Unit Lembaga (Cabang)
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [namaLembaga, setNamaLembaga] = useState('')
  const [editLembagaId, setEditLembagaId] = useState<string | null>(null)

  // Master Tingkat Kelas
  const [daftarTingkat, setDaftarTingkat] = useState<any[]>([])
  const [namaTingkat, setNamaTingkat] = useState('')
  const [lembagaIdTingkat, setLembagaIdTingkat] = useState('')
  const [editTingkatId, setEditTingkatId] = useState<string | null>(null)

  // Rombel Turunan
  const [daftarRombel, setDaftarRombel] = useState<any[]>([])
  const [namaRombel, setNamaRombel] = useState('')
  const [tingkatIdRombel, setTingkatIdRombel] = useState('')
  const [editRombelId, setEditRombelId] = useState<string | null>(null)

  const router = useRouter()

  useEffect(() => {
    async function checkUser() {
      // 1. CEK SESI GURU LOKAL TERLEBIH DAHULU
      const sesiGuruLokal = localStorage.getItem('sesi_guru_login')
      let isGuruLogin = false

      if (sesiGuruLokal) {
        try {
          const parsedGuru = JSON.parse(sesiGuruLokal)
          setNamaGuru(parsedGuru.nama || 'Pendidik')
          setIsGuru(true)
          setUserEmail(parsedGuru.email || 'Guru')
          isGuruLogin = true
        } catch (e) {
          console.error("Gagal membaca sesi guru")
        }
      }

      // 2. JIKA BUKAN GURU, CEK SESI ADMIN DI SUPABASE
      if (!isGuruLogin) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/')
          return // Hentikan eksekusi jika tidak ada sesi sama sekali
        } else {
          setUserEmail(session.user.email || 'Admin')
          setIsGuru(false)
        }
      }

      // 3. MUAT DATA MASTER (Tetap dijalankan agar fitur dasbor dasar tidak error)
      const storedInduk = localStorage.getItem('identitas_induk')
      if (storedInduk) {
        const parsed = JSON.parse(storedInduk)
        setNamaInduk(parsed.nama || 'Lembaga / Yayasan Pusat')
        setLogoUtama(parsed.logo_utama || parsed.logo || '')
      }

      const storedTa = localStorage.getItem('master_tahun_ajaran')
      if (storedTa) {
         setDaftarTa(JSON.parse(storedTa))
      } else {
        const defaultTa = [{ id: 'ta-' + Date.now(), nama: '2026/2027', aktif: true }]
        setDaftarTa(defaultTa)
        localStorage.setItem('master_tahun_ajaran', JSON.stringify(defaultTa))
      }

      const storedLembaga = localStorage.getItem('daftar_lembaga')
      if (storedLembaga) setDaftarLembaga(JSON.parse(storedLembaga))

      const storedTingkat = localStorage.getItem('master_tingkat')
      if (storedTingkat) setDaftarTingkat(JSON.parse(storedTingkat))

      const storedRombel = localStorage.getItem('master_rombel')
      if (storedRombel) setDaftarRombel(JSON.parse(storedRombel))

      setLoading(false)
    }
    checkUser()
  }, [router])

  const tahunAjaranAktif = daftarTa.find(ta => ta.aktif)?.nama || 'Belum Diatur'

  // --- FORM UBAH NAMA LEMBAGA PUSAT ---
  const handleSimpanNamaInduk = (e: React.FormEvent) => {
     e.preventDefault()
     if (!namaInduk.trim()) return
     
     const storedInduk = localStorage.getItem('identitas_induk')
     const parsed = storedInduk ? JSON.parse(storedInduk) : {}
     
     const updated = { ...parsed, nama: namaInduk }
     localStorage.setItem('identitas_induk', JSON.stringify(updated))
     alert('Nama Lembaga / Yayasan Pusat berhasil diperbarui!')
  }

  // --- CRUD TAHUN AJARAN ---
  const handleSimpanTa = (e: React.FormEvent) => {
    e.preventDefault()
    if (!namaTa.trim()) return

    let updatedTa = [...daftarTa]
    const newTaList = updatedTa.map(item => ({ ...item, aktif: false }))

    if (editTaId) {
      const index = newTaList.findIndex(item => item.id === editTaId)
      if (index !== -1) {
        newTaList[index] = { ...newTaList[index], nama: namaTa, aktif: true }
      }
      setEditTaId(null)
    } else {
      newTaList.push({ id: 'ta-' + Date.now(), nama: namaTa, aktif: true })
    }

    setDaftarTa(newTaList)
    localStorage.setItem('master_tahun_ajaran', JSON.stringify(newTaList))
    setNamaTa('')
  }

  const handleEditTaClick = (item: any) => {
    setEditTaId(item.id)
    setNamaTa(item.nama)
  }

  const handleSetAktifTa = (id: string) => {
    const updated = daftarTa.map(item => ({ ...item, aktif: item.id === id }))
    setDaftarTa(updated)
    localStorage.setItem('master_tahun_ajaran', JSON.stringify(updated))
  }

  const handleHapusTa = (id: string) => {
    if (confirm('Hapus data tahun ajaran ini? Semua log administrasi terkait periode ini akan ikut terpengaruh.')) {
      const filtered = daftarTa.filter(item => item.id !== id)
      if (filtered.length > 0 && !filtered.some(item => item.aktif)) {
         filtered[0].aktif = true
      }
      setDaftarTa(filtered)
      localStorage.setItem('master_tahun_ajaran', JSON.stringify(filtered))
    }
  }

  // --- CRUD LEMBAGA UNIT ---
  const handleSimpanLembaga = (e: React.FormEvent) => {
    e.preventDefault()
    if (editLembagaId) {
      const updated = daftarLembaga.map(item => item.id === editLembagaId ? { ...item, nama: namaLembaga } : item)
      setDaftarLembaga(updated); localStorage.setItem('daftar_lembaga', JSON.stringify(updated)); setEditLembagaId(null)
    } else {
      const updated = [...daftarLembaga, { id: 'unit-' + Date.now(), nama: namaLembaga, kepsek: '', logo: '', kop: '' }]
      setDaftarLembaga(updated); localStorage.setItem('daftar_lembaga', JSON.stringify(updated))
    }
    setNamaLembaga('')
  }
  const handleEditLembagaClick = (item: any) => { setEditLembagaId(item.id); setNamaLembaga(item.nama) }
  const handleHapusLembaga = (id: string) => {
    if (confirm('Hapus unit ini?')) { const filtered = daftarLembaga.filter(item => item.id !== id); setDaftarLembaga(filtered); localStorage.setItem('daftar_lembaga', JSON.stringify(filtered)) }
  }

  // --- CRUD TINGKAT ---
  const handleSimpanTingkat = (e: React.FormEvent) => {
    e.preventDefault()
    if (editTingkatId) {
      const updated = daftarTingkat.map(item => item.id === editTingkatId ? { ...item, nama: namaTingkat, lembagaId: lembagaIdTingkat } : item)
      setDaftarTingkat(updated); localStorage.setItem('master_tingkat', JSON.stringify(updated)); setEditTingkatId(null)
    } else {
      const updated = [...daftarTingkat, { id: 'lvl-' + Date.now(), nama: namaTingkat, lembagaId: lembagaIdTingkat }]
      setDaftarTingkat(updated); localStorage.setItem('master_tingkat', JSON.stringify(updated))
    }
    setNamaTingkat('')
  }
  const handleHapusTingkat = (id: string) => {
    if (confirm('Hapus tingkat ini?')) { const filtered = daftarTingkat.filter(item => item.id !== id); setDaftarTingkat(filtered); localStorage.setItem('master_tingkat', JSON.stringify(filtered)) }
  }

  // --- CRUD ROMBEL ---
  const handleSimpanRombel = (e: React.FormEvent) => {
    e.preventDefault()
    if (editRombelId) {
      const updated = daftarRombel.map(item => item.id === editRombelId ? { ...item, nama: namaRombel, tingkatId: tingkatIdRombel } : item)
      setDaftarRombel(updated); localStorage.setItem('master_rombel', JSON.stringify(updated)); setEditRombelId(null)
    } else {
      const updated = [...daftarRombel, { id: 'rombel-' + Date.now(), nama: namaRombel, tingkatId: tingkatIdRombel }]
      setDaftarRombel(updated); localStorage.setItem('master_rombel', JSON.stringify(updated))
    }
    setNamaRombel('')
  }
  const handleHapusRombel = (id: string) => {
    if (confirm('Hapus rombongan belajar ini?')) { const filtered = daftarRombel.filter(item => item.id !== id); setDaftarRombel(filtered); localStorage.setItem('master_rombel', JSON.stringify(filtered)) }
  }

  // --- PENYESUAIAN FUNGSI KELUAR (LOGOUT) ---
  const handleLogout = async () => { 
    if (isGuru) {
      localStorage.removeItem('sesi_guru_login')
      router.push('/')
    } else {
      await supabase.auth.signOut()
      router.push('/')
    }
  }

  if (loading) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Sistem Dasbor...</div>

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 font-opensans">
      
      {/* SIDEBAR NAVIGASI STICKY */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="h-20 flex flex-col justify-center px-6 border-b border-slate-200 bg-[#F7ECFA]/40">
             <div className="flex items-center gap-3">
                {logoUtama ? (
                  <img src={logoUtama} alt="Logo Utama" className="w-8 h-8 object-contain shrink-0" />
                ) : (
                  <Landmark className="w-6 h-6 text-[#6A197D] shrink-0" />
                )}
                <h2 className="text-xs font-baloo font-black text-[#22072B] uppercase tracking-widest truncate">{namaInduk}</h2>
             </div>
          </div>
          
          <nav className="p-4 space-y-1">
            <Link href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-baloo font-bold text-white bg-[#6A197D] rounded-xl shadow-md shadow-[#DEB3EA]">
              <Home className="w-4 h-4" /> Beranda Dasbor
            </Link>
            <Link href="/lembaga" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <Building className="w-4 h-4" /> Identitas Lembaga
            </Link>
            <Link href="/peran" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <Shield className="w-4 h-4" /> Pembagian Peran & Guru
            </Link>
            
            <div className="pt-6 pb-2 px-4 text-[10px] font-baloo font-black text-slate-400 uppercase tracking-widest">Modul Administrasi</div>
            <Link href="/kaldik" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <CalendarDays className="w-4 h-4" /> Kalender Pendidikan
            </Link>
            <Link href="/jadwal" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <Clock className="w-4 h-4" /> Jadwal Pelajaran
            </Link>
            <Link href="/minggu-efektif" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <BarChart2 className="w-4 h-4" /> Minggu Efektif
            </Link>
            <Link href="/cp-tp-atp" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <FileText className="w-4 h-4" /> CP, TP & ATP
            </Link>
            <Link href="/prota-promes" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <FileSpreadsheet className="w-4 h-4" /> Prota & Promes
            </Link>
            <Link href="/rpp" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <BookOpen className="w-4 h-4" /> RPP / Modul Ajar
            </Link>
          </nav>
        </div>
        
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="mb-4 px-2">
            <p className="text-[10px] text-slate-500 font-baloo font-bold uppercase">Tahun Ajaran Aktif</p>
            <p className="text-sm font-baloo font-black text-[#330B40]">{tahunAjaranAktif}</p>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-baloo font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition">
            <LogOut className="w-4 h-4" /> Keluar Sistem
          </button>
        </div>
      </aside>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-8">
        
        {/* Header Menampilkan Form Input Nama Lembaga Pusat & Tahun Ajaran Aktif */}
        <header className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm items-center">
           <div className="flex items-center gap-4 md:col-span-3">
              {logoUtama && <img src={logoUtama} alt="Logo" className="w-16 h-16 object-contain p-1 border rounded-xl bg-slate-50 shrink-0" />}
              
              {/* Notifikasi Welcome Khusus Guru atau Tampilan Admin Asli */}
              {isGuru ? (
                 <div className="w-full">
                   <p className="text-[10px] font-baloo font-extrabold text-[#6A197D] uppercase tracking-widest block">Akses Kontributor</p>
                   <h2 className="text-lg font-baloo font-black text-slate-800">Selamat datang kembali, {namaGuru}</h2>
                   <p className="text-[10px] text-slate-500 font-medium">Anda dapat menggunakan modul di sebelah kiri untuk melengkapi data ajar.</p>
                 </div>
              ) : (
                 <form onSubmit={handleSimpanNamaInduk} className="w-full space-y-1.5">
                   <p className="text-[9px] font-baloo font-extrabold text-[#6A197D] uppercase tracking-widest block">Input Label Lembaga Yayasan Induk (Pusat)</p>
                   <div className="flex gap-2">
                      <input 
                         type="text" 
                         value={namaInduk} 
                         onChange={e => setNamaInduk(e.target.value)} 
                         className="px-4 py-2 border rounded-xl text-sm font-baloo font-black text-slate-900 outline-none focus:ring-2 focus:ring-[#8A3499] w-full max-w-md" 
                         required 
                      />
                      <button type="submit" className="px-4 bg-[#F7ECFA] text-[#57146A] rounded-xl hover:bg-[#EFD9F5] border border-[#EFD9F5] transition flex items-center justify-center">
                         <Save className="w-4 h-4" />
                      </button>
                   </div>
                   <p className="text-[10px] text-slate-400 font-medium">Ubah dan simpan label lembaga pusat secara fleksibel sesuai instansi terkait.</p>
                </form>
              )}
           </div>
           
           <div className="bg-[#F7ECFA]/40 border border-[#EFD9F5]/60 p-4 rounded-xl text-center shrink-0 w-full">
              <p className="text-[9px] font-baloo font-black text-[#57146A] uppercase tracking-wider">Tahun Ajaran Aktif Saat Ini</p>
              <p className="text-base font-baloo font-extrabold text-[#22072B] mt-1">{tahunAjaranAktif}</p>
           </div>
        </header>

        {/* --- KARTU PINTASAN MODUL --- */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: BarChart2, title: 'Analisis Minggu Efektif', desc: 'Hitung hari belajar efektif', link: '/minggu-efektif' },
            { icon: FileText, title: 'CP, TP & ATP', desc: 'Pemetaan capaian belajar', link: '/cp-tp-atp' },
            { icon: FileSpreadsheet, title: 'Prota & Promes', desc: 'Rencana kerja tahunan & semester', link: '/prota-promes' },
            { icon: BookOpen, title: 'RPP / Modul Ajar', desc: 'Perangkat ajar guru', link: '/rpp' },
            { icon: Clock, title: 'Jadwal Pelajaran', desc: 'Manajemen jam & mapel kelas', link: '/jadwal' },
          ].map((m, i) => (
            <Link key={i} href={m.link} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-[#C98DDE] transition-all cursor-pointer group flex items-start gap-4 text-slate-800 no-underline">
              <div className="w-10 h-10 bg-[#F7ECFA] text-[#6A197D] rounded-xl flex items-center justify-center shrink-0 group-hover:bg-[#6A197D] group-hover:text-white transition-colors">
                <m.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-baloo font-bold text-slate-800 text-sm">{m.title}</h3>
                <p className="text-[11px] text-slate-500 mt-1">{m.desc}</p>
              </div>
            </Link>
          ))}
        </section>

        {/* --- MASTER TAHUN AJARAN --- */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
            <CalendarDays className="w-5 h-5 text-[#6A197D]" />
            <h2 className="font-baloo font-bold text-slate-800">Master Manajemen Tahun Ajaran</h2>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-5">
             <form onSubmit={handleSimpanTa} className="p-6 space-y-4 xl:col-span-3 border-r border-slate-100">
                <div>
                   <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Periode / Tahun Ajaran</label>
                   <input type="text" placeholder="Contoh: 2026/2027 atau 2027/2028" value={namaTa} onChange={e => setNamaTa(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" required={!isGuru} disabled={isGuru} />
                </div>
                <p className="text-[9px] font-semibold text-slate-400 leading-relaxed">Menambahkan atau menyimpan tahun ajaran akan otomatis menjadikannya sebagai periode aktif yang berlaku pada sistem administrasi.</p>
                {!isGuru && (
                  <div className="flex gap-2 pt-2">
                     <button type="submit" className="flex-1 bg-[#6A197D] text-white py-3 rounded-xl font-baloo font-bold shadow-md hover:bg-[#57146A] transition">
                        {editTaId ? 'Simpan Perubahan' : '+ Tambah Tahun Ajaran'}
                     </button>
                     {editTaId && <button type="button" onClick={() => { setEditTaId(null); setNamaTa('') }} className="px-5 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600">Batal</button>}
                  </div>
                )}
             </form>
             
             <div className="p-6 bg-slate-50/50 xl:col-span-2 max-h-[250px] overflow-y-auto">
                <label className="text-[10px] font-baloo font-black text-slate-400 uppercase tracking-widest block mb-4">Arsip Periode Tahun Ajaran</label>
                <div className="space-y-2">
                   {daftarTa.map(item => (
                     <div key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                        <div>
                           <p className="font-baloo font-black text-sm text-slate-800">{item.nama}</p>
                           {item.aktif ? (
                             <span className="text-[9px] font-baloo font-extrabold text-[#57146A] bg-[#FFFBEA] border border-[#FFF6D1] px-2 py-0.5 rounded-full mt-1 inline-block">Sedang Berlaku / Aktif</span>
                           ) : (
                             <span className="text-[9px] font-baloo font-extrabold text-slate-500 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full mt-1 inline-block">Arsip Waktu Lalu</span>
                           )}
                        </div>
                        {!isGuru && (
                          <div className="flex items-center gap-1">
                             {!item.aktif && <button onClick={() => handleSetAktifTa(item.id)} className="text-[9px] font-baloo font-bold px-2.5 py-1.5 bg-[#F7ECFA] text-[#57146A] hover:bg-[#EFD9F5] rounded-lg transition mr-1">Gunakan</button>}
                             <button onClick={() => handleEditTaClick(item)} className="p-1.5 text-slate-400 hover:text-[#6A197D] rounded-lg border border-slate-100 bg-white"><Edit2 className="w-3.5 h-3.5" /></button>
                             <button onClick={() => handleHapusTa(item.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg border border-slate-100 bg-white"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                     </div>
                   ))}
                </div>
             </div>
          </div>
        </section>

        {/* --- MASTER UNIT CABANG --- */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
            <Building className="w-5 h-5 text-[#6A197D]" />
            <h2 className="font-baloo font-bold text-slate-800">Master Unit Lembaga Cabang</h2>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-5">
            <form onSubmit={handleSimpanLembaga} className="p-6 space-y-5 xl:col-span-3 border-r border-slate-100">
              <div>
                <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nama Unit Cabang Lembaga</label>
                <input type="text" placeholder="Contoh: SMP ABS, SMA ABS" value={namaLembaga} onChange={(e) => setNamaLembaga(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-[#8A3499] outline-none" required={!isGuru} disabled={isGuru} />
              </div>
              {!isGuru && (
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="flex-1 bg-[#6A197D] hover:bg-[#57146A] text-white py-3 rounded-xl font-baloo font-bold transition-all shadow-md">
                    {editLembagaId ? 'Simpan Perubahan Unit Cabang' : 'Tambah Unit Cabang'}
                  </button>
                  {editLembagaId && (
                    <button type="button" onClick={() => { setEditLembagaId(null); setNamaLembaga(''); }} className="px-6 py-3 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600 hover:bg-slate-200">Batal</button>
                  )}
                </div>
              )}
            </form>
            <div className="p-6 bg-slate-50/50 xl:col-span-2">
              <label className="text-[10px] font-baloo font-black text-slate-400 uppercase tracking-widest block mb-4">Daftar Unit Cabang</label>
              <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                {daftarLembaga.map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center group">
                    <div>
                       <p className="text-sm font-baloo font-bold text-slate-800">{item.nama}</p>
                    </div>
                    {!isGuru && (
                      <div className="flex gap-1.5">
                        <button onClick={() => handleEditLembagaClick(item)} className="p-1.5 text-slate-400 hover:text-[#6A197D] bg-slate-50 hover:bg-[#F7ECFA] rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleHapusLembaga(item.id)} className="p-1.5 text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* --- HIERARKI KELAS --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
              <Layers className="w-5 h-5 text-[#6A197D]" />
              <h2 className="font-baloo font-bold text-slate-800">Master Tingkat Kelas</h2>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <form onSubmit={handleSimpanTingkat} className="space-y-4 mb-6">
                <select value={lembagaIdTingkat} onChange={(e) => setLembagaIdTingkat(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm font-medium bg-white outline-none focus:ring-2 focus:ring-[#8A3499]" required={!isGuru} disabled={isGuru}>
                  <option value="">-- Pilih Unit Lembaga Cabang --</option>
                  {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
                </select>
                <input type="text" placeholder="Contoh: Kelas 7 atau Fase D" value={namaTingkat} onChange={(e) => setNamaTingkat(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" required={!isGuru} disabled={isGuru} />
                {!isGuru && (
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-[#6A197D] text-white py-2.5 rounded-xl font-baloo font-bold shadow-md hover:bg-[#57146A]">
                      {editTingkatId ? 'Update Tingkat' : 'Tambah Tingkat'}
                    </button>
                    {editTingkatId && <button type="button" onClick={() => { setEditTingkatId(null); setNamaTingkat('') }} className="px-5 py-2.5 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600">Batal</button>}
                  </div>
                )}
              </form>
              <div className="flex-1 bg-slate-50/50 rounded-xl border p-4 max-h-[250px] overflow-y-auto space-y-2">
                {daftarTingkat.map(item => (
                  <div key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <p className="font-baloo font-bold text-sm text-slate-800">{item.nama}</p>
                      <p className="text-[10px] font-baloo font-bold text-[#6A197D] mt-0.5">{daftarLembaga.find(u => u.id === item.lembagaId)?.nama}</p>
                    </div>
                    {!isGuru && (
                      <div className="flex gap-1.5">
                        <button onClick={() => { setEditTingkatId(item.id); setNamaTingkat(item.nama); setLembagaIdTingkat(item.lembagaId) }} className="p-1.5 text-slate-400 hover:text-[#6A197D] bg-slate-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleHapusTingkat(item.id)} className="p-1.5 text-slate-400 hover:text-red-600 bg-slate-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-[#6A197D]" />
              <h2 className="font-baloo font-bold text-slate-800">Master Rombel (Kelas Spesifik)</h2>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <form onSubmit={handleSimpanRombel} className="space-y-4 mb-6">
                <select value={tingkatIdRombel} onChange={(e) => setTingkatIdRombel(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm font-medium bg-white outline-none focus:ring-2 focus:ring-[#8A3499]" required={!isGuru} disabled={isGuru}>
                  <option value="">-- Pilih Tingkat Induk --</option>
                  {daftarTingkat.map(t => <option key={t.id} value={t.id}>{t.nama} ({daftarLembaga.find(u => u.id === t.lembagaId)?.nama})</option>)}
                </select>
                <input type="text" placeholder="Contoh: 7A atau X IPA 1" value={namaRombel} onChange={(e) => setNamaRombel(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" required={!isGuru} disabled={isGuru} />
                {!isGuru && (
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-[#6A197D] text-white py-2.5 rounded-xl font-baloo font-bold shadow-md hover:bg-[#57146A]">
                      {editRombelId ? 'Update Rombel' : 'Tambah Rombel'}
                    </button>
                    {editRombelId && <button type="button" onClick={() => { setEditRombelId(null); setNamaRombel('') }} className="px-5 py-2.5 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600">Batal</button>}
                  </div>
                )}
              </form>
              <div className="flex-1 bg-slate-50/50 rounded-xl border p-4 max-h-[250px] overflow-y-auto space-y-2">
                {daftarRombel.map(item => (
                  <div key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <p className="font-baloo font-bold text-sm text-slate-800">Rombel: {item.nama}</p>
                      <p className="text-[10px] font-medium text-slate-500 mt-0.5">Tingkat: {daftarTingkat.find(t => t.id === item.tingkatId)?.nama}</p>
                    </div>
                    {!isGuru && (
                      <div className="flex gap-1.5">
                        <button onClick={() => { setEditRombelId(item.id); setNamaRombel(item.nama); setTingkatIdRombel(item.tingkatId) }} className="p-1.5 text-slate-400 hover:text-[#6A197D] bg-slate-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleHapusRombel(item.id)} className="p-1.5 text-slate-400 hover:text-red-500 bg-slate-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}