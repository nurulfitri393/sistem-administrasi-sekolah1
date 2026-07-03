'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../supabase'
import { 
  Plus, Trash2, Edit2, Shield, Users, ArrowLeft, LogOut, Landmark, BookOpen, UserPlus
} from 'lucide-react'

export default function MasterMapelPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')

  const [daftarMapel, setDaftarMapel] = useState<any[]>([])
  const [namaMapel, setNamaMapel] = useState('')
  const [kodeMapel, setKodeMapel] = useState('')
  const [editMapelId, setEditMapelId] = useState<string | null>(null)

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

        const storedMapel = localStorage.getItem('master_mapel')
        if (storedMapel) setDaftarMapel(JSON.parse(storedMapel))
        else {
          const defaultMapel = [{ id: 'mapel-1', kode: 'MAT', nama: 'Matematika' }]
          setDaftarMapel(defaultMapel)
          localStorage.setItem('master_mapel', JSON.stringify(defaultMapel))
        }
        setLoading(false)
      }
    }
    checkAuth()
  }, [router])

  const handleSimpanMapel = (e: React.FormEvent) => {
    e.preventDefault()
    if (editMapelId) {
      const updated = daftarMapel.map(item => item.id === editMapelId ? { ...item, kode: kodeMapel, nama: namaMapel } : item)
      setDaftarMapel(updated); localStorage.setItem('master_mapel', JSON.stringify(updated)); setEditMapelId(null)
    } else {
      const newMapel = { id: 'mapel-' + Date.now(), kode: kodeMapel, nama: namaMapel }
      const updated = [...daftarMapel, newMapel]
      setDaftarMapel(updated); localStorage.setItem('master_mapel', JSON.stringify(updated))
    }
    setKodeMapel(''); setNamaMapel('')
  }

  const handleEditMapelClick = (item: any) => {
    setEditMapelId(item.id); setKodeMapel(item.kode); setNamaMapel(item.nama)
  }

  const handleHapusMapelClick = (id: string) => {
    if (confirm('Hapus mata pelajaran ini?')) {
      const filtered = daftarMapel.filter(item => item.id !== id)
      setDaftarMapel(filtered); localStorage.setItem('master_mapel', JSON.stringify(filtered))
    }
  }

  if (loading) return <div className="p-8 text-center font-semibold text-indigo-600">Memuat Modul Mapel...</div>

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen">
        <div className="overflow-y-auto">
          <div className="h-16 flex items-center px-6 border-b border-slate-200 bg-indigo-50/50">
            {logoInduk ? (
              <img src={logoInduk} alt="Logo" className="w-8 h-8 object-contain mr-3" />
            ) : (
              <Landmark className="w-6 h-6 text-indigo-600 mr-3" />
            )}
            <h2 className="text-xs font-black text-indigo-900 uppercase tracking-widest truncate max-w-[170px]">{namaInduk}</h2>
          </div>
          <nav className="p-4 space-y-1">
            <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <ArrowLeft className="w-4 h-4" /> Kembali ke Dasbor
            </a>
            <div className="pt-2 pb-1 px-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Sub-menu Folder Peran</div>
            <a href="/peran" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <Users className="w-4 h-4" /> Pembagian Peran
            </a>
            <a href="/peran/mapel" className="flex items-center gap-3 px-4 py-3 text-sm font-bold text-white bg-indigo-600 rounded-xl shadow-md">
              <BookOpen className="w-4 h-4" /> Kelola Mata Pelajaran
            </a>
            <a href="/peran/guru" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition">
              <UserPlus className="w-4 h-4" /> Kelola Data Guru
            </a>
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => { supabase.auth.signOut(); router.push('/') }} className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition">
            <LogOut className="w-4 h-4" /> Keluar Sistem
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto space-y-6">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-black text-slate-900">Master Data Mata Pelajaran</h1>
           <p className="text-xs text-gray-500">Definisikan daftar mata pelajaran yang berlaku di lembaga instansi pendidikan.</p>
        </header>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6">
          <form onSubmit={handleSimpanMapel} className="space-y-4 md:col-span-1 border-r border-slate-100 pr-0 md:pr-4">
             <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Kode Mata Pelajaran</label>
                <input type="text" placeholder="Cth: MAT, BIO, EKO" value={kodeMapel} onChange={e => setKodeMapel(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 uppercase" required />
             </div>
             <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nama Mata Pelajaran</label>
                <input type="text" placeholder="Cth: Matematika Lanjutan" value={namaMapel} onChange={e => setNamaMapel(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500" required />
             </div>
             <div className="flex gap-2 pt-1">
                <button type="submit" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-md hover:bg-indigo-700 text-xs">
                  {editMapelId ? 'Simpan Perubahan' : '+ Tambah Mata Pelajaran'}
                </button>
                {editMapelId && <button type="button" onClick={() => { setEditMapelId(null); setKodeMapel(''); setNamaMapel('') }} className="px-5 bg-slate-100 rounded-xl font-bold text-slate-600 text-xs">Batal</button>}
             </div>
          </form>

          <div className="bg-slate-50/50 rounded-xl p-4 md:col-span-2 max-h-[350px] overflow-y-auto border border-slate-100">
             <div className="space-y-2">
                {daftarMapel.map(item => (
                  <div key={item.id} className="bg-white p-3.5 rounded-xl border border-slate-200 flex justify-between items-center text-xs shadow-sm">
                     <div>
                        <span className="bg-indigo-50 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px] border border-indigo-100 uppercase tracking-widest">{item.kode}</span>
                        <p className="font-extrabold text-slate-800 mt-1.5">{item.nama}</p>
                     </div>
                     <div className="flex gap-1">
                        <button onClick={() => handleEditMapelClick(item)} className="p-1 text-slate-400 hover:text-indigo-600"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleHapusMapelClick(item.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                     </div>
                  </div>
                ))}
                {daftarMapel.length === 0 && <p className="text-center text-xs text-slate-400 py-12 font-medium">Belum ada master data mapel terdaftar.</p>}
             </div>
          </div>
        </div>
      </main>
    </div>
  )
}