'use client'
import { useAksesGuard } from '@/lib/useAksesGuard'

import Sidebar from '@/components/Sidebar'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { 
  Plus, Trash2, Edit2, Shield, Users, ArrowLeft, LogOut, Landmark, BookOpen, UserPlus
} from 'lucide-react'

export default function PembagianPeranPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('peran')
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')

  const [daftarPeran, setDaftarPeran] = useState<any[]>([])
  const [namaPeran, setNamaPeran] = useState('')
  const [editPeranId, setEditPeranId] = useState<string | null>(null)
  
  // PENAMBAHAN MODUL BARU: Identitas Lembaga, Pembagian Peran, Kelola Data Guru
  const daftarModulSistem = [
    { id: 'lembaga', label: 'Identitas Lembaga' },
    { id: 'peran', label: 'Pembagian Peran' },
    { id: 'guru', label: 'Kelola Data Guru' },
    { id: 'kaldik', label: 'Kaldik' },
    { id: 'jadwal', label: 'Jadwal Pelajaran' },
    { id: 'minggu_efektif', label: 'Minggu Efektif' },
    { id: 'cp_tp_atp', label: 'CP, TP & ATP' },
    { id: 'prota_promes', label: 'Prota & Promes' },
    { id: 'rpp', label: 'RPP / Modul Ajar' }
  ]

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
          setNamaInduk(parsed.nama)
          setLogoInduk(parsed.logo_utama || parsed.logo || '')
        }

        const storedPeran = localStorage.getItem('master_peran')
        if (storedPeran) {
          // MIGRASI OTOMATIS: Mengubah array lama ['kaldik'] menjadi object baru { kaldik: {read: true, write: true} }
          let parsedPeran = JSON.parse(storedPeran)
          parsedPeran = parsedPeran.map((role: any) => {
            if (Array.isArray(role.akses)) {
              const newAkses: any = {}
              role.akses.forEach((modId: string) => {
                newAkses[modId] = { read: true, write: true }
              })
              return { ...role, akses: newAkses }
            }
            return role
          })
          setDaftarPeran(parsedPeran)
          localStorage.setItem('master_peran', JSON.stringify(parsedPeran))
        } else {
          // FORMAT DEFAULT BARU (Admin utama mendapatkan semua akses penuh secara otomatis)
          const defaultPeran = [
            { 
              id: 'peran-1', 
              nama: 'Admin / Kurikulum', 
              akses: { 
                lembaga: { read: true, write: true },
                peran: { read: true, write: true },
                guru: { read: true, write: true },
                kaldik: { read: true, write: true }, 
                jadwal: { read: true, write: true }, 
                minggu_efektif: { read: true, write: true }, 
                cp_tp_atp: { read: true, write: true }, 
                prota_promes: { read: true, write: true }, 
                rpp: { read: true, write: true } 
              } 
            },
            { 
              id: 'peran-2', 
              nama: 'Guru Mata Pelajaran', 
              akses: { 
                cp_tp_atp: { read: true, write: true }, 
                prota_promes: { read: true, write: true }, 
                rpp: { read: true, write: true } 
              } 
            }
          ]
          setDaftarPeran(defaultPeran)
          localStorage.setItem('master_peran', JSON.stringify(defaultPeran))
        }

        setLoading(false)
      }
    }
    checkAuth()
  }, [router])

  const handleSimpanPeran = (e: React.FormEvent) => {
    e.preventDefault()
    if (editPeranId) {
      const updated = daftarPeran.map(item => item.id === editPeranId ? { ...item, nama: namaPeran } : item)
      setDaftarPeran(updated); localStorage.setItem('master_peran', JSON.stringify(updated)); setEditPeranId(null)
    } else {
      const updated = [...daftarPeran, { id: 'peran-' + Date.now(), nama: namaPeran, akses: {} }]
      setDaftarPeran(updated); localStorage.setItem('master_peran', JSON.stringify(updated))
    }
    setNamaPeran('')
  }

  const handleToggleAkses = (peranId: string, modulId: string, tipeAkses: 'read' | 'write') => {
    const updated = daftarPeran.map(peran => {
      if (peran.id === peranId) {
        const currentAkses = peran.akses || {}
        const moduleAkses = currentAkses[modulId] || { read: false, write: false }
        
        const newModuleAkses = { ...moduleAkses, [tipeAkses]: !moduleAkses[tipeAkses] }
        
        // Cerdas Kontrol: Jika diberi akses edit (write), otomatis akses lihat (read) ikut aktif
        if (tipeAkses === 'write' && newModuleAkses.write) {
           newModuleAkses.read = true
        }
        // Cerdas Kontrol: Jika akses lihat (read) dicabut, akses edit (write) otomatis dicabut
        if (tipeAkses === 'read' && !newModuleAkses.read) {
           newModuleAkses.write = false
        }

        return {
          ...peran,
          akses: {
            ...currentAkses,
            [modulId]: newModuleAkses
          }
        }
      }
      return peran
    })
    setDaftarPeran(updated); localStorage.setItem('master_peran', JSON.stringify(updated))
  }

  const handleHapusPeran = (id: string) => {
    if (confirm('Yakin ingin menghapus peran ini?')) {
      const filtered = daftarPeran.filter(item => item.id !== id)
      setDaftarPeran(filtered); localStorage.setItem('master_peran', JSON.stringify(filtered))
    }
  }

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Halaman Otoritas...</div>
  if (diizinkanAkses === false) return null

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800 font-opensans">
      
      {/* SIDEBAR NAVIGASI */}
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-8">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-baloo font-black text-slate-900">Matriks Hak Akses Peran Pengguna</h1>
           <p className="text-xs text-gray-500">Buat deskripsi jabatan, lalu berikan izin kelola modul sistem (Lihat & Edit) secara spesifik untuk setiap peran terkait.</p>
        </header>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <form onSubmit={handleSimpanPeran} className="flex gap-3 mb-6 md:w-2/3">
             <input 
               type="text" 
               placeholder="Input label peran baru, cth: Waka Kurikulum" 
               value={namaPeran} 
               onChange={(e) => setNamaPeran(e.target.value)} 
               className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8A3499] font-semibold" 
               required 
             />
             <button type="submit" className="bg-[#6A197D] hover:bg-[#57146A] text-white px-6 rounded-xl text-sm font-baloo font-bold transition">
               {editPeranId ? 'Simpan Label' : '+ Tambah Peran'}
             </button>
             {editPeranId && (
               <button type="button" onClick={() => {setEditPeranId(null); setNamaPeran('')}} className="px-4 py-2 bg-slate-100 rounded-xl text-sm font-baloo font-bold text-slate-700">Batal</button>
             )}
          </form>

          <div className="overflow-x-auto border border-slate-100 rounded-xl">
             <table className="w-full text-left text-xs border-collapse min-w-max">
                <thead>
                   <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-baloo font-extrabold">
                      <th className="p-4">Label Peran Jabatan</th>
                      {daftarModulSistem.map(modul => (
                        <th key={modul.id} className="p-3 text-center border-l border-slate-100">{modul.label}</th>
                      ))}
                      <th className="p-4 text-center border-l border-slate-100">Aksi</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                   {daftarPeran.map(item => (
                     <tr key={item.id} className="hover:bg-slate-50/60">
                        <td className="p-4 flex items-center gap-2.5">
                           <Users className="w-4 h-4 text-[#6A197D]" /> {item.nama}
                        </td>
                        {daftarModulSistem.map(modul => (
                          <td key={modul.id} className="p-3 align-middle border-l border-slate-100">
                             <div className="flex flex-col items-center gap-2">
                                <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={item.akses?.[modul.id]?.read || false}
                                    onChange={() => handleToggleAkses(item.id, modul.id, 'read')}
                                    className="w-3.5 h-3.5 text-blue-500 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                                  /> Lihat
                                </label>
                                <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={item.akses?.[modul.id]?.write || false}
                                    onChange={() => handleToggleAkses(item.id, modul.id, 'write')}
                                    className="w-3.5 h-3.5 text-[#6A197D] rounded border-slate-300 focus:ring-[#8A3499] cursor-pointer"
                                  /> Edit
                                </label>
                             </div>
                          </td>
                        ))}
                        <td className="p-4 text-center border-l border-slate-100">
                           <div className="flex items-center justify-center gap-1">
                              <button onClick={() => { setEditPeranId(item.id); setNamaPeran(item.nama); window.scrollTo({top:0, behavior:'smooth'}) }} className="p-1 text-slate-400 hover:text-[#6A197D]" title="Edit Nama Peran">
                                 <Edit2 className="w-4 h-4"/>
                              </button>
                              <button onClick={() => handleHapusPeran(item.id)} className="p-1 text-slate-400 hover:text-red-600" title="Hapus Peran">
                                 <Trash2 className="w-4 h-4"/>
                              </button>
                           </div>
                        </td>
                     </tr>
                   ))}
                   {daftarPeran.length === 0 && (
                     <tr>
                        <td colSpan={daftarModulSistem.length + 2} className="p-12 text-center text-slate-400 font-medium">Belum ada struktur data peran terdaftar.</td>
                     </tr>
                   )}
                </tbody>
             </table>
          </div>
        </div>
      </main>
    </div>
  )
}