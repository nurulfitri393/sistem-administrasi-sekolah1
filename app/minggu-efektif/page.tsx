'use client'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { bisaMengeditModul, getCakupanMengajarGuru } from '@/lib/aksesPeran'
import CatatanHanyaLihat from '@/components/CatatanHanyaLihat'

import Sidebar from '@/components/Sidebar'
import PratinjauPdfModal from '@/components/PratinjauPdfModal'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { kunciTahun, getTahunAjaranAktifNama } from '@/lib/tahunAjaran'
import { ambilIdentitasOtomatis } from '@/lib/identitasOtomatis'
import {
  Landmark, LogOut, Shield, BookOpen, Home, Building,
  CalendarDays, BarChart2, FileText, FileSpreadsheet, Clock,
  Download, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  Calculator, Calendar, BookMarked, Eye
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

/**
 * Kaldik tidak menyimpan tanggal awal/akhir semester secara eksplisit
 * (hanya konvensi Semester 1 = Juli-Desember, Semester 2 = Januari-Juni),
 * jadi rentang tanggal di sini tetap diisi manual -- tapi divalidasi di
 * sini supaya tidak salah tahun/terbalik seperti yang pernah terjadi
 * (mis. Tahun Ajaran 2026/2027 tapi tanggal masih tahun 2025).
 */
function peringatanTanggal(sem: SemesterInfo, jenis: 'ganjil' | 'genap', tahunAjaranAktif: string): string | null {
  if (!sem.tanggalMulai || !sem.tanggalSelesai) return 'Tanggal mulai/selesai belum diisi.'
  const mulai = new Date(sem.tanggalMulai)
  const selesai = new Date(sem.tanggalSelesai)
  if (isNaN(mulai.getTime()) || isNaN(selesai.getTime())) return null
  if (mulai > selesai) return 'Tanggal mulai tidak boleh setelah tanggal selesai.'

  const cocok = tahunAjaranAktif.match(/(\d{4})\s*\/\s*(\d{4})/)
  if (!cocok) return null
  const [, thnAwal, thnAkhir] = cocok

  if (jenis === 'ganjil') {
    if (mulai.getFullYear().toString() !== thnAwal || selesai.getFullYear().toString() !== thnAwal) {
      return `Semester Ganjil untuk Tahun Ajaran ${tahunAjaranAktif} seharusnya berada di tahun ${thnAwal} (Juli–Desember), sesuai Kaldik.`
    }
  } else {
    if (mulai.getFullYear().toString() !== thnAkhir || selesai.getFullYear().toString() !== thnAkhir) {
      return `Semester Genap untuk Tahun Ajaran ${tahunAjaranAktif} seharusnya berada di tahun ${thnAkhir} (Januari–Juni), sesuai Kaldik.`
    }
  }
  return null
}

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
  onPreviewGanjil,
  onPreviewGenap,
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
  onPreviewGanjil?: () => void
  onPreviewGenap?: () => void
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
            {onPreviewGanjil && (
              <button onClick={onPreviewGanjil} title="Pratinjau sebelum unduh"
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs shadow transition">
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onDownloadGanjil}
              className="flex items-center gap-1.5 bg-[#6A197D] hover:bg-[#58146A] text-white px-4 py-2 rounded-xl font-bold text-xs shadow transition">
              <Download className="w-3.5 h-3.5" /> PDF Ganjil
            </button>
            {onPreviewGenap && (
              <button onClick={onPreviewGenap} title="Pratinjau sebelum unduh"
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs shadow transition">
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  useEffect(() => { return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) } }, [])
  const diizinkanAkses = useAksesGuard('minggu_efektif')
  const bolehEdit = bisaMengeditModul('minggu_efektif')
  const cakupanGuru = getCakupanMengajarGuru() // null utk Admin, berisi mapelIds/guruId/mapelRombel utk Guru
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
  // Tahun ajaran TIDAK diketik manual di sini -- selalu mengikuti Tahun
  // Ajaran Aktif yang diatur di menu Beranda Dasbor (data pusat).
  const [tahunAjaranAktif, setTahunAjaranAktif] = useState('')

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

      // Kalau yang login adalah Guru, kunci ke akunnya sendiri -- tidak bisa
      // melihat/pilih data guru lain sama sekali.
      if (cakupanGuru?.guruId) setFilterGuruId(cakupanGuru.guruId)
      const sm = localStorage.getItem('master_mapel'); if (sm) setDaftarMapel(JSON.parse(sm))
      const sr = localStorage.getItem('master_rombel'); if (sr) setDaftarRombel(JSON.parse(sr))
      const st = localStorage.getItem('master_tingkat'); if (st) setDaftarTingkat(JSON.parse(st))
      const sl = localStorage.getItem('daftar_lembaga'); if (sl) setDaftarLembagaUnit(JSON.parse(sl))
      const sj = localStorage.getItem(kunciTahun('data_jadwal_pelajaran')); if (sj) setDaftarJadwal(JSON.parse(sj))
      const sw = localStorage.getItem(kunciTahun('master_pemetaan_waktu')); if (sw) setDaftarWaktu(JSON.parse(sw))
      const smj = localStorage.getItem(kunciTahun('matriks_alokasi_rinci_samping')); if (smj) setMatriksJp(JSON.parse(smj))

      // Data kaldik — sumber yang benar adalah 'kaldik_agenda_list' (dibuat modul Kaldik)
      const ska = localStorage.getItem(kunciTahun('kaldik_agenda_list'))
      if (ska) { try { setDaftarAgenda(JSON.parse(ska)) } catch { /* abaikan */ } }

      // Load semester setting
      const namaTaAktif = getTahunAjaranAktifNama()
      setTahunAjaranAktif(namaTaAktif)

      const sgs = localStorage.getItem(kunciTahun('setting_semester_ganjil'))
      if (sgs) {
        const parsed = JSON.parse(sgs)
        setSemesterGanjil({ ...parsed, tahunAjaran: namaTaAktif })
      } else if (namaTaAktif) {
        setSemesterGanjil(prev => ({ ...prev, tahunAjaran: namaTaAktif }))
      }
      const sge = localStorage.getItem(kunciTahun('setting_semester_genap'))
      if (sge) {
        const parsed = JSON.parse(sge)
        setSemesterGenap({ ...parsed, tahunAjaran: namaTaAktif })
      } else if (namaTaAktif) {
        setSemesterGenap(prev => ({ ...prev, tahunAjaran: namaTaAktif }))
      }

      setLoading(false)
    }
    init()
  }, [router])

  // Simpan perubahan semester
  const simpanSemester = (sem: SemesterInfo, jenis: 'ganjil' | 'genap') => {
    if (jenis === 'ganjil') { setSemesterGanjil(sem); localStorage.setItem(kunciTahun('setting_semester_ganjil'), JSON.stringify(sem)) }
    else { setSemesterGenap(sem); localStorage.setItem(kunciTahun('setting_semester_genap'), JSON.stringify(sem)) }
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

  // Unit yang sedang jadi acuan cakupan (dari selector "Lembaga (Pusat)/Unit/Kelas" di atas)
  const unitAcuanCakupan = scopeLevel === 'unit'
    ? scopeUnitId
    : scopeLevel === 'kelas'
      ? resolveUnitIdRombel(daftarRombel.find((r: any) => r.id === scopeRombelId))
      : '' // 'pusat' -> tidak difilter (semua unit)

  // Rombel/Kelas yang muncul di tab "Per Mapel/Guru" HARUS mengikuti Unit yang
  // sedang dipilih di cakupan atas -- supaya tidak salah pilih kelas dari unit lain.
  // Kalau yang login adalah Guru, dibatasi lagi hanya kelas yang benar-benar
  // diampu guru tsb (union rombel dari seluruh mapelRombel miliknya).
  const daftarRombelSesuaiCakupan = useMemo(() => {
    let list = daftarRombel
    if (unitAcuanCakupan) list = list.filter((r: any) => resolveUnitIdRombel(r) === unitAcuanCakupan)
    if (cakupanGuru) {
      const rombelIdGuru = new Set<string>()
      Object.values(cakupanGuru.mapelRombel || {}).forEach((ids: any) => (ids || []).forEach((id: string) => rombelIdGuru.add(id)))
      list = list.filter((r: any) => rombelIdGuru.has(r.id))
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daftarRombel, daftarTingkat, unitAcuanCakupan, cakupanGuru])

  // Guru yang muncul juga HARUS mengikuti Unit yang sedang dipilih (guru yang
  // memang ditugaskan di unit tsb, lihat unitIds di Kelola Data Guru).
  const daftarGuruSesuaiCakupan = useMemo(() => {
    if (!unitAcuanCakupan) return daftarGuru
    return daftarGuru.filter((g: any) => (g.unitIds || []).includes(unitAcuanCakupan))
  }, [daftarGuru, unitAcuanCakupan])

  // Mapel yang muncul di tab "Per Mapel/Guru" -- kalau login sebagai Guru,
  // dibatasi hanya mapel yang benar-benar diampu (tidak semua mapel sekolah).
  const daftarMapelSesuaiCakupan = useMemo(() => {
    if (!cakupanGuru) return daftarMapel
    return daftarMapel.filter((m: any) => cakupanGuru.mapelIds.includes(m.id))
  }, [daftarMapel, cakupanGuru])

  // Kalau Unit cakupan diganti dan Guru/Kelas yang tadinya dipilih ternyata
  // bukan milik unit yang baru, kosongkan lagi supaya tidak salah data.
  useEffect(() => {
    if (filterGuruId && !daftarGuruSesuaiCakupan.some((g: any) => g.id === filterGuruId)) {
      setFilterGuruId('')
    }
    if (filterRombelId && !daftarRombelSesuaiCakupan.some((r: any) => r.id === filterRombelId)) {
      setFilterRombelId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitAcuanCakupan])

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
  const handleDownloadPdf = async (semester: SemesterInfo, mode: 'lembaga' | 'mapel' = 'lembaga', aksi: 'unduh' | 'preview' = 'unduh') => {
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
    let nuptkGuru = ''

    // --- Identitas penandatangan (Kepala Sekolah / Mudir) diambil OTOMATIS,
    //     mengikuti unit yang relevan -- konsisten dengan Kaldik/Jadwal/Prota-Promes.
    //     Lembaga Pusat -> Mudir (tanpa NIP). Unit/Kelas/Mapel -> Kepala Sekolah unit (NUPTK).
    const identitas = ambilIdentitasOtomatis()
    let unitIdUntukTtd: string | undefined
    let scopeAdalahPusat = false

    if (isMapelMode) {
      unitIdUntukTtd = unitIdRombelMapel || undefined
    } else if (scopeLevel === 'pusat') {
      scopeAdalahPusat = true
    } else if (scopeLevel === 'unit') {
      unitIdUntukTtd = scopeUnitId || undefined
    } else if (scopeLevel === 'kelas') {
      unitIdUntukTtd = scopeUnitResolved || undefined
    }

    const unitDataTtd = unitIdUntukTtd ? identitas?.unitList.find(u => u.id === unitIdUntukTtd) : undefined
    const namaPenandatangan = scopeAdalahPusat ? (identitas?.namaMudir || '') : (unitDataTtd?.namaKepala || '')
    const nipPenandatangan = scopeAdalahPusat ? '' : (unitDataTtd?.nipKepala || '') // Pusat = Mudir, tidak pakai NIP
    const labelPenandatangan = scopeAdalahPusat ? 'Mudir' : 'Kepala Sekolah'
    const alamatUntukTtd = unitDataTtd?.alamat || identitas?.alamat || ''
    const kotaUntukTtd = localStorage.getItem('profil_kota') || ''
    const titiMangsaUntukTtd = localStorage.getItem('profil_titi_mangsa') || ''

    // "Satuan Pendidikan" WAJIB mengikuti cakupan yang sedang dipilih --
    // Lembaga Pusat -> nama lembaga pusat/yayasan. Unit/Kelas/Mapel -> nama
    // unit cabang yang bersangkutan (BUKAN selalu nama lembaga pusat seperti
    // sebelumnya).
    const namaSatuanPendidikanPdf = scopeAdalahPusat
      ? (identitas?.namaLembaga || namaSekolah)
      : (unitDataTtd?.nama || namaSekolah)

    // --- Integrasi data TP dari CP, TP & ATP + alokasi JP yang sudah diisi
    //     guru di halaman Prota — supaya guru TIDAK perlu isi ulang JP di
    //     sini, cukup lihat hasilnya di PDF Analisis Alokasi Waktu.
    let distribusiTp: { nomor: string; deskripsi: string; jp: number }[] = []
    if (isMapelMode) {
      try {
        const daftarTpRaw = localStorage.getItem(kunciTahun('data_tp'))
        const daftarAtpRaw = localStorage.getItem(kunciTahun('data_atp'))
        const daftarTpX = daftarTpRaw ? JSON.parse(daftarTpRaw) : []
        const daftarAtpX = daftarAtpRaw ? JSON.parse(daftarAtpRaw) : []
        const alokasiRaw = localStorage.getItem(`prota_alokasi_${filterMapelId}_${filterRombelId}`)
        const alokasiMap = alokasiRaw ? JSON.parse(alokasiRaw) : {}

        const rombelObj = daftarRombel.find((r: any) => r.id === filterRombelId)
        const namaTingkatKelas = String(rombelObj?.tingkat || rombelObj?.kelas || rombelObj?.nama || '')
          .toUpperCase().replace(/^KELAS\s+/, '')
        const romawiMatch = namaTingkatKelas.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/)
        const tingkatKelas = romawiMatch ? romawiMatch[1] : namaTingkatKelas

        distribusiTp = daftarAtpX
          .filter((a: any) => a.mapelId === filterMapelId && a.kelas === tingkatKelas && a.semester === semester.id)
          .sort((x: any, y: any) => (x.urutanDiKelas || 0) - (y.urutanDiKelas || 0))
          .map((a: any) => {
            const tp = daftarTpX.find((t: any) => t.id === a.tpId)
            return {
              nomor: tp?.nomor || '',
              deskripsi: tp?.deskripsi || '(TP tidak ditemukan)',
              jp: alokasiMap[a.id]?.jp || 0,
            }
          })
      } catch {
        distribusiTp = []
      }
    }

    if (isMapelMode) {
      namaGuru = daftarGuru.find((g: any) => g.id === filterGuruId)?.nama || ''
      nuptkGuru = daftarGuru.find((g: any) => g.id === filterGuruId)?.nip || ''
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
      namaSekolah: namaSatuanPendidikanPdf,
      alamat: alamatUntukTtd,
      kota: kotaUntukTtd,
      titiMangsa: titiMangsaUntukTtd,
      semester: semester.nama,
      tahunAjaran: semester.tahunAjaran,
      tanggalMulai: formatTgl(semester.tanggalMulai),
      tanggalSelesai: formatTgl(semester.tanggalSelesai),
      cakupan: cakupanLabel,
      namaGuru, namaMapel: namaMapelPdf, namaRombel: namaRombelPdf,
      nuptkGuru,
      jpPerMinggu: jpPerMingguPdf,
      hasil: semHasil,
      bulanDistribusi,
      hasilHari: hasilHariPdf,
      namaPenandatangan,
      nipPenandatangan,
      labelPenandatangan,
      distribusiTp,
    }

    // PENTING: dikirim lewat POST (body), BUKAN lewat query string URL --
    // data semester Ganjil/Genap bisa cukup besar (banyak minggu & kegiatan)
    // sehingga kalau dipaksa lewat URL bisa melebihi batas panjang URL
    // browser/server dan menghasilkan error "HTTP 431".
    try {
      const res = await fetch('/api/download-alokasi-waktu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const pesan = await res.text()
        alert(`Gagal membuat PDF: ${pesan}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (aksi === 'preview') {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = url
        setPreviewUrl(url)
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = `Alokasi_Waktu_${semester.nama}_${(semester.tahunAjaran || '').replace('/', '-')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`Gagal membuat PDF: ${e?.message || e}`)
    }
  }

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Minggu Efektif...</div>
  if (diizinkanAkses === false) return null

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800 font-body">
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
      <Sidebar />

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
          <p className="text-[10px] text-slate-500 -mt-2">
            Tahun ajaran mengikuti <strong>Tahun Ajaran Aktif</strong> yang diatur di menu Beranda Dasbor — tidak bisa
            diubah manual di sini. Hanya rentang tanggal per semester yang perlu diatur, dan harus sesuai dengan
            periode yang ditetapkan di Kalender Pendidikan (Kaldik).
          </p>
          {bolehEdit ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Ganjil */}
            <div className="space-y-3 border border-[#6A197D]/15 rounded-xl p-4 bg-[#6A197D]/5">
              <p className="text-xs font-black text-[#4A1159] uppercase tracking-wider">Semester Ganjil</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tahun Ajaran</label>
                  <p className="w-full px-3 py-2 border rounded-xl text-xs font-bold bg-slate-50 text-slate-600">{tahunAjaranAktif || '—'}</p>
                </div>
                <div />
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Mulai</label>
                  <input type="date" value={semesterGanjil.tanggalMulai}
                    onChange={e => simpanSemester({ ...semesterGanjil, tanggalMulai: e.target.value, tahunAjaran: tahunAjaranAktif }, 'ganjil')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Selesai</label>
                  <input type="date" value={semesterGanjil.tanggalSelesai}
                    onChange={e => simpanSemester({ ...semesterGanjil, tanggalSelesai: e.target.value, tahunAjaran: tahunAjaranAktif }, 'ganjil')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
              </div>
              {peringatanTanggal(semesterGanjil, 'ganjil', tahunAjaranAktif) && (
                <p className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  ⚠️ {peringatanTanggal(semesterGanjil, 'ganjil', tahunAjaranAktif)}
                </p>
              )}
            </div>
            {/* Genap */}
            <div className="space-y-3 border border-[#FFDE59]/60 rounded-xl p-4 bg-[#FFDE59]/10">
              <p className="text-xs font-black text-[#6A197D] uppercase tracking-wider">Semester Genap</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tahun Ajaran</label>
                  <p className="w-full px-3 py-2 border rounded-xl text-xs font-bold bg-slate-50 text-slate-600">{tahunAjaranAktif || '—'}</p>
                </div>
                <div />
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Mulai</label>
                  <input type="date" value={semesterGenap.tanggalMulai}
                    onChange={e => simpanSemester({ ...semesterGenap, tanggalMulai: e.target.value, tahunAjaran: tahunAjaranAktif }, 'genap')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tanggal Selesai</label>
                  <input type="date" value={semesterGenap.tanggalSelesai}
                    onChange={e => simpanSemester({ ...semesterGenap, tanggalSelesai: e.target.value, tahunAjaran: tahunAjaranAktif }, 'genap')}
                    className="w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
              </div>
              {peringatanTanggal(semesterGenap, 'genap', tahunAjaranAktif) && (
                <p className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  ⚠️ {peringatanTanggal(semesterGenap, 'genap', tahunAjaranAktif)}
                </p>
              )}
            </div>
          </div>
          ) : (
            <CatatanHanyaLihat pesan="Anda tidak diberi izin untuk mengubah rentang tanggal semester. Hasil perhitungan minggu efektif di bawah tetap bisa dilihat & dicetak." />
          )}
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
            {/* KARTU RINGKASAN — khusus tab Lembaga. Untuk tab "Per Mapel/Guru", kartu
                ringkasannya sendiri (di dalam KartuPerhitunganMingguJam di bawah) baru
                muncul setelah Guru/Mapel/Kelas dipilih, supaya tidak menyesatkan seolah
                angka Lembaga adalah angka mapel yang belum dipilih. */}
            {viewMode === 'lembaga' && (
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
            )}

            {viewMode === 'lembaga' && (
            <KartuPerhitunganMingguJam
              title="Perhitungan Minggu / Jam Efektif"
              subtitle="Lembaga — sesuai cakupan yang dipilih di atas"
              hasil={hasilPerhitungan}
              showDownload
              onDownloadGanjil={() => handleDownloadPdf(semesterGanjil, 'lembaga')}
              onDownloadGenap={() => handleDownloadPdf(semesterGenap, 'lembaga')}
              onPreviewGanjil={() => handleDownloadPdf(semesterGanjil, 'lembaga', 'preview')}
              onPreviewGenap={() => handleDownloadPdf(semesterGenap, 'lembaga', 'preview')}
              expandDetail={expandDetail}
              onToggleExpand={() => setExpandDetail(!expandDetail)}
              footnote={'* JP/Minggu untuk hasil spesifik per mapel dihitung otomatis dari tabel Pemetaan Jam — buka tab "Per Mapel/Guru" dan pilih Guru/Mapel/Kelas.'}
            />
            )}


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
                    {cakupanGuru ? (
                      <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-slate-600">
                        {daftarGuru.find((g: any) => g.id === filterGuruId)?.nama || 'Anda'} <span className="text-[9px] font-normal text-slate-400">(akun Anda)</span>
                      </div>
                    ) : (
                      <select value={filterGuruId} onChange={e => setFilterGuruId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                        <option value="">-- Pilih Guru --</option>
                        {daftarGuruSesuaiCakupan.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mata Pelajaran</label>
                    <select value={filterMapelId} onChange={e => setFilterMapelId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">-- Pilih Mapel --</option>
                      {daftarMapelSesuaiCakupan.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Kelas / Rombel</label>
                    <select value={filterRombelId} onChange={e => setFilterRombelId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">-- Pilih Kelas --</option>
                      {daftarRombelSesuaiCakupan.map(r => <option key={r.id} value={r.id}>Kelas {r.nama}</option>)}
                    </select>
                  </div>
                </div>

                {filterRombelId && hasilRombelMapel && (
                  <>
                  {/* KARTU RINGKASAN KHUSUS GURU+MAPEL+KELAS INI — dihitung dari
                      hasil silang Kaldik (hari libur per kelas ini) DENGAN Jadwal
                      Pelajaran (hari & JP aktual guru ini mengajar mapel ini di
                      kelas ini). Angkanya BISA berbeda dari kartu Lembaga Pusat/
                      Unit, karena di sini yang dihitung "efektif" adalah minggu
                      yang masih punya hari mengajar guru ini yang tidak kena
                      libur/kegiatan — bukan sekadar 3-hari-libur seperti di
                      level Lembaga. */}
                  {filterGuruId && filterMapelId && hasilHariEfektif && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: 'Total Minggu', val: hasilRombelMapel.totalMinggu, color: 'bg-slate-100 text-slate-800', icon: <Calendar className="w-5 h-5" /> },
                        { label: 'Minggu Efektif (Mapel Ini)', val: hasilHariEfektif.perMinggu.filter(m => m.hariMengajar.length > 0).length, color: 'bg-[#FFDE59]/15 text-[#6A197D] border border-[#FFDE59]/60', icon: <CheckCircle2 className="w-5 h-5 text-[#6A197D]" /> },
                        { label: 'Minggu Tidak Efektif (Mapel Ini)', val: hasilRombelMapel.totalMinggu - hasilHariEfektif.perMinggu.filter(m => m.hariMengajar.length > 0).length, color: 'bg-red-50 text-red-800 border border-red-100', icon: <AlertTriangle className="w-5 h-5 text-red-500" /> },
                        { label: 'Total JP Efektif (Mapel Ini)', val: `${hasilHariEfektif.totalJpEfektif} JP`, color: 'bg-[#6A197D]/5 text-[#4A1159] border border-[#6A197D]/15', icon: <Calculator className="w-5 h-5 text-[#6A197D]" /> },
                      ].map((item, i) => (
                        <div key={i} className={`rounded-2xl p-5 space-y-2 ${item.color}`}>
                          <div className="flex items-center gap-2 opacity-70">{item.icon}</div>
                          <p className="text-3xl font-black">{item.val}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <KartuPerhitunganMingguJam
                    title={`Perhitungan Minggu / Jam Efektif — Kelas ${daftarRombel.find(r => r.id === filterRombelId)?.nama || ''}${filterMapelId ? ` (${daftarMapel.find(m => m.id === filterMapelId)?.nama || ''})` : ''}`}
                    subtitle="Disaring dari Kaldik khusus untuk kelas ini — bisa berbeda dari tabel Lembaga di atas"
                    hasil={hasilRombelMapel}
                    jpPerMinggu={jpPerMingguAktif}
                    jpKnown={Boolean(filterGuruId && filterMapelId && filterRombelId && jpPerMingguAktif > 0)}
                    showDownload={Boolean(filterGuruId && filterMapelId)}
                    onDownloadGanjil={() => handleDownloadPdf(semesterGanjil, 'mapel')}
                    onDownloadGenap={() => handleDownloadPdf(semesterGenap, 'mapel')}
                    onPreviewGanjil={() => handleDownloadPdf(semesterGanjil, 'mapel', 'preview')}
                    onPreviewGenap={() => handleDownloadPdf(semesterGenap, 'mapel', 'preview')}
                    expandDetail={expandDetailMapel}
                    onToggleExpand={() => setExpandDetailMapel(!expandDetailMapel)}
                    footnote={filterGuruId && filterMapelId ? undefined : '* Pilih Guru dan Mata Pelajaran juga untuk menghitung IV. Jumlah Jam Efektif.'}
                  />
                  </>
                )}

                {filterGuruId && filterMapelId && filterRombelId && jadwalTerjadwal.length === 0 && (
                  <div className="bg-[#FFDE59]/15 border border-[#FFDE59]/80 rounded-xl p-3 text-[10px] font-semibold text-[#6A197D] space-y-2">
                    <p>
                      Belum ditemukan jadwal (hari mengajar) untuk kombinasi Guru/Mapel/Kelas ini di modul Jadwal Pelajaran,
                      sehingga hari efektif belum bisa dihitung meski JP/minggu ({jpPerMingguAktif} JP) sudah terbaca dari tabel Pemetaan Jam.
                      Susun dulu jadwalnya di modul Jadwal Pelajaran.
                    </p>
                    {/* Diagnostik sementara: bantu temukan field mana yang tidak cocok */}
                    <details className="text-[9px] font-normal text-[#4A1159] bg-white/60 rounded-lg p-2 border border-[#FFDE59]/60">
                      <summary className="cursor-pointer font-bold">Detail diagnostik (klik untuk lihat)</summary>
                      <div className="pt-2 space-y-1">
                        <p>Total entri Jadwal terbaca dari modul Jadwal Pelajaran: <strong>{daftarJadwal.length}</strong></p>
                        <p>Cocok guruId saja: <strong>{daftarJadwal.filter((j: any) => j.guruId === filterGuruId).length}</strong></p>
                        <p>Cocok mapelId saja: <strong>{daftarJadwal.filter((j: any) => j.mapelId === filterMapelId).length}</strong></p>
                        <p>Cocok rombelId saja: <strong>{daftarJadwal.filter((j: any) => j.rombelId === filterRombelId).length}</strong></p>
                        <p>Cocok guruId + mapelId + rombelId (belum cek jenis waktu): <strong>{daftarJadwal.filter((j: any) => j.guruId === filterGuruId && j.mapelId === filterMapelId && j.rombelId === filterRombelId).length}</strong></p>
                        <p>Total entri Master Waktu terbaca: <strong>{daftarWaktu.length}</strong> (bertipe &quot;mapel&quot;: {daftarWaktu.filter((w: any) => w.jenis === 'mapel').length})</p>
                        <p className="pt-1 text-slate-500">Kalau baris ke-4 di atas (guruId+mapelId+rombelId) menunjukkan angka 0 padahal Anda yakin datanya ada di Plot Matriks, kemungkinan ID Kelas/Guru/Mapel yang tersimpan di entri jadwal berbeda dari yang dipakai saat ini — screenshot bagian ini akan sangat membantu diagnosis lebih lanjut.</p>
                      </div>
                    </details>
                  </div>
                )}

                {/* Ringkasan tambahan JP efektif (hasil silang dengan Jadwal Pelajaran) --
                    HANYA ringkasan singkat, bukan tabel minggu efektif kedua yang terpisah,
                    supaya tidak dobel dengan kartu "Perhitungan Minggu / Jam Efektif" di atas. */}
                {hasilHariEfektif && (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1.5 text-xs">
                    <p className="text-slate-600">
                      Total Hari Mengajar Efektif: <strong className="text-[#58146A]">{hasilHariEfektif.totalHariMengajar} hari</strong>
                      {' '}({hasilHariEfektif.perHari.map(h => `${h.hari}(${h.jumlah}x)`).join(', ') || '-'})
                    </p>
                    {hasilHariEfektif.perMinggu.some(m => !m.efektif && m.hariMengajar.length > 0) && (
                      <p className="text-[10px] font-semibold text-[#6A197D] bg-[#FFDE59]/15 border border-[#FFDE59]/60 rounded-lg px-2.5 py-1.5 mt-1">
                        ⚠️ Ada minggu yang berstatus "tidak efektif" untuk kelas ini (≥3 hari kena kegiatan/libur) namun tetap ada KBM
                        mapel ini pada hari yang tidak bertepatan dengan hari libur tersebut — JP tetap terhitung efektif, makanya
                        "Minggu Efektif (Mapel Ini)" di kartu atas bisa lebih tinggi dari perhitungan Kelas/Lembaga.
                      </p>
                    )}
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
      <PratinjauPdfModal url={previewUrl} onClose={() => setPreviewUrl(null)} judul="Pratinjau Analisis Alokasi Waktu" />
    </div>
  )
}