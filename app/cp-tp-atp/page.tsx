'use client'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { bisaMengeditModul, getCakupanMengajarGuru } from '@/lib/aksesPeran'

import Sidebar from '@/components/Sidebar'
import PratinjauPdfModal from '@/components/PratinjauPdfModal'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { kunciTahun } from '@/lib/tahunAjaran'
import { ambilIdentitasOtomatis } from '@/lib/identitasOtomatis'
import {
  Landmark, LogOut, Shield, BookOpen, Home, Building,
  CalendarDays, BarChart2, FileText, FileSpreadsheet, Clock,
  Plus, Trash2, Edit2, Check, ChevronDown, ChevronRight,
  Download, ArrowUp, ArrowDown, GripVertical, X,
  BookMarked, Layers, ListChecks, Library, Eye
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// TIPE DATA
// ─────────────────────────────────────────────────────────────
// CATATAN PENTING (Kurikulum Merdeka):
// - CP & TP berlaku untuk SATU FASE (bukan satu kelas). CP Matematika Fase D
//   misalnya berlaku untuk seluruh SMP, apapun penamaan kelasnya.
// - MATERI ditulis per CP (setelah CP, sebelum TP). Setiap TP wajib merujuk ke
//   satu Materi, sehingga saat menuliskan TP langsung terlihat TP itu masuk CP
//   mana dan materi apa.
// - ATP BUKAN entitas baru — ATP adalah PEMETAAN TP (beserta materinya, otomatis
//   ikut) ke kelas tertentu. Alokasi JP & pembagian semester TIDAK diisi di sini,
//   itu diatur belakangan di halaman Prota & Promes.
type CP = {
  id: string
  mapelId: string
  fase: string          // A, B, C, D, E, F — CP berlaku untuk satu fase
  deskripsi: string
  elemen: string        // Elemen CP (opsional), mis. Bilangan, Aljabar, dll
  createdAt: string
}

// Materi pokok, ditulis per CP. Inilah yang nanti otomatis muncul di TP & ATP.
type Materi = {
  id: string
  cpId: string
  mapelId: string
  fase: string
  nama: string
  deskripsi: string
  createdAt: string
}

type TP = {
  id: string
  cpId: string
  materiId: string      // rujukan Materi — wajib diisi
  mapelId: string
  fase: string
  nomor: string         // 1.1, 1.2, dst
  deskripsi: string
  dimensiPancasila: string[]
  createdAt: string
}

// ATP = TP yang sudah dipetakan ke satu kelas, lengkap dengan urutan penyampaian
// di kelas itu dan semester pelaksanaannya. Murni pemetaan — TIDAK ada isian
// deskriptif apapun di sini (materi mengikuti TP secara otomatis). Semester dipilih
// di sini karena nantinya diinput otomatis ke Prota & Promes. Pertemuan, minggu,
// metode, asesmen, dan JP tetap domain Prota & Promes, bukan di sini.
type ATPItem = {
  id: string
  tpId: string
  cpId: string
  mapelId: string
  fase: string
  kelas: string
  semester: '1' | '2'      // dipakai Prota & Promes
  urutanDiKelas: number    // urutan TP ini di dalam kelas tsb
  createdAt: string
}

const DIMENSI_PANCASILA = [
  'Beriman & Bertakwa', 'Berkebinekaan Global', 'Bergotong Royong',
  'Mandiri', 'Bernalar Kritis', 'Kreatif'
]

// Bersihkan karakter yang tidak boleh ada di nama file (filesystem-unsafe),
// tanpa mengubah huruf besar/kecil atau spasi -- nama file tetap mudah dibaca.
function namaFileAman(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

const FASE_OPTIONS = ['A', 'B', 'C', 'D', 'E', 'F']

/**
 * Menentukan Fase yang relevan untuk SATU unit, berdasarkan jenjang yang
 * tersirat dari namanya (SD/MI -> A,B,C ; SMP/MTs -> D ; SMA/SMK/MA -> E,F).
 * Kalau nama unit tidak mengandung petunjuk jenjang, semua fase ditampilkan
 * (tidak dibatasi) supaya tidak salah menyembunyikan pilihan yang valid.
 */
function faseUntukUnit(namaUnit: string): string[] {
  const n = (namaUnit || '').toUpperCase()
  if (/\bSD\b|\bMI\b/.test(n)) return ['A', 'B', 'C']
  if (/\bSMP\b|\bMTS\b/.test(n)) return ['D']
  if (/\bSMA\b|\bSMK\b|\bMA\b/.test(n)) return ['E', 'F']
  return FASE_OPTIONS
}
const KELAS_OPTIONS_FALLBACK = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']
const ANGKA_KE_ROMAWI: { [k: string]: string } = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI',
  '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII'
}
const ROMAWI_KE_ANGKA: { [k: string]: number } = {
  I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10, XI:11, XII:12
}

// Ambil kode TINGKAT (bukan rombel) dari data rombel yang didaftarkan admin.
// Prioritas: pakai persis apa yang diinput admin di field "tingkat" (tanpa diubah sama sekali),
// supaya penamaan kelas di CP/TP/ATP selalu sama persis dengan yang didaftarkan admin.
// Hanya jika field tingkat eksplisit tidak ada, baru dicoba ekstraksi dari nama rombel
// (mis. "VII A" -> "VII", "8B" -> "VIII") sebagai fallback.
function ambilTingkatDariRombel(r: any): string {
  if (!r) return ''
  if (r.tingkat && String(r.tingkat).trim()) return String(r.tingkat).trim()
  const nama = String(r.kelas || r.nama || '').trim()
  if (!nama) return ''
  const bersih = nama.toUpperCase().replace(/^KELAS\s+/, '')
  const romawi = bersih.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/)
  if (romawi) return romawi[1]
  const angka = bersih.match(/^(\d{1,2})/)
  if (angka && ANGKA_KE_ROMAWI[angka[1]]) return ANGKA_KE_ROMAWI[angka[1]]
  return nama // fallback: gunakan apa adanya sesuai input admin
}

// Ubah label kelas (apapun formatnya: "VII", "7", "Kelas 7", dll) menjadi angka urut.
// Angka ini HANYA dipakai untuk mengurutkan kelas dari yang paling rendah ke paling
// tinggi — bukan diasumsikan sebagai nomor tingkat nasional (1-12), karena tiap
// sekolah bisa punya cara penomoran sendiri.
function angkaDariKelas(label: string): number | null {
  if (!label) return null
  const bersih = label.trim().toUpperCase().replace(/^KELAS\s+/, '')
  if (ROMAWI_KE_ANGKA[bersih] != null) return ROMAWI_KE_ANGKA[bersih]
  const angka = bersih.match(/(\d{1,2})/)
  if (angka) return parseInt(angka[1], 10)
  return null
}

// Tentukan kolom kelas yang relevan untuk suatu fase, murni dari POSISI kelas
// yang sudah terurut (bukan dari angka absolut) — karena penomoran kelas tiap
// sekolah bisa beda. Asumsi struktur baku: 3 kelas terakhir = jenjang SMA,
// 3 kelas sebelum itu = jenjang SMP, sisanya (jika ada) = jenjang SD.
//   - Fase A/B/C → seluruh jenjang SD
//   - Fase D     → seluruh jenjang SMP (mis. kelas 7,8,9)
//   - Fase E     → HANYA kelas SMA paling rendah (mis. kelas 10, atau kelas 4 jika SMA diberi nomor 4,5,6)
//   - Fase F     → 2 kelas SMA sisanya (mis. kelas 11 & 12, atau kelas 5 & 6)
function hitungKolomKelas(fase: string, kelasUrut: string[]): string[] {
  if (kelasUrut.length === 0) return []
  const n = kelasUrut.length
  const smaBucket = kelasUrut.slice(Math.max(0, n - 3))
  const smpBucket = kelasUrut.slice(Math.max(0, n - 6), Math.max(0, n - 3))
  const sdBucket = kelasUrut.slice(0, Math.max(0, n - 6))

  if (fase === 'A' || fase === 'B' || fase === 'C') return sdBucket.length > 0 ? sdBucket : kelasUrut
  if (fase === 'D') return smpBucket.length > 0 ? smpBucket : kelasUrut
  if (fase === 'E') return smaBucket.length > 0 ? [smaBucket[0]] : kelasUrut
  if (fase === 'F') return smaBucket.length > 1 ? smaBucket.slice(1) : kelasUrut
  return kelasUrut
}


// ─────────────────────────────────────────────────────────────
// KOMPONEN UTAMA
// ─────────────────────────────────────────────────────────────
export default function CpTpAtpPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('cp_tp_atp')
  const bolehEdit = bisaMengeditModul('cp_tp_atp')
  const cakupanGuru = getCakupanMengajarGuru() // null utk Admin, berisi mapelIds utk Guru
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')
  const [namaSekolah, setNamaSekolah] = useState('')

  const [daftarGuru, setDaftarGuru] = useState<any[]>([])
  const [daftarMapel, setDaftarMapel] = useState<any[]>([])
  const daftarMapelTampil = cakupanGuru
    ? daftarMapel.filter(m => cakupanGuru.mapelIds.includes(m.id))
    : daftarMapel
  const [daftarRombel, setDaftarRombel] = useState<any[]>([])

  // Data CP / Materi / TP / ATP
  const [daftarCp, setDaftarCp] = useState<CP[]>([])
  const [daftarMateri, setDaftarMateri] = useState<Materi[]>([])
  const [daftarTp, setDaftarTp] = useState<TP[]>([])
  const [daftarAtp, setDaftarAtp] = useState<ATPItem[]>([])

  // Tab navigasi utama — urutan: CP → Materi → TP → ATP → Rekap
  const [tabUtama, setTabUtama] = useState<'cp' | 'materi' | 'tp' | 'atp' | 'rekap'>('cp')

  // Identitas / cakupan dokumen — CP & TP berlaku per Mapel + Fase (bukan per kelas/semester)
  const [filterMapelId, setFilterMapelId] = useState('')
  const [filterFase, setFilterFase] = useState('')
  const [filterGuruId, setFilterGuruId] = useState('')
  const [filterUnitId, setFilterUnitId] = useState('') // '' = Lembaga Pusat (Mudir)
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])

  // ── Alur seleksi berjenjang: Unit -> Fase -> Guru Pengampu -> Mata Pelajaran ──
  // 1) Fase yang muncul mengikuti jenjang Unit yang dipilih (Lembaga Pusat =
  //    gabungan semua jenjang unit yang terdaftar; unit tertentu = jenjang unit itu saja).
  const faseOptionsTersedia = useMemo(() => {
    if (!filterUnitId) {
      // Lembaga Pusat -> gabungan (union) jenjang dari SEMUA unit yang ada
      const gabungan = new Set<string>()
      daftarLembaga.forEach(u => faseUntukUnit(u.nama).forEach(f => gabungan.add(f)))
      return gabungan.size > 0 ? FASE_OPTIONS.filter(f => gabungan.has(f)) : FASE_OPTIONS
    }
    const unit = daftarLembaga.find(u => u.id === filterUnitId)
    return faseUntukUnit(unit?.nama || '')
  }, [filterUnitId, daftarLembaga])

  // 2) Guru Pengampu yang muncul mengikuti Unit yang dipilih (guru yang memang
  //    ditugaskan di unit tsb, lihat unitIds di Kelola Data Guru/Pembagian Peran).
  const daftarGuruSesuaiUnit = useMemo(() => {
    if (!filterUnitId) return daftarGuru // Lembaga Pusat -> semua guru
    return daftarGuru.filter((g: any) => (g.unitIds || []).includes(filterUnitId))
  }, [daftarGuru, filterUnitId])

  // 3) Mata Pelajaran yang muncul mengikuti Guru Pengampu yang dipilih --
  //    hanya mapel yang benar-benar diampu guru tsb.
  const daftarMapelSesuaiGuru = useMemo(() => {
    const dasar = daftarMapelTampil
    if (!filterGuruId) return dasar
    const guru = daftarGuru.find((g: any) => g.id === filterGuruId)
    if (!guru) return dasar
    return dasar.filter(m => (guru.mapelIds || []).includes(m.id))
  }, [daftarMapelTampil, filterGuruId, daftarGuru])

  // Reset berjenjang: kalau pilihan level atas berubah dan pilihan level bawah
  // jadi tidak valid lagi, kosongkan supaya tidak salah data.
  useEffect(() => {
    if (filterFase && !faseOptionsTersedia.includes(filterFase)) setFilterFase('')
    if (filterGuruId && !daftarGuruSesuaiUnit.some((g: any) => g.id === filterGuruId)) setFilterGuruId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUnitId])

  useEffect(() => {
    if (filterMapelId && !daftarMapelSesuaiGuru.some(m => m.id === filterMapelId)) setFilterMapelId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterGuruId])

  const defaultTahunAjaran = (() => {
    const now = new Date()
    const y = now.getFullYear()
    return now.getMonth() >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`
  })()
  const [tahunAjaran, setTahunAjaran] = useState(defaultTahunAjaran)
  const [titiMangsaAtpInput, setTitiMangsaAtpInput] = useState('')

  // ── Form CP (per elemen)
  const [formCp, setFormCp] = useState<Partial<CP>>({})
  const [editCpId, setEditCpId] = useState<string|null>(null)
  const [showFormCp, setShowFormCp] = useState(false)

  // ── Form Materi
  const [formMateri, setFormMateri] = useState<Partial<Materi>>({})
  const [editMateriId, setEditMateriId] = useState<string|null>(null)
  const [showFormMateri, setShowFormMateri] = useState(false)
  const [expandCpIdMateri, setExpandCpIdMateri] = useState<string|null>(null)

  // ── Form TP
  const [formTp, setFormTp] = useState<Partial<TP>>({ dimensiPancasila: [] })
  const [editTpId, setEditTpId] = useState<string|null>(null)
  const [showFormTp, setShowFormTp] = useState(false)
  const [expandCpId, setExpandCpId] = useState<string|null>(null)

  // ── Papan ATP (drag & drop)
  const [dragOverKelas, setDragOverKelas] = useState<string|null>(null)

  // Download state
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  useEffect(() => { return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) } }, [])

  // ─────────────────────────────────────────────────────────
  // LOAD DATA
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const si = localStorage.getItem('identitas_induk')
      let indukNama = 'Lembaga / Yayasan Pusat'
      if (si) {
        const p = JSON.parse(si)
        indukNama = p.nama || indukNama
        setNamaInduk(indukNama)
        setLogoInduk(p.logo_utama || p.logo || '')
      }
      // Nama yang dicetak di dokumen mengikuti UNIT sekolah yang sedang aktif kalau ada
      // (mis. "SMP Aisyiyah Boarding School"), atau nama lembaga pusat/yayasan sebagai fallback.
      // ASUMSI: unit aktif disimpan di localStorage 'identitas_unit_aktif' -> { nama }.
      // Sesuaikan kunci ini jika app Anda memakai nama/struktur lain.
      try {
        const su = localStorage.getItem('identitas_unit_aktif')
        const u = su ? JSON.parse(su) : null
        setNamaSekolah((u && u.nama) ? u.nama : indukNama)
      } catch {
        setNamaSekolah(indukNama)
      }

      const sg = localStorage.getItem('master_guru'); if (sg) setDaftarGuru(JSON.parse(sg))
      const sm = localStorage.getItem('master_mapel'); if (sm) setDaftarMapel(JSON.parse(sm))
      const sl = localStorage.getItem('daftar_lembaga'); if (sl) setDaftarLembaga(JSON.parse(sl))

      // Kalau yang login adalah Guru, kunci ke akunnya sendiri (nama & unit)
      // -- tidak bisa melihat/pilih identitas guru lain sama sekali.
      if (cakupanGuru?.guruId) {
        setFilterGuruId(cakupanGuru.guruId)
        const guruSendiri = sg ? JSON.parse(sg).find((g: any) => g.id === cakupanGuru.guruId) : null
        if (guruSendiri?.unitIds?.[0]) setFilterUnitId(guruSendiri.unitIds[0])
      }

      // Kalau yang login adalah Guru, kunci ke mapel yang dia ampu saja.
      // Kalau cuma ampu 1 mapel, langsung dipilihkan otomatis.
      const cakupan = getCakupanMengajarGuru()
      if (cakupan && cakupan.mapelIds.length === 1) {
        setFilterMapelId(cakupan.mapelIds[0])
      }
      const sr = localStorage.getItem('master_rombel'); if (sr) setDaftarRombel(JSON.parse(sr))

      const scp = localStorage.getItem(kunciTahun('data_cp')); if (scp) setDaftarCp(JSON.parse(scp))
      const smt = localStorage.getItem(kunciTahun('data_materi')); if (smt) setDaftarMateri(JSON.parse(smt))
      const stp = localStorage.getItem(kunciTahun('data_tp')); if (stp) setDaftarTp(JSON.parse(stp))
      const satp = localStorage.getItem(kunciTahun('data_atp')); if (satp) setDaftarAtp(JSON.parse(satp))

      setLoading(false)
    }
    init()
  }, [router])

  // PENTING: sebelumnya fungsi save() ini menulis LANGSUNG ke localStorage
  // TANPA kunciTahun(), padahal pembacaan datanya (lihat useEffect init di atas)
  // SUDAH pakai kunciTahun() -- akibatnya data yang baru disimpan seperti
  // "hilang" lagi setelah reload, karena tersimpan di kunci yang berbeda dari
  // yang dibaca. Diperbaiki di sini secara terpusat.
  const KUNCI_TAHUN_CPTPATP = new Set(['data_cp', 'data_materi', 'data_tp', 'data_atp'])
  const save = (key: string, data: any) => localStorage.setItem(KUNCI_TAHUN_CPTPATP.has(key) ? kunciTahun(key) : key, JSON.stringify(data))

  // ─────────────────────────────────────────────────────────
  // CP CRUD (per elemen — berlaku untuk satu fase, bukan satu kelas)
  // ─────────────────────────────────────────────────────────
  const handleSimpanCp = () => {
    if (!formCp.mapelId || !formCp.deskripsi || !formCp.fase) {
      alert('Lengkapi: Mapel, Fase, dan Deskripsi CP.'); return
    }
    if (editCpId) {
      const updated = daftarCp.map(c => c.id === editCpId ? { ...c, ...formCp } as CP : c)
      setDaftarCp(updated); save('data_cp', updated)
    } else {
      const newCp: CP = { id: 'cp-'+Date.now(), createdAt: new Date().toISOString(), ...formCp as any }
      const updated = [...daftarCp, newCp]
      setDaftarCp(updated); save('data_cp', updated)
    }
    setFormCp({}); setEditCpId(null); setShowFormCp(false)
  }

  const handleHapusCp = (id: string) => {
    if (!confirm('Hapus CP ini? Semua Materi, TP, dan ATP yang terkait juga akan terhapus.')) return
    const tpIds = daftarTp.filter(t => t.cpId === id).map(t => t.id)
    const updCp = daftarCp.filter(c => c.id !== id)
    const updMateri = daftarMateri.filter(m => m.cpId !== id)
    const updTp = daftarTp.filter(t => t.cpId !== id)
    const updAtp = daftarAtp.filter(a => !tpIds.includes(a.tpId))
    setDaftarCp(updCp); save('data_cp', updCp)
    setDaftarMateri(updMateri); save('data_materi', updMateri)
    setDaftarTp(updTp); save('data_tp', updTp)
    setDaftarAtp(updAtp); save('data_atp', updAtp)
  }

  // ─────────────────────────────────────────────────────────
  // MATERI CRUD (per CP — akan otomatis dipakai saat menulis TP & tampil di ATP)
  // ─────────────────────────────────────────────────────────
  const handleSimpanMateri = () => {
    if (!formMateri.cpId || !formMateri.nama) { alert('Lengkapi CP rujukan dan Nama Materi.'); return }
    const cp = daftarCp.find(c => c.id === formMateri.cpId)
    if (editMateriId) {
      const updated = daftarMateri.map(m => m.id === editMateriId ? { ...m, ...formMateri } as Materi : m)
      setDaftarMateri(updated); save('data_materi', updated)
    } else {
      const newMateri: Materi = {
        id: 'mat-'+Date.now(),
        createdAt: new Date().toISOString(),
        mapelId: cp?.mapelId || '',
        fase: cp?.fase || '',
        deskripsi: '',
        ...formMateri as any
      }
      const updated = [...daftarMateri, newMateri]
      setDaftarMateri(updated); save('data_materi', updated)
    }
    setFormMateri({}); setEditMateriId(null); setShowFormMateri(false)
  }

  const handleHapusMateri = (id: string) => {
    const tpTerkait = daftarTp.filter(t => t.materiId === id)
    const pesan = tpTerkait.length > 0
      ? `Materi ini dipakai oleh ${tpTerkait.length} TP. Jika dihapus, TP tersebut akan kehilangan rujukan materinya. Tetap hapus?`
      : 'Hapus materi ini?'
    if (!confirm(pesan)) return
    const updated = daftarMateri.filter(m => m.id !== id)
    setDaftarMateri(updated); save('data_materi', updated)
    if (tpTerkait.length > 0) {
      const updTp = daftarTp.map(t => t.materiId === id ? { ...t, materiId: '' } : t)
      setDaftarTp(updTp); save('data_tp', updTp)
    }
  }

  // ─────────────────────────────────────────────────────────
  // TP CRUD (diturunkan dari CP, merujuk 1 Materi → mewarisi mapel & fase dari CP)
  // ─────────────────────────────────────────────────────────
  const handleSimpanTp = () => {
    if (!formTp.cpId || !formTp.materiId || !formTp.deskripsi) {
      alert('Lengkapi CP rujukan, Materi rujukan, dan deskripsi TP.'); return
    }
    const cp = daftarCp.find(c => c.id === formTp.cpId)
    if (editTpId) {
      const updated = daftarTp.map(t => t.id === editTpId ? { ...t, ...formTp } as TP : t)
      setDaftarTp(updated); save('data_tp', updated)
    } else {
      // Nomor otomatis
      const tpDiCp = daftarTp.filter(t => t.cpId === formTp.cpId)
      const noUrut = tpDiCp.length + 1
      const newTp: TP = {
        id: 'tp-'+Date.now(),
        createdAt: new Date().toISOString(),
        mapelId: cp?.mapelId || '',
        fase: cp?.fase || '',
        nomor: `${noUrut}`,
        dimensiPancasila: [],
        ...formTp as any
      }
      const updated = [...daftarTp, newTp]
      setDaftarTp(updated); save('data_tp', updated)
    }
    setFormTp({ dimensiPancasila: [] }); setEditTpId(null); setShowFormTp(false)
  }

  const handleHapusTp = (id: string) => {
    if (!confirm('Hapus TP ini? Pemetaannya ke kelas (ATP) juga ikut terhapus.')) return
    const updTp = daftarTp.filter(t => t.id !== id)
    const updAtp = daftarAtp.filter(a => a.tpId !== id)
    setDaftarTp(updTp); save('data_tp', updTp)
    setDaftarAtp(updAtp); save('data_atp', updAtp)
  }

  const toggleDimensi = (d: string) => {
    const cur = formTp.dimensiPancasila || []
    setFormTp({ ...formTp, dimensiPancasila: cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d] })
  }

  // ─────────────────────────────────────────────────────────
  // PAPAN ATP — pemindahan TP ke kelas, reorder
  // ATP tidak dibuat dari form kosong; ATP = TP (dengan materinya) yang dipetakan ke kelas.
  // ─────────────────────────────────────────────────────────
  const rekalkulasiKelas = (list: ATPItem[]): ATPItem[] =>
    list
      .sort((a,b) => a.urutanDiKelas - b.urutanDiKelas)
      .map((item, i) => ({ ...item, urutanDiKelas: i + 1 }))

  // Pindahkan TP dari pool (belum dipetakan) ke sebuah kolom kelas
  const handlePindahkanTpKeKelas = (tpId: string, kelas: string) => {
    const tp = daftarTp.find(t => t.id === tpId)
    if (!tp) return
    if (daftarAtp.some(a => a.tpId === tpId)) return // sudah dipetakan, abaikan
    const kelompokTujuan = daftarAtp.filter(a => a.mapelId === tp.mapelId && a.fase === tp.fase && a.kelas === kelas)
    const maxUrutan = kelompokTujuan.reduce((m, a) => Math.max(m, a.urutanDiKelas), 0)
    const newEntry: ATPItem = {
      id: 'atp-'+Date.now(),
      tpId: tp.id,
      cpId: tp.cpId,
      mapelId: tp.mapelId,
      fase: tp.fase,
      kelas,
      semester: '1',
      urutanDiKelas: maxUrutan + 1,
      createdAt: new Date().toISOString()
    }
    const updated = [...daftarAtp, newEntry]
    setDaftarAtp(updated); save('data_atp', updated)
  }

  // Pindahkan entri yang sudah ada ke kelas lain (drag antar kolom)
  const handlePindahkanEntryKeKelas = (entryId: string, kelasBaru: string) => {
    const entry = daftarAtp.find(a => a.id === entryId)
    if (!entry || entry.kelas === kelasBaru) return
    const kelompokLama = rekalkulasiKelas(daftarAtp.filter(a => a.mapelId === entry.mapelId && a.fase === entry.fase && a.kelas === entry.kelas && a.id !== entryId))
    const kelompokTujuan = daftarAtp.filter(a => a.mapelId === entry.mapelId && a.fase === entry.fase && a.kelas === kelasBaru)
    const maxUrutan = kelompokTujuan.reduce((m, a) => Math.max(m, a.urutanDiKelas), 0)
    const entryPindah: ATPItem = { ...entry, kelas: kelasBaru, urutanDiKelas: maxUrutan + 1 }
    const sisanya = daftarAtp.filter(a =>
      !(a.mapelId === entry.mapelId && a.fase === entry.fase && (a.kelas === entry.kelas || a.kelas === kelasBaru)) )
    const updated = [...sisanya, ...kelompokLama, ...kelompokTujuan, entryPindah]
    setDaftarAtp(updated); save('data_atp', updated)
  }

  // Urutkan bebas di dalam satu kolom kelas
  const handleReorderEntry = (entryId: string, arah: 'up'|'down') => {
    const entry = daftarAtp.find(a => a.id === entryId)
    if (!entry) return
    const kelompok = daftarAtp
      .filter(a => a.mapelId === entry.mapelId && a.fase === entry.fase && a.kelas === entry.kelas)
      .sort((a,b) => a.urutanDiKelas - b.urutanDiKelas)
    const idx = kelompok.findIndex(a => a.id === entryId)
    if (arah === 'up' && idx === 0) return
    if (arah === 'down' && idx === kelompok.length - 1) return
    const swapIdx = arah === 'up' ? idx - 1 : idx + 1
    const baru = [...kelompok]
    ;[baru[idx], baru[swapIdx]] = [baru[swapIdx], baru[idx]]
    const direindeks = baru.map((item, i) => ({ ...item, urutanDiKelas: i + 1 }))
    const rest = daftarAtp.filter(a => !(a.mapelId === entry.mapelId && a.fase === entry.fase && a.kelas === entry.kelas))
    const updated = [...rest, ...direindeks]
    setDaftarAtp(updated); save('data_atp', updated)
  }

  // Kembalikan TP ke pool (hapus pemetaan kelasnya)
  const handleKembalikanKePool = (entryId: string) => {
    const entry = daftarAtp.find(a => a.id === entryId)
    if (!entry) return
    const sisaKelompok = rekalkulasiKelas(daftarAtp.filter(a => a.mapelId === entry.mapelId && a.fase === entry.fase && a.kelas === entry.kelas && a.id !== entryId))
    const rest = daftarAtp.filter(a => !(a.mapelId === entry.mapelId && a.fase === entry.fase && a.kelas === entry.kelas))
    const updated = [...rest, ...sisaKelompok]
    setDaftarAtp(updated); save('data_atp', updated)
  }

  // Ubah semester TP ini (dipakai untuk input otomatis ke Prota & Promes)
  const handleUbahSemester = (entryId: string, semester: '1'|'2') => {
    const updated = daftarAtp.map(a => a.id === entryId ? { ...a, semester } : a)
    setDaftarAtp(updated); save('data_atp', updated)
  }

  // ── Drag & drop handlers
  const onDragStartPool = (e: React.DragEvent, tpId: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'tp', tpId }))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragStartCard = (e: React.DragEvent, entryId: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'entry', entryId }))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOverColumn = (e: React.DragEvent, kelas: string) => {
    e.preventDefault()
    if (dragOverKelas !== kelas) setDragOverKelas(kelas)
  }
  const onDragLeaveColumn = () => setDragOverKelas(null)
  const onDropColumn = (e: React.DragEvent, kelas: string) => {
    e.preventDefault()
    setDragOverKelas(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type === 'tp') handlePindahkanTpKeKelas(data.tpId, kelas)
      else if (data.type === 'entry') handlePindahkanEntryKeKelas(data.entryId, kelas)
    } catch { /* abaikan drop tidak valid */ }
  }

  // ─────────────────────────────────────────────────────────
  // DOWNLOAD — satu dokumen gabungan: Capaian Umum + CP per Elemen + Materi + TP + ATP
  // PDF dibuat LANGSUNG DI BROWSER (jsPDF + jspdf-autotable) supaya layoutnya bisa
  // dikontrol persis mengikuti format dokumen Word acuan (judul, nama sekolah, blok
  // identitas, "Capaian Pembelajaran Umum", lalu tabel 3 kolom dengan kolom ATP
  // digabung/merge ke bawah berisi alur bernomor lanjut per kelas).
  // Perlu paket tambahan: `npm install jspdf jspdf-autotable`.
  // Excel tetap lewat endpoint server (/api/download-cp-tp-atp-excel).
  // ─────────────────────────────────────────────────────────
  const siapkanDataCetak = () => {
    const cp = daftarCp.filter(c => c.mapelId === filterMapelId && c.fase === filterFase)
    const materi = daftarMateri.filter(m => m.mapelId === filterMapelId && m.fase === filterFase)
    const tp = daftarTp.filter(t => t.mapelId === filterMapelId && t.fase === filterFase)
      .map(t => ({ ...t, materiNama: daftarMateri.find(m => m.id === t.materiId)?.nama || '' }))

    // ATP dicetak sebagai blok per kelas (urutan awal → akhir sesuai jenjang fase),
    // dengan nomor urut yang BERLANJUT lintas kelas — mis. Kelas VII 1-10, lanjut
    // Kelas VIII 11-15, lanjut Kelas IX 16-20 (bukan reset ke 1 tiap kelas).
    const kelasDenganEntri = Array.from(new Set(daftarAtp.filter(a => a.mapelId === filterMapelId && a.fase === filterFase).map(a => a.kelas)))
    const urutanBaku = hitungKolomKelas(filterFase, kelasTerurutAngka).filter(k => kelasDenganEntri.includes(k))
    const kelasLain = kelasDenganEntri.filter(k => !urutanBaku.includes(k)).sort()
    const urutanKelasCetak = [...urutanBaku, ...kelasLain]

    let counter = 0
    const atpPerKelas = urutanKelasCetak.map(kelas => {
      const items = daftarAtp
        .filter(a => a.mapelId === filterMapelId && a.fase === filterFase && a.kelas === kelas)
        .sort((a,b) => a.urutanDiKelas - b.urutanDiKelas)
        .map(a => {
          const t = daftarTp.find(x => x.id === a.tpId)
          const m = daftarMateri.find(x => x.id === t?.materiId)
          counter++
          return { nomorGlobal: counter, semester: a.semester, materiNama: m?.nama || '', tpDeskripsi: t?.deskripsi || '' }
        })
      return { kelas, mulai: items[0]?.nomorGlobal || 0, akhir: items[items.length-1]?.nomorGlobal || 0, items }
    })
    const atp = atpPerKelas.flatMap(b => b.items.map(it => ({ ...it, kelas: b.kelas })))

    const namaMapel = daftarMapel.find(m => m.id === filterMapelId)?.nama || ''
    const namaGuru = daftarGuru.find(g => g.id === filterGuruId)?.nama || ''

    return { cp, materi, tp, atp, atpPerKelas, namaMapel, namaGuru }
  }

  const handleDownloadPdf = async (mode: 'unduh' | 'preview' = 'unduh', halaman: 'analisis' | 'atp' = 'analisis') => {
    if (!filterMapelId || !filterFase) { alert('Pilih Mata Pelajaran dan Fase terlebih dahulu untuk download.'); return }
    setDownloadLoading(true)
    try {
      const { jsPDF } = await import('jspdf')
      const autoTableMod: any = await import('jspdf-autotable')
      const autoTable = autoTableMod.default || autoTableMod

      const { cp, materi, tp, atpPerKelas, namaMapel, namaGuru } = siapkanDataCetak()

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const marginLeft = 20, marginRight = 15
      const contentWidth = pageWidth - marginLeft - marginRight

      // Nama lembaga yang tercetak WAJIB mengikuti Unit yang dipilih di filter
      // atas -- Lembaga Pusat -> nama lembaga pusat, Unit tertentu -> nama unit itu.
      const identitasAtp = ambilIdentitasOtomatis()
      const unitAtpTerpilih = filterUnitId ? identitasAtp?.unitList.find(u => u.id === filterUnitId) : undefined
      const namaLembagaCetak = filterUnitId ? (unitAtpTerpilih?.nama || namaSekolah) : (identitasAtp?.namaLembaga || namaSekolah || namaInduk || '')

      // Kop judul + identitas dipakai ulang di KEDUA halaman (Analisis CP & Alur TP)
      // supaya masing-masing halaman tetap lengkap & bisa berdiri sendiri kalau dicetak
      // terpisah. Mengembalikan posisi Y setelah kop, siap dipakai startY tabel.
      const tulisKopHalaman = (judul: string): number => {
        let yy = 18
        doc.setFont('times', 'bold'); doc.setFontSize(14)
        doc.text(judul, pageWidth / 2, yy, { align: 'center' }); yy += 6
        doc.text(namaLembagaCetak.toUpperCase(), pageWidth / 2, yy, { align: 'center' }); yy += 9

        doc.setFont('times', 'normal'); doc.setFontSize(11.5)
        const halfW = contentWidth / 2
        const labelW = 38 // lebar label tetap supaya titik dua selalu sejajar dalam 1 kolom
        const barisInfo = (label: string, value: string, x: number, yPos: number) => {
          doc.text(label, x, yPos)
          doc.text(`: ${value}`, x + labelW, yPos)
        }
        barisInfo('Fase', `FASE ${filterFase}`, marginLeft, yy)
        barisInfo('Nama Guru', namaGuru || '-', marginLeft + halfW, yy)
        yy += 5.5
        barisInfo('Mata Pelajaran', namaMapel, marginLeft, yy)
        barisInfo('Tahun Ajaran', tahunAjaran, marginLeft + halfW, yy)
        yy += 10
        return yy
      }

      // Dua pilihan unduhan TERPISAH (bukan satu file gabungan) -- Admin/Guru memilih
      // sendiri halaman mana yang mau dicetak/diunduh lewat parameter `halaman`.
      let judulDokumen = ''
      if (halaman === 'analisis') {
        // ═══════════════ ANALISIS CAPAIAN PEMBELAJARAN ═══════════════
        // Satu baris per Lingkup Materi (bukan per CP). Data mentahnya SELALU lengkap di
        // setiap baris (tidak pakai rowSpan bawaan jspdf-autotable -- itu yang bikin garis
        // & isi sel hilang kalau sel gabungan kepotong ke halaman lain). Efek "sel gabungan"
        // (Elemen / Capaian Pembelajaran / Lingkup Materi yang sama tidak diulang teksnya)
        // dibuat sendiri lewat hook willDrawCell di bawah: baris & garisnya tetap sungguhan
        // (jadi border TIDAK PERNAH hilang), cuma teks yang identik dengan baris tepat di
        // atasnya PADA HALAMAN YANG SAMA yang dikosongkan. Kalau kebetulan baris yang sama
        // itu mulai di halaman baru, teksnya sengaja ditulis ulang supaya tetap ada konteks.
        judulDokumen = 'Analisis Capaian Pembelajaran'
        const y1 = tulisKopHalaman('ANALISIS CAPAIAN PEMBELAJARAN')

        const bodyCp: any[] = []
        if (cp.length === 0) {
          bodyCp.push(['-', '-', '-', '-'])
        } else {
          cp.forEach(c => {
            const materiUntukCp = materi.filter(m => m.cpId === c.id)
            const daftarBaris = materiUntukCp.length > 0 ? materiUntukCp : [null]
            daftarBaris.forEach(m => {
              const tpUntukMateri = m ? tp.filter(t => t.materiId === m.id) : []
              const tpTeks = tpUntukMateri.length > 0 ? tpUntukMateri.map(t => `•  ${t.deskripsi}`).join('\n') : '-'
              bodyCp.push([c.elemen || '-', c.deskripsi, m ? m.nama : '-', tpTeks])
            })
          })
        }

        // Ingat nilai + nomor halaman baris SEBELUMNYA per kolom (0=Elemen, 1=Capaian
        // Pembelajaran, 2=Lingkup Materi) -- direset otomatis tiap kali fungsi ini
        // dipanggil ulang karena dideklarasikan di dalam handleDownloadPdf.
        const barisSebelumnya: Record<number, { nilai: string; halaman: number } | null> = { 0: null, 1: null, 2: null }

        autoTable(doc, {
          startY: y1,
          margin: { left: marginLeft, right: marginRight },
          head: [[
            { content: 'Elemen', styles: { fontStyle: 'bold', halign: 'center' } },
            { content: 'Capaian Pembelajaran', styles: { fontStyle: 'bold', halign: 'center' } },
            { content: 'Lingkup Materi', styles: { fontStyle: 'bold', halign: 'center' } },
            { content: 'Tujuan Pembelajaran', styles: { fontStyle: 'bold', halign: 'center' } },
          ]],
          body: bodyCp,
          theme: 'grid',
          styles: { font: 'times', fontSize: 10.5, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.15, valign: 'top', textColor: [0, 0, 0] },
          headStyles: { fillColor: [237, 227, 243], textColor: [0, 0, 0], font: 'times', fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: contentWidth * 0.14 },
            1: { cellWidth: contentWidth * 0.30 },
            2: { cellWidth: contentWidth * 0.20 },
            3: { cellWidth: contentWidth * 0.36 },
          },
          willDrawCell: (data: any) => {
            if (data.section !== 'body' || data.column.index > 2) return
            const nilai = String(data.cell.raw ?? '')
            const sebelumnya = barisSebelumnya[data.column.index]
            if (sebelumnya && sebelumnya.nilai === nilai && sebelumnya.halaman === data.pageNumber) {
              data.cell.text = []
              // Sembunyikan garis ATAS supaya menyatu dengan baris di atasnya (efek sel
              // gabungan) -- garis kiri/kanan/bawah tetap normal, jadi kotak tabelnya
              // tetap utuh walau teksnya kosong.
              data.cell.styles.lineWidth = { top: 0, bottom: 0.15, left: 0.15, right: 0.15 }
            }
            barisSebelumnya[data.column.index] = { nilai, halaman: data.pageNumber }
          },
        })
      } else {
        // ═══════════════ ALUR TUJUAN PEMBELAJARAN ═══════════════
        // Tabel No | Alur Tujuan Pembelajaran (ATP), dikelompokkan per KELAS (baris judul
        // penuh selebar tabel), nomor urut BERLANJUT lintas kelas (tidak reset).
        judulDokumen = 'Alur Tujuan Pembelajaran (ATP)'
        const y2 = tulisKopHalaman('ALUR TUJUAN PEMBELAJARAN')

        const bodyAtp: any[] = []
        atpPerKelas.forEach(blok => {
          if (blok.items.length === 0) return
          bodyAtp.push([{ content: `KELAS ${blok.kelas}`, colSpan: 2, styles: { fontStyle: 'bold', fillColor: [245, 240, 248] } }])
          blok.items.forEach(it => {
            bodyAtp.push([String(it.nomorGlobal), it.materiNama || it.tpDeskripsi || '-'])
          })
        })
        if (bodyAtp.length === 0) bodyAtp.push(['-', 'Belum ada data ATP'])

        autoTable(doc, {
          startY: y2,
          margin: { left: marginLeft, right: marginRight },
          head: [[
            { content: 'No', styles: { fontStyle: 'bold', halign: 'center' } },
            { content: 'Alur Tujuan Pembelajaran (ATP)', styles: { fontStyle: 'bold', halign: 'center' } },
          ]],
          body: bodyAtp,
          theme: 'grid',
          styles: { font: 'times', fontSize: 11, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.15, valign: 'top' },
          headStyles: { fillColor: [237, 227, 243], textColor: [30, 10, 40], font: 'times', fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 16, halign: 'center' },
            1: { cellWidth: contentWidth - 16 },
          },
        })
      }

      // ── TANDA TANGAN ──────────────────────────────────────
      // Kepala Sekolah/Mudir ("Mengetahui") SELALU di KIRI (ditentukan dari
      // selector "Lembaga / Unit" di atas), Guru Mapel di KANAN -- titimangsa
      // sejajar kolom KANAN (Guru). Tanpa garis TTD.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalYTabel: number = (doc as any).lastAutoTable?.finalY || 40
      let ttdY = finalYTabel + 14
      if (ttdY + 45 > doc.internal.pageSize.getHeight() - 15) { doc.addPage(); ttdY = 20 }

      const namaPenandatanganAtp = filterUnitId ? (unitAtpTerpilih?.namaKepala || '') : (identitasAtp?.namaMudir || '')
      const nipPenandatanganAtp = filterUnitId ? (unitAtpTerpilih?.nipKepala || '') : '' // Mudir tanpa NUPTK
      const labelPenandatanganAtp = filterUnitId ? 'Kepala Sekolah' : 'Mudir'

      // Blok KIRI (Kepala Sekolah/Mudir) tetap di sisi KIRI, blok KANAN (Guru
      // Mapel) tetap di sisi KANAN -- tapi teks di dalam masing-masing kolom
      // rata TENGAH terhadap lebar kolomnya sendiri, bukan rata kiri/kanan mentah.
      const ttdColWAtp = 60
      const ttdKiriTengahAtp = marginLeft + ttdColWAtp / 2
      doc.setFont('times', 'normal'); doc.setFontSize(10.5)
      doc.text('Mengetahui,', ttdKiriTengahAtp, ttdY, { align: 'center' })
      doc.text(`${labelPenandatanganAtp},`, ttdKiriTengahAtp, ttdY + 5, { align: 'center' })
      doc.setFont('times', 'bold')
      const namaKsLines = doc.splitTextToSize(namaPenandatanganAtp || '(Nama)', ttdColWAtp)
      doc.text(namaKsLines, ttdKiriTengahAtp, ttdY + 30, { align: 'center' })
      if (labelPenandatanganAtp !== 'Mudir') {
        doc.setFont('times', 'normal'); doc.setFontSize(9.5)
        doc.text(`NUPTK: ${nipPenandatanganAtp || '-'}`, ttdKiriTengahAtp, ttdY + 30 + namaKsLines.length * 4, { align: 'center' })
      }

      const ttdKananTengahAtp = pageWidth - marginRight - ttdColWAtp / 2
      const titiMangsaAtp = titiMangsaAtpInput.trim() || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      doc.setFont('times', 'normal'); doc.setFontSize(10.5)
      doc.text(titiMangsaAtp, ttdKananTengahAtp, ttdY, { align: 'center' })
      doc.text('Guru Mata Pelajaran,', ttdKananTengahAtp, ttdY + 5, { align: 'center' })
      doc.setFont('times', 'bold')
      const namaGuruLinesAtp = doc.splitTextToSize(namaGuru || '(Nama Guru)', ttdColWAtp)
      doc.text(namaGuruLinesAtp, ttdKananTengahAtp, ttdY + 30, { align: 'center' })
      doc.setFont('times', 'normal'); doc.setFontSize(9.5)
      doc.text(`NUPTK: ${daftarGuru.find(g => g.id === filterGuruId)?.nip || '-'}`, ttdKananTengahAtp, ttdY + 30 + namaGuruLinesAtp.length * 4, { align: 'center' })

      const namaFileDasar = `${judulDokumen} ${namaMapel} Fase ${filterFase}`
      if (mode === 'preview') {
        const namaFile = `${namaFileAman(namaFileDasar)}.pdf`
        const fileBernama = new File([doc.output('blob')], namaFile, { type: 'application/pdf' })
        const url = URL.createObjectURL(fileBernama)
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = url
        setPreviewUrl(url)
      } else {
        doc.save(`${namaFileAman(namaFileDasar)}.pdf`)
      }
    } catch (e) {
      alert('Gagal membuat PDF: ' + String(e instanceof Error ? e.message : e) +
        '\n\nPastikan paket "jspdf" dan "jspdf-autotable" sudah terpasang (npm install jspdf jspdf-autotable).')
    }
    setDownloadLoading(false)
  }

  const handleDownloadExcel = async () => {
    if (!filterMapelId || !filterFase) { alert('Pilih Mata Pelajaran dan Fase terlebih dahulu untuk download.'); return }
    setDownloadLoading(true)
    const { cp, materi, tp, atp, atpPerKelas, namaMapel, namaGuru } = siapkanDataCetak()
    const payload = {
      namaSekolah, namaMapel, namaGuru, tahunAjaran,
      fase: filterFase,
      cp, materi, tp, atp, atpPerKelas,
      daftarMapel, daftarCp, daftarTp
    }
    try {
      const res = await fetch('/api/download-cp-tp-atp-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const rawText = await res.text()
        const contentType = res.headers.get('content-type') || ''
        let pesan = rawText
        if (contentType.includes('text/html') || rawText.trim().startsWith('<!DOCTYPE')) {
          pesan = `Server mengembalikan halaman error (status ${res.status}), bukan file Excel. ` +
            `Kemungkinan endpoint API "/api/download-cp-tp-atp-excel" belum tersedia / gagal dijalankan di server. ` +
            `Coba refresh halaman, pastikan server sudah di-deploy ulang, atau hubungi admin sistem.`
        }
        throw new Error(pesan)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${namaFileAman(`CP TP ATP ${namaMapel} Fase ${filterFase}`)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Gagal download: ' + String(e instanceof Error ? e.message : e))
    }
    setDownloadLoading(false)
  }

  // ─────────────────────────────────────────────────────────
  // COMPUTED
  // ─────────────────────────────────────────────────────────
  // Daftar TINGKAT KELAS yang tersedia, diambil dari rombel yang sudah didaftarkan admin
  // (bukan hardcode I-XII), supaya opsi kelas selalu sesuai kondisi sekolah.
  const kelasTerdaftar = useMemo(() => {
    const set = new Set<string>()
    daftarRombel.forEach((r: any) => {
      const t = ambilTingkatDariRombel(r)
      if (t) set.add(t)
    })
    const dikenal = KELAS_OPTIONS_FALLBACK.filter(k => set.has(k))
    const lainnya = Array.from(set).filter(k => !KELAS_OPTIONS_FALLBACK.includes(k)).sort()
    const hasil = [...dikenal, ...lainnya]
    return hasil.length > 0 ? hasil : KELAS_OPTIONS_FALLBACK
  }, [daftarRombel])

  // Kelas terdaftar, diurutkan dari yang paling rendah — dasar untuk menentukan
  // kolom kelas per fase (lihat hitungKolomKelas)
  const kelasTerurutAngka = useMemo(() => {
    return [...kelasTerdaftar]
      .map(k => ({ label: k, n: angkaDariKelas(k) }))
      .filter((x): x is { label: string; n: number } => x.n != null)
      .sort((a, b) => a.n - b.n)
      .map(x => x.label)
  }, [kelasTerdaftar])

  // Kolom kelas yang relevan untuk papan ATP, berdasarkan jenjang fase terpilih
  const kolomKelasAtp = useMemo(() => {
    if (!filterFase) return []
    if (kelasTerurutAngka.length === 0) return kelasTerdaftar // fallback: urutan tak terbaca
    return hitungKolomKelas(filterFase, kelasTerurutAngka)
  }, [filterFase, kelasTerurutAngka, kelasTerdaftar])

  const filteredCp = useMemo(() =>
    daftarCp.filter(c =>
      (!filterMapelId || c.mapelId === filterMapelId) &&
      (!filterFase || c.fase === filterFase)
    ), [daftarCp, filterMapelId, filterFase])

  const filteredMateri = useMemo(() =>
    daftarMateri.filter(m =>
      (!filterMapelId || m.mapelId === filterMapelId) &&
      (!filterFase || m.fase === filterFase)
    ), [daftarMateri, filterMapelId, filterFase])

  const filteredTp = useMemo(() =>
    daftarTp.filter(t =>
      (!filterMapelId || t.mapelId === filterMapelId) &&
      (!filterFase || t.fase === filterFase)
    ), [daftarTp, filterMapelId, filterFase])

  // TP yang sudah ditulis tapi BELUM dipetakan ke kelas manapun
  const tpBelumDipetakan = useMemo(() =>
    filteredTp.filter(t => !daftarAtp.some(a => a.tpId === t.id)),
    [filteredTp, daftarAtp])

  // ATP (TP yang sudah dipetakan) untuk Mapel + Fase terpilih
  const filteredAtp = useMemo(() =>
    daftarAtp.filter(a => (!filterMapelId || a.mapelId === filterMapelId) && (!filterFase || a.fase === filterFase)),
    [daftarAtp, filterMapelId, filterFase])

  const entriKelas = (kelas: string) =>
    filteredAtp.filter(a => a.kelas === kelas).sort((a,b) => a.urutanDiKelas - b.urutanDiKelas)

  // Nomor urut ATP yang BERLANJUT lintas kelas (bukan reset per kelas), mengikuti
  // urutan kolom kelas (kelas awal → akhir). Mis. kelas VII TP 1-10, kelas VIII
  // lanjut 11-15, kelas IX lanjut 16-20 — sesuai cara penomoran ATP yang dicetak.
  const nomorGlobalMap = useMemo(() => {
    const map: {[entryId: string]: number} = {}
    let counter = 1
    kolomKelasAtp.forEach(kelas => {
      entriKelas(kelas).forEach(a => { map[a.id] = counter; counter++ })
    })
    return map
  }, [kolomKelasAtp, filteredAtp])

  const namaMateri = (materiId?: string) => daftarMateri.find(m => m.id === materiId)?.nama || ''

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul CP / TP / ATP...</div>
  if (diizinkanAkses === false) return null

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800">

      {/* SIDEBAR */}
      <Sidebar />

      {/* MAIN */}
      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl font-black text-slate-900">Capaian Pembelajaran, Materi, TP & ATP</h1>
          <p className="text-xs text-gray-500 mt-1">Susun CP, Materi, TP, dan Alur Tujuan Pembelajaran sesuai Kurikulum Merdeka.</p>
        </header>

        {/* IDENTITAS DOKUMEN — alur seleksi berjenjang: Unit -> Fase -> Guru -> Mapel */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1.5 block">1. Lembaga / Unit</label>
              {cakupanGuru ? (
                <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-slate-600">
                  {daftarLembaga.find(u => u.id === filterUnitId)?.nama || 'Lembaga Pusat'} <span className="text-[9px] font-normal text-slate-400">(unit Anda)</span>
                </div>
              ) : (
                <select value={filterUnitId} onChange={e => setFilterUnitId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                  <option value="">Lembaga Pusat (Mudir)</option>
                  {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
                </select>
              )}
              <p className="text-[9px] text-slate-400 mt-1">Menentukan Fase, Guru Pengampu, serta Kepala Sekolah/Mudir yang tercantum di tanda tangan.</p>
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1.5 block">2. Fase</label>
              <select value={filterFase} onChange={e => setFilterFase(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                <option value="">-- Pilih Fase --</option>
                {faseOptionsTersedia.map(f => <option key={f} value={f}>Fase {f}</option>)}
              </select>
              <p className="text-[9px] text-slate-400 mt-1">
                Pilihan menyesuaikan jenjang Unit di atas (mis. SMP → Fase D, SMA → Fase E/F). Berlaku untuk satu fase, bukan per kelas — kelas dipetakan di tab ATP.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end mt-4 pt-4 border-t border-slate-100">
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1.5 block">3. Guru Pengampu</label>
              {cakupanGuru ? (
                <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-slate-600">
                  {daftarGuru.find(g => g.id === filterGuruId)?.nama || 'Anda'} <span className="text-[9px] font-normal text-slate-400">(akun Anda)</span>
                </div>
              ) : (
                <select value={filterGuruId} onChange={e => setFilterGuruId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                  <option value="">-- Pilih Guru --</option>
                  {daftarGuruSesuaiUnit.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                </select>
              )}
              <p className="text-[9px] text-slate-400 mt-1">Daftar mengikuti guru yang ditugaskan di Unit terpilih (lihat Kelola Data Guru).</p>
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1.5 block">4. Mata Pelajaran</label>
              <select value={filterMapelId} onChange={e => setFilterMapelId(e.target.value)}
                disabled={!!cakupanGuru && daftarMapelSesuaiGuru.length <= 1}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white disabled:bg-slate-50 disabled:text-slate-500">
                <option value="">-- Pilih Mapel --</option>
                {daftarMapelSesuaiGuru.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
              </select>
              <p className="text-[9px] text-slate-400 mt-1">
                {filterGuruId ? 'Otomatis mengikuti mapel yang diampu guru terpilih.' : 'Pilih Guru Pengampu dulu supaya daftar mapel lebih tepat.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end mt-4 pt-4 border-t border-slate-100">
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1.5 block">Tahun Ajaran</label>
              <input value={tahunAjaran} onChange={e => setTahunAjaran(e.target.value)}
                placeholder="Cth: 2025/2026"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1.5 block">Titi Mangsa (Tempat, Tanggal)</label>
              <input value={titiMangsaAtpInput} onChange={e => setTitiMangsaAtpInput(e.target.value)}
                placeholder={`Cth: Bandung, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]" />
              <p className="text-[9px] text-slate-400 mt-1">Kosongkan untuk memakai tanggal hari ini otomatis.</p>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-slate-400 leading-relaxed">
            Nama sekolah yang tercetak mengikuti Unit yang dipilih di atas (Lembaga Pusat → nama lembaga pusat; Unit tertentu → nama unit itu). Nama Guru & Tahun Ajaran ini akan tampil di bawah judul dokumen (sebelum tabel Capaian Umum, CP per Elemen, Materi, TP, dan ATP) saat dicetak.
          </p>

          {/* Cetak / Download — 2 pilihan TERPISAH, masing-masing 1 halaman/dokumen sendiri */}
          {filterMapelId && filterFase ? (
            <div className="mt-3 flex flex-col gap-2 items-end">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Analisis Capaian Pembelajaran:</span>
                <button onClick={() => handleDownloadPdf('preview', 'analisis')} disabled={downloadLoading}
                  className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold text-xs shadow transition disabled:opacity-50" title="Pratinjau sebelum unduh">
                  <Eye className="w-3.5 h-3.5" /> Pratinjau
                </button>
                <button onClick={() => handleDownloadPdf('unduh', 'analisis')} disabled={downloadLoading}
                  className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition disabled:opacity-50">
                  <Download className="w-3.5 h-3.5" /> {downloadLoading ? 'Menyiapkan...' : 'Unduh PDF'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Alur Tujuan Pembelajaran (ATP):</span>
                <button onClick={() => handleDownloadPdf('preview', 'atp')} disabled={downloadLoading}
                  className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold text-xs shadow transition disabled:opacity-50" title="Pratinjau sebelum unduh">
                  <Eye className="w-3.5 h-3.5" /> Pratinjau
                </button>
                <button onClick={() => handleDownloadPdf('unduh', 'atp')} disabled={downloadLoading}
                  className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition disabled:opacity-50">
                  <Download className="w-3.5 h-3.5" /> {downloadLoading ? 'Menyiapkan...' : 'Unduh PDF'}
                </button>
              </div>
              <button onClick={handleDownloadExcel} disabled={downloadLoading}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition disabled:opacity-50">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
              </button>
            </div>
          ) : (
            <p className="mt-3 text-right text-[10px] text-slate-400">Pilih Mata Pelajaran dan Fase untuk mengaktifkan cetak dokumen.</p>
          )}
        </section>

        {/* TAB NAVIGASI */}
        <div className="flex bg-white rounded-xl border border-slate-200 p-1.5 w-fit flex-wrap">
          {[
            { key: 'cp', label: 'Capaian Pembelajaran (CP)', icon: <BookMarked className="w-3.5 h-3.5" /> },
            { key: 'materi', label: 'Materi', icon: <Library className="w-3.5 h-3.5" /> },
            { key: 'tp', label: 'Tujuan Pembelajaran (TP)', icon: <Layers className="w-3.5 h-3.5" /> },
            { key: 'atp', label: 'Alur TP (ATP)', icon: <ListChecks className="w-3.5 h-3.5" /> },
            { key: 'rekap', label: 'Rekap ATP', icon: <FileText className="w-3.5 h-3.5" /> },
          ].map(t => (
            <button key={t.key} onClick={() => setTabUtama(t.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition ${tabUtama === t.key ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════ TAB CP ══════════════════ */}
        {tabUtama === 'cp' && (
          <fieldset disabled={!bolehEdit} className="space-y-8 border-0 p-0 m-0 min-w-0">
          <section className="space-y-8">

            {/* ── CAPAIAN PEMBELAJARAN PER ELEMEN ── */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-sm font-black text-slate-800">Capaian Pembelajaran per Elemen (CP)</h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">CP dari pemerintah/pusat, dipecah per elemen. Berlaku untuk satu fase (mis. Fase D = seluruh SMP), bukan per kelas.</p>
                </div>
                <button onClick={() => { setShowFormCp(true); setEditCpId(null); setFormCp({ mapelId: filterMapelId, fase: filterFase }) }}
                  className="flex items-center gap-2 bg-[#6A197D] hover:bg-[#571466] text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition">
                  <Plus className="w-3.5 h-3.5" /> Tambah CP
                </button>
              </div>

              {/* Form CP */}
              {showFormCp && (
                <div className="bg-[#F7ECFA]/50 border border-[#F0DFF5] rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-black text-[#450F52] uppercase tracking-wider">{editCpId ? 'Edit' : 'Tambah'} Capaian Pembelajaran</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Mata Pelajaran *</label>
                      <select value={formCp.mapelId||''} onChange={e => setFormCp({...formCp, mapelId: e.target.value})}
                        className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                        <option value="">-- Pilih --</option>
                        {daftarMapelTampil.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Fase *</label>
                      <select value={formCp.fase||''} onChange={e => setFormCp({...formCp, fase: e.target.value})}
                        className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                        <option value="">-- Fase --</option>
                        {FASE_OPTIONS.map(f => <option key={f} value={f}>Fase {f}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Elemen CP (Opsional)</label>
                    <input value={formCp.elemen||''} onChange={e => setFormCp({...formCp, elemen: e.target.value})}
                      placeholder="Cth: Pemahaman Konsep, Keterampilan Proses, dll"
                      className="w-full px-3 py-2 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Deskripsi Capaian Pembelajaran *</label>
                    <textarea value={formCp.deskripsi||''} onChange={e => setFormCp({...formCp, deskripsi: e.target.value})}
                      placeholder="Tulis deskripsi CP sesuai dokumen kurikulum..."
                      rows={4}
                      className="w-full px-3 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0] resize-none" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowFormCp(false); setEditCpId(null); setFormCp({}) }}
                      className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition">Batal</button>
                    <button onClick={handleSimpanCp}
                      className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-[#6A197D] rounded-xl hover:bg-[#571466] transition">
                      <Check className="w-3.5 h-3.5" /> Simpan CP
                    </button>
                  </div>
                </div>
              )}

              {/* Daftar CP */}
              <div className="space-y-3">
                {filteredCp.length === 0 && (
                  <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center text-slate-400">
                    <BookMarked className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-semibold">Belum ada CP. Klik "Tambah CP" untuk mulai.</p>
                  </div>
                )}
                {filteredCp.map(cp => {
                  const tpCount = daftarTp.filter(t => t.cpId === cp.id).length
                  const materiCount = daftarMateri.filter(m => m.cpId === cp.id).length
                  const namaMapelCp = daftarMapel.find(m => m.id === cp.mapelId)?.nama || '-'
                  return (
                    <div key={cp.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="px-2.5 py-1 bg-[#F0DFF5] text-[#450F52] text-[10px] font-black rounded-lg uppercase tracking-wider">{namaMapelCp}</span>
                            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-black rounded-lg">Fase {cp.fase}</span>
                            {cp.elemen && <span className="px-2.5 py-1 bg-violet-50 text-violet-700 text-[10px] font-semibold rounded-lg">{cp.elemen}</span>}
                            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-lg">{materiCount} Materi</span>
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-lg">{tpCount} TP</span>
                          </div>
                          <p className="text-sm text-slate-700 font-medium leading-relaxed">{cp.deskripsi}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => { setFormCp(cp); setEditCpId(cp.id); setShowFormCp(true) }}
                            className="p-2 text-slate-400 hover:text-[#6A197D] hover:bg-[#F7ECFA] rounded-lg transition"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleHapusCp(cp.id)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
          </fieldset>
        )}

        {/* ══════════════════ TAB MATERI ══════════════════ */}
        {tabUtama === 'materi' && (
          <fieldset disabled={!bolehEdit} className="space-y-4 border-0 p-0 m-0 min-w-0">
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-sm font-black text-slate-800">Materi</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Tulis materi pokok untuk tiap CP. Materi ini akan dipilih saat menulis TP, dan otomatis tampil di ATP.</p>
              </div>
              <button onClick={() => { setShowFormMateri(true); setEditMateriId(null); setFormMateri({}) }}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition">
                <Plus className="w-3.5 h-3.5" /> Tambah Materi
              </button>
            </div>

            {/* Form Materi */}
            {showFormMateri && (
              <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black text-amber-800 uppercase tracking-wider">{editMateriId ? 'Edit' : 'Tambah'} Materi</h3>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">CP Rujukan *</label>
                  <select value={formMateri.cpId||''} onChange={e => setFormMateri({...formMateri, cpId: e.target.value})}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                    <option value="">-- Pilih CP Rujukan --</option>
                    {(filteredCp.length === 0 ? daftarCp : filteredCp).map(c => {
                      const nm = daftarMapel.find(m => m.id === c.mapelId)?.nama || '-'
                      return <option key={c.id} value={c.id}>[{nm} | Fase {c.fase}{c.elemen ? ` | ${c.elemen}` : ''}] {c.deskripsi.slice(0,80)}...</option>
                    })}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nama Materi *</label>
                  <input value={formMateri.nama||''} onChange={e => setFormMateri({...formMateri, nama: e.target.value})}
                    placeholder="Cth: Bilangan Bulat, Teks Laporan Hasil Observasi, dll"
                    className="w-full px-3 py-2 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Keterangan (Opsional)</label>
                  <textarea value={formMateri.deskripsi||''} onChange={e => setFormMateri({...formMateri, deskripsi: e.target.value})}
                    placeholder="Cakupan/lingkup materi ini..."
                    rows={3}
                    className="w-full px-3 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowFormMateri(false); setEditMateriId(null); setFormMateri({}) }}
                    className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition">Batal</button>
                  <button onClick={handleSimpanMateri}
                    className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-amber-600 rounded-xl hover:bg-amber-700 transition">
                    <Check className="w-3.5 h-3.5" /> Simpan Materi
                  </button>
                </div>
              </div>
            )}

            {/* Daftar CP + Materi nested */}
            <div className="space-y-4">
              {filteredCp.length === 0 && <div className="py-12 text-center text-slate-400 text-sm">Belum ada CP. Tambah CP terlebih dahulu.</div>}
              {filteredCp.map(cp => {
                const materiDiCp = filteredMateri.filter(m => m.cpId === cp.id)
                const namaMapelCp = daftarMapel.find(m => m.id === cp.mapelId)?.nama || '-'
                const isExpand = expandCpIdMateri === cp.id
                return (
                  <div key={cp.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div
                      onClick={() => setExpandCpIdMateri(isExpand ? null : cp.id)}
                      className="flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-slate-50/70 transition">
                      <div className="flex items-center gap-3 flex-1">
                        {isExpand ? <ChevronDown className="w-4 h-4 text-amber-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                        <div>
                          <div className="flex gap-2 items-center flex-wrap">
                            <span className="text-[10px] font-black bg-[#F7ECFA] text-[#571466] px-2 py-0.5 rounded">{namaMapelCp}</span>
                            <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Fase {cp.fase}</span>
                          </div>
                          <p className="text-xs font-semibold text-slate-700 mt-1 line-clamp-1">{cp.deskripsi}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-100 px-2.5 py-1 rounded-lg shrink-0">
                        {materiDiCp.length} Materi
                      </span>
                    </div>

                    {isExpand && (
                      <div className="border-t border-slate-100 divide-y divide-slate-100">
                        {materiDiCp.length === 0 && (
                          <div className="py-8 text-center text-slate-400 text-xs">Belum ada Materi untuk CP ini.</div>
                        )}
                        {materiDiCp.map((m, idx) => {
                          const tpCount = daftarTp.filter(t => t.materiId === m.id).length
                          return (
                            <div key={m.id} className="p-4 pl-10 bg-amber-50/20 hover:bg-amber-50/40 transition">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className="w-6 h-6 bg-amber-600 text-white text-[10px] font-black rounded-full flex items-center justify-center shrink-0">{idx+1}</span>
                                    <span className="text-xs font-bold text-slate-800">{m.nama}</span>
                                    <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-lg">{tpCount} TP</span>
                                  </div>
                                  {m.deskripsi && <p className="text-xs text-slate-600 leading-relaxed pl-8">{m.deskripsi}</p>}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={() => { setFormMateri({...m}); setEditMateriId(m.id); setShowFormMateri(true) }}
                                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"><Edit2 className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => handleHapusMateri(m.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
          </fieldset>
        )}

        {/* ══════════════════ TAB TP ══════════════════ */}
        {tabUtama === 'tp' && (
          <fieldset disabled={!bolehEdit} className="space-y-4 border-0 p-0 m-0 min-w-0">
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-sm font-black text-slate-800">Tujuan Pembelajaran (TP)</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Turunkan setiap CP menjadi TP yang lebih spesifik, dan pilih Materi yang menaunginya.</p>
              </div>
              <button onClick={() => { setShowFormTp(true); setEditTpId(null); setFormTp({ dimensiPancasila: [] }) }}
                className="flex items-center gap-2 bg-[#6A197D] hover:bg-[#571466] text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition">
                <Plus className="w-3.5 h-3.5" /> Tambah TP
              </button>
            </div>

            {/* Form TP */}
            {showFormTp && (
              <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black text-blue-800 uppercase tracking-wider">{editTpId ? 'Edit' : 'Tambah'} Tujuan Pembelajaran</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">CP Rujukan *</label>
                    <select value={formTp.cpId||''} onChange={e => setFormTp({...formTp, cpId: e.target.value, materiId: ''})}
                      className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      <option value="">-- Pilih CP Rujukan --</option>
                      {(filteredCp.length === 0 ? daftarCp : filteredCp).map(c => {
                        const nm = daftarMapel.find(m => m.id === c.mapelId)?.nama || '-'
                        return <option key={c.id} value={c.id}>[{nm} | Fase {c.fase}{c.elemen ? ` | ${c.elemen}` : ''}] {c.deskripsi.slice(0,60)}...</option>
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Materi Rujukan *</label>
                    <select value={formTp.materiId||''} onChange={e => setFormTp({...formTp, materiId: e.target.value})}
                      disabled={!formTp.cpId}
                      className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400">
                      <option value="">-- Pilih Materi --</option>
                      {daftarMateri.filter(m => m.cpId === formTp.cpId).map(m => (
                        <option key={m.id} value={m.id}>{m.nama}</option>
                      ))}
                    </select>
                    {formTp.cpId && daftarMateri.filter(m => m.cpId === formTp.cpId).length === 0 && (
                      <p className="text-[9px] text-red-500 mt-1">Belum ada Materi untuk CP ini. Tambahkan dulu di tab Materi.</p>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Deskripsi Tujuan Pembelajaran *</label>
                    <textarea value={formTp.deskripsi||''} onChange={e => setFormTp({...formTp, deskripsi: e.target.value})}
                      placeholder="Peserta didik mampu..."
                      rows={3}
                      className="w-full px-3 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Dimensi Profil Pelajar Pancasila</label>
                  <div className="flex flex-wrap gap-2">
                    {DIMENSI_PANCASILA.map(d => (
                      <button key={d} onClick={() => toggleDimensi(d)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition ${(formTp.dimensiPancasila||[]).includes(d) ? 'bg-[#6A197D] text-white border-[#6A197D]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#D19EE0]'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowFormTp(false); setEditTpId(null); setFormTp({ dimensiPancasila: [] }) }}
                    className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition">Batal</button>
                  <button onClick={handleSimpanTp}
                    className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition">
                    <Check className="w-3.5 h-3.5" /> Simpan TP
                  </button>
                </div>
              </div>
            )}

            {/* Daftar CP + TP nested */}
            <div className="space-y-4">
              {filteredCp.length === 0 && <div className="py-12 text-center text-slate-400 text-sm">Belum ada CP. Tambah CP terlebih dahulu.</div>}
              {filteredCp.map(cp => {
                const tpDiCp = filteredTp.filter(t => t.cpId === cp.id)
                const namaMapelCp = daftarMapel.find(m => m.id === cp.mapelId)?.nama || '-'
                const isExpand = expandCpId === cp.id
                return (
                  <div key={cp.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div
                      onClick={() => setExpandCpId(isExpand ? null : cp.id)}
                      className="flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-slate-50/70 transition">
                      <div className="flex items-center gap-3 flex-1">
                        {isExpand ? <ChevronDown className="w-4 h-4 text-[#8A2FA0] shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                        <div>
                          <div className="flex gap-2 items-center flex-wrap">
                            <span className="text-[10px] font-black bg-[#F7ECFA] text-[#571466] px-2 py-0.5 rounded">{namaMapelCp}</span>
                            <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Fase {cp.fase}</span>
                          </div>
                          <p className="text-xs font-semibold text-slate-700 mt-1 line-clamp-1">{cp.deskripsi}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-lg shrink-0">
                        {tpDiCp.length} TP
                      </span>
                    </div>

                    {isExpand && (
                      <div className="border-t border-slate-100 divide-y divide-slate-100">
                        {tpDiCp.length === 0 && (
                          <div className="py-8 text-center text-slate-400 text-xs">Belum ada TP untuk CP ini.</div>
                        )}
                        {tpDiCp.map((tp, tpIdx) => {
                          const sudahDipetakan = daftarAtp.find(a => a.tpId === tp.id)
                          return (
                            <div key={tp.id} className="p-4 pl-10 bg-blue-50/20 hover:bg-blue-50/40 transition">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <span className="w-6 h-6 bg-blue-600 text-white text-[10px] font-black rounded-full flex items-center justify-center shrink-0">{tpIdx+1}</span>
                                    {tp.materiId ? (
                                      <span className="text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-lg">📘 {namaMateri(tp.materiId)}</span>
                                    ) : (
                                      <span className="text-[10px] font-black bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-lg">⚠️ Materi belum dipilih</span>
                                    )}
                                    {sudahDipetakan ? (
                                      <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-lg">Kelas {sudahDipetakan.kelas}</span>
                                    ) : (
                                      <span className="text-[10px] font-black bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-lg">Belum dipetakan ke kelas</span>
                                    )}
                                  </div>
                                  <p className="text-xs font-semibold text-slate-700 leading-relaxed">{tp.deskripsi}</p>
                                  {tp.dimensiPancasila?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {tp.dimensiPancasila.map(d => (
                                        <span key={d} className="text-[9px] font-bold bg-violet-50 text-violet-700 border border-violet-100 px-1.5 py-0.5 rounded">{d}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={() => { setFormTp({...tp}); setEditTpId(tp.id); setShowFormTp(true) }}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><Edit2 className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => handleHapusTp(tp.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
          </fieldset>
        )}

        {/* ══════════════════ TAB ATP (PAPAN KELAS) ══════════════════ */}
        {tabUtama === 'atp' && (
          <fieldset disabled={!bolehEdit} className="space-y-6 border-0 p-0 m-0 min-w-0">
          <section className="space-y-6">
            <div>
              <h2 className="text-sm font-black text-slate-800">Alur Tujuan Pembelajaran (ATP)</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Murni pemetaan — tidak ada isian apapun di sini. Materi otomatis ikut dari TP yang sudah dituliskan. Pindahkan TP dari
                daftar di kiri ke kolom kelas (drag, atau pakai dropdown "Pindah ke kelas" di tiap kartu), lalu urutkan bebas dengan panah.
                Nomor urut berlanjut lintas kelas (kelas awal → akhir). Pertemuan, minggu, metode, asesmen, JP & semester diatur belakangan di Prota &amp; Promes.
              </p>
            </div>

            {!filterMapelId || !filterFase ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center text-slate-400">
                <ListChecks className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-semibold">Pilih Mata Pelajaran dan Fase di atas untuk membuka papan ATP.</p>
              </div>
            ) : (
              <div className="flex gap-4 items-start overflow-x-auto pb-4">

                {/* ── POOL: TP belum dipetakan ── */}
                <div className="w-72 shrink-0 bg-slate-100 border border-slate-200 rounded-2xl p-3 flex flex-col max-h-[75vh]">
                  <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-slate-200">
                    <h3 className="text-[11px] font-black text-slate-600 uppercase tracking-wider">TP Belum Dipetakan</h3>
                    <span className="text-[10px] font-black bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{tpBelumDipetakan.length}</span>
                  </div>
                  <div className="space-y-2 overflow-y-auto flex-1">
                    {tpBelumDipetakan.length === 0 && (
                      <p className="text-[10px] text-slate-400 text-center py-6 px-2">
                        {filteredTp.length === 0 ? 'Belum ada TP untuk Mapel & Fase ini. Tulis dulu di tab TP.' : 'Semua TP sudah dipetakan ke kelas. 🎉'}
                      </p>
                    )}
                    {tpBelumDipetakan.map(tp => (
                      <div key={tp.id} draggable
                        onDragStart={e => onDragStartPool(e, tp.id)}
                        className="bg-white border border-slate-200 rounded-xl p-2.5 shadow-sm cursor-grab active:cursor-grabbing hover:border-[#D19EE0] transition">
                        <div className="flex items-start gap-1.5">
                          <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            {tp.materiId ? (
                              <span className="text-[9px] font-black text-amber-600 uppercase">📘 {namaMateri(tp.materiId)}</span>
                            ) : (
                              <span className="text-[9px] font-black text-red-500 uppercase">⚠️ Materi belum dipilih</span>
                            )}
                            <p className="text-[11px] font-semibold text-slate-700 leading-snug line-clamp-3">{tp.deskripsi}</p>
                          </div>
                        </div>
                        {kolomKelasAtp.length > 0 && (
                          <select onChange={e => { if (e.target.value) { handlePindahkanTpKeKelas(tp.id, e.target.value); e.target.value = '' } }}
                            defaultValue=""
                            className="w-full mt-2 px-2 py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-slate-50">
                            <option value="">→ Pindah ke kelas...</option>
                            {kolomKelasAtp.map(k => <option key={k} value={k}>Kelas {k}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── KOLOM PER KELAS ── */}
                {kolomKelasAtp.map(kelas => {
                  const entri = entriKelas(kelas)
                  const isDragOver = dragOverKelas === kelas
                  const nomorAwal = entri.length > 0 ? nomorGlobalMap[entri[0].id] : null
                  const nomorAkhir = entri.length > 0 ? nomorGlobalMap[entri[entri.length-1].id] : null
                  return (
                    <div key={kelas}
                      onDragOver={e => onDragOverColumn(e, kelas)}
                      onDragLeave={onDragLeaveColumn}
                      onDrop={e => onDropColumn(e, kelas)}
                      className={`w-80 shrink-0 border rounded-2xl p-3 flex flex-col max-h-[75vh] transition ${isDragOver ? 'bg-[#F7ECFA] border-[#B36BC7] border-2' : 'bg-white border-slate-200'}`}>
                      <div className="px-1 pb-2 mb-2 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-xs font-black text-slate-800">Kelas {kelas}</h3>
                        <div className="flex items-center gap-1.5">
                          {nomorAwal != null && (
                            <span className="text-[9px] font-black bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">
                              No {nomorAwal}{nomorAkhir !== nomorAwal ? `–${nomorAkhir}` : ''}
                            </span>
                          )}
                          <span className="text-[10px] font-black bg-[#F7ECFA] text-[#571466] px-2 py-0.5 rounded-full">{entri.length} TP</span>
                        </div>
                      </div>
                      <div className="space-y-2 overflow-y-auto flex-1 min-h-[80px]">
                        {entri.length === 0 && (
                          <p className="text-[10px] text-slate-400 text-center py-8 px-2 border-2 border-dashed border-slate-200 rounded-xl">
                            Seret TP ke sini, atau pakai dropdown "Pindah ke kelas" di kartu TP.
                          </p>
                        )}
                        {entri.map((a, idx) => {
                          const tp = daftarTp.find(t => t.id === a.tpId)
                          return (
                            <div key={a.id} draggable
                              onDragStart={e => onDragStartCard(e, a.id)}
                              className="bg-violet-50/60 border border-violet-100 rounded-xl p-2.5 cursor-grab active:cursor-grabbing">
                              <div className="flex items-start gap-1.5">
                                <GripVertical className="w-3.5 h-3.5 text-violet-300 mt-1 shrink-0" />
                                <span className="w-5 h-5 bg-violet-600 text-white text-[10px] font-black rounded-full flex items-center justify-center shrink-0 mt-0.5">{nomorGlobalMap[a.id]}</span>
                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="px-2 py-1.5 border border-violet-200 rounded-lg text-[11px] font-bold text-slate-800 bg-white">
                                    {tp?.materiId ? namaMateri(tp.materiId) : <span className="text-red-500 font-semibold">⚠️ Materi belum dipilih (edit di tab TP)</span>}
                                  </div>
                                  <p className="text-[9px] text-slate-400 leading-snug line-clamp-2 px-0.5">{tp?.deskripsi}</p>

                                  <div className="flex items-center gap-1.5 px-0.5">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase">Semester</span>
                                    <div className="flex bg-white border border-violet-200 rounded-lg p-0.5">
                                      <button onClick={() => handleUbahSemester(a.id, '1')}
                                        className={`px-2 py-0.5 text-[9px] font-black rounded ${a.semester==='1' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}>Ganjil</button>
                                      <button onClick={() => handleUbahSemester(a.id, '2')}
                                        className={`px-2 py-0.5 text-[9px] font-black rounded ${a.semester==='2' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}>Genap</button>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-0.5 pt-0.5">
                                    <button onClick={() => handleReorderEntry(a.id, 'up')} disabled={idx===0}
                                      className="p-1 text-slate-400 hover:text-violet-600 hover:bg-white rounded transition disabled:opacity-30" title="Naik">
                                      <ArrowUp className="w-3 h-3" /></button>
                                    <button onClick={() => handleReorderEntry(a.id, 'down')} disabled={idx===entri.length-1}
                                      className="p-1 text-slate-400 hover:text-violet-600 hover:bg-white rounded transition disabled:opacity-30" title="Turun">
                                      <ArrowDown className="w-3 h-3" /></button>
                                    <button onClick={() => handleKembalikanKePool(a.id)}
                                      className="p-1 ml-auto text-slate-400 hover:text-red-500 hover:bg-white rounded transition" title="Kembalikan ke pool">
                                      <X className="w-3 h-3" /></button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
          </fieldset>
        )}

        {/* ══════════════════ TAB REKAP ══════════════════ */}
        {tabUtama === 'rekap' && (
          <section className="space-y-6">
            <div>
              <h2 className="text-sm font-black text-slate-800">Rekap ATP — Semua Mapel & Fase</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">Nomor urut berlanjut lintas kelas dalam satu fase (mis. Kelas VII 1–10, lanjut Kelas VIII 11–15, dst).</p>
            </div>
            {daftarAtp.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-sm">Belum ada TP yang dipetakan ke kelas. Buka tab ATP untuk memetakan TP ke kelas.</div>
            ) : (
              (() => {
                const kombinasi = new Set(daftarAtp.map(a => `${a.mapelId}||${a.fase}`))
                return Array.from(kombinasi).sort().map(key => {
                  const [mapelId, fase] = key.split('||')
                  const namaMapelRekap = daftarMapel.find(m => m.id === mapelId)?.nama || mapelId

                  // Urutkan kelas sesuai posisi kolom baku (SD/SMP/SMA), lalu tambahkan
                  // kelas lain yang mungkin tak masuk bucket standar di akhir.
                  const kelasDenganEntri = Array.from(new Set(daftarAtp.filter(a => a.mapelId === mapelId && a.fase === fase).map(a => a.kelas)))
                  const urutanBaku = hitungKolomKelas(fase, kelasTerurutAngka).filter(k => kelasDenganEntri.includes(k))
                  const kelasLain = kelasDenganEntri.filter(k => !urutanBaku.includes(k)).sort()
                  const urutanKelas = [...urutanBaku, ...kelasLain]

                  let counter = 0
                  const blok = urutanKelas.map(kelas => {
                    const items = daftarAtp
                      .filter(a => a.mapelId === mapelId && a.fase === fase && a.kelas === kelas)
                      .sort((a,b) => a.urutanDiKelas - b.urutanDiKelas)
                      .map(a => { counter++; return { ...a, nomorGlobal: counter } })
                    return { kelas, items }
                  })
                  const totalTp = blok.reduce((s,b) => s + b.items.length, 0)

                  return (
                    <div key={key} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-slate-800">{namaMapelRekap}</span>
                          <span className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Fase {fase}</span>
                        </div>
                        <span className="text-xs font-black px-3 py-1 rounded-xl border bg-emerald-50 text-emerald-700 border-emerald-100">
                          {totalTp} TP
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                        <table className="w-full text-[10px] border-collapse">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-50 text-slate-500 font-black uppercase tracking-wider">
                              <th className="p-2 border border-slate-200 text-center w-10">No</th>
                              <th className="p-2 border border-slate-200 text-center w-16">Kelas</th>
                              <th className="p-2 border border-slate-200 text-center w-16">Semester</th>
                              <th className="p-2 border border-slate-200 text-left">Materi</th>
                              <th className="p-2 border border-slate-200 text-left">Tujuan Pembelajaran</th>
                            </tr>
                          </thead>
                          <tbody>
                            {blok.map(b => b.items.map((a, i) => {
                              const tp = daftarTp.find(t => t.id === a.tpId)
                              return (
                                <tr key={a.id} className={`${a.nomorGlobal % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'}`}>
                                  <td className="p-2 border border-slate-100 text-center font-bold text-[#8A2FA0]">{a.nomorGlobal}</td>
                                  {i === 0 && (
                                    <td className="p-2 border border-slate-100 text-center font-black text-slate-700 align-top" rowSpan={b.items.length}>
                                      {b.kelas}
                                    </td>
                                  )}
                                  <td className="p-2 border border-slate-100 text-center text-slate-600">{a.semester === '2' ? 'Genap' : 'Ganjil'}</td>
                                  <td className="p-2 border border-slate-100 font-bold text-slate-700">{namaMateri(tp?.materiId)}</td>
                                  <td className="p-2 border border-slate-100 text-slate-600">{tp?.deskripsi || '-'}</td>
                                </tr>
                              )
                            }))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })
              })()
            )}
          </section>
        )}

      </main>
      <PratinjauPdfModal url={previewUrl} onClose={() => setPreviewUrl(null)} judul="Pratinjau CP / TP / ATP" />
    </div>
  )
}