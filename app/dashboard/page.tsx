'use client'

import Sidebar from '@/components/Sidebar'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../supabase'
import {
  Home, CalendarDays, Layers, BookOpen, LogOut,
  Building, FileText, Clock, BarChart2, FileSpreadsheet, Edit2,
  Shield, Landmark, Plus, Trash2, Save, Copy
} from 'lucide-react'
import { salinDataTahunAjaran, daftarKunciDasarUntukTahun } from '@/lib/salinTahunAjaran'

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
  const [sumberSalinId, setSumberSalinId] = useState('')
  const [jumlahBagianSalinTersedia, setJumlahBagianSalinTersedia] = useState(0)

  // Master Unit Lembaga (Cabang)
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [namaLembaga, setNamaLembaga] = useState('')
  const [editLembagaId, setEditLembagaId] = useState<string | null>(null)

  // Master Tingkat Kelas
  const [daftarTingkat, setDaftarTingkat] = useState<any[]>([])
  const [namaTingkat, setNamaTingkat] = useState('')
  const [lembagaIdTingkat, setLembagaIdTingkat] = useState('')
  const [namaResmiTingkat, setNamaResmiTingkat] = useState('')
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

      // PENTING -- perbaikan akar masalah "data hilang di akun/perangkat baru":
      // lib/cloudSync.ts menarik data dari cloud secara ASINKRON di latar
      // belakang (lihat CloudSyncProvider, yang bahkan punya batas waktu 4
      // detik -- kalau koneksi lambat, halaman tetap dibuka walau tarikan data
      // belum selesai). Di sesi yang benar-benar baru (perangkat baru, akun
      // baru pertama kali login, atau cache baru saja dibersihkan) ini berarti
      // localStorage['master_tahun_ajaran'] BISA SAJA masih kosong tepat saat
      // baris ini dijalankan, PADAHAL datanya sudah ada di cloud (cuma belum
      // sempat sampai). Kode sebelumnya langsung menyimpulkan "kosong berarti
      // belum pernah diatur" lalu MEMBUAT tahun ajaran baru dengan ID BARU
      // (`'ta-' + Date.now()`) dan MENIMPA `master_tahun_ajaran` -- baik di
      // localStorage maupun di cloud (lewat penyadap localStorage.setItem di
      // cloudSync.ts). ID baru itu tidak pernah cocok dengan ID lama yang
      // dipakai untuk mengarsipkan seluruh data (lihat kunciTahun() di
      // lib/tahunAjaran.ts) -- akibatnya SEMUA data lama (Kaldik, Jadwal,
      // CP/TP/ATP, Prota/Promes, dst) yang sebenarnya masih ada, jadi terlihat
      // "hilang" karena kuncinya sudah tidak cocok lagi. Ini jugalah sebabnya
      // value 'master_tahun_ajaran' di Supabase seperti "berubah sendiri".
      //
      // Perbaikannya (memakai pola yang sama seperti sudah diterapkan di
      // app/jadwal/page.tsx): sebelum memutuskan apa pun, ambil dulu
      // 'master_tahun_ajaran' LANGSUNG dari Supabase di sini (tidak menunggu/
      // bergantung pada cloudSync yang mungkin belum selesai) -- baru kalau
      // ternyata cloud-nya SENDIRI juga betul-betul kosong (instalasi baru
      // sungguhan), baru buat default baru.
      let dariCloud: string | null = null
      try {
        const { data: rowTa } = await supabase
          .from('app_storage')
          .select('value')
          .eq('key', 'master_tahun_ajaran')
          .maybeSingle()
        const nilaiTa = (rowTa?.value as string | undefined) ?? undefined
        if (nilaiTa) {
          JSON.parse(nilaiTa) // validasi dulu -- jangan pakai kalau datanya rusak/bukan JSON valid
          dariCloud = nilaiTa
          localStorage.setItem('master_tahun_ajaran', nilaiTa)
        }
      } catch (e) {
        console.warn('Gagal memuat master_tahun_ajaran langsung dari cloud, memakai cache localStorage (jika ada):', e)
      }

      const storedTa = dariCloud || localStorage.getItem('master_tahun_ajaran')
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
  //
  // AKAR MASALAH "tahun ajaran tiba-tiba berubah otomatis": SEBELUMNYA, submit
  // form ini SELALU menjadikan entri yang disimpan sebagai periode AKTIF --
  // termasuk saat admin cuma MENGEDIT NAMA (mis. memperbaiki typo) pada
  // tahun ajaran ARSIP LAMA yang sedang tidak aktif. Akibatnya, memperbaiki
  // nama arsip lama diam-diam memindahkan seluruh sistem ke periode lama itu,
  // menutupi data tahun ajaran yang sedang berjalan (terlihat seperti "hilang").
  //
  // PERBAIKAN: mengedit nama SEKARANG TIDAK PERNAH mengubah status aktif --
  // hanya tombol "Gunakan" (handleSetAktifTa) yang boleh memindahkan periode
  // aktif. Menambah tahun ajaran BARU tetap otomatis mengaktifkannya (perilaku
  // ini sudah diberitahukan lewat teks di UI & memang wajar diharapkan saat
  // menambah periode baru).
  const handleSimpanTa = (e: React.FormEvent) => {
    e.preventDefault()
    if (!namaTa.trim()) return

    if (editTaId) {
      const updated = daftarTa.map(item => item.id === editTaId ? { ...item, nama: namaTa } : item)
      setDaftarTa(updated)
      localStorage.setItem('master_tahun_ajaran', JSON.stringify(updated))
      setEditTaId(null)
      setNamaTa('')
    } else {
      const namaBaru = namaTa
      const newTaList = daftarTa.map(item => ({ ...item, aktif: false }))
      newTaList.push({ id: 'ta-' + Date.now(), nama: namaBaru, aktif: true })
      setDaftarTa(newTaList)
      localStorage.setItem('master_tahun_ajaran', JSON.stringify(newTaList))
      setNamaTa('')
      // Periode aktif berubah -- muat ulang SEKARANG supaya perubahan ini
      // langsung & KONSISTEN berlaku di seluruh halaman (lihat lib/tahunAjaran.ts:
      // ID tahun ajaran dikunci sekali per sesi/tab begitu sinkronisasi awal
      // selesai, justru supaya data yang sedang aktif dikerjakan TIDAK diam-diam
      // pindah kunci di tengah sesi -- jadi mengganti periode aktif butuh muat
      // ulang untuk diterapkan, ini SENGAJA, bukan bug).
      alert(`Tahun ajaran aktif diubah ke "${namaBaru}". Halaman akan dimuat ulang untuk menerapkan perubahan ini di seluruh modul.`)
      window.location.reload()
    }
  }

  const handleEditTaClick = (item: any) => {
    setEditTaId(item.id)
    setNamaTa(item.nama)
  }

  const handleSetAktifTa = (id: string) => {
    const target = daftarTa.find(item => item.id === id)
    const updated = daftarTa.map(item => ({ ...item, aktif: item.id === id }))
    setDaftarTa(updated)
    localStorage.setItem('master_tahun_ajaran', JSON.stringify(updated))
    alert(`Tahun ajaran aktif diubah ke "${target?.nama || ''}". Halaman akan dimuat ulang untuk menerapkan perubahan ini di seluruh modul.`)
    window.location.reload()
  }

  const handleHapusTa = (id: string) => {
    if (confirm('Hapus data tahun ajaran ini? Semua log administrasi terkait periode ini akan ikut terpengaruh.')) {
      const dihapusAktif = daftarTa.find(item => item.id === id)?.aktif
      const filtered = daftarTa.filter(item => item.id !== id)
      if (filtered.length > 0 && !filtered.some(item => item.aktif)) {
         filtered[0].aktif = true
      }
      setDaftarTa(filtered)
      localStorage.setItem('master_tahun_ajaran', JSON.stringify(filtered))
      // Kalau yang dihapus BUKAN yang aktif, periode aktif tidak berubah -- tidak perlu reload.
      if (dihapusAktif && filtered.length > 0) {
        alert(`Tahun ajaran aktif diubah ke "${filtered[0].nama}" (periode aktif sebelumnya dihapus). Halaman akan dimuat ulang untuk menerapkan perubahan ini di seluruh modul.`)
        window.location.reload()
      }
    }
  }

  // --- SALIN DATA DARI TAHUN AJARAN LAIN (sebagai referensi, bukan pindah) ---
  // Dipakai kalau tahun ajaran yang sedang berjalan ingin memakai ulang isi
  // data tahun ajaran sebelumnya (mis. struktur CP/TP/ATP, jadwal, kaldik)
  // supaya tidak perlu mengetik ulang dari nol. SEPENUHNYA manual/opt-in, dan
  // TIDAK PERNAH menimpa data yang sudah ada di tahun ajaran tujuan (lihat
  // lib/salinTahunAjaran.ts) -- data tetap "diam di kamarnya masing-masing"
  // kecuali admin sendiri yang secara sadar memilih menyalinnya.
  const tahunAjaranAktifSaatIni = daftarTa.find(item => item.aktif)

  // Membaca localStorage HARUS di dalam efek, bukan langsung di JSX -- render
  // harus tetap murni (tidak boleh langsung membaca sumber data mutable).
  useEffect(() => {
    if (!sumberSalinId) { setJumlahBagianSalinTersedia(0); return }
    setJumlahBagianSalinTersedia(daftarKunciDasarUntukTahun(sumberSalinId).length)
  }, [sumberSalinId])

  const handleSalinData = () => {
    if (!sumberSalinId || !tahunAjaranAktifSaatIni) return
    const sumber = daftarTa.find(item => item.id === sumberSalinId)
    if (!sumber) return
    if (!confirm(`Salin data dari "${sumber.nama}" ke tahun ajaran aktif "${tahunAjaranAktifSaatIni.nama}"?\n\nHanya bagian yang MASIH KOSONG di "${tahunAjaranAktifSaatIni.nama}" yang akan diisi -- data yang sudah ada TIDAK akan ditimpa.`)) return
    const hasil = salinDataTahunAjaran(sumberSalinId, tahunAjaranAktifSaatIni.id)
    if (hasil.disalin.length === 0) {
      alert(hasil.dilewatiSudahAdaData.length > 0
        ? `Tidak ada yang disalin -- "${tahunAjaranAktifSaatIni.nama}" sudah punya data sendiri di semua bagian yang tersedia di "${sumber.nama}".`
        : `Tidak ada data untuk disalin dari "${sumber.nama}".`)
      return
    }
    alert(`Berhasil menyalin ${hasil.disalin.length} bagian data dari "${sumber.nama}" ke "${tahunAjaranAktifSaatIni.nama}". Halaman akan dimuat ulang supaya perubahan terlihat.`)
    window.location.reload()
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
      const updated = daftarTingkat.map(item => item.id === editTingkatId ? { ...item, nama: namaTingkat, lembagaId: lembagaIdTingkat, namaResmi: namaResmiTingkat.trim() } : item)
      setDaftarTingkat(updated); localStorage.setItem('master_tingkat', JSON.stringify(updated)); setEditTingkatId(null)
    } else {
      const updated = [...daftarTingkat, { id: 'lvl-' + Date.now(), nama: namaTingkat, lembagaId: lembagaIdTingkat, namaResmi: namaResmiTingkat.trim() }]
      setDaftarTingkat(updated); localStorage.setItem('master_tingkat', JSON.stringify(updated))
    }
    setNamaTingkat('')
    setNamaResmiTingkat('')
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
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800 font-opensans">
      
      {/* SIDEBAR NAVIGASI STICKY */}
      <Sidebar />

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
                <p className="text-[9px] font-semibold text-slate-400 leading-relaxed">Menambahkan tahun ajaran BARU akan otomatis menjadikannya periode aktif (halaman akan dimuat ulang). Mengedit nama tahun ajaran yang sudah ada TIDAK mengubah periode aktif -- gunakan tombol &quot;Gunakan&quot; di daftar arsip untuk berpindah periode.</p>
                {!isGuru && (
                  <div className="flex gap-2 pt-2">
                     <button type="submit" className="flex-1 bg-[#6A197D] text-white py-3 rounded-xl font-baloo font-bold shadow-md hover:bg-[#57146A] transition">
                        {editTaId ? 'Simpan Perubahan' : '+ Tambah Tahun Ajaran'}
                     </button>
                     {editTaId && <button type="button" onClick={() => { setEditTaId(null); setNamaTa('') }} className="px-5 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600">Batal</button>}
                  </div>
                )}

                {!isGuru && daftarTa.length > 1 && tahunAjaranAktifSaatIni && (
                  <div className="pt-4 mt-4 border-t border-slate-100 space-y-2">
                     <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider block flex items-center gap-1.5">
                        <Copy className="w-3.5 h-3.5" /> Salin Data dari Tahun Ajaran Lain
                     </label>
                     <p className="text-[9px] font-semibold text-slate-400 leading-relaxed">
                        Isi periode aktif (&quot;{tahunAjaranAktifSaatIni.nama}&quot;) dengan menyalin data dari periode lain sebagai referensi -- HANYA mengisi bagian yang masih kosong, data yang sudah ada tidak akan ditimpa.
                     </p>
                     <div className="flex gap-2">
                        <select value={sumberSalinId} onChange={e => setSumberSalinId(e.target.value)} className="flex-1 px-3 py-2 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#8A3499]">
                           <option value="">-- Pilih tahun ajaran sumber --</option>
                           {daftarTa.filter(item => item.id !== tahunAjaranAktifSaatIni.id).map(item => (
                             <option key={item.id} value={item.id}>{item.nama}</option>
                           ))}
                        </select>
                        <button type="button" disabled={!sumberSalinId} onClick={handleSalinData} className="px-4 bg-[#F7ECFA] text-[#57146A] hover:bg-[#EFD9F5] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-baloo font-bold transition">
                           Salin
                        </button>
                     </div>
                     {sumberSalinId && (
                        <p className="text-[9px] text-slate-400">{jumlahBagianSalinTersedia} bagian data tersedia untuk disalin dari periode ini.</p>
                     )}
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
                <div>
                  <input type="text" placeholder="Nama kelas RESMI (opsional), contoh: 7 atau VII" value={namaResmiTingkat} onChange={(e) => setNamaResmiTingkat(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" disabled={isGuru} />
                  <p className="text-[10px] text-slate-400 mt-1">Isi HANYA jika nama tingkat di atas adalah kode internal Lembaga Pusat (mis. &quot;1&quot; untuk kelas 7 SMP) yang perlu ditulis beda saat dokumen (CP, TP, ATP, Prota, Promes, Analisis Alokasi Waktu) dicetak atas nama Lembaga Unit. Kosongkan kalau nama tingkat sudah sesuai apa adanya -- sistem TIDAK akan menebak/mengubah otomatis.</p>
                </div>
                {!isGuru && (
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-[#6A197D] text-white py-2.5 rounded-xl font-baloo font-bold shadow-md hover:bg-[#57146A]">
                      {editTingkatId ? 'Update Tingkat' : 'Tambah Tingkat'}
                    </button>
                    {editTingkatId && <button type="button" onClick={() => { setEditTingkatId(null); setNamaTingkat(''); setNamaResmiTingkat('') }} className="px-5 py-2.5 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600">Batal</button>}
                  </div>
                )}
              </form>
              <div className="flex-1 bg-slate-50/50 rounded-xl border p-4 max-h-[250px] overflow-y-auto space-y-2">
                {daftarTingkat.map(item => (
                  <div key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <p className="font-baloo font-bold text-sm text-slate-800">{item.nama}{item.namaResmi ? ` (resmi: ${item.namaResmi})` : ''}</p>
                      <p className="text-[10px] font-baloo font-bold text-[#6A197D] mt-0.5">{daftarLembaga.find(u => u.id === item.lembagaId)?.nama}</p>
                    </div>
                    {!isGuru && (
                      <div className="flex gap-1.5">
                        <button onClick={() => { setEditTingkatId(item.id); setNamaTingkat(item.nama); setLembagaIdTingkat(item.lembagaId); setNamaResmiTingkat(item.namaResmi || '') }} className="p-1.5 text-slate-400 hover:text-[#6A197D] bg-slate-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
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