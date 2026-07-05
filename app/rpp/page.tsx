'use client'

import Sidebar from '@/components/Sidebar'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { kunciTahun } from '@/lib/tahunAjaran'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { bisaMengeditModul, getCakupanMengajarGuru } from '@/lib/aksesPeran'
import CatatanHanyaLihat from '@/components/CatatanHanyaLihat'
import { 
  Clock, Trash2, Search, AlertTriangle, 
  Landmark, LogOut, Shield, BookOpen, CheckCircle,
  Building, CalendarDays, BarChart2, FileText, FileSpreadsheet, Home,
  Wand2, RefreshCw, Plus, Edit2, Check, Users, Layers, X
} from 'lucide-react'

export default function JadwalPelajaranPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('rpp')
  const bolehEdit = bisaMengeditModul('rpp')
  const cakupanGuru = getCakupanMengajarGuru() // null utk Admin, berisi guruId utk Guru
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')

  // Referensi Data Master
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [daftarRombel, setDaftarRombel] = useState<any[]>([])
  const [daftarMapel, setDaftarMapel] = useState<any[]>([])
  const [daftarGuru, setDaftarGuru] = useState<any[]>([])

  // State Penjadwalan
  const [daftarJadwal, setDaftarJadwal] = useState<any[]>([])
  const [modeTampil, setModeTampil] = useState<'keseluruhan' | 'unit'>('keseluruhan')
  const [unitFilter, setUnitFilter] = useState<string>('lembaga-induk')
  
  // Master Waktu
  const [daftarWaktu, setDaftarWaktu] = useState<any[]>([])
  const [labelWaktu, setLabelWaktu] = useState('')
  const [jamKeNomor, setJamKeNomor] = useState('1')
  const [waktuMulai, setWaktuMulai] = useState('07.30')
  const [waktuSelesai, setWaktuSelesai] = useState('08.10')
  const [jenisWaktu, setJenisWaktu] = useState<'mapel' | 'istirahat'>('mapel')

  // State Fitur Cari Guru & Rekap
  const [cariGuruId, setCariGuruId] = useState('')
  const [tabView, setTabView] = useState<'waktu' | 'input' | 'gabungan' | 'rekap_guru' | 'rekap_jadwal'>('input')

  // State Matriks Dinamis Melebar mendukung string rinci: { "guruId_mapelId_rombelId": "2, 3" }
  const [matriksRinciJp, setMatriksRinciJp] = useState<{ [key: string]: string }>({})

  // State Request Hari & JP Khusus per Pendidik: { "guruId_Senin": "2, 2" } atau "-"
  const [requestHariJp, setRequestHariJp] = useState<{ [key: string]: string }>({})

  // State Kelas Gabungan: [{ id, mapelId, rombelIds: [...], guruId, keterangan }]
  const [daftarKelasGabungan, setDaftarKelasGabungan] = useState<any[]>([])
  const [formGabunganMapelId, setFormGabunganMapelId] = useState('')
  const [formGabunganGuruId, setFormGabunganGuruId] = useState('')
  const [formGabunganRombelIds, setFormGabunganRombelIds] = useState<string[]>([])
  const [formGabunganKeterangan, setFormGabunganKeterangan] = useState('')

  // Maksimal JP Guru per Hari (default 10, bisa diatur)
  const [maksJpGuruPerHari, setMaksJpGuruPerHari] = useState(10)

  // Filter Hari Matriks Tabel Plot Bawah
  const [hariPlotTabel, setHariPlotTabel] = useState('Senin')

  // State Editing Cell Langsung Inline Matriks
  const [editingCell, setEditingCell] = useState<string | null>(null)
  const [editGuruMapel, setEditGuruMapel] = useState<string>('')

  const router = useRouter()
  const listHari = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
      } else {
        const email = session.user.email
        setUserEmail(session.user.email || 'Admin')

        // Pengecekan Akses Modul
        const storedGuru = localStorage.getItem('master_guru')
        const masterGuru = storedGuru ? JSON.parse(storedGuru) : []
        const guruLogin = masterGuru.find((g: any) => g.email === email)

        const storedPeran = localStorage.getItem('master_peran')
        const masterPeran = storedPeran ? JSON.parse(storedPeran) : []

        if (guruLogin) {
          const peranGuru = masterPeran.find((p: any) => p.id === guruLogin.peranId)
          if (!peranGuru || !peranGuru.akses.includes('jadwal')) {
            alert('Anda tidak memiliki hak akses untuk membuka Modul Jadwal Pelajaran.')
            router.push('/dashboard')
            return
          }
        }

        const storedInduk = localStorage.getItem('identitas_induk')
        if (storedInduk) {
          const parsed = JSON.parse(storedInduk)
          setNamaInduk(parsed.nama)
          setLogoInduk(parsed.logo_utama || parsed.logo || '')
        }

        const storedLembaga = localStorage.getItem('daftar_lembaga')
        if (storedLembaga) setDaftarLembaga(JSON.parse(storedLembaga))

        const storedRombel = localStorage.getItem('master_rombel')
        if (storedRombel) setDaftarRombel(JSON.parse(storedRombel))

        const storedMapel = localStorage.getItem('master_mapel')
        if (storedMapel) setDaftarMapel(JSON.parse(storedMapel))

        if (storedGuru) setDaftarGuru(JSON.parse(storedGuru))

        // Kalau yang login adalah Guru, kunci rekap ke dirinya sendiri --
        // tidak bisa melihat rekap beban JP guru lain.
        const cakupan = getCakupanMengajarGuru()
        if (cakupan?.guruId) setCariGuruId(cakupan.guruId)

        const storedJadwal = localStorage.getItem(kunciTahun('data_jadwal_pelajaran'))
        if (storedJadwal) setDaftarJadwal(JSON.parse(storedJadwal))

        const storedWaktu = localStorage.getItem(kunciTahun('master_pemetaan_waktu'))
        if (storedWaktu) setDaftarWaktu(JSON.parse(storedWaktu))

        const storedMatriksRinci = localStorage.getItem(kunciTahun('matriks_alokasi_rinci_samping'))
        if (storedMatriksRinci) setMatriksRinciJp(JSON.parse(storedMatriksRinci))

        const storedRequestHariJp = localStorage.getItem(kunciTahun('request_hari_jp_guru'))
        if (storedRequestHariJp) setRequestHariJp(JSON.parse(storedRequestHariJp))

        const storedKelasGabungan = localStorage.getItem(kunciTahun('master_kelas_gabungan'))
        if (storedKelasGabungan) setDaftarKelasGabungan(JSON.parse(storedKelasGabungan))

        const storedMaksJp = localStorage.getItem(kunciTahun('master_maks_jp_guru_per_hari'))
        if (storedMaksJp) setMaksJpGuruPerHari(Number(storedMaksJp) || 10)

        setLoading(false)
      }
    }
    checkAuth()
  }, [router])

  // --- CRUD MASTER PEMETAAN WAKTU ---
  const handleSimpanWaktu = (e: React.FormEvent) => {
    e.preventDefault()
    const newWaktu = {
      id: 'waktu-' + Date.now(),
      label: labelWaktu || (jenisWaktu === 'mapel' ? `Jam ke-${jamKeNomor}` : 'Istirahat'),
      jamKe: jamKeNomor,
      mulai: waktuMulai,
      selesai: waktuSelesai,
      jenis: jenisWaktu
    }
    const updated = [...daftarWaktu, newWaktu]
    setDaftarWaktu(updated)
    localStorage.setItem(kunciTahun('master_pemetaan_waktu'), JSON.stringify(updated))
    setLabelWaktu('')
  }

  const handleHapusWaktu = (id: string) => {
    if (confirm('Hapus slot waktu ini? (Akan menghapus jadwal yang menggunakannya)')) {
      const filtered = daftarWaktu.filter(item => item.id !== id)
      setDaftarWaktu(filtered)
      localStorage.setItem(kunciTahun('master_pemetaan_waktu'), JSON.stringify(filtered))
      
      const filterJadwal = daftarJadwal.filter(j => j.waktuId !== id)
      setDaftarJadwal(filterJadwal)
      localStorage.setItem(kunciTahun('data_jadwal_pelajaran'), JSON.stringify(filterJadwal))
    }
  }

  // --- SIMPAN MAKS JP GURU PER HARI ---
  const handleSimpanMaksJp = (val: number) => {
    setMaksJpGuruPerHari(val)
    localStorage.setItem(kunciTahun('master_maks_jp_guru_per_hari'), String(val))
  }

  // --- MATRIKS GURU DENGAN KELAS MELEBAR KE SAMPING BESERTA RINCIAN JP ---
  const handleMatriksRinciChange = (key: string, val: string) => {
     const updated = { ...matriksRinciJp, [key]: val }
     setMatriksRinciJp(updated)
     localStorage.setItem(kunciTahun('matriks_alokasi_rinci_samping'), JSON.stringify(updated))
  }

  const handleRequestHariJpChange = (key: string, val: string) => {
     const updated = { ...requestHariJp, [key]: val }
     setRequestHariJp(updated)
     localStorage.setItem(kunciTahun('request_hari_jp_guru'), JSON.stringify(updated))
  }

  const hitungTotalJpFromString = (strVal: string) => {
     if (!strVal) return 0
     return strVal.split(',')
       .map(item => Number(item.trim()))
       .filter(num => !isNaN(num))
       .reduce((sum, current) => sum + current, 0)
  }

  const hitungJumlahSesiFromString = (strVal: string) => {
     if (!strVal) return 0
     return strVal.split(',')
       .map(item => Number(item.trim()))
       .filter(num => !isNaN(num) && num > 0).length
  }

  const getMatriksRows = () => {
    const rows: any[] = []
    daftarGuru.forEach(guru => {
       if (guru.mapelIds && guru.mapelIds.length > 0 && guru.rombelIds && guru.rombelIds.length > 0) {
          guru.mapelIds.forEach((mId: string) => {
             const mapel = daftarMapel.find(m => m.id === mId)
             if (mapel) {
                rows.push({ guru, mapel })
             }
          })
       }
    })
    return rows
  }

  const matriksRows = getMatriksRows()

  // ====================================================================
  // --- HELPER KELAS GABUNGAN ---
  // Mencari apakah ada definisi gabungan untuk mapel tertentu yang mencakup
  // SEMUA rombel yang sedang dibandingkan (rombelA & rombelB ada di rombelIds yang sama).
  // ====================================================================
  const isPasanganRombelGabungan = (mapelId: string, rombelIdA: string, rombelIdB: string) => {
     if (rombelIdA === rombelIdB) return true
     return daftarKelasGabungan.some(kg => 
        kg.mapelId === mapelId &&
        kg.rombelIds?.includes(rombelIdA) &&
        kg.rombelIds?.includes(rombelIdB)
     )
  }

  const getKelasGabunganUntukMapel = (mapelId: string) => {
     return daftarKelasGabungan.filter(kg => kg.mapelId === mapelId)
  }

  // --- CRUD KELAS GABUNGAN ---
  const toggleFormGabunganRombel = (rombelId: string) => {
     setFormGabunganRombelIds(prev => 
        prev.includes(rombelId) ? prev.filter(id => id !== rombelId) : [...prev, rombelId]
     )
  }

  const handleSimpanKelasGabungan = (e: React.FormEvent) => {
     e.preventDefault()
     if (!formGabunganMapelId || formGabunganRombelIds.length < 2) {
        alert('Pilih mata pelajaran dan minimal 2 rombel/kelas yang akan digabungkan.')
        return
     }
     const newGabungan = {
        id: 'gabung-' + Date.now(),
        mapelId: formGabunganMapelId,
        guruId: formGabunganGuruId || null,
        rombelIds: formGabunganRombelIds,
        keterangan: formGabunganKeterangan
     }
     const updated = [...daftarKelasGabungan, newGabungan]
     setDaftarKelasGabungan(updated)
     localStorage.setItem(kunciTahun('master_kelas_gabungan'), JSON.stringify(updated))
     setFormGabunganMapelId('')
     setFormGabunganGuruId('')
     setFormGabunganRombelIds([])
     setFormGabunganKeterangan('')
  }

  const handleHapusKelasGabungan = (id: string) => {
     if (confirm('Hapus aturan kelas gabungan ini? Jadwal yang sudah digabung sebelumnya tidak otomatis terhapus, namun validasi gabungan untuk kombinasi ini tidak lagi berlaku.')) {
        const filtered = daftarKelasGabungan.filter(kg => kg.id !== id)
        setDaftarKelasGabungan(filtered)
        localStorage.setItem(kunciTahun('master_kelas_gabungan'), JSON.stringify(filtered))
     }
  }

  // ====================================================================
  // --- HELPER VALIDASI: TOTAL JP TERPAKAI GURU DI SUATU HARI ---
  // (Dihitung dari SLOT WAKTU UNIK (hari+waktuId) bertipe mapel yang sudah terjadwal untuk
  // guru tsb pada hari itu. Memakai slot unik -- bukan jumlah baris jadwal -- supaya kelas
  // gabungan (1 guru mengajar 2 rombel sekaligus di jam yang sama) tetap dihitung 1 JP, bukan 2 JP.)
  // ====================================================================
  const hitungJpGuruPadaHari = (guruId: string, hari: string, kecualiJadwalId?: string) => {
     const slotUnik = new Set<string>()
     daftarJadwal.forEach(j => {
        if (j.guruId !== guruId || j.hari !== hari) return
        if (kecualiJadwalId && j.id === kecualiJadwalId) return
        const sw = daftarWaktu.find(w => w.id === j.waktuId)
        if (sw && sw.jenis === 'mapel') slotUnik.add(j.waktuId)
     })
     return slotUnik.size
  }

  // ====================================================================
  // --- HELPER VALIDASI: TOTAL JP TERPAKAI UNTUK SATU PASANGAN GURU-MAPEL-ROMBEL ---
  // Dihitung berdasarkan jumlah SESI unik (kombinasi hari+blok berurutan dianggap 1 sesi
  // secara sederhana: setiap hari yang punya jadwal mapel ini di rombel ini = 1 sesi)
  // ====================================================================
  const hitungJpDanSesiTerpakai = (guruId: string, mapelId: string, rombelId: string, kecualiJadwalId?: string) => {
     const jadwalTerkait = daftarJadwal.filter(j => 
        j.guruId === guruId && j.mapelId === mapelId && j.rombelId === rombelId &&
        (!kecualiJadwalId || j.id !== kecualiJadwalId)
     )
     const hariSet = new Set(jadwalTerkait.map(j => j.hari))
     return {
        totalJp: jadwalTerkait.length,
        jumlahSesi: hariSet.size,
        perHari: Array.from(hariSet).map(h => ({
           hari: h,
           jumlah: jadwalTerkait.filter(j => j.hari === h).length
        }))
     }
  }

  // ====================================================================
  // --- VALIDASI UTAMA SEBELUM MENYIMPAN SATU SLOT JADWAL ---
  // Mengembalikan { ok: boolean, pesan?: string }
  // tambahJp: berapa JP yang akan ditambahkan oleh aksi ini (biasanya 1 untuk edit per-sel,
  // tapi dipakai juga oleh generator otomatis dengan nilai custom)
  // ====================================================================
  const validasiSlotJadwal = (params: {
     hari: string
     waktuId: string
     rombelId: string
     guruId: string
     mapelId: string
     kecualiJadwalId?: string
     tambahJpUntukSesiBaru?: number // jika sesi BARU (hari baru) ditambahkan, berapa JP yg masuk di sesi ini
  }) => {
     const { hari, waktuId, rombelId, guruId, mapelId, kecualiJadwalId, tambahJpUntukSesiBaru } = params
     const sw = daftarWaktu.find(w => w.id === waktuId)
     if (!sw || sw.jenis !== 'mapel') return { ok: true }

     // 1. CEK BENTROK GURU (guru yang sama tidak boleh mengajar 2 tempat di hari & jam yang sama)
     //    KECUALI jika jadwal lain itu adalah mapel yang SAMA dan rombelnya merupakan pasangan
     //    kelas gabungan terdaftar (guru memang sengaja mengajar 2 rombel gabungan di jam yang sama).
     const bentrokGuru = daftarJadwal.find(j => {
        if (j.id === kecualiJadwalId) return false
        if (!(j.hari === hari && j.waktuId === waktuId && j.guruId === guruId)) return false
        const isGabungan = j.mapelId === mapelId && isPasanganRombelGabungan(mapelId, rombelId, j.rombelId)
        return !isGabungan
     })
     if (bentrokGuru) {
        const namaGuruBentrok = daftarGuru.find(g => g.id === guruId)?.nama || 'Pendidik ini'
        const rombelLain = daftarRombel.find(r => r.id === bentrokGuru.rombelId)?.nama || bentrokGuru.rombelId
        return { ok: false, pesan: `BENTROK PENDIDIK: ${namaGuruBentrok} sudah dijadwalkan mengajar di Kelas ${rombelLain} pada ${hari}, jam yang sama.` }
     }

     // 2. CEK BENTROK ROMBEL (rombel yang sama tidak boleh ada 2 mapel di jam yang sama)
     //    KECUALI jika kombinasi rombel tersebut terdaftar sebagai kelas gabungan untuk mapel yang sama.
     const jadwalLainDiRombelJamIni = daftarJadwal.filter(j => 
        j.id !== kecualiJadwalId &&
        j.hari === hari && j.waktuId === waktuId && j.rombelId === rombelId
     )
     for (const jLain of jadwalLainDiRombelJamIni) {
        const isGabungan = jLain.mapelId === mapelId && isPasanganRombelGabungan(mapelId, rombelId, jLain.rombelId)
        if (!isGabungan) {
           const namaRombel = daftarRombel.find(r => r.id === rombelId)?.nama || rombelId
           const namaMapelLain = daftarMapel.find(m => m.id === jLain.mapelId)?.nama || jLain.mapelId
           return { ok: false, pesan: `BENTROK ROMBEL: Kelas ${namaRombel} sudah memiliki jadwal "${namaMapelLain}" pada ${hari}, jam yang sama.` }
        }
     }

     // 2b. JUGA cek dari sisi rombel lain: jika rombel lain pada jam ini terisi mapel sama tapi BUKAN
     //     anggota gabungan dari rombel kita, dan rombel itu dipakai guru yang sama -> sudah tercover di cek 1.
     //     Cek tambahan: pastikan jika ini bagian dari gabungan, semua rombel gabungan memang diisi guru yang sama
     //     (silent, tidak diblokir, hanya informasi - tidak perlu validasi keras di sini)

     // 3. CEK MAKSIMAL JP GURU PER HARI
     //    Jika slot waktu (hari+waktuId) ini SENDIRI sudah dihitung untuk guru ini (kasus: menambah
     //    rombel pasangan gabungan ke slot yang sudah terisi guru yang sama), jangan tambahkan +1 lagi.
     const slotIniSudahDihitungUntukGuru = daftarJadwal.some(j => 
        j.id !== kecualiJadwalId && j.guruId === guruId && j.hari === hari && j.waktuId === waktuId
     )
     const jpTerpakaiHariIni = hitungJpGuruPadaHari(guruId, hari, kecualiJadwalId)
     const proyeksiJpHariIni = slotIniSudahDihitungUntukGuru ? jpTerpakaiHariIni : jpTerpakaiHariIni + 1
     if (proyeksiJpHariIni > maksJpGuruPerHari) {
        const namaGuru = daftarGuru.find(g => g.id === guruId)?.nama || 'Pendidik ini'
        return { ok: false, pesan: `MELEBIHI MAKS JP HARIAN: ${namaGuru} sudah mengajar ${jpTerpakaiHariIni} JP pada ${hari}. Batas maksimal adalah ${maksJpGuruPerHari} JP/hari, sehingga tidak bisa ditambah lagi.` }
     }

     // 4. CEK MAKSIMAL ALOKASI JP MAPEL-ROMBEL (sesuai matriks alokasi & jumlah sesi)
     const keyMatriks = `${guruId}_${mapelId}_${rombelId}`
     const strAlokasi = matriksRinciJp[keyMatriks] || ''
     const totalAlokasi = hitungTotalJpFromString(strAlokasi)
     const sesiAlokasi = hitungJumlahSesiFromString(strAlokasi)

     if (totalAlokasi > 0) {
        const { totalJp: jpTerpakai, jumlahSesi: sesiTerpakai, perHari } = hitungJpDanSesiTerpakai(guruId, mapelId, rombelId, kecualiJadwalId)
        const sudahAdaDiHariIni = perHari.some(p => p.hari === hari)
        const sesiSetelahIni = sudahAdaDiHariIni ? sesiTerpakai : sesiTerpakai + 1

        if (jpTerpakai + 1 > totalAlokasi) {
           const namaMapel = daftarMapel.find(m => m.id === mapelId)?.nama || mapelId
           const namaRombel = daftarRombel.find(r => r.id === rombelId)?.nama || rombelId
           return { ok: false, pesan: `MELEBIHI ALOKASI JP: Mapel "${namaMapel}" di Kelas ${namaRombel} sudah terisi ${jpTerpakai} dari total alokasi ${totalAlokasi} JP (${sesiAlokasi > 0 ? sesiAlokasi : '?'} sesi: ${strAlokasi}). Tidak bisa menambah JP lagi di hari ini.` }
        }
        if (sesiAlokasi > 0 && sesiSetelahIni > sesiAlokasi) {
           const namaMapel = daftarMapel.find(m => m.id === mapelId)?.nama || mapelId
           const namaRombel = daftarRombel.find(r => r.id === rombelId)?.nama || rombelId
           return { ok: false, pesan: `MELEBIHI JUMLAH SESI: Mapel "${namaMapel}" di Kelas ${namaRombel} direncanakan hanya ${sesiAlokasi} sesi pertemuan (${strAlokasi}). Menambah di hari baru ini akan menjadi sesi ke-${sesiSetelahIni}, melebihi rencana.` }
        }
     }

     return { ok: true }
  }

  // --- LOGIKA GENERATE (DIROMBAK v2): SELAIN BLOK UTUH & BEDA HARI PER SESI, SEKARANG JUGA
  //     MENERAPKAN "ZONA JAM" PER SESI AGAR PEMBAGIAN ADIL SEPANJANG HARI, DAN DISTRIBUSI
  //     ROUND-ROBIN ANTAR ROMBEL UNTUK MAPEL DENGAN 1 SESI SAJA (SUPAYA TIDAK SEMUA ROMBEL
  //     KEBAGIAN JAM PAGI ATAU JAM SIANG SAJA). ---
  //
  //     ATURAN ZONA (berdasar JUMLAH SESI dari alokasi, otomatis):
  //     - 2 sesi -> sesi-1 dicari di jam ke-1..6, sesi-2 dicari di jam ke-7..10 (beda hari wajib)
  //     - 3 sesi -> sesi-1 di jam ke-1..4, sesi-2 di jam ke-5..6, sesi-3 di jam ke-7..10
  //     - 1 sesi -> tanpa zona tetap, namun titik awal pencarian digilir (round-robin) antar
  //       rombel yang sama-sama mendapat mapel ini, supaya tidak semua rombel selalu di pagi/siang.
  const handlePlotOtomatisMatriks = () => {
     if (matriksRows.length === 0 || daftarWaktu.length === 0) {
        alert('Data Pendidik / Matriks Rombel atau Master Waktu belum tersedia.')
        return
     }
     if (!confirm('Generate jadwal otomatis akan menimpa jadwal yang sudah ada. Lanjutkan?')) return

     const generatedJadwal: any[] = []
     const slotMapel = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
     const peringatanGenerate: string[] = []

     if (slotMapel.length === 0) {
        alert('Belum ada Master Waktu bertipe "Jam Pelajaran (JP)". Tambahkan dahulu di Tab Master Waktu.')
        return
     }

     // Indeks slot (0-based) berdasarkan nomor urut jamKe (1-based) -> dipakai untuk menentukan zona.
     // Jika jumlah slot lebih sedikit dari batas zona (mis. sekolah hanya punya 8 JP/hari), zona akan
     // otomatis menyesuaikan (clamp) ke jumlah slot yang ada agar tidak gagal generate karena zona kosong.
     const jumlahSlotPerHari = slotMapel.length
     const zonaUntukSesi = (totalSesi: number, urutanSesiKe0: number): { awalIdx: number, akhirIdx: number } => {
        // urutanSesiKe0: 0 = sesi pertama, 1 = sesi kedua, dst.
        const clamp = (n: number) => Math.max(0, Math.min(n, jumlahSlotPerHari - 1))
        if (totalSesi === 2) {
           // sesi1: jam 1-6 (idx 0-5) | sesi2: jam 7-10 (idx 6-9)
           if (urutanSesiKe0 === 0) return { awalIdx: clamp(0), akhirIdx: clamp(5) }
           return { awalIdx: clamp(6), akhirIdx: clamp(9) }
        }
        if (totalSesi === 3) {
           // sesi1: jam 1-4 (idx 0-3) | sesi2: jam 5-6 (idx 4-5) | sesi3: jam 7-10 (idx 6-9)
           if (urutanSesiKe0 === 0) return { awalIdx: clamp(0), akhirIdx: clamp(3) }
           if (urutanSesiKe0 === 1) return { awalIdx: clamp(4), akhirIdx: clamp(5) }
           return { awalIdx: clamp(6), akhirIdx: clamp(9) }
        }
        // Untuk 1 sesi atau >3 sesi (kasus tidak standar): tanpa zona tetap, bebas sepanjang hari.
        return { awalIdx: 0, akhirIdx: jumlahSlotPerHari - 1 }
     }

     // Cek apakah satu slot (hari+waktuId) bebas dipakai untuk SET rombel tertentu (1 rombel biasa,
     // atau beberapa rombel sekaligus jika kelas gabungan) oleh guru tertentu.
     const slotBebasUntukSetRombel = (hari: string, waktuId: string, setRombelId: string[], guruId: string) => {
        const bentrokGuru = generatedJadwal.some(x => 
           x.hari === hari && x.waktuId === waktuId && x.guruId === guruId && !setRombelId.includes(x.rombelId)
        )
        if (bentrokGuru) return false
        for (const rIdCek of setRombelId) {
           const sudahTerisi = generatedJadwal.some(x => x.hari === hari && x.waktuId === waktuId && x.rombelId === rIdCek)
           if (sudahTerisi) return false
        }
        return true
     }

     const sisaKapasitasGuruDiHari = (guruId: string, hari: string) => {
        const slotUnik = new Set(generatedJadwal.filter(x => x.hari === hari && x.guruId === guruId).map(x => x.waktuId))
        return maksJpGuruPerHari - slotUnik.size
     }

     // Mencari & menempatkan satu BLOK berurutan sepanjang `panjangBlok` slot, dimulai di hari `hari`,
     // dengan titik awal blok WAJIB berada di dalam [awalIdx, akhirIdx] (zona jam), dan opsional
     // digeser oleh `offsetPreferensi` (dipakai untuk round-robin antar rombel pada mapel 1 sesi).
     // Mengembalikan true jika berhasil menempatkan SELURUH blok (all-or-nothing) DI DALAM ZONA.
     const cobaTempatkanBlokDiHari = (
        hari: string, panjangBlok: number, setRombelId: string[], guruId: string, mapelId: string,
        zona: { awalIdx: number, akhirIdx: number }, offsetPreferensi: number = 0
     ) => {
        if (sisaKapasitasGuruDiHari(guruId, hari) < panjangBlok) return false
        const batasAwalMaksimal = zona.akhirIdx - panjangBlok + 1
        if (batasAwalMaksimal < zona.awalIdx) return false // zona terlalu sempit untuk blok ini

        // Susun urutan titik awal yang dicoba: mulai dari offsetPreferensi (untuk round-robin),
        // lalu sisanya berurutan di dalam zona.
        const kandidatAwal: number[] = []
        for (let a = zona.awalIdx; a <= batasAwalMaksimal; a++) kandidatAwal.push(a)
        kandidatAwal.sort((a, b) => {
           const da = Math.abs(a - offsetPreferensi)
           const db = Math.abs(b - offsetPreferensi)
           return da - db
        })

        for (const awal of kandidatAwal) {
           let semuaBebas = true
           for (let k = 0; k < panjangBlok; k++) {
              const slotCek = slotMapel[awal + k]
              if (!slotCek || !slotBebasUntukSetRombel(hari, slotCek.id, setRombelId, guruId)) { semuaBebas = false; break }
           }
           if (semuaBebas) {
              for (let k = 0; k < panjangBlok; k++) {
                 const slotTarget = slotMapel[awal + k]
                 setRombelId.forEach(rIdTarget => {
                    generatedJadwal.push({
                       id: `auto-${guruId}-${rIdTarget}-${mapelId}-${hari}-${slotTarget.id}-${Math.random().toString(36).slice(2, 8)}`,
                       hari,
                       waktuId: slotTarget.id,
                       rombelId: rIdTarget,
                       guruId,
                       mapelId,
                       modeTampil,
                       unitFilter
                    })
                 })
              }
              return true
           }
        }
        return false
     }

     // Susun daftar pekerjaan unik per (guru, mapel) dengan SET rombel yang mencakup pasangan gabungan,
     // supaya gabungan ditempatkan dalam satu kali proses, bukan rombel demi rombel sendiri-sendiri.
     type Pekerjaan = { guru: any, mapelId: string, setRombelId: string[], strAlokasi: string }
     const pekerjaanList: Pekerjaan[] = []
     const sudahDiproses = new Set<string>()

     daftarGuru.forEach(guru => {
        if (!guru.mapelIds?.length || !guru.rombelIds?.length) return
        guru.mapelIds.forEach((mId: string) => {
           guru.rombelIds.forEach((rId: string) => {
              const kunciCek = `${guru.id}_${mId}_${rId}`
              if (sudahDiproses.has(kunciCek)) return
              const strRinci = matriksRinciJp[kunciCek] || ""
              if (!strRinci) { sudahDiproses.add(kunciCek); return }

              const aturanGabungan = daftarKelasGabungan.find(kg => kg.mapelId === mId && kg.rombelIds?.includes(rId))
              let setRombelId = [rId]
              if (aturanGabungan) {
                 const kandidatPasangan = aturanGabungan.rombelIds.filter((rid: string) => {
                    if (rid === rId) return true
                    const keyPasangan = `${guru.id}_${mId}_${rid}`
                    return (matriksRinciJp[keyPasangan] || "") === strRinci && guru.rombelIds.includes(rid)
                 })
                 if (kandidatPasangan.length > 1) setRombelId = kandidatPasangan
              }
              setRombelId.forEach(rid => sudahDiproses.add(`${guru.id}_${mId}_${rid}`))

              pekerjaanList.push({ guru, mapelId: mId, setRombelId, strAlokasi: strRinci })
           })
        })
     })

     // --- Hitung urutan round-robin per MAPEL untuk pekerjaan dengan 1 SESI saja ---
     // Tujuannya: rombel pertama yang mendapat mapel ini diutamakan di awal hari, rombel berikutnya
     // digeser sejauh `panjangBlok` slot, dst -- berputar (modulo) sepanjang hari -- supaya tidak
     // semua rombel selalu kebagian jam pagi (atau jam siang) untuk mapel yang sama.
     const urutanRombelPerMapelSesiTunggal: { [mapelId: string]: string[] } = {}
     pekerjaanList.forEach(({ mapelId, setRombelId, strAlokasi }) => {
        const arrSesiCek = strAlokasi.split(',').map(x => Number(x.trim())).filter(x => !isNaN(x) && x > 0)
        if (arrSesiCek.length !== 1) return
        const kunciMapel = mapelId
        if (!urutanRombelPerMapelSesiTunggal[kunciMapel]) urutanRombelPerMapelSesiTunggal[kunciMapel] = []
        // Pakai representasi gabungan (join) sebagai 1 "slot urutan" supaya kelas gabungan tetap dianggap 1 unit
        const repr = setRombelId.slice().sort().join('+')
        if (!urutanRombelPerMapelSesiTunggal[kunciMapel].includes(repr)) {
           urutanRombelPerMapelSesiTunggal[kunciMapel].push(repr)
        }
     })

     pekerjaanList.forEach(({ guru, mapelId, setRombelId, strAlokasi }) => {
        const arrSesi = strAlokasi.split(',').map(x => Number(x.trim())).filter(x => !isNaN(x) && x > 0)
        if (arrSesi.length === 0) return
        const totalAlokasi = arrSesi.reduce((s, n) => s + n, 0)

        const hariTerlarang = new Set(
           listHari.filter(h => (requestHariJp[`${guru.id}_${h}`] || '').trim() === '-')
        )
        const hariDenganRequest = listHari.filter(h => {
           const v = (requestHariJp[`${guru.id}_${h}`] || '').trim()
           return v !== '' && v !== '-'
        })

        const hariTerpakaiUntukMapelIni = new Set<string>()
        let jpBerhasil = 0
        let sesiBerhasil = 0

        // Offset round-robin (hanya relevan untuk pekerjaan 1 sesi)
        let offsetRoundRobin = 0
        if (arrSesi.length === 1) {
           const repr = setRombelId.slice().sort().join('+')
           const urutan = urutanRombelPerMapelSesiTunggal[mapelId] || []
           const posisiKe = Math.max(0, urutan.indexOf(repr))
           const panjangBlokSesiIni = arrSesi[0]
           // geser titik awal sejauh (posisiKe * panjangBlok), lalu modulo jumlah slot supaya berputar
           offsetRoundRobin = jumlahSlotPerHari > 0 ? (posisiKe * panjangBlokSesiIni) % jumlahSlotPerHari : 0
        }

        arrSesi.forEach((panjangBlok, urutanSesiKe0) => {
           const zona = zonaUntukSesi(arrSesi.length, urutanSesiKe0)
           const kandidatHari = [
              ...hariDenganRequest,
              ...listHari.filter(h => !hariDenganRequest.includes(h))
           ].filter(h => !hariTerlarang.has(h) && !hariTerpakaiUntukMapelIni.has(h))

           let ditempatkan = false
           for (const hariCoba of kandidatHari) {
              if (cobaTempatkanBlokDiHari(hariCoba, panjangBlok, setRombelId, guru.id, mapelId, zona, offsetRoundRobin)) {
                 hariTerpakaiUntukMapelIni.add(hariCoba)
                 jpBerhasil += panjangBlok
                 sesiBerhasil += 1
                 ditempatkan = true
                 break
              }
           }
           if (!ditempatkan) {
              const namaGuru = guru.nama
              const namaMapel = daftarMapel.find(m => m.id === mapelId)?.nama || mapelId
              const namaRombelGab = setRombelId.map(rid => daftarRombel.find(r => r.id === rid)?.nama || rid).join(' & ')
              const labelZona = arrSesi.length >= 2 ? ` (zona jam ke-${zona.awalIdx + 1} s/d ke-${zona.akhirIdx + 1})` : ''
              peringatanGenerate.push(`${namaGuru} - ${namaMapel} (Kelas ${namaRombelGab}): sesi ke-${urutanSesiKe0 + 1} (${panjangBlok} JP)${labelZona} TIDAK berhasil ditempatkan di hari manapun (zona penuh / bentrok / maks JP harian tercapai / hari tersedia habis).`)
           }
        })

        if (totalAlokasi > 0 && jpBerhasil < totalAlokasi) {
           const namaGuru = guru.nama
           const namaMapel = daftarMapel.find(m => m.id === mapelId)?.nama || mapelId
           const namaRombelGab = setRombelId.map(rid => daftarRombel.find(r => r.id === rid)?.nama || rid).join(' & ')
           peringatanGenerate.push(`${namaGuru} - ${namaMapel} (Kelas ${namaRombelGab}): total hanya ${jpBerhasil}/${totalAlokasi} JP (${sesiBerhasil}/${arrSesi.length} sesi) berhasil dialokasikan.`)
        }
     })

     setDaftarJadwal(generatedJadwal)
     localStorage.setItem(kunciTahun('data_jadwal_pelajaran'), JSON.stringify(generatedJadwal))

     if (peringatanGenerate.length > 0) {
        alert('Generate selesai dengan beberapa CATATAN (alokasi belum penuh karena zona jam penuh / bentrok / slot habis / maks JP harian):\n\n' + peringatanGenerate.slice(0, 15).join('\n') + (peringatanGenerate.length > 15 ? `\n...dan ${peringatanGenerate.length - 15} catatan lainnya.` : ''))
     } else {
        alert('Matriks plot jadwal otomatis berhasil disinkronkan dan di-generate sesuai alokasi JP, zona jam per sesi, distribusi adil antar rombel, batas harian, dan kelas gabungan!')
     }
  }

  // --- EDIT & KOREKSI LANGSUNG INLINE MATRIKS ---
  const handleCellClick = (cellKey: string, currentJadwal: any) => {
     setEditingCell(cellKey)
     if (currentJadwal) {
        setEditGuruMapel(`${currentJadwal.guruId}|${currentJadwal.mapelId}`)
     } else {
        setEditGuruMapel('')
     }
  }

  const handleInlineCellSave = (hari: string, waktuId: string, rombelId: string, currentJadwalItem: any) => {
     if (!editGuruMapel) {
        if (currentJadwalItem) {
           const filtered = daftarJadwal.filter(j => j.id !== currentJadwalItem.id)
           setDaftarJadwal(filtered); localStorage.setItem(kunciTahun('data_jadwal_pelajaran'), JSON.stringify(filtered))
        }
     } else {
        const [gId, mId] = editGuruMapel.split('|')

        const hasil = validasiSlotJadwal({
           hari, waktuId, rombelId, guruId: gId, mapelId: mId,
           kecualiJadwalId: currentJadwalItem?.id
        })

        if (!hasil.ok) {
           alert(`⚠️ TIDAK BISA DISIMPAN\n\n${hasil.pesan}`)
           return
        }

        if (currentJadwalItem) {
           const updated = daftarJadwal.map(j => j.id === currentJadwalItem.id ? {
              ...j,
              hari,
              waktuId,
              rombelId,
              guruId: gId,
              mapelId: mId
           } : j)
           setDaftarJadwal(updated); localStorage.setItem(kunciTahun('data_jadwal_pelajaran'), JSON.stringify(updated))
        } else {
           const newJadwal = {
              id: 'jdwl-' + Date.now(),
              hari,
              waktuId,
              rombelId,
              guruId: gId,
              mapelId: mId,
              modeTampil,
              unitFilter
           }
           const updated = [...daftarJadwal, newJadwal]
           setDaftarJadwal(updated); localStorage.setItem(kunciTahun('data_jadwal_pelajaran'), JSON.stringify(updated))
        }
     }
     setEditingCell(null)
     setEditGuruMapel('')
  }

  const rekapJamMengajar = () => {
    const rekapSet: { [guruId: string]: Set<string> } = {}
    daftarJadwal.forEach(j => {
       const sw = daftarWaktu.find(w => w.id === j.waktuId)
       if (!sw || sw.jenis !== 'mapel') return
       if (!rekapSet[j.guruId]) rekapSet[j.guruId] = new Set()
       rekapSet[j.guruId].add(`${j.hari}_${j.waktuId}`)
    })
    const rekap: { [key: string]: number } = {}
    Object.keys(rekapSet).forEach(gId => { rekap[gId] = rekapSet[gId].size })
    return rekap
  }

  const rekapJamMengajarPerHari = (guruId: string) => {
     const rekap: { [hari: string]: number } = {}
     listHari.forEach(h => { rekap[h] = hitungJpGuruPadaHari(guruId, h) })
     return rekap
  }

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Penjadwalan...</div>
  if (diizinkanAkses === false) return null

  const slotMapelUrut = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))

  const getDaftarGuruTersediaUntukRombel = (rombelId: string) => {
     return daftarGuru.filter(g => g.rombelIds?.includes(rombelId))
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      
      {/* --- SIDEBAR --- */}
      <Sidebar />

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-8">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-black text-slate-900">Modul Pengaturan Jadwal Pelajaran</h1>
           <p className="text-xs text-gray-500">Petakan master durasi waktu, plot matriks menyamping dan request ketersediaan hari, kelola kelas gabungan, serta koreksi jadwal langsung via sel matriks dengan validasi otomatis.</p>
        </header>

        {/* --- KONTROL TAMPILAN MODE & NAVIGASI TAB --- */}
        <section className="bg-[#F7ECFA]/50 border border-[#F0DFF5] p-6 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
           <div>
              <label className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider mb-1.5 block">Mode Tampilan Jadwal</label>
              <select value={modeTampil} onChange={e => setModeTampil(e.target.value as any)} className="w-full px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]">
                 <option value="keseluruhan">Mode Keseluruhan (Unit & Pusat)</option>
                 <option value="unit">Mode Unit Lembaga Cabang</option>
              </select>
           </div>
           
           {modeTampil === 'unit' && (
             <div>
                <label className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider mb-1.5 block">Pilih Unit Cabang Ditampilkan</label>
                <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="w-full px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]">
                   <option value="lembaga-induk">Lembaga Induk / Yayasan Pusat</option>
                   {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
                </select>
             </div>
           )}

           <div>
              <label className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider mb-1.5 block">Maks. JP Mengajar / Hari (per Pendidik)</label>
              {bolehEdit ? (
              <input 
                type="number" 
                min={1}
                value={maksJpGuruPerHari} 
                onChange={e => handleSimpanMaksJp(Number(e.target.value) || 1)} 
                className="w-full px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]" 
              />
              ) : (
                <p className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50 font-bold text-slate-500">{maksJpGuruPerHari} JP/hari</p>
              )}
           </div>

           <div className="flex bg-white rounded-xl border border-slate-200 p-1.5 self-center justify-self-end w-full md:col-span-3 flex-wrap gap-1">
              <button onClick={() => setTabView('waktu')} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === 'waktu' ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>1. Master Waktu</button>
              <button onClick={() => setTabView('gabungan')} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === 'gabungan' ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>2. Kelas Gabungan</button>
              <button onClick={() => setTabView('input')} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === 'input' ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>3. Input Matriks</button>
              <button onClick={() => setTabView('rekap_guru')} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === 'rekap_guru' ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>4. Rekap Guru</button>
              <button onClick={() => setTabView('rekap_jadwal')} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === 'rekap_jadwal' ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>5. Rekap Jadwal</button>
           </div>
        </section>

        {/* --- TAB 1 : PEMETAAN WAKTU TIAP JP & ISTIRAHAT --- */}
        {tabView === 'waktu' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             {bolehEdit ? (
             <form onSubmit={handleSimpanWaktu} className="space-y-4 xl:col-span-1 border-r border-slate-100 pr-0 xl:pr-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                   <Clock className="w-4 h-4 text-[#6A197D]" />
                   <h2 className="text-xs font-black text-slate-700">Petakan Slot Durasi Waktu</h2>
                </div>
                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tipe Slot Waktu</label>
                   <select value={jenisWaktu} onChange={e => setJenisWaktu(e.target.value as any)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                      <option value="mapel">Jam Pelajaran (JP)</option>
                      <option value="istirahat">Waktu Istirahat / Sholat</option>
                   </select>
                </div>
                
                {jenisWaktu === 'mapel' && (
                  <div>
                     <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Urutan Jam Ke- (Nomor Slot)</label>
                     <input type="text" placeholder="Cth: 1 atau 2" value={jamKeNomor} onChange={e => setJamKeNomor(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
                  </div>
                )}
                
                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Label / Keterangan (Opsional)</label>
                   <input type="text" placeholder="Cth: Istirahat 1 atau Jam ke-1" value={labelWaktu} onChange={e => setLabelWaktu(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Waktu Mulai (Cth: 07.30)</label>
                      <input type="text" placeholder="07.30" value={waktuMulai} onChange={e => setWaktuMulai(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
                   </div>
                   <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Waktu Selesai (Cth: 08.10)</label>
                      <input type="text" placeholder="08.10" value={waktuSelesai} onChange={e => setWaktuSelesai(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
                   </div>
                </div>

                <button type="submit" className="w-full bg-[#6A197D] text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-[#571466] transition mt-6">+ Tambahkan Master Waktu</button>
             </form>
             ) : (
               <div className="xl:col-span-1 border-r border-slate-100 pr-0 xl:pr-6">
                 <CatatanHanyaLihat pesan="Anda tidak diberi izin untuk menambah master slot waktu. Daftar di sebelah tetap bisa dilihat." />
               </div>
             )}

             <div className="xl:col-span-2 space-y-4">
                <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Tabel Pemetaan Master Waktu</h2>
                <div className="overflow-x-auto max-h-[450px] overflow-y-auto border border-slate-200 rounded-xl">
                   <table className="w-full text-left text-[11px] border-collapse">
                      <thead>
                         <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                            <th className="p-3">Slot Waktu</th>
                            <th className="p-3">Label / Keterangan</th>
                            <th className="p-3">Waktu Berlaku</th>
                            <th className="p-3 text-center">Aksi</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                         {daftarWaktu.map(w => (
                           <tr key={w.id} className="hover:bg-slate-50/70">
                              <td className="p-3">
                                 <span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase tracking-wider ${w.jenis === 'mapel' ? 'bg-[#F7ECFA] text-[#571466] border-[#F0DFF5]' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                    {w.jenis === 'mapel' ? `JP Jam ke-${w.jamKe}` : 'Istirahat'}
                                 </span>
                              </td>
                              <td className="p-3 font-bold">{w.label}</td>
                              <td className="p-3 font-extrabold text-[#6A197D] tracking-wider">{w.mulai} - {w.selesai}</td>
                              <td className="p-3 text-center">
                                 <button onClick={() => handleHapusWaktu(w.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                              </td>
                           </tr>
                         ))}
                         {daftarWaktu.length === 0 && (
                           <tr>
                              <td colSpan={4} className="py-12 text-center text-slate-400 font-medium text-xs">Belum ada pemetaan durasi waktu yang dimasukkan.</td>
                           </tr>
                         )}
                      </tbody>
                   </table>
                </div>
             </div>
          </div>
        )}

        {/* --- TAB 2 : KELAS GABUNGAN --- */}
        {tabView === 'gabungan' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
             {bolehEdit ? (
             <form onSubmit={handleSimpanKelasGabungan} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                   <Users className="w-4 h-4 text-emerald-600" />
                   <h2 className="text-xs font-black text-slate-700">Daftarkan Kelas Gabungan</h2>
                </div>
                <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                   Untuk mapel yang sengaja digabung jadwalnya antar beberapa rombel (cth: Bahasa Indonesia Kelas 2A &amp; 2B diajar bersamaan), daftarkan di sini agar sistem <strong className="text-emerald-700">tidak menganggapnya bentrok</strong>.
                </p>

                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mata Pelajaran</label>
                   <select value={formGabunganMapelId} onChange={e => setFormGabunganMapelId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white" required>
                      <option value="">-- Pilih Mapel --</option>
                      {daftarMapel.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
                   </select>
                </div>

                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pendidik Pengampu (Opsional)</label>
                   <select value={formGabunganGuruId} onChange={e => setFormGabunganGuruId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      <option value="">-- Tanpa Filter Pendidik --</option>
                      {daftarGuru.filter(g => !formGabunganMapelId || g.mapelIds?.includes(formGabunganMapelId)).map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                   </select>
                </div>

                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pilih Rombel/Kelas yang Digabung (min. 2)</label>
                   <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-xl p-3 bg-slate-50">
                      {daftarRombel.map(r => (
                        <label key={r.id} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
                           <input type="checkbox" checked={formGabunganRombelIds.includes(r.id)} onChange={() => toggleFormGabunganRombel(r.id)} className="rounded accent-emerald-600" />
                           {r.nama}
                        </label>
                      ))}
                      {daftarRombel.length === 0 && <span className="text-[10px] text-slate-400 col-span-3">Belum ada data rombel.</span>}
                   </div>
                </div>

                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Keterangan (Opsional)</label>
                   <input type="text" placeholder="Cth: Gabung karena jumlah siswa sedikit" value={formGabunganKeterangan} onChange={e => setFormGabunganKeterangan(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>

                <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-emerald-700 transition mt-2 flex items-center justify-center gap-2">
                   <Plus className="w-4 h-4" /> Daftarkan Kelas Gabungan
                </button>
             </form>
             ) : (
               <div className="xl:col-span-1">
                 <CatatanHanyaLihat pesan="Anda tidak diberi izin untuk menambah aturan kelas gabungan. Daftar di sebelah tetap bisa dilihat." />
               </div>
             )}

             <div className="xl:col-span-2 space-y-4">
                <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Daftar Aturan Kelas Gabungan Aktif</h2>
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                   {daftarKelasGabungan.map(kg => {
                      const namaMapel = daftarMapel.find(m => m.id === kg.mapelId)?.nama || kg.mapelId
                      const namaGuru = kg.guruId ? daftarGuru.find(g => g.id === kg.guruId)?.nama : null
                      const namaRombelList = kg.rombelIds.map((rid: string) => daftarRombel.find(r => r.id === rid)?.nama || rid)
                      return (
                        <div key={kg.id} className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-sm flex items-start justify-between gap-4">
                           <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                 <Layers className="w-4 h-4 text-emerald-600" />
                                 <span className="font-black text-slate-800 text-sm">{namaMapel}</span>
                                 {namaGuru && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">• {namaGuru}</span>}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                 {namaRombelList.map((nm: string, i: number) => (
                                    <span key={i} className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-lg text-[10px] font-extrabold">Kelas {nm}</span>
                                 ))}
                              </div>
                              {kg.keterangan && <p className="text-[10px] text-slate-400 font-medium pt-1">{kg.keterangan}</p>}
                           </div>
                           <button onClick={() => handleHapusKelasGabungan(kg.id)} className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition shrink-0"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )
                   })}
                   {daftarKelasGabungan.length === 0 && (
                     <div className="py-16 text-center text-slate-400 font-medium text-xs bg-white border border-slate-200 rounded-2xl">Belum ada aturan kelas gabungan yang didaftarkan.</div>
                   )}
                </div>
             </div>
          </div>
        )}

        {/* --- TAB 3 : MATRIKS PILOTING RINCI MELEBAR KESAMPING & CEKLIST REQUEST HARI/JAM --- */}
        {tabView === 'input' && (
          <fieldset disabled={!bolehEdit} className="space-y-8 border-0 p-0 m-0 min-w-0">
          <div className="space-y-8">
             
             {/* 1. MATRIKS UTAMA MELEBAR MENYAMPING SECARA RINCI */}
             <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                   <Wand2 className="w-5 h-5 text-[#6A197D]" />
                   <h2 className="font-bold text-slate-800 text-sm">Matriks Alokasi Beban Jam Pelajaran (JP) Menyamping</h2>
                </div>
                <p className="text-[11px] font-medium text-slate-500 max-w-4xl">
                   Daftar Pendidik & Mapel di sebelah kiri, dengan kelas/rombel berderet ke kanan. 
                   Isikan dengan pemisah koma (Cth: <strong className="text-[#571466]">3</strong> untuk 3 JP dalam 1 sesi, atau <strong className="text-[#571466]">2, 3</strong> untuk 5 JP dalam 2 sesi pertemuan berbeda hari).
                   Sistem akan otomatis memberi notifikasi jika penjadwalan manual atau otomatis melebihi alokasi/sesi ini.
                </p>

                <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[350px]">
                   <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
                      <thead>
                         <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                            <th className="p-4 min-w-[150px]">Nama Pendidik</th>
                            <th className="p-4 min-w-[150px]">Mata Pelajaran</th>
                            {daftarRombel.map(r => (
                               <th key={r.id} className="p-4 text-center min-w-[75px] bg-sky-50/50 text-sky-800 border-l border-sky-100 uppercase tracking-widest text-[10px]">Kelas {r.nama}</th>
                            ))}
                            <th className="p-4 text-center min-w-[65px] bg-[#F7ECFA]/70 text-[#450F52] border-l border-[#F0DFF5] uppercase tracking-widest text-[10px]">Total Akumulasi JP</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                         {matriksRows.map((item, idx) => (
                           <tr key={idx} className="hover:bg-slate-50/60">
                              <td className="p-4 font-black text-slate-800 border-r border-slate-50">{item.guru.nama}</td>
                              <td className="p-4 text-[#571466] font-bold border-r border-slate-50">{item.mapel.nama}</td>
                              
                              {/* Kolom kelas berderet kesamping */}
                              {daftarRombel.map(r => {
                                 const isPjRombel = item.guru.rombelIds?.includes(r.id) && item.guru.mapelIds?.includes(item.mapel.id)
                                 const keyMatriks = `${item.guru.id}_${item.mapel.id}_${r.id}`
                                 
                                 return (
                                    <td key={r.id} className="p-2 text-center border-l border-slate-100 align-middle">
                                       {isPjRombel ? (
                                          <input 
                                            type="text" 
                                            placeholder="Cth: 3"
                                            value={matriksRinciJp[keyMatriks] || ''} 
                                            onChange={e => handleMatriksRinciChange(keyMatriks, e.target.value)}
                                            className="w-16 h-8 border border-slate-200 rounded-lg text-center outline-none focus:ring-2 focus:ring-[#8A2FA0] font-extrabold text-xs shadow-sm bg-white tracking-wider"
                                          />
                                       ) : (
                                          <span className="text-slate-300 text-[10px] font-light">-</span>
                                       )}
                                    </td>
                                 )
                              })}

                              <td className="p-4 text-center border-l border-slate-100 font-black bg-[#F7ECFA]/30 text-[#330B40] tracking-wider">
                                 {daftarRombel.reduce((sumRombel, r) => {
                                    const isPjRombel = item.guru.rombelIds?.includes(r.id) && item.guru.mapelIds?.includes(item.mapel.id)
                                    if (isPjRombel) {
                                       const keyMatriks = `${item.guru.id}_${item.mapel.id}_${r.id}`
                                       return sumRombel + hitungTotalJpFromString(matriksRinciJp[keyMatriks] || '')
                                    }
                                    return sumRombel
                                 }, 0)} JP
                              </td>
                           </tr>
                         ))}
                         {matriksRows.length === 0 && (
                           <tr>
                              <td colSpan={3 + daftarRombel.length} className="py-16 text-center text-slate-400 font-medium">Belum ada pemetaan penugasan peran & guru.</td>
                           </tr>
                         )}
                      </tbody>
                   </table>
                </div>
             </section>

             {/* 2. TABEL REQUEST HARI & JP KHUSUS PENDIDIK */}
             <section className="bg-amber-50/30 border border-amber-100 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-amber-200 pb-3">
                   <Shield className="w-5 h-5 text-amber-700" />
                   <div>
                      <h2 className="font-black text-amber-900 text-sm">Request Hari & Jam Ketersediaan (Pemisahan Tabel)</h2>
                      <p className="text-[10px] font-semibold text-amber-600 mt-0.5">
                         Tentukan angka JP pada hari spesifik. 
                         Isi <strong className="text-amber-800">2, 2</strong> jika terdapat 2 sesi waktu (misal jp 1-2 dan 7-8). 
                         Isi <strong className="text-amber-800">-</strong> jika sama sekali tidak bisa. 
                         Kosongkan jika bisa kapan saja.
                      </p>
                   </div>
                </div>
                
                <div className="overflow-x-auto border border-amber-200 rounded-xl max-h-[350px]">
                   <table className="w-full text-left text-xs border-collapse whitespace-nowrap bg-white">
                      <thead>
                         <tr className="bg-amber-50 border-b border-amber-200 text-amber-800 font-black tracking-wider">
                            <th className="p-4 min-w-[160px]">Nama Pendidik</th>
                            {listHari.map(h => (
                               <th key={h} className="p-4 text-center min-w-[90px] border-l border-amber-100 text-[10px] uppercase tracking-wider">{h} (JP)</th>
                            ))}
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 font-semibold text-slate-700">
                         {daftarGuru.map(g => (
                           <tr key={g.id} className="hover:bg-amber-50/30">
                              <td className="p-4 font-black text-slate-800">{g.nama}</td>
                              {listHari.map(h => {
                                 const keyReq = `${g.id}_${h}`
                                 return (
                                    <td key={h} className="p-2 text-center border-l border-amber-50">
                                       <input 
                                         type="text" 
                                         placeholder=""
                                         value={requestHariJp[keyReq] || ''}
                                         onChange={e => handleRequestHariJpChange(keyReq, e.target.value)}
                                         className="w-16 h-8 border border-amber-200 rounded-lg text-center outline-none focus:ring-1 focus:ring-amber-500 font-bold text-xs bg-amber-50/10"
                                       />
                                    </td>
                                 )
                              })}
                           </tr>
                         ))}
                      </tbody>
                   </table>
                </div>

                <div className="flex justify-end pt-2">
                   <button onClick={handlePlotOtomatisMatriks} className="flex items-center gap-2 bg-[#6A197D] hover:bg-[#571466] text-white px-6 py-3 rounded-xl font-extrabold text-xs shadow-md transition-all">
                      <RefreshCw className="w-4 h-4" /> Plot / Generate Matriks Jadwal
                   </button>
                </div>
             </section>

             {/* 3. MATRIKS PENJADWALAN VERTIKAL (WAKTU MENURUN, KELAS MELEBAR) DENGAN EDITING CELL LANGSUNG INLINE */}
             <div className="space-y-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center pb-3 border-b border-slate-100 flex-wrap gap-4">
                   <div>
                      <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">Matriks Tabel Plot Jadwal</h2>
                      <p className="text-[9px] text-slate-400 font-semibold mt-0.5 tracking-wide">Koreksi rute plot atau sisipkan mapel/guru secara interaktif langsung dengan klik kotak persilangan sel matriks di bawah ini. Sistem otomatis memvalidasi bentrok, maksimal JP harian, dan alokasi JP per mapel.</p>
                   </div>
                   
                   {/* Pemilih Hari Tampilan Matriks Bawah */}
                   <div className="flex items-center gap-2">
                      <span className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider">Pilih Hari Tampil:</span>
                      <select value={hariPlotTabel} onChange={e => setHariPlotTabel(e.target.value)} className="px-3 py-1.5 border border-[#E3C2ED] rounded-xl text-xs bg-[#F7ECFA] font-black text-[#220729] outline-none">
                         {listHari.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                   </div>
                </div>

                <div className="overflow-x-auto max-h-[580px] overflow-y-auto border border-slate-200 rounded-xl">
                   <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap">
                      <thead>
                         <tr className="bg-[#220729] text-white font-black tracking-wider text-[10px] uppercase">
                            <th className="p-3.5 border-r border-[#330B40] min-w-[90px]">Waktu / Jam</th>
                            {daftarRombel.map(r => (
                               <th key={r.id} className="p-3.5 border-l border-[#330B40] text-center min-w-[130px]">Kelas {r.nama}</th>
                            ))}
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-bold text-slate-700">
                         {slotMapelUrut.map(slot => (
                           <tr key={slot.id} className="hover:bg-slate-50">
                              <td className="p-3.5 bg-slate-50/70 border-r border-slate-200 tracking-wider font-black text-[#330B40]">
                                 <p className="leading-none text-[10px] uppercase tracking-widest">{slot.label}</p>
                                 <p className="text-[9px] font-extrabold text-[#6A197D] mt-1 tracking-wider">{slot.mulai} - {slot.selesai}</p>
                              </td>
                              
                              {/* Kolom Rombel/Kelas Melebar Kesamping */}
                              {daftarRombel.map(r => {
                                 const cellKey = `${hariPlotTabel}_${slot.id}_${r.id}`
                                 const jadwalRinci = daftarJadwal.find(j => 
                                    j.hari === hariPlotTabel && 
                                    j.waktuId === slot.id && 
                                    j.rombelId === r.id
                                 )
                                 const mapelRinci = daftarMapel.find(m => m.id === jadwalRinci?.mapelId)
                                 const isBagianGabungan = jadwalRinci ? daftarKelasGabungan.some(kg => kg.mapelId === jadwalRinci.mapelId && kg.rombelIds?.includes(r.id) && kg.rombelIds?.length > 1) : false

                                 return (
                                    <td key={r.id} onClick={() => handleCellClick(cellKey, jadwalRinci)} className={`p-3 border-l border-slate-100 text-center align-middle cursor-pointer transition-colors relative min-h-[60px] ${editingCell === cellKey ? 'bg-amber-50/70 ring-1 ring-amber-400' : 'hover:bg-[#F7ECFA]/30'}`}>
                                       {editingCell === cellKey ? (
                                          <div className="flex flex-col gap-1.5 items-center justify-center bg-white p-2.5 rounded-xl border border-slate-100 shadow-xl z-20 absolute top-2 left-2 right-2">
                                             <select 
                                               value={editGuruMapel} 
                                               onChange={e => setEditGuruMapel(e.target.value)} 
                                               onClick={e => e.stopPropagation()}
                                               className="w-full text-[9px] font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none bg-slate-50"
                                             >
                                                <option value="">-- Strip / Kosongkan --</option>
                                                <optgroup label="Pendidik & Mapel Terkait">
                                                   {getDaftarGuruTersediaUntukRombel(r.id).map(g => 
                                                      g.mapelIds?.map((mId: string) => {
                                                         const mp = daftarMapel.find(m => m.id === mId)
                                                         return mp ? (
                                                            <option key={`${g.id}-${mp.id}`} value={`${g.id}|${mp.id}`}>{g.nama} - {mp.nama}</option>
                                                         ) : null
                                                      })
                                                   )}
                                                </optgroup>
                                             </select>
                                             <div className="flex gap-1 w-full">
                                                <button onClick={(e) => { e.stopPropagation(); handleInlineCellSave(hariPlotTabel, slot.id, r.id, jadwalRinci); }} className="flex-1 bg-[#6A197D] text-white text-[9px] font-extrabold py-1.5 rounded-lg flex items-center justify-center gap-1">
                                                   <Check className="w-3 h-3" /> Simpan
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); setEditingCell(null); }} className="flex-1 bg-slate-100 text-slate-600 text-[9px] font-bold py-1.5 rounded-lg">Batal</button>
                                             </div>
                                          </div>
                                       ) : (
                                          jadwalRinci ? (
                                             <div className="relative">
                                                {isBagianGabungan && (
                                                   <span title="Bagian dari Kelas Gabungan" className="absolute -top-1 -right-1">
                                                      <Layers className="w-3 h-3 text-emerald-500" />
                                                   </span>
                                                )}
                                                <p className="text-[#220729] font-black text-xs leading-none tracking-wide">{mapelRinci?.nama || '-'}</p>
                                                <p className="text-slate-400 font-semibold text-[9px] mt-1.5 truncate max-w-[90px] mx-auto">{daftarGuru.find(g => g.id === jadwalRinci.guruId)?.nama || '-'}</p>
                                             </div>
                                          ) : (
                                             <span className="text-slate-300 font-light text-[10px]">-</span>
                                          )
                                       )}
                                    </td>
                                 )
                              })}
                           </tr>
                         ))}
                         {slotMapelUrut.length === 0 && (
                           <tr>
                              <td colSpan={1 + daftarRombel.length} className="py-24 text-center text-slate-400 font-medium">Belum ada pemetaan master waktu jam pelajaran.</td>
                           </tr>
                         )}
                      </tbody>
                   </table>
                </div>
                <p className="text-[9px] text-slate-400 font-semibold flex items-center gap-1.5"><Layers className="w-3 h-3 text-emerald-500" /> Ikon ini menandakan slot merupakan bagian dari Kelas Gabungan (tidak dianggap bentrok dengan rombel pasangannya).</p>
             </div>
          </div>
          {!bolehEdit && (
            <p className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 -mt-4">
              Anda hanya bisa melihat matriks ini. Kolom isian dinonaktifkan karena peran Anda tidak diberi izin mengubah modul ini.
            </p>
          )}
          </fieldset>
        )}

        {/* --- TAB 4 : REKAP BEBAN JP GURU --- */}
        {tabView === 'rekap_guru' && (
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
             <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <Shield className="w-5 h-5 text-[#6A197D]" />
                <h2 className="font-bold text-slate-800 text-sm">Rekapitulasi Beban Jumlah Jam Mengajar Pendidik</h2>
             </div>
             
             <div className="md:w-1/3 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <select value={cariGuruId} onChange={e => setCariGuruId(e.target.value)} disabled={!!cakupanGuru} className="w-full pl-9 pr-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white disabled:bg-slate-50 disabled:text-slate-500">
                   <option value="">🔍 Cari guru untuk melihat rekap jam...</option>
                   {daftarGuru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                </select>
             </div>
             
             <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                   <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                         <th className="p-4">Nama Pendidik</th>
                         <th className="p-4">NIP / ID</th>
                         <th className="p-4">Mapel Diampu</th>
                         <th className="p-4 text-center">Total JP (Slot Waktu) Mengajar</th>
                         <th className="p-4">Rincian JP per Hari</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                      {daftarGuru.filter(g => !cariGuruId || g.id === cariGuruId).map(g => {
                         const rekapHarian = rekapJamMengajarPerHari(g.id)
                         return (
                        <tr key={g.id} className="hover:bg-slate-50/70">
                           <td className="p-4 text-sm font-black text-slate-800">{g.nama}</td>
                           <td className="p-4 font-mono">{g.nip || '-'}</td>
                           <td className="p-4">
                              <ul className="list-disc pl-3 text-[#571466]">
                                 {g.mapelIds?.map((mId: string) => <li key={mId}>{daftarMapel.find(m => m.id === mId)?.nama || mId}</li>)}
                              </ul>
                           </td>
                           <td className="p-4 text-center">
                              <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 font-black px-4 py-1.5 rounded-xl shadow-sm text-xs inline-block">
                                 {rekapJamMengajar()[g.id] || 0} JP (Waktu Pertemuan)
                              </span>
                           </td>
                           <td className="p-4">
                              <div className="flex flex-wrap gap-1.5">
                                 {listHari.map(h => (
                                    <span key={h} className={`px-2 py-1 rounded-lg text-[9px] font-extrabold border ${rekapHarian[h] >= maksJpGuruPerHari ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                       {h.slice(0,3)}: {rekapHarian[h]} JP
                                    </span>
                                 ))}
                              </div>
                           </td>
                        </tr>
                         )
                      })}
                   </tbody>
                </table>
             </div>
          </section>
        )}

        {/* --- TAB 5 : REKAP JADWAL UTUH TERFILTER --- */}
        {tabView === 'rekap_jadwal' && (
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
             <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <CheckCircle className="w-5 h-5 text-[#6A197D]" />
                <h2 className="font-bold text-slate-800 text-sm">Rekapitulasi Plot Jadwal Terfilter (Unit / Pusat)</h2>
             </div>
             
             <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                   <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                         <th className="p-4">Hari</th>
                         <th className="p-4">Slot Waktu</th>
                         <th className="p-4">Rombel</th>
                         <th className="p-4">Pendidik</th>
                         <th className="p-4">Mata Pelajaran</th>
                         <th className="p-4 text-center">Tipe Jam</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-amber-100 font-semibold text-slate-700">
                      {daftarJadwal.filter(j => modeTampil === 'keseluruhan' || j.unitFilter === unitFilter).map(item => {
                        const sw = daftarWaktu.find(w => w.id === item.waktuId)
                        const isGabungan = daftarKelasGabungan.some(kg => kg.mapelId === item.mapelId && kg.rombelIds?.includes(item.rombelId) && kg.rombelIds?.length > 1)
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/60">
                             <td className="p-4 font-extrabold">{item.hari}</td>
                             <td className="p-4">
                                <p className="font-extrabold text-[10px] uppercase tracking-widest">{sw?.label}</p>
                                {sw && (
                                   <p className="text-[9px] text-[#6A197D] font-extrabold tracking-wider mt-0.5">
                                      {sw.mulai} - {sw.selesai}
                                   </p>
                                )}
                             </td>
                             <td className="p-4 font-bold text-sky-700">
                                {sw?.jenis === 'mapel' ? `Rombel ${daftarRombel.find(r => r.id === item.rombelId)?.nama || item.rombelId}` : '-'}
                                {isGabungan && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[8px] font-black text-emerald-600 uppercase"><Layers className="w-2.5 h-2.5" /> Gabungan</span>}
                             </td>
                             <td className="p-4 text-slate-600 font-bold">
                                {sw?.jenis === 'mapel' ? daftarGuru.find(g => g.id === item.guruId)?.nama : '-'}
                             </td>
                             <td className="p-4">
                                {sw?.jenis === 'mapel' ? daftarMapel.find(m => m.id === item.mapelId)?.nama : <em className="text-amber-600 font-extrabold bg-amber-50 px-2.5 py-1 rounded border border-amber-100 text-[10px] uppercase tracking-wider">{sw?.label}</em>}
                             </td>
                             <td className="p-4 text-center">
                                <span className={`px-3 py-1 font-extrabold text-[9px] rounded-lg border uppercase tracking-wider ${sw?.jenis === 'mapel' ? 'bg-[#F7ECFA] text-[#571466] border-[#F0DFF5]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{sw?.jenis || 'istirahat'}</span>
                             </td>
                          </tr>
                        )
                      })}
                      {daftarJadwal.filter(j => modeTampil === 'keseluruhan' || j.unitFilter === unitFilter).length === 0 && (
                        <tr>
                           <td colSpan={6} className="p-16 text-center text-slate-400 font-medium">Belum ada jadwal yang diset untuk unit/mode saat ini.</td>
                        </tr>
                      )}
                   </tbody>
                </table>
             </div>
          </section>
        )}
      </main>
    </div>
  )
}