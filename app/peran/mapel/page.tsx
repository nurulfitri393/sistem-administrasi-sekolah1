'use client'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { bisaMengeditModul } from '@/lib/aksesPeran'
import CatatanHanyaLihat from '@/components/CatatanHanyaLihat'

import Sidebar from '@/components/Sidebar'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../supabase'
import { 
  Plus, Trash2, Edit2, Shield, Users, ArrowLeft, LogOut, Landmark, BookOpen, UserPlus
} from 'lucide-react'

export default function MasterMapelPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('guru')
  const bolehEdit = bisaMengeditModul('guru')
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

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Mapel...</div>
  if (diizinkanAkses === false) return null

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto space-y-6">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-black text-slate-900">Master Data Mata Pelajaran</h1>
           <p className="text-xs text-gray-500">Definisikan daftar mata pelajaran yang berlaku di lembaga instansi pendidikan.</p>
        </header>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6">
          {bolehEdit ? (
          <form onSubmit={handleSimpanMapel} className="space-y-4 md:col-span-1 border-r border-slate-100 pr-0 md:pr-4">
             <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Kode Mata Pelajaran</label>
                <input type="text" placeholder="Cth: MAT, BIO, EKO" value={kodeMapel} onChange={e => setKodeMapel(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A2FA0] uppercase" required />
             </div>
             <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nama Mata Pelajaran</label>
                <input type="text" placeholder="Cth: Matematika Lanjutan" value={namaMapel} onChange={e => setNamaMapel(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
             </div>
             <div className="flex gap-2 pt-1">
                <button type="submit" className="flex-1 bg-[#6A197D] text-white py-3 rounded-xl font-bold shadow-md hover:bg-[#571466] text-xs">
                  {editMapelId ? 'Simpan Perubahan' : '+ Tambah Mata Pelajaran'}
                </button>
                {editMapelId && <button type="button" onClick={() => { setEditMapelId(null); setKodeMapel(''); setNamaMapel('') }} className="px-5 bg-slate-100 rounded-xl font-bold text-slate-600 text-xs">Batal</button>}
             </div>
          </form>
          ) : (
            <div className="md:col-span-1 border-r border-slate-100 pr-0 md:pr-4">
              <CatatanHanyaLihat pesan="Anda tidak diberi izin untuk menambah/mengubah mata pelajaran. Daftar di samping tetap bisa dilihat." />
            </div>
          )}

          <div className="bg-slate-50/50 rounded-xl p-4 md:col-span-2 max-h-[350px] overflow-y-auto border border-slate-100">
             <div className="space-y-2">
                {daftarMapel.map(item => (
                  <div key={item.id} className="bg-white p-3.5 rounded-xl border border-slate-200 flex justify-between items-center text-xs shadow-sm">
                     <div>
                        <span className="bg-[#F7ECFA] text-[#571466] font-black px-2 py-0.5 rounded text-[10px] border border-[#F0DFF5] uppercase tracking-widest">{item.kode}</span>
                        <p className="font-extrabold text-slate-800 mt-1.5">{item.nama}</p>
                     </div>
                     {bolehEdit && (
                     <div className="flex gap-1">
                        <button onClick={() => handleEditMapelClick(item)} className="p-1 text-slate-400 hover:text-[#6A197D]"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleHapusMapelClick(item.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                     </div>
                     )}
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