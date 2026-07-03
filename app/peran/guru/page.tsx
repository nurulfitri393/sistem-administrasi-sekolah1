'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../supabase'
import { 
  Trash2, Edit2, Users, ArrowLeft, LogOut, Landmark, UserPlus, BookOpen, Layers, CheckSquare, Download, Search, LayoutGrid, ClipboardList
} from 'lucide-react'

export default function MasterGuruPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')
  const [npsnSekolah, setNpsnSekolah] = useState('12345678')

  // Tab aktif langsung ke 'formulir' agar tidak kosong
  const [tabAktif, setTabAktif] = useState<'formulir' | 'direktori'>('formulir') 
  const [kataKunciCari, setKataKunciCari] = useState('')

  // Referensi Data Master
  const [daftarPeran, setDaftarPeran] = useState<any[]>([])
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [daftarTingkat, setDaftarTingkat] = useState<any[]>([])
  const [daftarRombel, setDaftarRombel] = useState<any[]>([])
  const [daftarMapel, setDaftarMapel] = useState<any[]>([])

  // State Master Data Guru
  const [daftarGuru, setDaftarGuru] = useState<any[]>([])
  const [namaGuru, setNamaGuru] = useState('')
  const [nipGuru, setNipGuru] = useState('')
  const [unitTerpilih, setUnitTerpilih] = useState<string[]>([]) 
  const [editGuruId, setEditGuruId] = useState<string | null>(null)

  // State Relasi Manual: Mapel -> Rombel & Multi-Peran
  const [mapelTerpilih, setMapelTerpilih] = useState<string[]>([]) 
  const [mapelRombelTerpilih, setMapelRombelTerpilih] = useState<Record<string, string[]>>({}) 
  const [peranDipilih, setPeranDipilih] = useState<string[]>([]) 

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

        const storedPeran = localStorage.getItem('master_peran')
        if (storedPeran) setDaftarPeran(JSON.parse(storedPeran))

        const storedMapel = localStorage.getItem('master_mapel')
        if (storedMapel) setDaftarMapel(JSON.parse(storedMapel))

        const storedLembaga = localStorage.getItem('daftar_lembaga')
        if (storedLembaga) setDaftarLembaga(JSON.parse(storedLembaga))

        const storedTingkat = localStorage.getItem('master_tingkat')
        if (storedTingkat) setDaftarTingkat(JSON.parse(storedTingkat))

        const storedRombel = localStorage.getItem('master_rombel')
        if (storedRombel) setDaftarRombel(JSON.parse(storedRombel))

        const storedGuru = localStorage.getItem('master_guru')
        if (storedGuru) setDaftarGuru(JSON.parse(storedGuru))

        setLoading(false)
      }
    }
    checkAuth()
  }, [router])

  const handleUnitCheckboxChange = (unitId: string) => {
    setUnitTerpilih(prev => 
      prev.includes(unitId) ? prev.filter(item => item !== unitId) : [...prev, unitId]
    )
  }

  const handleMapelCheckboxChange = (mapelId: string) => {
    setMapelTerpilih(prev => {
      if (prev.includes(mapelId)) {
        const newMapel = prev.filter(item => item !== mapelId)
        const newMapelRombel = { ...mapelRombelTerpilih }
        delete newMapelRombel[mapelId]
        setMapelRombelTerpilih(newMapelRombel)
        return newMapel
      } else {
        return [...prev, mapelId]
      }
    })
  }

  const handleMapelRombelCheckboxChange = (mapelId: string, rombelId: string) => {
    setMapelRombelTerpilih(prev => {
      const currentRombels = prev[mapelId] || []
      if (currentRombels.includes(rombelId)) {
        return { ...prev, [mapelId]: currentRombels.filter(id => id !== rombelId) }
      } else {
        return { ...prev, [mapelId]: [...currentRombels, rombelId] }
      }
    })
  }

  const handlePeranCheckboxChange = (peranId: string) => {
    setPeranDipilih(prev => 
      prev.includes(peranId) ? prev.filter(item => item !== peranId) : [...prev, peranId]
    )
  }

  const handlePilihSemuaRombelLembaga = (mapelId: string, lembagaId: string) => {
    let rombelTerkait: string[] = []

    if (lembagaId === 'lembaga-induk') {
      rombelTerkait = daftarRombel.map(r => r.id)
    } else {
      const tingkatTerkait = daftarTingkat.filter(t => t.lembagaId === lembagaId).map(t => t.id)
      rombelTerkait = daftarRombel.filter(r => tingkatTerkait.includes(r.tingkatId)).map(r => r.id)
    }

    if (rombelTerkait.length === 0) {
      alert('Belum ada kelas (rombel) yang didaftarkan pada entitas ini.')
      return
    }

    setMapelRombelTerpilih(prev => {
      const saatIni = prev[mapelId] || []
      const gabungan = Array.from(new Set([...saatIni, ...rombelTerkait]))
      return { ...prev, [mapelId]: gabungan }
    })
  }

  const handleBersihkanRombel = (mapelId: string) => {
    setMapelRombelTerpilih(prev => ({ ...prev, [mapelId]: [] }))
  }

  const handleSimpanGuru = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // VALIDASI DIPERBARUI: Mapel TIDAK LAGI WAJIB
    let validRombel = true
    if (mapelTerpilih.length > 0) {
      mapelTerpilih.forEach(mId => {
        if (!mapelRombelTerpilih[mId] || mapelRombelTerpilih[mId].length === 0) validRombel = false
      })
    }

    if (unitTerpilih.length === 0 || peranDipilih.length === 0) {
      alert('Lengkapi pendaftaran: Anda wajib memilih Unit/Lembaga dan minimal 1 Peran/Jabatan.')
      return
    }

    if (mapelTerpilih.length > 0 && !validRombel) {
      alert('Anda telah memilih Mata Pelajaran. Silakan centang/pilih minimal 1 Kelas (Rombel) yang diampu untuk mapel tersebut.')
      return
    }

    const guruIndex = daftarGuru.findIndex(
      (g) => g.nama.trim().toLowerCase() === namaGuru.trim().toLowerCase() && g.nip === nipGuru
    )
    
    let guruId = editGuruId
    
    if (guruIndex !== -1 && !editGuruId) {
      guruId = daftarGuru[guruIndex].id
      if (!confirm('Data staf/guru dengan Nama & NIP sama persis ditemukan. Timpa/Perbarui data?')) {
        return
      }
    }
    
    const bersihkanNama = (str: string) => {
      return str
        .split(',')[0]
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .toLowerCase();
    }
    
    const namaLoginId = bersihkanNama(namaGuru) || 'guru'
    const autoEmail = `${namaLoginId}@abs.sch.id`
    const autoPassword = npsnSekolah

    setLoading(true)
    
    const newGuru = { 
      id: guruId || 'guru-' + Date.now(),
      nama: namaGuru, 
      nip: nipGuru, 
      mapelIds: mapelTerpilih,
      mapelRombel: mapelRombelTerpilih,
      unitIds: unitTerpilih, 
      peranIds: peranDipilih,
      email: autoEmail,
      password: autoPassword
    }

    if (guruId) {
      const updated = daftarGuru.map(item => item.id === guruId ? newGuru : item)
      setDaftarGuru(updated); localStorage.setItem('master_guru', JSON.stringify(updated))
      alert('Data staf berhasil diperbarui!')
    } else {
      const updated = [...daftarGuru, newGuru]
      setDaftarGuru(updated); localStorage.setItem('master_guru', JSON.stringify(updated))
      alert('Staf/Guru baru berhasil didaftarkan!')
    }
    
    setNamaGuru(''); setNipGuru(''); setMapelTerpilih([]); setMapelRombelTerpilih({}); setUnitTerpilih([]); setPeranDipilih([]);
    setEditGuruId(null)
    setTabAktif('direktori') 
    setLoading(false)
  }
  
  const handleImporCsvGuru = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    const reader = new FileReader()
    reader.onload = async (event) => {
      const text = event.target?.result as string
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
      const rows = lines.slice(1)
      const importedGurus: any[] = []
      let skippedCount = 0

      let currentDaftarGuru = [...daftarGuru]

      for (let row of rows) {
        const delimiter = row.includes(';') ? ';' : ','
        const cols = row.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, '')) 
        
        if (cols.length >= 1) {
          const nama = cols[0] ? cols[0].trim() : ''
          const nip = cols[1] ? cols[1].trim() : '' 

          if (!nama) continue 

          const existingIndex = currentDaftarGuru.findIndex(
            (g) => g.nama.trim().toLowerCase() === nama.trim().toLowerCase() && g.nip === nip
          )

          const bersihkanNama = (str: string) => {
             return str
               .split(',')[0]
               .replace(/\./g, '')
               .replace(/\s+/g, '')
               .toLowerCase();
          }
          
          const namaLoginId = bersihkanNama(nama) || 'guru'
          const randomNum = Math.floor(100 + Math.random() * 900)
          const autoEmail = `${namaLoginId}${randomNum}@abs.sch.id`
          const autoPassword = npsnSekolah

          if (existingIndex !== -1) {
            currentDaftarGuru[existingIndex] = {
              ...currentDaftarGuru[existingIndex],
              nama,
              nip
            }
            skippedCount++
          } else {
            importedGurus.push({
              id: 'guru-' + Date.now() + Math.random(),
              nama, 
              nip, 
              mapelIds: [],
              mapelRombel: {},
              unitIds: [], 
              peranIds: [], 
              email: autoEmail,
              password: autoPassword
            })
          }
        }
      }

      const updated = [...currentDaftarGuru, ...importedGurus]
      setDaftarGuru(updated)
      localStorage.setItem('master_guru', JSON.stringify(updated))
      
      alert(`Impor selesai. ${importedGurus.length} data baru dimasukkan, ${skippedCount} data yang sama telah diperbarui.`)
      setTabAktif('direktori')
      setLoading(false)
    }
    reader.readAsText(file)
  }

  const handleUnduhTemplat = () => {
    const csvTemplate = `Nama Lengkap,Nomor Induk Pendidik (NIP/NUPTK)\r\nDr. H. Ahmad, M.Pd,198001012005011001\r\nHj. Siti Aminah, S.Pd,\r\n`
    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvTemplate)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", "Template_Impor_Data_Guru.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleEditGuruClick = (item: any) => {
    setEditGuruId(item.id)
    setNamaGuru(item.nama)
    setNipGuru(item.nip || '')
    setMapelTerpilih(item.mapelIds || [])
    setUnitTerpilih(item.unitIds || [])
    
    let loadedPeran = item.peranIds || []
    if (!item.peranIds && item.peranId) {
      loadedPeran = [item.peranId]
    }
    setPeranDipilih(loadedPeran)

    let loadedMapelRombel = item.mapelRombel || {}
    if (!item.mapelRombel && item.mapelIds && item.rombelIds) {
      item.mapelIds.forEach((mId: string) => {
        loadedMapelRombel[mId] = item.rombelIds
      })
    }
    setMapelRombelTerpilih(loadedMapelRombel)
    
    setTabAktif('formulir')
  }

  const handleHapusGuru = (id: string) => {
    if (confirm('Hapus data staf/guru ini dari sistem?')) {
      const filtered = daftarGuru.filter(item => item.id !== id)
      setDaftarGuru(filtered); localStorage.setItem('master_guru', JSON.stringify(filtered))
    }
  }

  const daftarGuruTersaring = daftarGuru.filter(guru => {
    const query = kataKunciCari.toLowerCase()
    return (
      guru.nama.toLowerCase().includes(query) || 
      (guru.nip && guru.nip.toLowerCase().includes(query))
    )
  })

  if (loading) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Data Pendidik...</div>

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 font-opensans">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="h-16 flex items-center px-6 border-b border-slate-200 bg-[#F7ECFA]/50">
            {logoInduk ? (
              <img src={logoInduk} alt="Logo" className="w-8 h-8 object-contain mr-3" />
            ) : (
              <Landmark className="w-6 h-6 text-[#6A197D] mr-3" />
            )}
            <h2 className="text-xs font-baloo font-black text-[#330B40] uppercase tracking-widest truncate max-w-[170px]">{namaInduk}</h2>
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
            <Link href="/peran/guru" className="flex items-center gap-3 px-4 py-3 text-sm font-baloo font-bold text-white bg-[#6A197D] rounded-xl shadow-md">
              <UserPlus className="w-4 h-4" /> Kelola Data Guru
            </Link>
            <div className="pt-4 pb-1 px-4 text-[9px] font-baloo font-black text-slate-400 uppercase tracking-widest">Pusat Distribusi Akun</div>
            <Link href="/peran/guru/unduh" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
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

      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-6">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-baloo font-black text-slate-900">Master Data & Penugasan Staf</h1>
           <p className="text-xs text-gray-500">Daftar data staf/pendidik, serta tautkan penugasan unit, mata pelajaran, dan kelas (bisa dikosongkan jika tidak mengajar).</p>
        </header>

        {/* TAB NAVIGATION CONTROLLER */}
        <div className="flex border-b border-slate-200 gap-2">
          <button 
            type="button" 
            onClick={() => setTabAktif('formulir')} 
            className={`px-5 py-3 text-xs font-baloo font-bold border-b-2 flex items-center gap-2 transition-all ${tabAktif === 'formulir' ? 'border-[#6A197D] text-[#6A197D] bg-white rounded-t-xl' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <LayoutGrid className="w-4 h-4" /> {editGuruId ? 'Ubah Data Penugasan' : 'Formulir Pendaftaran'}
          </button>
          <button 
            type="button" 
            onClick={() => setTabAktif('direktori')} 
            className={`px-5 py-3 text-xs font-baloo font-bold border-b-2 flex items-center gap-2 transition-all ${tabAktif === 'direktori' ? 'border-[#6A197D] text-[#6A197D] bg-white rounded-t-xl' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <ClipboardList className="w-4 h-4" /> Halaman Data Tersimpan ({daftarGuru.length})
          </button>
        </div>

        {/* TAB 1: FORMULIR INPUT */}
        {tabAktif === 'formulir' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6">
            <form onSubmit={handleSimpanGuru} className="space-y-4 max-w-3xl">
                 <div>
                    <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nama Lengkap & Gelar</label>
                    <input type="text" placeholder="Contoh: Dr. H. Ahmad, M.Pd" value={namaGuru} onChange={e => setNamaGuru(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" required />
                 </div>
                 <div>
                    <label className="text-[10px] font-baloo font-bold text-slate-500 uppercase tracking-wider mb-1 block">NIP / Nomor Identitas</label>
                    <input type="text" placeholder="NIP / NUPTK / ID Pegawai" value={nipGuru} onChange={e => setNipGuru(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A3499]" />
                 </div>
                 
                 <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                    <div className="mb-3">
                       <label className="text-[10px] font-baloo font-extrabold text-slate-600 uppercase tracking-wider block">Mata Pelajaran & Kelas Diampu (Opsional)</label>
                       <p className="text-[9px] text-slate-500">Kosongkan centang mapel di bawah ini jika staf/guru bersangkutan tidak memiliki kewajiban mengajar di kelas (misal: Kepala Sekolah, Tata Usaha).</p>
                    </div>
                    <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                       {daftarMapel.map(m => (
                         <div key={m.id} className="p-3 border border-slate-200 rounded-xl bg-white shadow-sm transition-all">
                            <div className="flex items-center gap-2">
                               <input 
                                 type="checkbox" 
                                 id={'teacher-m-'+m.id} 
                                 value={m.id} 
                                 checked={mapelTerpilih.includes(m.id)}
                                 onChange={() => handleMapelCheckboxChange(m.id)}
                                 className="w-4 h-4 text-[#6A197D] rounded border-slate-300 focus:ring-[#8A3499]"
                               />
                               <label htmlFor={'teacher-m-'+m.id} className="cursor-pointer font-baloo font-bold text-sm text-slate-800">{m.nama} <span className="text-[10px] text-slate-400 font-medium ml-1">({m.kode})</span></label>
                            </div>
                            
                            {mapelTerpilih.includes(m.id) && (
                              <div className="mt-3 ml-6 pl-3 border-l-2 border-[#DEB3EA] space-y-3">
                                 <div>
                                    <p className="text-[9px] font-baloo font-black text-[#6A197D] uppercase tracking-wider mb-1.5">Pilih Cepat Kelompok Kelas:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                       <button type="button" onClick={() => handlePilihSemuaRombelLembaga(m.id, 'lembaga-induk')} className="text-[9px] font-baloo font-bold bg-[#F7ECFA] hover:bg-[#EFD9F5] text-[#57146A] px-2.5 py-1.5 rounded-lg border border-[#EFD9F5] transition flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Semua Kelas Yayasan Pusat</button>
                                       {daftarLembaga.map(u => (
                                          <button key={u.id} type="button" onClick={() => handlePilihSemuaRombelLembaga(m.id, u.id)} className="text-[9px] font-baloo font-bold bg-[#FFFBEA] hover:bg-[#FFF6D1] text-[#57146A] px-2.5 py-1.5 rounded-lg border border-[#FFF6D1] transition flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Semua Kelas {u.nama}</button>
                                       ))}
                                       <button type="button" onClick={() => handleBersihkanRombel(m.id)} className="text-[9px] font-baloo font-bold bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg border border-red-100 transition ml-1">Reset</button>
                                    </div>
                                 </div>

                                 <div>
                                    <p className="text-[9px] font-baloo font-black text-slate-400 uppercase tracking-wider mb-1.5">Tentukan Kelas Manual:</p>
                                    {daftarRombel.length === 0 ? (
                                       <p className="text-[9px] text-slate-400 italic">Belum ada Rombel.</p>
                                    ) : (
                                       <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-baloo font-bold text-slate-600">
                                          {daftarRombel.map(r => (
                                             <label key={r.id} className="flex items-center gap-1.5 cursor-pointer">
                                                <input 
                                                  type="checkbox" 
                                                  checked={mapelRombelTerpilih[m.id]?.includes(r.id) || false}
                                                  onChange={() => handleMapelRombelCheckboxChange(m.id, r.id)}
                                                  className="w-3.5 h-3.5 text-[#6A197D] rounded border-slate-300 focus:ring-[#FFDE59]"
                                                />
                                                Kelas {r.nama}
                                             </label>
                                          ))}
                                       </div>
                                    )}
                                 </div>
                              </div>
                            )}
                         </div>
                       ))}
                       {daftarMapel.length === 0 && <p className="text-[9px] text-slate-400 italic">Belum ada data mapel.</p>}
                    </div>
                 </div>
                 
                 <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                    <label className="text-[10px] font-baloo font-extrabold text-slate-600 uppercase tracking-wider mb-2 block">Penugasan Peran / Jabatan (Bisa Multi-Peran)</label>
                    <div className="space-y-2 text-xs font-baloo font-bold max-h-[120px] overflow-y-auto">
                       {daftarPeran.map(p => (
                         <div key={p.id} className="flex items-center gap-2">
                            <input 
                              type="checkbox" 
                              id={'teacher-p-'+p.id} 
                              value={p.id} 
                              checked={peranDipilih.includes(p.id)}
                              onChange={() => handlePeranCheckboxChange(p.id)}
                              className="w-3.5 h-3.5 text-[#6A197D] rounded border-slate-300 focus:ring-[#8A3499]"
                            />
                            <label htmlFor={'teacher-p-'+p.id} className="cursor-pointer">{p.nama}</label>
                         </div>
                       ))}
                       {daftarPeran.length === 0 && <p className="text-[9px] text-slate-400 italic">Belum ada data peran.</p>}
                    </div>
                 </div>
                 
                 <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                    <label className="text-[10px] font-baloo font-extrabold text-slate-600 uppercase tracking-wider mb-2 block">Penugasan Unit / Lembaga</label>
                    <div className="space-y-2 text-xs font-baloo font-bold">
                       <div className="flex items-center gap-2">
                          <input 
                            type="checkbox" 
                            id="unit-induk" 
                            value="lembaga-induk" 
                            checked={unitTerpilih.includes('lembaga-induk')}
                            onChange={() => handleUnitCheckboxChange('lembaga-induk')}
                            className="w-3.5 h-3.5 text-[#6A197D] rounded border-slate-300 focus:ring-[#8A3499]"
                          />
                          <label htmlFor="unit-induk" className="cursor-pointer">Lembaga Induk / Yayasan Pusat</label>
                       </div>
                       {daftarLembaga.map(u => (
                         <div key={u.id} className="flex items-center gap-2">
                            <input 
                              type="checkbox" 
                              id={'teacher-u-'+u.id} 
                              value={u.id} 
                              checked={unitTerpilih.includes(u.id)}
                              onChange={() => handleUnitCheckboxChange(u.id)}
                              className="w-3.5 h-3.5 text-[#6A197D] rounded border-slate-300 focus:ring-[#8A3499]"
                          />
                            <label htmlFor={'teacher-u-'+u.id} className="cursor-pointer">{u.nama}</label>
                         </div>
                       ))}
                    </div>
                 </div>
                 
                 <div className="flex flex-col gap-2.5 p-3.5 bg-slate-50/70 border border-dashed border-slate-300 rounded-xl mt-4">
                    <div>
                       <label className="text-[10px] font-baloo font-extrabold text-slate-600 uppercase tracking-wider">Impor Data Staf via CSV</label>
                       <button type="button" onClick={handleUnduhTemplat} className="flex items-center gap-1.5 mt-1 text-[9px] font-baloo font-black bg-[#F7ECFA] text-[#57146A] hover:bg-[#EFD9F5] px-3 py-1.5 rounded-lg border border-[#EFD9F5] transition shadow-sm w-fit">
                          <Download className="w-3.5 h-3.5" /> Unduh Templat Format Contoh CSV
                       </button>
                    </div>
                    
                    <input 
                      type="file" 
                      accept=".csv" 
                      onChange={handleImporCsvGuru} 
                      className="text-xs file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-baloo font-bold file:bg-[#F7ECFA] file:text-[#57146A] hover:file:bg-[#EFD9F5] cursor-pointer mt-1" 
                    />
                 </div>

                 <div className="flex gap-2 pt-2">
                    <button type="submit" className="flex-1 bg-[#6A197D] text-white py-3 rounded-xl font-baloo font-bold shadow-md hover:bg-[#57146A]">
                      {editGuruId ? 'Simpan Perubahan Data' : '+ Daftarkan Staf/Guru'}
                    </button>
                    {editGuruId && <button type="button" onClick={() => { setEditGuruId(null); setNamaGuru(''); setNipGuru(''); setMapelTerpilih([]); setMapelRombelTerpilih({}); setUnitTerpilih([]); setPeranDipilih([]) }} className="px-5 bg-slate-100 rounded-xl font-baloo font-bold text-slate-600">Batal</button>}
                 </div>
            </form>
          </div>
        )}

        {/* TAB 2: DIREKTORI GURU */}
        {tabAktif === 'direktori' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
             <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input 
                  type="text" 
                  value={kataKunciCari}
                  onChange={e => setKataKunciCari(e.target.value)}
                  placeholder="Cari guru berdasarkan nama atau NIP..."
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#8A3499] font-medium"
                />
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                 {daftarGuruTersaring.map(item => (
                   <div key={item.id} className="bg-white p-5 rounded-xl border border-slate-200 flex justify-between items-start text-xs shadow-sm hover:border-[#DEB3EA] transition-all">
                      <div className="space-y-3 w-[88%]">
                         <div>
                            <p className="font-baloo font-black text-slate-900 text-sm leading-tight">{item.nama}</p>
                            <p className="text-[10px] text-slate-500 font-semibold mt-1">NIP / NUPTK: {item.nip || '-'}</p>
                         </div>
                         
                         <div className="bg-[#F7ECFA]/50 p-2.5 rounded-lg border border-[#EFD9F5]/50">
                            <p className="text-[9px] font-baloo font-extrabold text-[#22072B] uppercase mb-1.5">Tugas Pengajaran & Rombel:</p>
                            <ul className="space-y-1.5">
                               {item.mapelIds?.map((mId: string) => {
                                  let arrayRombelTerkait = item.mapelRombel ? item.mapelRombel[mId] : item.rombelIds;
                                  return (
                                    <li key={mId} className="text-[10px]">
                                       <span className="font-baloo font-bold text-[#57146A] block">{daftarMapel.find(m => m.id === mId)?.nama || mId}</span>
                                       {arrayRombelTerkait && arrayRombelTerkait.length > 0 ? (
                                         <span className="text-[9px] text-slate-600 font-semibold block mt-0.5">
                                           Rombel: {arrayRombelTerkait.map((rId: string) => daftarRombel.find(r => r.id === rId)?.nama || rId).join(', ')}
                                         </span>
                                       ) : (
                                         <span className="text-[9px] text-red-400 italic block mt-0.5">Belum diset Rombel kelas</span>
                                       )}
                                    </li>
                                  )
                               })}
                               {(!item.mapelIds || item.mapelIds.length === 0) && (
                                  <p className="text-[9px] text-slate-500 font-semibold italic">Tidak ada tugas mengajar kelas.</p>
                               )}
                            </ul>
                         </div>

                         <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-[10px]">
                             <div>
                                <p className="text-[8px] font-baloo font-extrabold text-slate-400 uppercase tracking-wide">Unit / Lembaga:</p>
                                <ul className="list-disc pl-3 mt-0.5 font-semibold text-[#57146A] space-y-0.5">
                                   {item.unitIds?.includes('lembaga-induk') && <li>Yayasan Pusat</li>}
                                   {item.unitIds?.filter((id: string) => id !== 'lembaga-induk').map((uId: string) => (
                                     <li key={uId} className="truncate max-w-[100px]">{daftarLembaga.find(u => u.id === uId)?.nama || uId}</li>
                                   ))}
                                </ul>
                             </div>
                             <div>
                                <p className="text-[8px] font-baloo font-extrabold text-[#6A197D] uppercase tracking-wide">Peran / Jabatan:</p>
                                <ul className="list-disc pl-3 mt-0.5 font-baloo font-bold text-[#440F55] space-y-0.5">
                                   {item.peranIds?.map((pId: string) => (
                                      <li key={pId}>{daftarPeran.find(p => p.id === pId)?.nama || pId}</li>
                                   ))}
                                   {(!item.peranIds || item.peranIds.length === 0) && <li>-</li>}
                                </ul>
                             </div>
                         </div>
                      </div>

                      <div className="flex flex-col gap-1.5 ml-2">
                         <button onClick={() => handleEditGuruClick(item)} className="p-1.5 bg-slate-50 rounded-md text-slate-400 hover:text-[#6A197D] border border-slate-100" title="Ubah Data / Tugas Mengajar"><Edit2 className="w-3 h-3" /></button>
                         <button onClick={() => handleHapusGuru(item.id)} className="p-1.5 bg-slate-50 rounded-md text-slate-400 hover:text-red-500 border border-slate-100" title="Hapus Guru"><Trash2 className="w-3 h-3" /></button>
                      </div>
                   </div>
                 ))}
             </div>

             {daftarGuruTersaring.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-12 font-medium">
                   Tidak ditemukan data staf terdaftar yang cocok dengan kata kunci pencarian Anda.
                </p>
             )}
          </div>
        )}
      </main>
    </div>
  )
}