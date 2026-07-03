'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import {
  Landmark, LogOut, Shield, BookOpen, Home, Building,
  CalendarDays, BarChart2, FileText, FileSpreadsheet, Clock,
  Download, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  Calculator, Calendar, BookMarked
} from 'lucide-react'

// ============================================================
// TIPE DATA
// ============================================================

// Item agenda kalender pendidikan — HARUS sama persis dengan struktur
// yang disimpan modul Kaldik (localStorage key 'kaldik_agenda_list').
type AgendaItem = {
  tanggal: string          // "YYYY-MM-DD" (tanggal mulai)
  tanggalSelesai?: string  // "YYYY-MM-DD" (default = tanggal jika sehari)
  keterangan: string
  statusHari: string       // 'libur' (Hari Libur Khusus) | 'efektif' (Hari Efektif KBM)
  kategoriKlasifikasi: string
  lembagaTerlibat: string[]     // id unit, atau 'lembaga-induk' utk seluruh lembaga
  tingkatTerlibat?: string[]
  rombelTerlibat?: string[]
}

type SemesterInfo = {
  id: string
  nama: string          // "Ganjil" | "Genap"
  tahunAjaran: string   // "2024/2025"
  tanggalMulai: string
  tanggalSelesai: string
}

// Cakupan perhitungan minggu efektif LEMBAGA
type ScopeLevel = 'pusat' | 'unit' | 'kelas'

type DetailMinggu = {
  minggu: string
  tanggalMulai: string   // Senin
  tanggalSelesai: string // Jumat
  bulanKey: string        // "YYYY-MM" — bulan PENENTU minggu ini (lihat aturan pemotongan minggu)
  bulanLabel: string      // "Agustus 2026"
  hariLibur: number
  efektif: boolean
  kegiatanDiMingguIni: string[]
}

type HasilPerhitungan = {
  totalMinggu: number
  mingguEfektif: number
  mingguTidakEfektif: number
  detail: DetailMinggu[]
  detailTidakEfektif: { nama: string; jumlahMinggu: number }[]
}

type HasilHariEfektif = {
  totalHariMengajar: number
  totalJpEfektif: number
  perHari: { hari: string; jumlah: number }[]
  perMinggu: { mingguLabel: string; hariMengajar: string[]; efektif: boolean; jpEfektif: number }[]
}

// ============================================================
// UTIL: TANGGAL
// ============================================================
const parseDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const toDateStr = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const NAMA_BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

const formatTgl = (s: string) => {
  const d = parseDate(s)
  return `${d.getDate()} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}`
}

// Bulan "pemilik" sebuah minggu Senin-Jumat ditentukan oleh bulan tempat hari RABU
// (hari tengah dari Senin-Jumat) jatuh. Ini otomatis memenuhi aturan "mayoritas hari
// kerja dalam minggu itu menentukan bulannya" — sekaligus mencegah satu minggu terhitung
// dobel di dua bulan yang berbeda.
// Contoh: Senin 30 Juli, Selasa 31 Juli, Rabu 1 Agustus, Kamis 2 Agustus, Jumat 3 Agustus
//   -> Rabu jatuh di Agustus -> seluruh minggu ini masuk hitungan Agustus (bukan Juli).
const getBulanMingguFromSenin = (seninStr: string): { key: string; label: string } => {
  const rabu = addDays(parseDate(seninStr), 2)
  const y = rabu.getFullYear()
  const m = rabu.getMonth() // 0-11
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${NAMA_BULAN[m]} ${y}` }
}

// ============================================================
// LOGIKA INTI — DATA KALDIK
// ============================================================

// Menentukan apakah sebuah item agenda kaldik berlaku untuk cakupan yang dipilih.
// - 'pusat'  : seluruh lembaga (semua unit), semua agenda ikut dihitung.
// - 'unit'   : hanya agenda yang menyertakan unit tsb (langsung, atau via tag 'lembaga-induk'
//              yang berarti "berlaku untuk seluruh unit").
// - 'kelas'  : sama seperti unit, DITAMBAH memperhatikan rombelTerlibat / tingkatTerlibat —
//              kalau agenda menargetkan rombel/tingkat tertentu, kelas lain tidak terdampak.
function agendaBerlakuUntukScope(
  item: AgendaItem,
  scope: ScopeLevel,
  unitId: string,
  rombel?: { id: string; tingkatId: string }
): boolean {
  if (scope === 'pusat') return true

  if (!item.lembagaTerlibat?.includes(unitId)) return false
  if (scope === 'unit') return true

  // scope === 'kelas'
  if (item.rombelTerlibat && item.rombelTerlibat.length > 0) {
    return rombel ? item.rombelTerlibat.includes(rombel.id) : false
  }
  if (item.tingkatTerlibat && item.tingkatTerlibat.length > 0) {
    return rombel ? item.tingkatTerlibat.includes(rombel.tingkatId) : false
  }
  // Tidak menargetkan rombel/tingkat spesifik -> berlaku utk semua kelas di unit tsb
  return true
}

// Menyaring daftar agenda kaldik sesuai cakupan yang dipilih.
function filterAgendaByScope(
  agenda: AgendaItem[],
  scope: ScopeLevel,
  unitId: string,
  rombel?: { id: string; tingkatId: string }
): AgendaItem[] {
  return agenda.filter(item => agendaBerlakuUntukScope(item, scope, unitId, rombel))
}

// Membangun peta tanggal -> daftar kegiatan, HANYA dari item berstatus 'libur'.
// Item berstatus 'efektif' (mis. MPLS, Ujian, dsb yang tetap KBM) TIDAK mengurangi
// hari efektif, sesuai aturan: yang menentukan tidak-efektifnya sebuah hari adalah
// ketiadaan KBM pada hari itu, bukan sekadar ada-tidaknya catatan agenda.
function buildKaldikMaps(agendaScoped: AgendaItem[]): {
  liburSet: Set<string>
  kegiatanPerTgl: { [tgl: string]: string[] }
} {
  const liburSet = new Set<string>()
  const kegiatanPerTgl: { [tgl: string]: string[] } = {}
  agendaScoped.forEach(item => {
    if (item.statusHari !== 'libur') return
    const s = parseDate(item.tanggal)
    const e = parseDate(item.tanggalSelesai || item.tanggal)
    let cur = new Date(s)
    while (cur <= e) {
      const key = toDateStr(cur)
      liburSet.add(key)
      if (!kegiatanPerTgl[key]) kegiatanPerTgl[key] = []
      if (!kegiatanPerTgl[key].includes(item.keterangan)) kegiatanPerTgl[key].push(item.keterangan)
      cur = addDays(cur, 1)
    }
  })
  return { liburSet, kegiatanPerTgl }
}

// ============================================================
// LOGIKA INTI: HITUNG MINGGU EFEKTIF
// ============================================================
// Aturan efektif: dalam rentang Senin-Jumat, jika ada 3 hari atau lebih tanpa KBM
// (hari libur/kegiatan) -> minggu TIDAK efektif. Jika 2 hari atau kurang -> efektif.
function hitungMingguEfektif(
  tanggalMulai: string,
  tanggalSelesai: string,
  liburSet: Set<string>,
  kegiatanPerTgl: { [tgl: string]: string[] }
): HasilPerhitungan {
  const mulai = parseDate(tanggalMulai)
  const selesai = parseDate(tanggalSelesai)

  // Iterasi per minggu, mundur dulu ke Senin
  let senin = new Date(mulai)
  const dayOfWeek = senin.getDay() // 0=Minggu
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  senin = addDays(senin, offsetToMonday)

  const detail: DetailMinggu[] = []
  let mingguEfektif = 0
  let mingguTidakEfektif = 0
  const kegiatanCount: { [nama: string]: number } = {}

  while (senin <= selesai) {
    const jumat = addDays(senin, 4)

    // Hari Senin-Jumat dalam rentang semester
    const hariDlmMinggu: Date[] = []
    for (let i = 0; i < 5; i++) {
      const h = addDays(senin, i)
      if (h >= mulai && h <= selesai) hariDlmMinggu.push(h)
    }

    if (hariDlmMinggu.length === 0) { senin = addDays(senin, 7); continue }

    let jmlLibur = 0
    const kegiatanMingguIni: string[] = []

    hariDlmMinggu.forEach(h => {
      const key = toDateStr(h)
      if (liburSet.has(key)) {
        jmlLibur++
        const kegiatan = kegiatanPerTgl[key] || []
        kegiatan.forEach(k => {
          if (!kegiatanMingguIni.includes(k)) kegiatanMingguIni.push(k)
        })
      }
    })

    // Efektif jika hari libur/kegiatan di minggu itu <= 2 (aturan: 3 hari atau lebih -> tidak efektif)
    const efektif = jmlLibur <= 2

    if (efektif) { mingguEfektif++ } else {
      mingguTidakEfektif++
      kegiatanMingguIni.forEach(k => {
        kegiatanCount[k] = (kegiatanCount[k] || 0) + 1
      })
    }

    const { key: bulanKey, label: bulanLabel } = getBulanMingguFromSenin(toDateStr(senin))

    detail.push({
      minggu: `${formatTgl(toDateStr(senin))} s.d. ${formatTgl(toDateStr(jumat))}`,
      tanggalMulai: toDateStr(senin),
      tanggalSelesai: toDateStr(jumat),
      bulanKey,
      bulanLabel,
      hariLibur: jmlLibur,
      efektif,
      kegiatanDiMingguIni: kegiatanMingguIni
    })

    senin = addDays(senin, 7)
  }

  const detailTidakEfektif = Object.entries(kegiatanCount)
    .map(([nama, jumlahMinggu]) => ({ nama, jumlahMinggu }))
    .sort((a, b) => b.jumlahMinggu - a.jumlahMinggu)

  return {
    totalMinggu: detail.length,
    mingguEfektif,
    mingguTidakEfektif,
    detail,
    detailTidakEfektif
  }
}

// ============================================================
// LOGIKA INTI: HITUNG HARI & JP EFEKTIF (per Guru/Mapel/Rombel)
// ============================================================
// hasilRombel HARUS sudah dihitung dengan cakupan (scope) kelas yang bersangkutan,
// begitu juga liburSet — supaya kegiatan yang hanya menyasar kelas lain tidak ikut
// memotong hari efektif kelas ini (lihat aturan #3).
function hitungHariEfektifGuru(
  hasilRombel: HasilPerhitungan,
  jadwalTerjadwal: { hari: string }[],  // entri jadwal (hari) utk kombinasi guru+mapel+rombel ini
  jpPerMinggu: number,
  liburSet: Set<string>
): HasilHariEfektif {
  const HARI_MAP: { [k: string]: number } = { Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6 }
  const hariMengajar = [...new Set(jadwalTerjadwal.map(j => j.hari))].filter(h => HARI_MAP[h])

  let totalHariMengajar = 0
  let totalJpEfektif = 0

  const perMinggu: HasilHariEfektif['perMinggu'] = []

  hasilRombel.detail.forEach(minggu => {
    const hariEfektifDiMingguIni: string[] = []

    hariMengajar.forEach(hari => {
      const offset = (HARI_MAP[hari] || 1) - 1
      const tglHari = toDateStr(addDays(parseDate(minggu.tanggalMulai), offset))
      const tgl = parseDate(tglHari)
      const mulaiMinggu = parseDate(minggu.tanggalMulai)
      const endMinggu = addDays(mulaiMinggu, 6)

      if (tgl >= mulaiMinggu && tgl <= endMinggu && !liburSet.has(tglHari)) {
        hariEfektifDiMingguIni.push(hari)
      }
    })

    const jpMingguIni = hariEfektifDiMingguIni.length > 0 ? jpPerMinggu : 0
    totalHariMengajar += hariEfektifDiMingguIni.length
    totalJpEfektif += jpMingguIni

    if (hariEfektifDiMingguIni.length > 0 || hariMengajar.length > 0) {
      perMinggu.push({
        mingguLabel: minggu.minggu,
        hariMengajar: hariEfektifDiMingguIni,
        efektif: minggu.efektif,
        jpEfektif: jpMingguIni
      })
    }
  })

  const perHariCount: { [h: string]: number } = {}
  hariMengajar.forEach(h => { perHariCount[h] = 0 })
  perMinggu.forEach(m => m.hariMengajar.forEach(h => { perHariCount[h] = (perHariCount[h] || 0) + 1 }))

  return {
    totalHariMengajar,
    totalJpEfektif,
    perHari: Object.entries(perHariCount).map(([hari, jumlah]) => ({ hari, jumlah })),
    perMinggu
  }
}

// ============================================================
// KOMPONEN: KARTU PERHITUNGAN MINGGU / JAM EFEKTIF (Tabel I-IV)
// Dipakai untuk menampilkan hasil perhitungan Lembaga MAUPUN per Mapel/Kelas —
// keduanya memakai HasilPerhitungan yang sudah di-scope masing-masing, jadi
// isian tabelnya bisa berbeda antara Lembaga dan Mapel/Kelas tertentu.
// ============================================================
function KartuPerhitunganMingguJam({
  title,
  subtitle,
  hasil,
  jpPerMinggu,
  jpKnown,
  showDownload,
  onDownloadGanjil,
  onDownloadGenap,
  expandDetail,
  onToggleExpand,
  footnote,
}: {
  title: string
  subtitle?: string
  hasil: HasilPerhitungan
  jpPerMinggu?: number
  jpKnown?: boolean
  showDownload?: boolean
  onDownloadGanjil?: () => void
  onDownloadGenap?: () => void
  expandDetail: boolean
  onToggleExpand: () => void
  footnote?: string
}) {
  const totalJp = jpKnown && jpPerMinggu !== undefined ? hasil.mingguEfektif * jpPerMinggu : null

  const bulanMap: { [k: string]: { label: string; jml: number } } = {}
  hasil.detail.forEach(d => {
    if (!bulanMap[d.bulanKey]) bulanMap[d.bulanKey] = { label: d.bulanLabel, jml: 0 }
    bulanMap[d.bulanKey].jml++
  })

  const tidakEfektifPerBulan: { [k: string]: { label: string; kegiatan: Set<string>, jml: number } } = {}
  hasil.detail.filter(d => !d.efektif).forEach(d => {
    if (!tidakEfektifPerBulan[d.bulanKey]) tidakEfektifPerBulan[d.bulanKey] = { label: d.bulanLabel, kegiatan: new Set(), jml: 0 }
    tidakEfektifPerBulan[d.bulanKey].jml++
    d.kegiatanDiMingguIni.forEach(k => tidakEfektifPerBulan[d.bulanKey].kegiatan.add(k))
  })

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-[#6A197D]" />
          <div>
            <h2 className="font-bold text-slate-800 text-sm">{title}</h2>
            {subtitle && <p className="text-[10px] font-semibold text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {showDownload && (
          <div className="flex gap-2">
            <button onClick={onDownloadGanjil}
              className="flex items-center gap-1.5 bg-[#6A197D] hover:bg-[#58146A] text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition">
              <Download className="w-3.5 h-3.5" /> PDF Ganjil
            </button>
            <button onClick={onDownloadGenap}
              className="flex items-center gap-1.5 bg-[#FFDE59] hover:bg-[#FFD22E] text-[#6A197D] px-4 py-2 rounded-xl font-bold text-xs shadow transition">
              <Download className="w-3.5 h-3.5" /> PDF Genap
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tabel I: Jumlah Minggu per Bulan */}
        <div>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">I. Jumlah Minggu per Bulan</p>
          <table className="w-full text-xs border-collapse border border-slate-200 rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-slate-50 font-black text-slate-600 text-[10px] uppercase">
                <th className="p-2.5 border border-slate-200 text-left">No</th>
                <th className="p-2.5 border border-slate-200 text-left">Bulan</th>
                <th className="p-2.5 border border-slate-200 text-center">Jml. Minggu</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(bulanMap)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, v], i) => (
                  <tr key={key} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2.5 border border-slate-100 font-semibold text-slate-500">{i + 1}</td>
                    <td className="p-2.5 border border-slate-100 font-bold">{v.label}</td>
                    <td className="p-2.5 border border-slate-100 text-center font-extrabold text-[#58146A]">{v.jml}</td>
                  </tr>
                ))}
              <tr className="bg-[#6A197D]/5 font-black">
                <td colSpan={2} className="p-2.5 border border-slate-200 text-right text-[#4A1159]">Jumlah</td>
                <td className="p-2.5 border border-slate-200 text-center text-[#3D0E49] text-sm">{hasil.totalMinggu}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tabel II: Minggu Tidak Efektif */}
        <div>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">II. Jumlah Minggu Tidak Efektif</p>
          <table className="w-full text-xs border-collapse border border-slate-200 rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-slate-50 font-black text-slate-600 text-[10px] uppercase">
                <th className="p-2.5 border border-slate-200 text-left">Bulan</th>
                <th className="p-2.5 border border-slate-200 text-left">Kegiatan</th>
                <th className="p-2.5 border border-slate-200 text-center">Jml. Minggu</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(tidakEfektifPerBulan).length === 0
                ? <tr><td colSpan={3} className="p-4 text-center text-slate-400 text-[10px]">Tidak ada minggu tidak efektif</td></tr>
                : Object.entries(tidakEfektifPerBulan)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, data]) => (
                      <tr key={key} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="p-2.5 border border-slate-100 font-bold">{data.label}</td>
                        <td className="p-2.5 border border-slate-100 text-slate-600 text-[10px]">{[...data.kegiatan].join(', ') || '-'}</td>
                        <td className="p-2.5 border border-slate-100 text-center font-extrabold text-red-600">{data.jml}</td>
                      </tr>
                    ))}
              <tr className="bg-red-50 font-black">
                <td colSpan={2} className="p-2.5 border border-slate-200 text-right text-red-800">Jumlah</td>
                <td className="p-2.5 border border-slate-200 text-center text-red-900 text-sm">{hasil.mingguTidakEfektif}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Ringkasan Akhir */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-xs font-semibold text-slate-700 mt-2">
        <p><strong>III. Jumlah Minggu Efektif</strong> = Jumlah Minggu − Jumlah Minggu Tidak Efektif</p>
        <p className="text-[#4A1159] font-black pl-4">= {hasil.totalMinggu} − {hasil.mingguTidakEfektif} = <span className="text-lg">{hasil.mingguEfektif} Minggu</span></p>
        <p className="pt-1"><strong>IV. Jumlah Jam Efektif</strong> = Jumlah Minggu Efektif × Jumlah JP/Minggu</p>
        {totalJp !== null ? (
          <p className="text-[#4A1159] font-black pl-4">= {hasil.mingguEfektif} × {jpPerMinggu} JP/Minggu = <span className="text-lg">{totalJp} Jam Pelajaran</span></p>
        ) : (
          <p className="text-slate-500 pl-4 text-[10px]">{footnote || '* Pilih Guru/Mapel/Kelas di tab "Per Mapel/Guru" untuk hasil JP spesifik.'}</p>
        )}
      </div>

      {/* DETAIL MINGGU - collapsible */}
      <div>
        <button onClick={onToggleExpand}
          className="flex items-center gap-2 text-xs font-bold text-[#6A197D] hover:text-[#4A1159] transition">
          {expandDetail ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          {expandDetail ? 'Sembunyikan' : 'Tampilkan'} Detail Minggu per Minggu ({hasil.totalMinggu} minggu)
        </button>
        {expandDetail && (
          <div className="mt-3 overflow-x-auto max-h-[400px] overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-50 font-black text-slate-600 text-[10px] uppercase">
                  <th className="p-3 border-b border-slate-200">No</th>
                  <th className="p-3 border-b border-slate-200">Rentang Minggu</th>
                  <th className="p-3 border-b border-slate-200 text-center">Hari Libur/Kegiatan</th>
                  <th className="p-3 border-b border-slate-200">Kegiatan</th>
                  <th className="p-3 border-b border-slate-200 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hasil.detail.map((d, i) => (
                  <tr key={i} className={`${d.efektif ? 'hover:bg-slate-50' : 'bg-red-50/40 hover:bg-red-50'}`}>
                    <td className="p-3 font-semibold text-slate-400">{i + 1}</td>
                    <td className="p-3 font-bold text-slate-700">{d.minggu}</td>
                    <td className="p-3 text-center">
                      <span className={`font-extrabold ${d.hariLibur >= 3 ? 'text-red-600' : d.hariLibur > 0 ? 'text-[#6A197D]' : 'text-slate-400'}`}>
                        {d.hariLibur} hari
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 text-[10px]">{d.kegiatanDiMingguIni.join(', ') || '-'}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase ${d.efektif ? 'bg-[#FFDE59]/15 text-[#6A197D] border-[#FFDE59]/60' : 'bg-red-50 text-red-700 border-red-100'}`}>
                        {d.efektif ? '✓ Efektif' : '✗ Tdk Efektif'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// KOMPONEN UTAMA
// ============================================================
export default function MingguEfektifPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')
  const [namaSekolah, setNamaSekolah] = useState('')

  // Data master
  const [daftarGuru, setDaftarGuru] = useState<any[]>([])
  const [daftarMapel, setDaftarMapel] = useState<any[]>([])
  const [daftarRombel, setDaftarRombel] = useState<any[]>([])
  const [daftarTingkat, setDaftarTingkat] = useState<any[]>([])
  const [daftarLembagaUnit, setDaftarLembagaUnit] = useState<any[]>([]) // dari 'daftar_lembaga'
  const [daftarJadwal, setDaftarJadwal] = useState<any[]>([])
  const [daftarWaktu, setDaftarWaktu] = useState<any[]>([])
  const [matriksJp, setMatriksJp] = useState<{ [k: string]: string }>({}) // fallback manual jika jadwal kosong

  // Data kaldik — dibaca langsung dari modul Kaldik (kaldik_agenda_list)
  const [daftarAgenda, setDaftarAgenda] = useState<AgendaItem[]>([])

  const [semesterGanjil, setSemesterGanjil] = useState<SemesterInfo>({
    id: 'ganjil', nama: 'Ganjil', tahunAjaran: '2024/2025',
    tanggalMulai: '2024-07-15', tanggalSelesai: '2024-12-20'
  })
  const [semesterGenap, setSemesterGenap] = useState<SemesterInfo>({
    id: 'genap', nama: 'Genap', tahunAjaran: '2024/2025',
    tanggalMulai: '2025-01-06', tanggalSelesai: '2025-06-20'
  })

  // Filter tampilan
  const [semesterAktif, setSemesterAktif] = useState<'ganjil' | 'genap'>('ganjil')
  const [viewMode, setViewMode] = useState<'lembaga' | 'mapel'>('lembaga')

  // Cakupan perhitungan Minggu Efektif Lembaga: pusat / unit / kelas
  const [scopeLevel, setScopeLevel] = useState<ScopeLevel>('pusat')
  const [scopeUnitId, setScopeUnitId] = useState('')
  const [scopeRombelId, setScopeRombelId] = useState('')

  const [filterGuruId, setFilterGuruId] = useState('')
  const [filterMapelId, setFilterMapelId] = useState('')
  const [filterRombelId, setFilterRombelId] = useState('')
  const [expandDetail, setExpandDetail] = useState(false)
  const [expandDetailMapel, setExpandDetailMapel] = useState(false)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const storedInduk = localStorage.getItem('identitas_induk')
      if (storedInduk) {
        const p = JSON.parse(storedInduk)
        setNamaInduk(p.nama)
        setLogoInduk(p.logo_utama || p.logo || '')
        setNamaSekolah(p.nama || '')
      }

      const sg = localStorage.getItem('master_guru'); if (sg) setDaftarGuru(JSON.parse(sg))
      const sm = localStorage.getItem('master_mapel'); if (sm) setDaftarMapel(JSON.parse(sm))
      const sr = localStorage.getItem('master_rombel'); if (sr) setDaftarRombel(JSON.parse(sr))
      const st = localStorage.getItem('master_tingkat'); if (st) setDaftarTingkat(JSON.parse(st))
      const sl = localStorage.getItem('daftar_lembaga'); if (sl) setDaftarLembagaUnit(JSON.parse(sl))
      const sj = localStorage.getItem('data_jadwal_pelajaran'); if (sj) setDaftarJadwal(JSON.parse(sj))
      const sw = localStorage.getItem('master_pemetaan_waktu'); if (sw) setDaftarWaktu(JSON.parse(sw))
      const smj = localStorage.getItem('matriks_alokasi_rinci_samping'); if (smj) setMatriksJp(JSON.parse(smj))

      // Data kaldik — sumber yang benar adalah 'kaldik_agenda_list' (dibuat modul Kaldik)
      const ska = localStorage.getItem('kaldik_agenda_list')
      if (ska) { try { setDaftarAgenda(JSON.parse(ska)) } catch { /* abaikan */ } }

      // Load semester setting
      const sgs = localStorage.getItem('setting_semester_ganjil'); if (sgs) setSemesterGanjil(JSON.parse(sgs))
      const sge = localStorage.getItem('setting_semester_genap'); if (sge) setSemesterGenap(JSON.parse(sge))

      setLoading(false)
    }
    init()
  }, [router])

  // Simpan perubahan semester
  const simpanSemester = (sem: SemesterInfo, jenis: 'ganjil' | 'genap') => {
    if (jenis === 'ganjil') { setSemesterGanjil(sem); localStorage.setItem('setting_semester_ganjil', JSON.stringify(sem)) }
    else { setSemesterGenap(sem); localStorage.setItem('setting_semester_genap', JSON.stringify(sem)) }
  }

  const semesterSaatIni = semesterAktif === 'ganjil' ? semesterGanjil : semesterGenap

  // Daftar unit untuk selector cakupan (mengikuti konvensi modul Kaldik/Jadwal)
  const daftarUnitScope = useMemo(
    () => daftarLembagaUnit.map((u: any) => ({ id: u.id, label: u.nama })),
    [daftarLembagaUnit]
  )

  // Cari unit (lembagaId) tempat sebuah rombel berada, lewat tingkatId -> master_tingkat.lembagaId
  const resolveUnitIdRombel = (rombel: any): string => {
    if (!rombel) return ''
    const t = daftarTingkat.find((tt: any) => tt.id === rombel.tingkatId)
    return t?.lembagaId || ''
  }

  // Auto-pilih unit/kelas pertama begitu datanya tersedia, supaya selector tidak kosong
  useEffect(() => {
    if (scopeLevel === 'unit' && !scopeUnitId && daftarUnitScope.length > 0) {
      setScopeUnitId(daftarUnitScope[0].id)
    }
    if (scopeLevel === 'kelas' && !scopeRombelId && daftarRombel.length > 0) {
      setScopeRombelId(daftarRombel[0].id)
    }
  }, [scopeLevel, daftarUnitScope, daftarRombel, scopeUnitId, scopeRombelId])

  // --------------------------------------------------------------
  // AGENDA KALDIK SESUAI CAKUPAN LEMBAGA (pusat/unit/kelas) YANG DIPILIH
  // --------------------------------------------------------------
  const scopeRombelObj = scopeLevel === 'kelas' ? daftarRombel.find((r: any) => r.id === scopeRombelId) : undefined
  const scopeUnitResolved = scopeLevel === 'kelas' ? resolveUnitIdRombel(scopeRombelObj) : scopeUnitId

  const agendaScoped = useMemo(
    () => filterAgendaByScope(
      daftarAgenda,
      scopeLevel,
      scopeUnitResolved,
      scopeRombelObj ? { id: scopeRombelObj.id, tingkatId: scopeRombelObj.tingkatId } : undefined
    ),
    [daftarAgenda, scopeLevel, scopeUnitResolved, scopeRombelObj]
  )

  const { liburSet, kegiatanPerTgl } = useMemo(() => buildKaldikMaps(agendaScoped), [agendaScoped])

  // Hitung minggu efektif LEMBAGA (sesuai cakupan yang dipilih)
  const hasilPerhitungan = useMemo(() => {
    if (!semesterSaatIni.tanggalMulai || !semesterSaatIni.tanggalSelesai) return null
    return hitungMingguEfektif(semesterSaatIni.tanggalMulai, semesterSaatIni.tanggalSelesai, liburSet, kegiatanPerTgl)
  }, [semesterSaatIni, liburSet, kegiatanPerTgl])

  // --------------------------------------------------------------
  // AGENDA KALDIK KHUSUS UNTUK KELAS YANG DIPILIH DI TAB "PER MAPEL/GURU"
  // (selalu di-scope ke kelas tsb, terlepas dari selector cakupan lembaga di atas —
  // lihat aturan #3: minggu bisa tidak efektif utk lembaga tapi tetap efektif utk kelas lain)
  // --------------------------------------------------------------
  const rombelMapelObj = daftarRombel.find((r: any) => r.id === filterRombelId)
  const unitIdRombelMapel = resolveUnitIdRombel(rombelMapelObj)

  const agendaScopedMapel = useMemo(() => {
    if (!filterRombelId || !rombelMapelObj) return []
    return filterAgendaByScope(daftarAgenda, 'kelas', unitIdRombelMapel, { id: rombelMapelObj.id, tingkatId: rombelMapelObj.tingkatId })
  }, [daftarAgenda, filterRombelId, rombelMapelObj, unitIdRombelMapel])

  const { liburSet: liburSetMapel, kegiatanPerTgl: kegiatanPerTglMapel } = useMemo(
    () => buildKaldikMaps(agendaScopedMapel),
    [agendaScopedMapel]
  )

  const hasilRombelMapel = useMemo(() => {
    if (!filterRombelId || !semesterSaatIni.tanggalMulai || !semesterSaatIni.tanggalSelesai) return null
    return hitungMingguEfektif(semesterSaatIni.tanggalMulai, semesterSaatIni.tanggalSelesai, liburSetMapel, kegiatanPerTglMapel)
  }, [filterRombelId, semesterSaatIni, liburSetMapel, kegiatanPerTglMapel])

  // Daftar hari mengajar (utk kombinasi Guru+Mapel+Rombel) diambil dari Jadwal Pelajaran —
  // dipakai HANYA untuk tahu di hari apa saja kelas ini mengajar mapel tsb.
  const jadwalTerjadwal = useMemo(() => {
    if (!filterGuruId || !filterMapelId || !filterRombelId) return []
    return daftarJadwal.filter((j: any) =>
      j.guruId === filterGuruId &&
      j.mapelId === filterMapelId &&
      j.rombelId === filterRombelId &&
      daftarWaktu.find((w: any) => w.id === j.waktuId)?.jenis === 'mapel'
    )
  }, [daftarJadwal, daftarWaktu, filterGuruId, filterMapelId, filterRombelId])

  // JP/minggu dihitung OTOMATIS dari tabel Pemetaan Jam di modul Jadwal
  // (matriks_alokasi_rinci_samping). Formatnya angka JP per pertemuan dipisah koma, mis:
  //   "2"      -> 1 pertemuan, 2 JP/minggu
  //   "2,3"    -> 2 pertemuan, total 5 JP/minggu
  //   "2,2,2"  -> 3 pertemuan, total 6 JP/minggu
  // Jadi JP/minggu = jumlah semua angka pada string tsb.
  const jpPerMingguDariMatriks = useMemo(() => {
    if (!filterGuruId || !filterMapelId || !filterRombelId) return 0
    const keyMatriks = `${filterGuruId}_${filterMapelId}_${filterRombelId}`
    const strJp = matriksJp[keyMatriks] || ''
    return strJp.split(',').map(x => Number(x.trim())).filter(n => !isNaN(n) && n > 0).reduce((a, b) => a + b, 0)
  }, [matriksJp, filterGuruId, filterMapelId, filterRombelId])

  const jpPerMingguAktif = jpPerMingguDariMatriks

  // Hitung hari & JP efektif utk guru/mapel/rombel terpilih
  const hasilHariEfektif = useMemo(() => {
    if (!hasilRombelMapel || !filterGuruId || !filterMapelId || !filterRombelId) return null
    return hitungHariEfektifGuru(hasilRombelMapel, jadwalTerjadwal, jpPerMingguAktif, liburSetMapel)
  }, [hasilRombelMapel, jadwalTerjadwal, jpPerMingguAktif, liburSetMapel, filterGuruId, filterMapelId, filterRombelId])

  // ============================================================
  // GENERATE PDF (client-side via API call)
  // ============================================================
  const handleDownloadPdf = async (semester: SemesterInfo, mode: 'lembaga' | 'mapel' = 'lembaga') => {
    const isMapelMode = mode === 'mapel' && filterGuruId && filterMapelId && filterRombelId

    // Untuk unduhan Lembaga: pakai agenda & liburSet sesuai cakupan (scopeLevel) di selector atas.
    // Untuk unduhan per Mapel/Kelas: pakai agenda & liburSet yang sudah di-scope khusus ke kelas
    // tsb (liburSetMapel/kegiatanPerTglMapel) — supaya angkanya konsisten dgn kartu "Per Mapel/Guru".
    const baseLiburSet = isMapelMode ? liburSetMapel : liburSet
    const baseKegiatanPerTgl = isMapelMode ? kegiatanPerTglMapel : kegiatanPerTgl

    const semHasil = hitungMingguEfektif(semester.tanggalMulai, semester.tanggalSelesai, baseLiburSet, baseKegiatanPerTgl)

    // Bangun distribusi per bulan langsung dari bulanKey/bulanLabel yang sudah benar
    // (sudah memperhitungkan aturan pemotongan minggu lintas-bulan via hari Rabu)
    const bulanAgg: { [key: string]: { label: string; jml: number; kegiatanTE: Set<string> } } = {}
    semHasil.detail.forEach(d => {
      if (!bulanAgg[d.bulanKey]) bulanAgg[d.bulanKey] = { label: d.bulanLabel, jml: 0, kegiatanTE: new Set() }
      bulanAgg[d.bulanKey].jml++
      if (!d.efektif) d.kegiatanDiMingguIni.forEach(k => bulanAgg[d.bulanKey].kegiatanTE.add(k))
    })
    const bulanDistribusi = Object.entries(bulanAgg)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ bulan: v.label, jmlMinggu: v.jml, kegiatanTE: [...v.kegiatanTE].join(', ') }))

    let namaGuru = ''
    let namaMapelPdf = ''
    let namaRombelPdf = ''
    let jpPerMingguPdf = 0
    let hasilHariPdf: HasilHariEfektif | null = null
    let cakupanLabel = ''

    if (isMapelMode) {
      namaGuru = daftarGuru.find((g: any) => g.id === filterGuruId)?.nama || ''
      namaMapelPdf = daftarMapel.find((m: any) => m.id === filterMapelId)?.nama || ''
      namaRombelPdf = daftarRombel.find((r: any) => r.id === filterRombelId)?.nama || ''
      jpPerMingguPdf = jpPerMingguAktif
      hasilHariPdf = hitungHariEfektifGuru(semHasil, jadwalTerjadwal, jpPerMingguAktif, liburSetMapel)
      cakupanLabel = `Kelas: ${namaRombelPdf} — Mapel: ${namaMapelPdf}`
    } else {
      if (scopeLevel === 'kelas' && scopeRombelObj) namaRombelPdf = scopeRombelObj.nama || ''
      cakupanLabel = scopeLevel === 'pusat'
        ? 'Lembaga (Keseluruhan/Pusat)'
        : scopeLevel === 'unit'
          ? `Unit: ${daftarUnitScope.find(u => u.id === scopeUnitId)?.label || '-'}`
          : `Kelas: ${scopeRombelObj?.nama || '-'}`
    }

    const payload = {
      namaSekolah,
      semester: semester.nama,
      tahunAjaran: semester.tahunAjaran,
      tanggalMulai: formatTgl(semester.tanggalMulai),
      tanggalSelesai: formatTgl(semester.tanggalSelesai),
      cakupan: cakupanLabel,
      namaGuru, namaMapel: namaMapelPdf, namaRombel: namaRombelPdf,
      jpPerMinggu: jpPerMingguPdf,
      hasil: semHasil,
      bulanDistribusi,
      hasilHari: hasilHariPdf
    }

    const dataStr = encodeURIComponent(JSON.stringify(payload))
    const url = `/api/download-alokasi-waktu?data=${dataStr}`
    window.open(url, '_blank')
  }

  if (loading) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Minggu Efektif...</div>

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 font-body">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Open+Sans:wght@400;500;600;700&display=swap');
        .font-body, .font-body * {
          font-family: 'Open Sans', sans-serif;
        }
        /* Semua teks tebal (heading, angka besar, label penting) pakai Baloo 2 */
        .font-body .font-black,
        .font-body .font-extrabold,
        .font-body .font-bold,
        .font-body h1,
        .font-body h2 {
          font-family: 'Baloo 2', sans-serif;
        }
      `}</style>

      {/* SIDEBAR */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="h-20 flex flex-col justify-center px-6 border-b border-[#6A197D]/10 bg-[#6A197D]/5">
            <div className="flex items-center gap-3">
              {logoInduk ? <img src={logoInduk} alt="Logo" className="w-8 h-8 object-contain shrink-0" />
                : <Landmark className="w-6 h-6 text-[#6A197D] shrink-0" />}
              <h2 className="text-xs font-black text-[#2E0B38] uppercase tracking-widest truncate">{namaInduk}</h2>
            </div>
          </div>
          <nav className="p-4 space-y-1">
            <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Home className="w-4 h-4" /> Beranda Dasbor</a>
            <a href="/lembaga" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Building className="w-4 h-4" /> Identitas Lembaga</a>
            <a href="/peran" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Shield className="w-4 h-4" /> Pembagian Peran & Guru</a>
            <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Modul Administrasi</div>
            <a href="/kaldik" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><CalendarDays className="w-4 h-4" /> Kalender Pendidikan</a>
            <a href="/jadwal" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Clock className="w-4 h-4" /> Jadwal Pelajaran</a>
            <a href="/minggu-efektif" className="flex items-center gap-3 px-4 py-3 text-sm font-bold text-white bg-[#6A197D] rounded-xl shadow-md shadow-[#6A197D]/20"><BarChart2 className="w-4 h-4" /> Minggu Efektif</a>
            <a href="#" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><FileText className="w-4 h-4" /> CP, TP & ATP</a>
            <a href="#" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><FileSpreadsheet className="w-4 h-4" /> Prota & Promes</a>
            <a href="#" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><BookOpen className="w-4 h-4" /> RPP / Modul Ajar</a>
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => { supabase.auth.signOut(); router.push('/') }}
            className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition">
            <LogOut className="w-4 h-4" /> Keluar Sistem
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-8">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-black text-slate-900">Analisis Alokasi Waktu & Minggu Efektif</h1>
          <p className="text-xs text-gray-500">Perhitungan otomatis berdasarkan data kalender pendidikan (Kaldik) dan jadwal pelajaran.</p>
        </header>

        {/* PENGATURAN SEMESTER */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Calendar className="w-5 h-5 text-[#6A197D]" />
            <h2 className="font-bold text-slate-800 text-sm">Pengaturan Rentang Semester</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Ganjil */}
            <div className="space-y-3 border border-[#6A197D]/15 rounded-xl p-4 bg-[#6A197D]/5">
              <p className="text-xs font-black text-[#4A1159] uppercase tracking-wider">Semester Ganjil</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tahun Ajaran</label>
                  <input type="text" value={semesterGanjil.tahunAjaran}
                    onChange={e => simpanSemester({ ...semesterGanjil, tahunAjaran: e.target.value }, 'ganjil')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div />
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Mulai</label>
                  <input type="date" value={semesterGanjil.tanggalMulai}
                    onChange={e => simpanSemester({ ...semesterGanjil, tanggalMulai: e.target.value }, 'ganjil')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Selesai</label>
                  <input type="date" value={semesterGanjil.tanggalSelesai}
                    onChange={e => simpanSemester({ ...semesterGanjil, tanggalSelesai: e.target.value }, 'ganjil')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
              </div>
            </div>
            {/* Genap */}
            <div className="space-y-3 border border-[#FFDE59]/60 rounded-xl p-4 bg-[#FFDE59]/10">
              <p className="text-xs font-black text-[#6A197D] uppercase tracking-wider">Semester Genap</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tahun Ajaran</label>
                  <input type="text" value={semesterGenap.tahunAjaran}
                    onChange={e => simpanSemester({ ...semesterGenap, tahunAjaran: e.target.value }, 'genap')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div />
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Mulai</label>
                  <input type="date" value={semesterGenap.tanggalMulai}
                    onChange={e => simpanSemester({ ...semesterGenap, tanggalMulai: e.target.value }, 'genap')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Selesai</label>
                  <input type="date" value={semesterGenap.tanggalSelesai}
                    onChange={e => simpanSemester({ ...semesterGenap, tanggalSelesai: e.target.value }, 'genap')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 font-medium">
            * Data hari libur/kegiatan diambil otomatis dari Kalender Pendidikan (modul Kaldik). Pastikan sudah diisi di sana.
          </p>
        </section>

        {/* CAKUPAN PERHITUNGAN MINGGU EFEKTIF LEMBAGA */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Building className="w-5 h-5 text-[#6A197D]" />
            <h2 className="font-bold text-slate-800 text-sm">Cakupan Perhitungan Minggu Efektif Lembaga</h2>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex bg-slate-100 rounded-xl p-1">
              {([
                { v: 'pusat', label: '🏛️ Lembaga (Pusat)' },
                { v: 'unit', label: '🏫 Unit' },
                { v: 'kelas', label: '🎓 Kelas / Rombel' },
              ] as { v: ScopeLevel; label: string }[]).map(opt => (
                <button key={opt.v} onClick={() => setScopeLevel(opt.v)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition ${scopeLevel === opt.v ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
                  {opt.label}
                </button>
              ))}
            </div>

            {scopeLevel === 'unit' && (
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Pilih Unit</label>
                <select value={scopeUnitId} onChange={e => setScopeUnitId(e.target.value)}
                  className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white min-w-[200px]">
                  {daftarUnitScope.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </div>
            )}

            {scopeLevel === 'kelas' && (
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Pilih Kelas</label>
                <select value={scopeRombelId} onChange={e => setScopeRombelId(e.target.value)}
                  className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white min-w-[200px]">
                  {daftarRombel.map((r: any) => <option key={r.id} value={r.id}>Kelas {r.nama}</option>)}
                </select>
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-400">
            * Perhitungan di bawah otomatis menyaring agenda Kaldik sesuai cakupan ini. Kegiatan yang hanya menyasar
            unit/kelas lain tidak akan ikut mengurangi hari efektif cakupan yang sedang dipilih.
          </p>
        </section>

        {/* PILIH SEMESTER & MODE */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex bg-white rounded-xl border border-slate-200 p-1">
            <button onClick={() => setSemesterAktif('ganjil')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition ${semesterAktif === 'ganjil' ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>
              Semester Ganjil
            </button>
            <button onClick={() => setSemesterAktif('genap')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition ${semesterAktif === 'genap' ? 'bg-[#FFDE59] text-[#6A197D] shadow' : 'text-slate-600 hover:bg-slate-50'}`}>
              Semester Genap
            </button>
          </div>
          <div className="flex bg-white rounded-xl border border-slate-200 p-1">
            <button onClick={() => setViewMode('lembaga')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition ${viewMode === 'lembaga' ? 'bg-slate-800 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>
              📊 Lembaga
            </button>
            <button onClick={() => setViewMode('mapel')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition ${viewMode === 'mapel' ? 'bg-slate-800 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>
              📚 Per Mapel/Guru
            </button>
          </div>
        </div>

        {/* HASIL PERHITUNGAN MINGGU EFEKTIF */}
        {hasilPerhitungan && (
          <section className="space-y-6">
            {/* KARTU RINGKASAN */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Minggu', val: hasilPerhitungan.totalMinggu, color: 'bg-slate-100 text-slate-800', icon: <Calendar className="w-5 h-5" /> },
                { label: 'Minggu Efektif', val: hasilPerhitungan.mingguEfektif, color: 'bg-[#FFDE59]/15 text-[#6A197D] border border-[#FFDE59]/60', icon: <CheckCircle2 className="w-5 h-5 text-[#6A197D]" /> },
                { label: 'Minggu Tidak Efektif', val: hasilPerhitungan.mingguTidakEfektif, color: 'bg-red-50 text-red-800 border border-red-100', icon: <AlertTriangle className="w-5 h-5 text-red-500" /> },
                { label: 'Total Jam (asumsi 5 JP/mgg)', val: `${hasilPerhitungan.mingguEfektif * 5} JP`, color: 'bg-[#6A197D]/5 text-[#4A1159] border border-[#6A197D]/15', icon: <Calculator className="w-5 h-5 text-[#6A197D]" /> },
              ].map((item, i) => (
                <div key={i} className={`rounded-2xl p-5 space-y-2 ${item.color}`}>
                  <div className="flex items-center gap-2 opacity-70">{item.icon}</div>
                  <p className="text-3xl font-black">{item.val}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{item.label}</p>
                </div>
              ))}
            </div>

            <KartuPerhitunganMingguJam
              title="Perhitungan Minggu / Jam Efektif"
              subtitle="Lembaga — sesuai cakupan yang dipilih di atas"
              hasil={hasilPerhitungan}
              showDownload
              onDownloadGanjil={() => handleDownloadPdf(semesterGanjil, 'lembaga')}
              onDownloadGenap={() => handleDownloadPdf(semesterGenap, 'lembaga')}
              expandDetail={expandDetail}
              onToggleExpand={() => setExpandDetail(!expandDetail)}
              footnote={'* JP/Minggu untuk hasil spesifik per mapel dihitung otomatis dari tabel Pemetaan Jam — buka tab "Per Mapel/Guru" dan pilih Guru/Mapel/Kelas.'}
            />


            {/* HARI EFEKTIF PER MAPEL/GURU */}
            {viewMode === 'mapel' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <BookMarked className="w-5 h-5 text-[#6A197D]" />
                  <h2 className="font-bold text-slate-800 text-sm">Hari & JP Efektif per Mapel / Guru / Kelas</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Guru</label>
                    <select value={filterGuruId} onChange={e => setFilterGuruId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">-- Pilih Guru --</option>
                      {daftarGuru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mata Pelajaran</label>
                    <select value={filterMapelId} onChange={e => setFilterMapelId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">-- Pilih Mapel --</option>
                      {daftarMapel.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Kelas / Rombel</label>
                    <select value={filterRombelId} onChange={e => setFilterRombelId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">-- Pilih Kelas --</option>
                      {daftarRombel.map(r => <option key={r.id} value={r.id}>Kelas {r.nama}</option>)}
                    </select>
                  </div>
                </div>

                {filterRombelId && hasilRombelMapel && (
                  <KartuPerhitunganMingguJam
                    title={`Perhitungan Minggu / Jam Efektif — Kelas ${daftarRombel.find(r => r.id === filterRombelId)?.nama || ''}${filterMapelId ? ` (${daftarMapel.find(m => m.id === filterMapelId)?.nama || ''})` : ''}`}
                    subtitle="Disaring dari Kaldik khusus untuk kelas ini — bisa berbeda dari tabel Lembaga di atas"
                    hasil={hasilRombelMapel}
                    jpPerMinggu={jpPerMingguAktif}
                    jpKnown={Boolean(filterGuruId && filterMapelId && filterRombelId && jpPerMingguAktif > 0)}
                    showDownload={Boolean(filterGuruId && filterMapelId)}
                    onDownloadGanjil={() => handleDownloadPdf(semesterGanjil, 'mapel')}
                    onDownloadGenap={() => handleDownloadPdf(semesterGenap, 'mapel')}
                    expandDetail={expandDetailMapel}
                    onToggleExpand={() => setExpandDetailMapel(!expandDetailMapel)}
                    footnote={filterGuruId && filterMapelId ? undefined : '* Pilih Guru dan Mata Pelajaran juga untuk menghitung IV. Jumlah Jam Efektif.'}
                  />
                )}

                {filterGuruId && filterMapelId && filterRombelId && jadwalTerjadwal.length === 0 && (
                  <div className="bg-[#FFDE59]/15 border border-[#FFDE59]/80 rounded-xl p-3 text-[10px] font-semibold text-[#6A197D]">
                    Belum ditemukan jadwal (hari mengajar) untuk kombinasi Guru/Mapel/Kelas ini di modul Jadwal Pelajaran,
                    sehingga hari efektif belum bisa dihitung meski JP/minggu ({jpPerMingguAktif} JP) sudah terbaca dari tabel Pemetaan Jam.
                    Susun dulu jadwalnya di modul Jadwal Pelajaran.
                  </div>
                )}

                {hasilHariEfektif ? (
                  <div className="space-y-5">
                    {/* Ringkasan */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-[#6A197D]/5 border border-[#6A197D]/15 rounded-xl p-4 text-center">
                        <p className="text-2xl font-black text-[#4A1159]">{hasilHariEfektif.totalHariMengajar}</p>
                        <p className="text-[10px] font-bold text-[#6A197D] uppercase tracking-wider mt-1">Total Hari Mengajar Efektif</p>
                      </div>
                      <div className="bg-[#FFDE59]/15 border border-[#FFDE59]/60 rounded-xl p-4 text-center">
                        <p className="text-2xl font-black text-[#6A197D]">{hasilHariEfektif.totalJpEfektif}</p>
                        <p className="text-[10px] font-bold text-[#6A197D] uppercase tracking-wider mt-1">Total JP Efektif</p>
                      </div>
                      <div className="bg-[#FFDE59]/15 border border-[#FFDE59]/60 rounded-xl p-4 text-center">
                        <p className="text-2xl font-black text-[#6A197D]">
                          {hasilHariEfektif.perHari.map(h => `${h.hari}(${h.jumlah}x)`).join(', ') || '-'}
                        </p>
                        <p className="text-[10px] font-bold text-[#6A197D] uppercase tracking-wider mt-1">Distribusi Hari</p>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[10px] font-semibold text-slate-500">
                      JP/Minggu: <strong className="text-slate-700">{jpPerMingguAktif} JP</strong>{' '}
                      <span className="text-[#6A197D]">(otomatis dijumlahkan dari tabel Pemetaan Jam di modul Jadwal)</span>
                    </div>

                    {/* Keterangan penting: minggu tidak efektif tapi hari mengajar tetap ada */}
                    {hasilHariEfektif.perMinggu.some(m => !m.efektif && m.hariMengajar.length > 0) && (
                      <div className="bg-[#FFDE59]/15 border border-[#FFDE59]/80 rounded-xl p-4 flex gap-3">
                        <AlertTriangle className="w-4 h-4 text-[#6A197D] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-black text-[#6A197D]">Perhatian: Ada minggu tidak efektif namun kelas ini tetap KBM</p>
                          <p className="text-[10px] font-medium text-[#6A197D] mt-1">
                            Minggu dihitung tidak efektif untuk kelas ini (≥3 hari libur/kegiatan yang menyasar kelas ini) tetapi hari mengajar
                            tidak bertepatan dengan hari libur tersebut, sehingga JP tetap terhitung efektif pada hari itu.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Tabel detail per minggu */}
                    <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 font-black text-slate-600 text-[10px] uppercase">
                            <th className="p-3 border-b border-slate-200">Minggu</th>
                            <th className="p-3 border-b border-slate-200 text-center">Status Minggu (Kelas Ini)</th>
                            <th className="p-3 border-b border-slate-200">Hari Mengajar Efektif</th>
                            <th className="p-3 border-b border-slate-200 text-center">JP Efektif</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {hasilHariEfektif.perMinggu.map((m, i) => (
                            <tr key={i} className={`${!m.efektif && m.hariMengajar.length > 0 ? 'bg-[#FFDE59]/10' : m.efektif ? 'hover:bg-slate-50' : 'bg-red-50/30'}`}>
                              <td className="p-3 font-bold text-slate-700 text-[10px]">{m.mingguLabel}</td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase ${m.efektif ? 'bg-[#FFDE59]/15 text-[#6A197D] border-[#FFDE59]/60' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                  {m.efektif ? '✓ Efektif' : '✗ Tdk Efektif'}
                                </span>
                              </td>
                              <td className="p-3">
                                {m.hariMengajar.length > 0
                                  ? <div className="flex gap-1 flex-wrap">
                                      {m.hariMengajar.map(h => (
                                        <span key={h} className="px-1.5 py-0.5 bg-[#6A197D]/5 text-[#58146A] border border-[#6A197D]/15 rounded text-[9px] font-black">{h}</span>
                                      ))}
                                    </div>
                                  : <span className="text-slate-300 text-[10px]">Tidak mengajar</span>
                                }
                              </td>
                              <td className="p-3 text-center font-extrabold text-[#58146A]">{m.jpEfektif > 0 ? `${m.jpEfektif} JP` : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Ringkasan JP Efektif */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1.5 text-xs">
                      <p className="font-black text-slate-700">Ringkasan Alokasi Waktu</p>
                      <p className="text-slate-600">
                        Jumlah Minggu Efektif (Kelas ini): <strong className="text-[#58146A]">{hasilRombelMapel?.mingguEfektif ?? 0} minggu</strong>
                      </p>
                      <p className="text-slate-600">
                        Total Hari Mengajar Efektif: <strong className="text-[#58146A]">{hasilHariEfektif.totalHariMengajar} hari</strong>
                      </p>
                      <p className="text-slate-600">
                        Total JP Efektif: <strong className="text-[#6A197D] text-sm">{hasilHariEfektif.totalJpEfektif} JP</strong>
                      </p>
                      <p className="text-[10px] text-slate-400 pt-1">
                        * Dihitung khusus untuk kelas {daftarRombel.find(r => r.id === filterRombelId)?.nama || ''} — kegiatan kaldik yang
                        hanya menyasar kelas/tingkat lain tidak ikut mengurangi hari efektif kelas ini.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="py-10 text-center text-slate-400 text-sm">
                    Pilih Guru, Mata Pelajaran, dan Kelas untuk melihat perhitungan hari efektif.
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {!hasilPerhitungan && (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm space-y-2">
            <Calendar className="w-10 h-10 mx-auto text-slate-300" />
            <p className="font-semibold">Isi rentang tanggal semester di atas untuk memulai perhitungan.</p>
            <p className="text-xs">Pastikan data Kalender Pendidikan sudah diisi di modul Kaldik.</p>
          </div>
        )}
      </main>
    </div>
  )
}