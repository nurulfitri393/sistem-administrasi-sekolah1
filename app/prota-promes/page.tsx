'use client'

/**
 * app/prota-promes/page.tsx
 * Halaman Program Tahunan (Prota) & Program Semester (Promes)
 *
 * PERBAIKAN PENTING (lihat catatan di bawah setiap bagian):
 * 1) Data Elemen/Materi/Tujuan Pembelajaran DAN SEMESTER di Prota SEKARANG diambil
 *    langsung dari halaman CP, TP & ATP (key localStorage: data_cp, data_materi,
 *    data_tp, data_atp — field "semester" pada tiap ATP) — BUKAN dari key lama
 *    'data_analisis_atp' yang tidak pernah ditulis oleh halaman manapun (bug lama).
 *    Guru HANYA perlu mengisi kolom "Alokasi Waktu (JP)"; semester tidak lagi
 *    dipilih di halaman ini. Semua TP (semester 1 & 2) ditampilkan sekaligus,
 *    dikelompokkan berdasarkan semester.
 * 2) Total JP yang diisi guru di Prota divalidasi terhadap kapasitas JP hasil
 *    perhitungan Minggu Efektif (jumlah minggu efektif × JP/minggu dari Jadwal
 *    Pelajaran) — tidak boleh melebihi kapasitas tsb.
 * 3) Di Promes, kolom "KD/Elemen" diganti "Elemen/Materi". Sel minggu diberi
 *    warna HITAM jika minggu tidak efektif untuk lembaga & tidak efektif untuk
 *    mapel (tidak ada hari mengajar yang lolos dari hari libur), warna ABU jika
 *    tidak efektif untuk lembaga tapi tetap efektif untuk mapel (ada hari
 *    mengajar yang lolos), dan putih/normal jika efektif. Pada minggu yang ada
 *    kapasitas mengajarnya, dituliskan jumlah JP riil (dihitung dari Jadwal
 *    Pelajaran per hari, dikurangi hari yang jatuh di hari libur), dan JP TP
 *    didistribusikan berurutan ke minggu-minggu tsb sampai habis.
 *
 * localStorage yang dibaca:
 *  - data_cp, data_materi, data_tp, data_atp   → CP/TP/ATP guru, termasuk field
 *    "semester" pada tiap ATP (dari halaman CP,TP&ATP)
 *  - master_guru / master_mapel / master_rombel
 *  - matriks_alokasi_rinci_samping → alokasi JP per guru-mapel-rombel (fallback)
 *  - setting_semester_ganjil / setting_semester_genap → rentang semester
 *  - data_kaldik_events / kaldik_agenda_list → event libur/kegiatan dari kaldik
 *  - data_jadwal_pelajaran, master_pemetaan_waktu → jadwal harian guru (sumber JP riil)
 *  - identitas_induk, profil_kepala, profil_nip, profil_kota → kop & TTD
 *  - prota_alokasi_<mapelId>_<rombelId> → input guru: HANYA alokasi JP tiap baris TP
 *
 * Dependencies cetak:
 *   npm install xlsx jspdf jspdf-autotable
 */

import Sidebar from '@/components/Sidebar'
import PratinjauPdfModal from '@/components/PratinjauPdfModal'
import { Fragment, useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { kunciTahun } from '@/lib/tahunAjaran'
import { ambilIdentitasOtomatis } from '@/lib/identitasOtomatis'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { bisaMengeditModul, getCakupanMengajarGuru } from '@/lib/aksesPeran'
import {
  Home, Building, Shield, CalendarDays, Clock, BarChart2,
  BookOpen, FileSpreadsheet, LogOut, Landmark, FileText,
  Download, ChevronDown, Settings, Eye, AlertTriangle, CheckCircle2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

// Struktur asli dari halaman "CP, TP & ATP" (data_cp / data_materi / data_tp / data_atp)
interface CP {
  id: string
  mapelId: string
  fase: string
  deskripsi: string
  elemen: string
}
interface Materi {
  id: string
  cpId: string
  mapelId: string
  fase: string
  nama: string
  deskripsi: string
}
interface TP {
  id: string
  cpId: string
  materiId: string
  mapelId: string
  fase: string
  nomor: string
  deskripsi: string
}
// ATP = pemetaan TP ke suatu tingkat kelas (field "kelas" berisi tingkat, mis. "VII").
// Semester SEKARANG ditentukan di halaman CP, TP & ATP (tombol Ganjil/Genap pada tiap
// kartu ATP) — bukan lagi dipilih di halaman Prota & Promes.
interface AtpPeta {
  id: string
  tpId: string
  cpId: string
  mapelId: string
  fase: string
  kelas: string
  semester: '1' | '2'
  urutanDiKelas: number
}

// Satu baris gabungan CP+Materi+TP+ATP siap tampil di Prota/Promes.
// "semester" bersifat tetap (read-only di halaman ini), diambil langsung dari ATP.
interface ProtaRow {
  id: string            // id AtpPeta
  urutan: number
  semester: 'ganjil' | 'genap'
  elemen: string
  materiNama: string
  tpNomor: string
  tpDeskripsi: string
}
// Input guru: HANYA alokasi JP per baris (disimpan terpisah, per mapel+kelas). Semester
// tidak lagi diinput di sini — sudah ditentukan di halaman CP, TP & ATP.
interface AlokasiInput { jp: number }

interface Guru {
  id: string
  nama: string
  nip?: string
  mapelIds: string[]
  rombelIds: string[]
  unitIds?: string[]
}

interface Mapel { id: string; nama: string; kode?: string }
interface Rombel { id: string; nama: string; tingkat?: string; kelas?: string }

interface SemesterInfo {
  id: string
  nama: string
  tahunAjaran: string
  tanggalMulai: string
  tanggalSelesai: string
}

interface KaldikEvent {
  tanggal: string
  tanggalSelesai?: string
  keterangan: string
  statusHari: string
  lembagaTerlibat?: string[]
  tanggalMulai?: string
  nama?: string
}

interface ProfilSekolah {
  namaSekolah: string
  alamat: string
  kota: string
  namaKepala: string
  nip: string
  nuptk?: string
  titiMangsa?: string   // "Kota, tanggal" — bisa diisi manual; kalau kosong dihitung otomatis dari kota & tanggal hari ini
}

// ─── Konstanta ────────────────────────────────────────────────────────────────

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const BULAN_SEM1 = ['Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const BULAN_SEM2 = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni']

const HARI_NUM: Record<string, number> = { Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6 }

const KELAS_OPTIONS_FALLBACK = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']
const ANGKA_KE_ROMAWI: { [k: string]: string } = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI',
  '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function getTitiMangsa(kota: string) {
  const now = new Date()
  return `${kota || 'Jakarta'}, ${now.getDate()} ${NAMA_BULAN[now.getMonth()]} ${now.getFullYear()}`
}

// Titi mangsa yang benar-benar dipakai di dokumen: pakai isian manual guru/admin
// kalau sudah diisi, kalau belum baru dihitung otomatis dari Kota & tanggal hari ini.
function resolveTitiMangsa(profil: ProfilSekolah): string {
  return profil.titiMangsa && profil.titiMangsa.trim() ? profil.titiMangsa.trim() : getTitiMangsa(profil.kota)
}

// Ambil kode TINGKAT (bukan nama rombel) dari data rombel — sama persis dengan
// logika di halaman CP, TP & ATP supaya pemetaan ATP.kelas <-> rombel konsisten.
function ambilTingkatDariRombel(r: Rombel | undefined): string {
  if (!r) return ''
  if (r.tingkat && String(r.tingkat).trim()) return String(r.tingkat).trim()
  const nama = String(r.kelas || r.nama || '').trim()
  if (!nama) return ''
  const bersih = nama.toUpperCase().replace(/^KELAS\s+/, '')
  const romawi = bersih.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/)
  if (romawi) return romawi[1]
  const angka = bersih.match(/^(\d{1,2})/)
  if (angka && ANGKA_KE_ROMAWI[angka[1]]) return ANGKA_KE_ROMAWI[angka[1]]
  return nama
}

/** Hitung jumlah minggu EFEKTIF (institusional, ≤2 hari libur Sen-Jum) per bulan dalam satu semester.
 *  Ini adalah kapasitas resmi ala halaman Minggu Efektif — dipakai sebagai batas atas (cap)
 *  pengisian JP di Prota. */
function hitungMingguEfektifPerBulan(
  tanggalMulai: string,
  tanggalSelesai: string,
  hariLiburSet: Set<string>,
): Record<string, number> {
  const mulai = parseDate(tanggalMulai)
  const selesai = parseDate(tanggalSelesai)
  const result: Record<string, number> = {}

  let senin = new Date(mulai)
  const dow = senin.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  senin = addDays(senin, offset)

  while (senin <= selesai) {
    let hariLibur = 0
    const hariDlm: Date[] = []
    for (let i = 0; i < 5; i++) {
      const h = addDays(senin, i)
      if (h >= mulai && h <= selesai) hariDlm.push(h)
    }
    hariDlm.forEach(h => {
      if (hariLiburSet.has(toDateStr(h))) hariLibur++
    })

    const efektif = hariLibur <= 2
    if (efektif && hariDlm.length > 0) {
      const tglRef = hariDlm[0]
      const key = `${tglRef.getFullYear()}-${String(tglRef.getMonth() + 1).padStart(2, '0')}`
      result[key] = (result[key] || 0) + 1
    }

    senin = addDays(senin, 7)
  }

  return result
}

/** Hitung total JP untuk guru-mapel-rombel dari matriks alokasi (fallback jika Jadwal kosong) */
function hitungTotalJp(strAlokasi: string): number {
  if (!strAlokasi) return 0
  return strAlokasi
    .split(',')
    .map(x => Number(x.trim()))
    .filter(n => !isNaN(n) && n > 0)
    .reduce((a, b) => a + b, 0)
}

/** Bangun set hari libur dari events kaldik */
function buildHariLiburSet(events: KaldikEvent[]): Set<string> {
  const set = new Set<string>()
  events.forEach(ev => {
    const mulai = ev.tanggalMulai || ev.tanggal
    const selesai = ev.tanggalSelesai || mulai
    if (!mulai) return
    let cur = parseDate(mulai)
    const end = parseDate(selesai)
    while (cur <= end) {
      set.add(toDateStr(cur))
      cur = addDays(cur, 1)
    }
  })
  return set
}

interface MingguKapasitas {
  mingguKe: number          // 1..5, posisi minggu dalam bulan tsb
  efektifLembaga: boolean   // status institusional (≤2 hari libur Sen-Jum)
  capacityJp: number        // JP riil yang bisa diajarkan minggu ini (dari jadwal, dikurangi hari libur)
}

/** Untuk Promes: hitung, per bulan dalam satu semester, status tiap minggu (efektif utk lembaga
 *  atau tidak) SEKALIGUS kapasitas JP riil minggu itu berdasarkan jadwal harian guru/mapel/kelas
 *  terpilih (jpPerHari) dikurangi hari-hari yang bertepatan dengan hari libur. */
function hitungMingguKapasitas(
  tanggalMulai: string,
  tanggalSelesai: string,
  hariLiburSet: Set<string>,
  jpPerHari: Record<number, number>,
): Record<string, MingguKapasitas[]> {
  const mulai = parseDate(tanggalMulai)
  const selesai = parseDate(tanggalSelesai)
  const hasil: Record<string, MingguKapasitas[]> = {}

  let senin = new Date(mulai)
  const dow = senin.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  senin = addDays(senin, offset)

  while (senin <= selesai) {
    const hariDlm: Date[] = []
    for (let i = 0; i < 5; i++) {
      const h = addDays(senin, i)
      if (h >= mulai && h <= selesai) hariDlm.push(h)
    }
    if (hariDlm.length > 0) {
      let hariLibur = 0
      hariDlm.forEach(h => { if (hariLiburSet.has(toDateStr(h))) hariLibur++ })
      const efektifLembaga = hariLibur <= 2

      let capacityJp = 0
      Object.keys(jpPerHari).forEach(k => {
        const hariNum = Number(k)
        const tgl = addDays(senin, hariNum - 1)
        if (tgl >= mulai && tgl <= selesai && !hariLiburSet.has(toDateStr(tgl))) {
          capacityJp += jpPerHari[hariNum] || 0
        }
      })

      const tglRef = hariDlm[0]
      const bulanKey = `${tglRef.getFullYear()}-${String(tglRef.getMonth() + 1).padStart(2, '0')}`
      if (!hasil[bulanKey]) hasil[bulanKey] = []
      hasil[bulanKey].push({ mingguKe: hasil[bulanKey].length + 1, efektifLembaga, capacityJp })
    }
    senin = addDays(senin, 7)
  }

  return hasil
}

type StatusMinggu = 'normal' | 'abu' | 'hitam'
function klasifikasiMinggu(w: MingguKapasitas | undefined): StatusMinggu {
  if (!w) return 'normal'
  if (w.efektifLembaga) return 'normal'
  return w.capacityJp > 0 ? 'abu' : 'hitam'
}

interface WeekFlat { key: string; bulan: string; mingguKe: number; status: StatusMinggu; capacityJp: number }

/** Distribusikan JP tiap baris TP (berurutan) ke minggu-minggu yang tersedia (weeksFlat), secara
 *  berurutan, memenuhi kapasitas tiap minggu sebelum lanjut ke minggu berikutnya. */
function distribusikanJp(
  weeksFlat: WeekFlat[],
  rows: { id: string; jp: number }[],
): { alokasi: Record<string, Record<string, number>>; totalDialokasikan: number } {
  const alokasi: Record<string, Record<string, number>> = {}
  let wi = 0
  let sisaMinggu = weeksFlat[0]?.capacityJp || 0
  let totalDialokasikan = 0

  for (const row of rows) {
    let need = row.jp || 0
    alokasi[row.id] = {}
    while (need > 0 && wi < weeksFlat.length) {
      if (sisaMinggu <= 0) {
        wi++
        sisaMinggu = weeksFlat[wi]?.capacityJp || 0
        continue
      }
      const pakai = Math.min(need, sisaMinggu)
      alokasi[row.id][weeksFlat[wi].key] = (alokasi[row.id][weeksFlat[wi].key] || 0) + pakai
      need -= pakai
      sisaMinggu -= pakai
      totalDialokasikan += pakai
    }
  }
  return { alokasi, totalDialokasikan }
}

// ─── Ekspor Excel Prota ───────────────────────────────────────────────────────

async function eksporProtaExcel(params: {
  profil: ProfilSekolah
  namaGuru: string
  nuptk: string
  namaMapel: string
  namaKelas: string
  tahunAjaran: string
  rows: (ProtaRow & AlokasiInput)[]
  capJpSem1: number
  capJpSem2: number
}) {
  const XLSX = await import('xlsx')
  const { profil, namaGuru, nuptk, namaMapel, namaKelas, tahunAjaran, rows, capJpSem1, capJpSem2 } = params

  const wb = XLSX.utils.book_new()
  const rowsOut: (string | number | null)[][] = []

  rowsOut.push(['PROGRAM TAHUNAN'])
  rowsOut.push([profil.namaSekolah || 'Nama Satuan Pendidikan'])
  if (profil.alamat) rowsOut.push([profil.alamat])
  rowsOut.push(['─'.repeat(90)])
  rowsOut.push([])
  rowsOut.push(['Mata Pelajaran', ':', namaMapel])
  rowsOut.push(['Kelas / Rombel', ':', namaKelas])
  rowsOut.push(['Tahun Ajaran', ':', tahunAjaran])
  rowsOut.push(['Guru', ':', namaGuru])
  rowsOut.push([])

  rowsOut.push(['SEMESTER', 'ELEMEN', 'MATERI', 'TUJUAN PEMBELAJARAN', 'ALOKASI WAKTU (JP)'])

  const tulisSemester = (semester: 'ganjil' | 'genap', label: string, cap: number) => {
    const rs = rows.filter(r => r.semester === semester)
    let total = 0
    rs.forEach((r, i) => {
      rowsOut.push([
        i === 0 ? label : '',
        r.elemen,
        r.materiNama,
        `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`,
        r.jp,
      ])
      total += r.jp
    })
    rowsOut.push(['', '', '', 'JUMLAH', total])
    rowsOut.push(['', '', '', `Kapasitas Minggu Efektif`, cap])
    rowsOut.push([])
  }
  tulisSemester('ganjil', 'Semester 1', capJpSem1)
  tulisSemester('genap', 'Semester 2', capJpSem2)

  rowsOut.push([])
  rowsOut.push([null, null, null, null, resolveTitiMangsa(profil)])
  rowsOut.push(['Mengetahui,', null, null, null, 'Guru Mata Pelajaran,'])
  rowsOut.push(['Kepala Sekolah / Pimpinan,'])
  rowsOut.push([''])
  rowsOut.push([''])
  rowsOut.push([''])
  rowsOut.push([profil.namaKepala || '(Nama Kepala Sekolah)', null, null, null, namaGuru])
  rowsOut.push([`NUPTK: ${profil.nuptk || profil.nip || '-'}`, null, null, null, `NUPTK: ${nuptk || '-'}`])

  const ws = XLSX.utils.aoa_to_sheet(rowsOut)
  ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 60 }, { wch: 18 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
  ]
  XLSX.utils.book_append_sheet(wb, ws, 'Program Tahunan')
  XLSX.writeFile(wb, `Prota_${namaMapel}_${namaKelas}_${tahunAjaran.replace('/', '-')}.xlsx`)
}

// ─── Ekspor Excel Promes ──────────────────────────────────────────────────────

async function eksporPromesExcel(params: {
  profil: ProfilSekolah
  namaGuru: string
  nuptk: string
  namaMapel: string
  namaKelas: string
  tahunAjaran: string
  semester: 'ganjil' | 'genap'
  rows: (ProtaRow & AlokasiInput)[]
  alokasiJpPerMinggu: number
  weeksByBulan: Record<string, MingguKapasitas[]>
  weeksFlat: WeekFlat[]
  alokasiMingguan: Record<string, Record<string, number>>
  capJpEfektif: number
}) {
  const XLSX = await import('xlsx')
  const {
    profil, namaGuru, nuptk, namaMapel, namaKelas, tahunAjaran, semester,
    rows, alokasiJpPerMinggu, weeksByBulan, alokasiMingguan, capJpEfektif,
  } = params

  const wb = XLSX.utils.book_new()
  const bulanList = semester === 'ganjil' ? BULAN_SEM1 : BULAN_SEM2
  const semLabel = semester === 'ganjil' ? 'Ganjil' : 'Genap'

  const { tahunAwal, tahunAkhir } = (() => {
    const [a, b] = tahunAjaran.split('/')
    return { tahunAwal: parseInt(a), tahunAkhir: parseInt(b) }
  })()
  const getBulanKey = (bulan: string) => {
    const idx = NAMA_BULAN.indexOf(bulan)
    const tahun = idx >= 6 ? tahunAwal : tahunAkhir
    return `${tahun}-${String(idx + 1).padStart(2, '0')}`
  }

  const headerRow1: (string | null)[] = ['No', 'Elemen/Materi', 'Tujuan Pembelajaran', 'Jml (JP)']
  const headerRow2: (string | null)[] = ['', '', '', '']
  bulanList.forEach(bln => { headerRow1.push(bln, null, null, null, null); headerRow2.push('1', '2', '3', '4', '5') })

  const rowsOut: (string | number | null)[][] = []
  rowsOut.push(['PROGRAM SEMESTER'])
  rowsOut.push([profil.namaSekolah || 'Nama Satuan Pendidikan'])
  if (profil.alamat) rowsOut.push([profil.alamat])
  rowsOut.push(['─'.repeat(120)])
  rowsOut.push([])
  rowsOut.push(['Mata Pelajaran', ':', namaMapel, '', 'Kelas', ':', namaKelas])
  rowsOut.push(['Tahun Ajaran', ':', tahunAjaran, '', 'Semester', ':', semLabel])
  rowsOut.push(['Alokasi Waktu', ':', `${alokasiJpPerMinggu} jam/minggu`])
  rowsOut.push([])
  rowsOut.push(headerRow1)
  rowsOut.push(headerRow2)

  let no = 1
  let totalDialokasikan = 0
  rows.forEach(r => {
    const row: (string | number | null)[] = [no++, `${r.elemen} — ${r.materiNama}`, `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`, r.jp]
    bulanList.forEach(bln => {
      const bulanKey = getBulanKey(bln)
      const list = weeksByBulan[bulanKey] || []
      for (let m = 1; m <= 5; m++) {
        const w = list.find(x => x.mingguKe === m)
        const jp = alokasiMingguan[r.id]?.[`${bulanKey}::${m}`] || 0
        totalDialokasikan += jp
        row.push(w ? (jp > 0 ? jp : null) : null)
      }
    })
    rowsOut.push(row)
  })

  const jpCadangan = Math.max(0, capJpEfektif - totalDialokasikan)
  rowsOut.push([])
  rowsOut.push(['', '', 'Jumlah Jam Efektif', capJpEfektif])
  rowsOut.push(['', '', 'Jumlah Jam Cadangan', jpCadangan])
  rowsOut.push(['', '', `Jumlah Jam Total Semester ${semLabel}`, capJpEfektif])
  rowsOut.push([])
  rowsOut.push([])

  rowsOut.push([null, null, null, null, resolveTitiMangsa(profil)])
  rowsOut.push(['Mengetahui,', null, null, null, 'Guru Mata Pelajaran,'])
  rowsOut.push(['Kepala Sekolah / Pimpinan,'])
  rowsOut.push([''])
  rowsOut.push([''])
  rowsOut.push([''])
  rowsOut.push([profil.namaKepala || '(Nama Kepala Sekolah)', null, null, null, namaGuru])
  rowsOut.push([`NUPTK: ${profil.nuptk || profil.nip || '-'}`, null, null, null, `NUPTK: ${nuptk || '-'}`])

  const ws = XLSX.utils.aoa_to_sheet(rowsOut)
  ws['!cols'] = [
    { wch: 5 }, { wch: 26 }, { wch: 50 }, { wch: 8 },
    ...bulanList.flatMap(() => [{ wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }]),
  ]
  XLSX.utils.book_append_sheet(wb, ws, `Promes ${semLabel}`)
  XLSX.writeFile(wb, `Promes_${semLabel}_${namaMapel}_${namaKelas}_${tahunAjaran.replace('/', '-')}.xlsx`)
}

// ─── Ekspor PDF Prota ─────────────────────────────────────────────────────────

async function eksporProtaPDF(params: {
  profil: ProfilSekolah
  namaGuru: string
  nuptk: string
  namaMapel: string
  namaKelas: string
  tahunAjaran: string
  rows: (ProtaRow & AlokasiInput)[]
  capJpSem1: number
  capJpSem2: number
  mode?: 'unduh' | 'preview'
}): Promise<string | void> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const { profil, namaGuru, nuptk, namaMapel, namaKelas, tahunAjaran, rows, capJpSem1, capJpSem2, mode = 'unduh' } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const mL = 16, mR = 16
  const contentWidth = pageW - mL - mR
  let curY = 14

  doc.setLineWidth(1); doc.setDrawColor(0, 0, 0)
  doc.line(mL, curY, pageW - mR, curY); curY += 5
  doc.setFontSize(14); doc.setFont('times', 'bold'); doc.setTextColor(15, 23, 42)
  doc.text('PROGRAM TAHUNAN', pageW / 2, curY, { align: 'center' }); curY += 6
  doc.setFontSize(11)
  const namaSekolahLines = doc.splitTextToSize(profil.namaSekolah || 'Nama Satuan Pendidikan', contentWidth - 10)
  doc.text(namaSekolahLines, pageW / 2, curY, { align: 'center' }); curY += namaSekolahLines.length * 4.6 + 0.5
  if (profil.alamat) {
    doc.setFont('times', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
    const alamatLines = doc.splitTextToSize(profil.alamat, contentWidth - 10)
    doc.text(alamatLines, pageW / 2, curY, { align: 'center' }); curY += alamatLines.length * 3.6 + 1
  }
  doc.setLineWidth(0.5); doc.setDrawColor(0, 0, 0)
  doc.line(mL, curY, pageW - mR, curY); curY += 5

  doc.setFont('times', 'normal'); doc.setFontSize(9); doc.setTextColor(15, 23, 42)
  const labelWProta = 34
  ;[['Mata Pelajaran', namaMapel], ['Kelas / Rombel', namaKelas], ['Tahun Ajaran', tahunAjaran]]
    .forEach(([label, value]) => {
      doc.text(label, mL, curY)
      const lines = doc.splitTextToSize(`: ${value}`, contentWidth - labelWProta)
      doc.text(lines, mL + labelWProta, curY)
      curY += lines.length * 4.5
    })
  curY += 2

  type Cell = string | { content: string; styles: Record<string, unknown> }
  const body: Cell[][] = []
  const tulisSemester = (semester: 'ganjil' | 'genap', label: string, cap: number) => {
    const rs = rows.filter(r => r.semester === semester)
    let total = 0
    rs.forEach((r, i) => {
      body.push([
        i === 0 ? { content: label, styles: { fontStyle: 'bold', textColor: [106, 25, 125] as unknown as string } } : '',
        r.elemen,
        r.materiNama,
        `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`,
        `${r.jp} JP`,
      ])
      total += r.jp
    })
    const over = total > cap
    body.push(['', '', '', { content: 'JUMLAH', styles: { fontStyle: 'bold', halign: 'right' as unknown as string } },
      { content: `${total} / ${cap} JP`, styles: { fontStyle: 'bold', textColor: (over ? [220, 38, 38] : [106, 25, 125]) as unknown as string } }])
  }
  tulisSemester('ganjil', 'Semester 1', capJpSem1)
  tulisSemester('genap', 'Semester 2', capJpSem2)

  // Lebar kolom dihitung persis dari contentWidth supaya tabel TIDAK PERNAH melebihi
  // lebar halaman (penyebab teks tumpang tindih / terpotong pada cetakan sebelumnya).
  const wSemester = 16, wElemen = 24, wMateri = 24, wJp = 20
  const wTp = contentWidth - (wSemester + wElemen + wMateri + wJp)

  autoTable(doc, {
    startY: curY,
    head: [['Semester', 'Elemen', 'Materi', 'Tujuan Pembelajaran', 'Alokasi Waktu (JP)']],
    body,
    headStyles: { font: 'times', fillColor: [237, 227, 243], textColor: [30, 10, 40], fontStyle: 'bold', fontSize: 8, halign: 'center' },
    bodyStyles: { font: 'times', fontSize: 7.5, valign: 'middle', overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: wSemester, fontStyle: 'bold', textColor: [106, 25, 125] as unknown as string },
      1: { cellWidth: wElemen },
      2: { cellWidth: wMateri },
      3: { cellWidth: wTp },
      4: { cellWidth: wJp, halign: 'center' },
    },
    tableWidth: contentWidth,
    alternateRowStyles: { fillColor: [250, 240, 253] },
    margin: { left: mL, right: mR },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawPage: (data: any) => {
      doc.setFontSize(7); doc.setFont('times', 'italic'); doc.setTextColor(148, 163, 184)
      doc.text(`Program Tahunan — ${namaMapel} — ${namaKelas} — ${tahunAjaran}   |   Hal. ${data.pageNumber}`,
        pageW / 2, pageH - 6, { align: 'center' })
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY: number = (doc as any).lastAutoTable?.finalY || 200
  const ttdY = finalY + 10 > pageH - 55 ? (() => { doc.addPage(); return 20 })() : finalY + 10

  const titiMangsa = resolveTitiMangsa(profil)
  const ttdColW = 60

  // Kepala Sekolah/Pimpinan ("Mengetahui") SELALU di KIRI, Guru Mapel di
  // KANAN -- titimangsa sejajar dengan kolom KANAN (Guru). Tanpa garis TTD.
  doc.setFont('times', 'normal'); doc.setFontSize(9); doc.setTextColor(15, 23, 42)
  doc.text('Mengetahui,', mL, ttdY)
  doc.text('Kepala Sekolah / Pimpinan,', mL, ttdY + 5)
  doc.setFont('times', 'bold')
  const namaKepalaLines = doc.splitTextToSize(profil.namaKepala || '(Nama Kepala Sekolah)', ttdColW)
  doc.text(namaKepalaLines, mL, ttdY + 39)
  doc.setFont('times', 'normal'); doc.setFontSize(8.5)
  doc.text(`NUPTK: ${profil.nuptk || profil.nip || '-'}`, mL, ttdY + 39 + namaKepalaLines.length * 4)

  const ttdX2 = pageW - mR - ttdColW
  doc.setFont('times', 'normal'); doc.setFontSize(9)
  const titiMangsaLines = doc.splitTextToSize(titiMangsa, ttdColW)
  doc.text(titiMangsaLines, ttdX2, ttdY)
  doc.text('Guru Mata Pelajaran,', ttdX2, ttdY + 4 + (titiMangsaLines.length - 1) * 4)
  doc.setFont('times', 'bold')
  const namaGuruLines = doc.splitTextToSize(namaGuru || '(Nama Guru)', ttdColW)
  doc.text(namaGuruLines, ttdX2, ttdY + 39)
  doc.setFont('times', 'normal'); doc.setFontSize(8.5)
  doc.text(`NUPTK: ${nuptk || '-'}`, ttdX2, ttdY + 39 + namaGuruLines.length * 4)

  if (mode === 'preview') {
    return doc.output('bloburl') as unknown as string
  }
  doc.save(`Prota_${namaMapel}_${namaKelas}_${tahunAjaran.replace('/', '-')}.pdf`)
}

// ─── Ekspor PDF Promes ────────────────────────────────────────────────────────

async function eksporPromesPDF(params: {
  profil: ProfilSekolah
  namaGuru: string
  nuptk: string
  namaMapel: string
  namaKelas: string
  tahunAjaran: string
  semester: 'ganjil' | 'genap'
  rows: (ProtaRow & AlokasiInput)[]
  alokasiJpPerMinggu: number
  weeksByBulan: Record<string, MingguKapasitas[]>
  alokasiMingguan: Record<string, Record<string, number>>
  capJpEfektif: number
  mode?: 'unduh' | 'preview'
}): Promise<string | void> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const {
    profil, namaGuru, nuptk, namaMapel, namaKelas, tahunAjaran, semester,
    rows, alokasiJpPerMinggu, weeksByBulan, alokasiMingguan, capJpEfektif,
    mode = 'unduh',
  } = params

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const mL = 12, mR = 12
  const contentWidth = pageW - mL - mR
  const semLabel = semester === 'ganjil' ? 'Ganjil' : 'Genap'
  const bulanList = semester === 'ganjil' ? BULAN_SEM1 : BULAN_SEM2

  const { tahunAwal, tahunAkhir } = (() => {
    const [a, b] = tahunAjaran.split('/')
    return { tahunAwal: parseInt(a), tahunAkhir: parseInt(b) }
  })()
  const getBulanKey = (bulan: string) => {
    const idx = NAMA_BULAN.indexOf(bulan)
    const tahun = idx >= 6 ? tahunAwal : tahunAkhir
    return `${tahun}-${String(idx + 1).padStart(2, '0')}`
  }

  let curY = 12
  doc.setLineWidth(1); doc.setDrawColor(0, 0, 0)
  doc.line(mL, curY, pageW - mR, curY); curY += 4
  doc.setFontSize(13); doc.setFont('times', 'bold'); doc.setTextColor(15, 23, 42)
  doc.text('PROGRAM SEMESTER', pageW / 2, curY, { align: 'center' }); curY += 5
  doc.setFontSize(10)
  const namaSekolahLines = doc.splitTextToSize(profil.namaSekolah || 'Nama Satuan Pendidikan', contentWidth - 20)
  doc.text(namaSekolahLines, pageW / 2, curY, { align: 'center' }); curY += namaSekolahLines.length * 4 + 0.5
  if (profil.alamat) {
    doc.setFont('times', 'normal'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105)
    const alamatLines = doc.splitTextToSize(profil.alamat, contentWidth - 20)
    doc.text(alamatLines, pageW / 2, curY, { align: 'center' }); curY += alamatLines.length * 3.3 + 1
  }
  doc.setLineWidth(0.5); doc.setDrawColor(0, 0, 0)
  doc.line(mL, curY, pageW - mR, curY); curY += 3

  doc.setFont('times', 'bold'); doc.setFontSize(8); doc.setTextColor(15, 23, 42)
  const kolKananX = mL + contentWidth / 2
  const labelWPromes = 30
  const barisInfoPromes = (label: string, value: string, x: number, yy: number) => {
    doc.text(label, x, yy)
    doc.text(`: ${value}`, x + labelWPromes, yy)
  }
  barisInfoPromes('Mata Pelajaran', namaMapel, mL, curY)
  barisInfoPromes('Kelas', namaKelas, kolKananX, curY); curY += 4
  barisInfoPromes('Tahun Ajaran', tahunAjaran, mL, curY)
  barisInfoPromes('Semester', semLabel, kolKananX, curY); curY += 4
  barisInfoPromes('Alokasi Waktu', `${alokasiJpPerMinggu} jam/minggu`, mL, curY); curY += 4

  const headRow1 = ['No', 'Elemen/Materi', 'Tujuan Pembelajaran', 'Jml\n(JP)']
  bulanList.forEach(bln => headRow1.push(bln, '', '', '', ''))
  const headRow2 = ['', '', '', '']
  bulanList.forEach(() => { for (let i = 1; i <= 5; i++) headRow2.push(String(i)) })

  type Cell = string | { content: string; styles: Record<string, unknown> }
  const body: Cell[][] = []
  let no = 1
  let totalDialokasikan = 0

  rows.forEach(r => {
    const row: Cell[] = [String(no++), `${r.elemen} — ${r.materiNama}`, `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`, String(r.jp)]
    bulanList.forEach(bln => {
      const bulanKey = getBulanKey(bln)
      const list = weeksByBulan[bulanKey] || []
      for (let m = 1; m <= 5; m++) {
        const w = list.find(x => x.mingguKe === m)
        if (!w) { row.push(''); continue }
        const status = klasifikasiMinggu(w)
        const jp = alokasiMingguan[r.id]?.[`${bulanKey}::${m}`] || 0
        totalDialokasikan += jp
        const bg = status === 'hitam' ? [30, 30, 30] : status === 'abu' ? [203, 213, 225] : [255, 255, 255]
        const fg = status === 'hitam' ? [255, 255, 255] : [15, 23, 42]
        row.push({ content: jp > 0 ? String(jp) : '', styles: { fontStyle: 'bold', halign: 'center' as unknown as string, fillColor: bg as unknown as string, textColor: fg as unknown as string } })
      }
    })
    body.push(row)
  })

  const jpCadangan = Math.max(0, capJpEfektif - totalDialokasikan)

  // Lebar kolom dihitung persis dari contentWidth (bukan angka tetap sembarangan) supaya
  // TOTAL lebar tabel TIDAK PERNAH melebihi lebar halaman — sebelumnya kolom mingguan
  // (hingga 30 kolom × 8mm = 240mm) ditambah kolom tetap bisa jauh melebihi lebar
  // halaman landscape (±273mm), menyebabkan tabel terpotong / teks tumpang tindih.
  const nWeekCols = bulanList.length * 5
  const wNo = 8, wElemen = 24, wJp = 9
  const wTpTarget = 45
  const remainingForWeeks = contentWidth - (wNo + wElemen + wJp + wTpTarget)
  const wWeek = Math.max(4.2, remainingForWeeks / nWeekCols)
  const wTp = contentWidth - (wNo + wElemen + wJp + wWeek * nWeekCols)

  const lebarKolom: { cellWidth: number; halign?: string }[] = [
    { cellWidth: wNo, halign: 'center' }, { cellWidth: wElemen }, { cellWidth: wTp }, { cellWidth: wJp, halign: 'center' },
  ]
  bulanList.forEach(() => { for (let i = 0; i < 5; i++) lebarKolom.push({ cellWidth: wWeek, halign: 'center' }) })

  autoTable(doc, {
    startY: curY,
    head: [headRow1, headRow2],
    body,
    headStyles: { font: 'times', fillColor: [237, 227, 243], textColor: [30, 10, 40], fontStyle: 'bold', fontSize: 6.5, halign: 'center', valign: 'middle' },
    bodyStyles: { font: 'times', fontSize: 6.5, valign: 'middle', overflow: 'linebreak' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columnStyles: lebarKolom.reduce((acc: any, col, idx) => { acc[idx] = col; return acc }, {}),
    tableWidth: contentWidth,
    alternateRowStyles: { fillColor: [250, 240, 253] },
    margin: { left: mL, right: mR },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawPage: (data: any) => {
      doc.setFontSize(6); doc.setFont('times', 'italic'); doc.setTextColor(148, 163, 184)
      doc.text(`Program Semester ${semLabel} — ${namaMapel} — ${namaKelas} — ${tahunAjaran}   |   Hal. ${data.pageNumber}`,
        pageW / 2, pageH - 4, { align: 'center' })
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let afterTableY: number = (doc as any).lastAutoTable?.finalY || 160
  afterTableY += 5
  if (afterTableY + 30 > pageH - 55) { doc.addPage(); afterTableY = 15 }
  doc.setFont('times', 'bold'); doc.setFontSize(8); doc.setTextColor(15, 23, 42)
  doc.text(`Jumlah Jam Efektif       : ${capJpEfektif} JP`, mL, afterTableY); afterTableY += 5
  doc.text(`Jumlah Jam Cadangan    : ${jpCadangan} JP`, mL, afterTableY); afterTableY += 5
  doc.setTextColor(0, 0, 0)
  doc.text(`Jumlah Jam Total Semester ${semLabel} : ${capJpEfektif} JP`, mL, afterTableY); afterTableY += 8

  if (afterTableY + 50 > pageH) { doc.addPage(); afterTableY = 15 }
  const titiMangsa = resolveTitiMangsa(profil)
  const ttdColW = 55

  // Kepala Sekolah/Pimpinan ("Mengetahui") SELALU di KIRI, Guru Mapel di
  // KANAN -- titimangsa sejajar kolom KANAN (Guru). Tanpa garis TTD.
  doc.setFont('times', 'normal'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42)
  doc.text('Mengetahui,', mL, afterTableY)
  doc.text('Kepala Sekolah / Pimpinan,', mL, afterTableY + 4)
  doc.setFont('times', 'bold'); doc.setFontSize(8.5)
  const namaKepalaLines = doc.splitTextToSize(profil.namaKepala || '(Nama Kepala Sekolah)', ttdColW)
  doc.text(namaKepalaLines, mL, afterTableY + 34)
  doc.setFont('times', 'normal'); doc.setFontSize(8)
  doc.text(`NUPTK: ${profil.nuptk || profil.nip || '-'}`, mL, afterTableY + 34 + namaKepalaLines.length * 4)

  const ttdX2 = pageW - mR - ttdColW
  doc.setFontSize(8.5)
  const titiMangsaLines = doc.splitTextToSize(titiMangsa, ttdColW)
  doc.text(titiMangsaLines, ttdX2, afterTableY)
  doc.text('Guru Mata Pelajaran,', ttdX2, afterTableY + 4 + (titiMangsaLines.length - 1) * 4)
  doc.setFont('times', 'bold')
  const namaGuruLines = doc.splitTextToSize(namaGuru || '(Nama Guru)', ttdColW)
  doc.text(namaGuruLines, ttdX2, afterTableY + 34)
  doc.setFont('times', 'normal'); doc.setFontSize(8)
  doc.text(`NUPTK: ${nuptk || '-'}`, ttdX2, afterTableY + 34 + namaGuruLines.length * 4)

  if (mode === 'preview') {
    return doc.output('bloburl') as unknown as string
  }
  doc.save(`Promes_${semLabel}_${namaMapel}_${namaKelas}_${tahunAjaran.replace('/', '-')}.pdf`)
}

// ─── KOMPONEN UTAMA ───────────────────────────────────────────────────────────

export default function ProtaPromesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('prota_promes')
  const bolehEdit = bisaMengeditModul('prota_promes')
  const cakupanGuru = getCakupanMengajarGuru() // null utk Admin, berisi mapelIds/guruId utk Guru
  const [namaInduk, setNamaInduk] = useState('Lembaga / Yayasan Pusat')
  const [logoInduk, setLogoInduk] = useState('')

  // Data master CP/TP/ATP (dari halaman CP, TP & ATP)
  const [daftarCp, setDaftarCp] = useState<CP[]>([])
  const [daftarMateri, setDaftarMateri] = useState<Materi[]>([])
  const [daftarTp, setDaftarTp] = useState<TP[]>([])
  const [daftarAtpPeta, setDaftarAtpPeta] = useState<AtpPeta[]>([])

  const [daftarGuru, setDaftarGuru] = useState<Guru[]>([])
  const [daftarMapel, setDaftarMapel] = useState<Mapel[]>([])
  const [daftarRombel, setDaftarRombel] = useState<Rombel[]>([])
  const [matriksJp, setMatriksJp] = useState<Record<string, string>>({})
  const [daftarJadwal, setDaftarJadwal] = useState<{ guruId: string; mapelId: string; rombelId: string; hari: string; waktuId: string }[]>([])
  const [daftarWaktu, setDaftarWaktu] = useState<{ id: string; jenis: string }[]>([])
  const [eventsKaldik, setEventsKaldik] = useState<KaldikEvent[]>([])

  const [semesterGanjil, setSemesterGanjil] = useState<SemesterInfo>({
    id: 'ganjil', nama: 'Ganjil', tahunAjaran: '2024/2025',
    tanggalMulai: '2024-07-15', tanggalSelesai: '2024-12-20',
  })
  const [semesterGenap, setSemesterGenap] = useState<SemesterInfo>({
    id: 'genap', nama: 'Genap', tahunAjaran: '2024/2025',
    tanggalMulai: '2025-01-06', tanggalSelesai: '2025-06-20',
  })

  const [profil, setProfil] = useState<ProfilSekolah>({
    namaSekolah: '', alamat: '', kota: '', namaKepala: '', nip: '', nuptk: '',
  })
  const [editProfil, setEditProfil] = useState(false)

  const [filterGuruId, setFilterGuruId] = useState('')
  const [filterMapelId, setFilterMapelId] = useState('')
  const [filterRombelId, setFilterRombelId] = useState('')
  const [filterUnitId, setFilterUnitId] = useState('') // '' = Lembaga Pusat
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([])
  const [daftarTingkat, setDaftarTingkat] = useState<any[]>([])

  const [loadingEkspor, setLoadingEkspor] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const tampilkanPratinjau = (url: string) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = url
    setPreviewUrl(url)
  }
  useEffect(() => { return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) } }, [])
  const [tabView, setTabView] = useState<'preview-prota' | 'preview-promes1' | 'preview-promes2'>('preview-prota')

  // Input guru: HANYA alokasi JP per baris TP — key: prota_alokasi_<mapelId>_<rombelId>
  // (semester TIDAK diinput di sini, sudah ditentukan di halaman CP, TP & ATP)
  const [protaAlokasi, setProtaAlokasi] = useState<Record<string, AlokasiInput>>({})

  // ── Init ──
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const si = localStorage.getItem('identitas_induk')
      if (si) {
        const p = JSON.parse(si)
        setNamaInduk(p.nama)
        setLogoInduk(p.logo_utama || p.logo || '')
        setProfil(prev => ({ ...prev, namaSekolah: p.nama || '', alamat: p.alamat || '' }))
      }

      const sg = localStorage.getItem('master_guru'); if (sg) setDaftarGuru(JSON.parse(sg))
      const sm = localStorage.getItem('master_mapel'); if (sm) setDaftarMapel(JSON.parse(sm))
      const sr = localStorage.getItem('master_rombel'); if (sr) setDaftarRombel(JSON.parse(sr))

      const scp = localStorage.getItem(kunciTahun('data_cp')); if (scp) setDaftarCp(JSON.parse(scp))
      const smt = localStorage.getItem(kunciTahun('data_materi')); if (smt) setDaftarMateri(JSON.parse(smt))
      const stp = localStorage.getItem(kunciTahun('data_tp')); if (stp) setDaftarTp(JSON.parse(stp))
      const satp = localStorage.getItem(kunciTahun('data_atp')); if (satp) setDaftarAtpPeta(JSON.parse(satp))

      const smj = localStorage.getItem(kunciTahun('matriks_alokasi_rinci_samping')); if (smj) setMatriksJp(JSON.parse(smj))
      const sj = localStorage.getItem(kunciTahun('data_jadwal_pelajaran')); if (sj) setDaftarJadwal(JSON.parse(sj))
      const sw = localStorage.getItem(kunciTahun('master_pemetaan_waktu')); if (sw) setDaftarWaktu(JSON.parse(sw))

      const sk = localStorage.getItem(kunciTahun('kaldik_agenda_list')) || localStorage.getItem(kunciTahun('data_kaldik_events'))
      if (sk) setEventsKaldik(JSON.parse(sk))

      const sgs = localStorage.getItem(kunciTahun('setting_semester_ganjil')); if (sgs) setSemesterGanjil(JSON.parse(sgs))
      const sge = localStorage.getItem(kunciTahun('setting_semester_genap')); if (sge) setSemesterGenap(JSON.parse(sge))

      setProfil(prev => ({
        ...prev,
        namaSekolah: localStorage.getItem('nama_sekolah') || prev.namaSekolah,
        kota: localStorage.getItem('profil_kota') || '',
        alamat: localStorage.getItem('profil_alamat') || prev.alamat,
        titiMangsa: localStorage.getItem('profil_titi_mangsa') || '',
        // namaKepala/nip/nuptk TIDAK diisi manual lagi -- dihitung otomatis
        // di effect terpisah di bawah (mengikuti guru/unit yang dipilih).
      }))

      setLoading(false)

      const sl = localStorage.getItem('daftar_lembaga')
      const parsedLembaga = sl ? JSON.parse(sl) : []
      setDaftarLembaga(parsedLembaga)
      const stg = localStorage.getItem('master_tingkat')
      if (stg) setDaftarTingkat(JSON.parse(stg))

      // Kalau yang login adalah Guru (bukan Admin), kunci filter Guru & Unit ke
      // dirinya sendiri -- tidak bisa memilih/lihat data guru/unit lain sama sekali.
      const cakupan = getCakupanMengajarGuru()
      if (cakupan?.guruId) {
        setFilterGuruId(cakupan.guruId)
        const sgRaw = localStorage.getItem('master_guru')
        const guruSendiri = sgRaw ? JSON.parse(sgRaw).find((g: any) => g.id === cakupan.guruId) : null
        if (guruSendiri?.unitIds?.[0]) setFilterUnitId(guruSendiri.unitIds[0])
      }
    }
    init()
  }, [router])

  // Kepala Sekolah/Mudir & Nama Satuan Pendidikan dideteksi OTOMATIS dari
  // Identitas Lembaga -- mengikuti Unit yang dipilih di filter ("" = Lembaga
  // Pusat/Mudir, unit tertentu = Kepala Sekolah unit itu). Tidak ada lagi
  // input manual nama Kepala Sekolah / Nama Sekolah di halaman ini.
  useEffect(() => {
    const identitas = ambilIdentitasOtomatis()
    if (!identitas) return

    const unitData = filterUnitId ? identitas.unitList.find(u => u.id === filterUnitId) : undefined

    setProfil(prev => ({
      ...prev,
      namaSekolah: filterUnitId ? (unitData?.nama || prev.namaSekolah) : (identitas.namaLembaga || prev.namaSekolah),
      alamat: unitData?.alamat || identitas.alamat || prev.alamat,
      namaKepala: filterUnitId ? (unitData?.namaKepala || '') : (identitas.namaMudir || ''),
      nip: filterUnitId ? (unitData?.nipKepala || '') : (identitas.nipMudir || ''),
    }))
  }, [filterUnitId])

  function simpanProfil() {
    localStorage.setItem('profil_titi_mangsa', profil.titiMangsa || '')
    setEditProfil(false)
  }

  // ── Muat input Prota (JP tiap baris) tiap kali mapel/kelas berganti ──
  useEffect(() => {
    if (!filterMapelId || !filterRombelId) { setProtaAlokasi({}); return }
    const raw = localStorage.getItem(`prota_alokasi_${filterMapelId}_${filterRombelId}`)
    setProtaAlokasi(raw ? JSON.parse(raw) : {})
  }, [filterMapelId, filterRombelId])

  function updateJp(id: string, jp: number) {
    setProtaAlokasi(prev => {
      const next: Record<string, AlokasiInput> = { ...prev, [id]: { jp } }
      if (filterMapelId && filterRombelId) {
        localStorage.setItem(`prota_alokasi_${filterMapelId}_${filterRombelId}`, JSON.stringify(next))
      }
      return next
    })
  }

  // ── Derived data ──

  const hariLiburSet = useMemo(() => buildHariLiburSet(eventsKaldik), [eventsKaldik])

  const guruTerpilih = daftarGuru.find(g => g.id === filterGuruId)
  const mapelTerpilih = daftarMapel.find(m => m.id === filterMapelId)
  const rombelTerpilih = daftarRombel.find(r => r.id === filterRombelId)
  const tahunAjaran = semesterGanjil.tahunAjaran

  // ── Baris Prota: gabungan CP + Materi + TP + ATP untuk mapel & tingkat kelas terpilih ──
  // INI PERBAIKAN UTAMA #1: sebelumnya membaca key 'data_analisis_atp' yang tidak pernah
  // diisi oleh halaman manapun. Sekarang benar-benar diambil dari CP, TP & ATP — termasuk
  // SEMESTER, yang kini ditentukan di halaman CP, TP & ATP (bukan lagi dipilih di sini).
  const protaRows = useMemo<ProtaRow[]>(() => {
    if (!filterMapelId || !filterRombelId) return []
    const tingkat = ambilTingkatDariRombel(rombelTerpilih)
    if (!tingkat) return []
    return daftarAtpPeta
      .filter(a => a.mapelId === filterMapelId && a.kelas === tingkat)
      .map(a => {
        const tp = daftarTp.find(t => t.id === a.tpId)
        const materi = daftarMateri.find(m => m.id === tp?.materiId)
        const cp = daftarCp.find(c => c.id === a.cpId)
        return {
          id: a.id,
          urutan: a.urutanDiKelas,
          semester: a.semester === '2' ? 'genap' as const : 'ganjil' as const,
          elemen: cp?.elemen || '',
          materiNama: materi?.nama || '(Materi belum dipilih)',
          tpNomor: tp?.nomor || '',
          tpDeskripsi: tp?.deskripsi || '(TP tidak ditemukan)',
        }
      })
      .sort((x, y) => x.urutan - y.urutan)
  }, [daftarAtpPeta, daftarTp, daftarMateri, daftarCp, filterMapelId, filterRombelId, rombelTerpilih])

  // Gabungkan baris Prota (elemen/materi/TP/semester — semua dari ATP) dengan input JP guru
  const protaRowsFull = useMemo<(ProtaRow & AlokasiInput)[]>(() =>
    protaRows.map(r => ({
      ...r,
      jp: protaAlokasi[r.id]?.jp || 0,
    })),
    [protaRows, protaAlokasi]
  )

  // JP per hari (Sen..Sab) untuk guru+mapel+kelas terpilih — SUMBER JP RIIL dari Jadwal Pelajaran
  // INI PERBAIKAN UTAMA #2: "Data JP per mapel diambil dari halaman jadwal"
  const jpPerHari = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {}
    if (!filterGuruId || !filterMapelId || !filterRombelId) return map
    daftarJadwal.forEach(j => {
      if (j.guruId === filterGuruId && j.mapelId === filterMapelId && j.rombelId === filterRombelId) {
        const w = daftarWaktu.find(w => w.id === j.waktuId)
        if (w?.jenis === 'mapel') {
          const hariNum = HARI_NUM[j.hari]
          if (hariNum) map[hariNum] = (map[hariNum] || 0) + 1
        }
      }
    })
    return map
  }, [filterGuruId, filterMapelId, filterRombelId, daftarJadwal, daftarWaktu])

  const hariMengajarNum = useMemo(() => Object.keys(jpPerHari).map(Number), [jpPerHari])

  // Alokasi JP/minggu: utamakan hitungan riil dari Jadwal; fallback ke Matriks Alokasi jika jadwal kosong
  const alokasiJpPerMinggu = useMemo(() => {
    const dariJadwal = Object.values(jpPerHari).reduce((a: number, b: number) => a + b, 0)
    if (dariJadwal > 0) return dariJadwal
    if (!filterGuruId || !filterMapelId || !filterRombelId) return 0
    const key = `${filterGuruId}_${filterMapelId}_${filterRombelId}`
    return hitungTotalJp(matriksJp[key] || '')
  }, [jpPerHari, filterGuruId, filterMapelId, filterRombelId, matriksJp])

  // Minggu efektif institusional per bulan (dasar kapasitas — sama seperti halaman Minggu Efektif)
  const mingguEfektifSem1 = useMemo(() =>
    hitungMingguEfektifPerBulan(semesterGanjil.tanggalMulai, semesterGanjil.tanggalSelesai, hariLiburSet),
    [semesterGanjil, hariLiburSet]
  )
  const mingguEfektifSem2 = useMemo(() =>
    hitungMingguEfektifPerBulan(semesterGenap.tanggalMulai, semesterGenap.tanggalSelesai, hariLiburSet),
    [semesterGenap, hariLiburSet]
  )

  // KAPASITAS JP (batas atas pengisian Prota) — jumlah minggu efektif × JP/minggu.
  // "jangan sampai di minggu efektif hanya ada 70 JP, tapi di prota diisi 72 JP"
  const capJpSem1 = useMemo(() =>
    Object.values(mingguEfektifSem1).reduce((a: number, b: number) => a + b, 0) * alokasiJpPerMinggu,
    [mingguEfektifSem1, alokasiJpPerMinggu]
  )
  const capJpSem2 = useMemo(() =>
    Object.values(mingguEfektifSem2).reduce((a: number, b: number) => a + b, 0) * alokasiJpPerMinggu,
    [mingguEfektifSem2, alokasiJpPerMinggu]
  )

  const totalJpTerisiSem1 = useMemo(() => protaRowsFull.filter(r => r.semester === 'ganjil').reduce((a, r) => a + (r.jp || 0), 0), [protaRowsFull])
  const totalJpTerisiSem2 = useMemo(() => protaRowsFull.filter(r => r.semester === 'genap').reduce((a, r) => a + (r.jp || 0), 0), [protaRowsFull])

  // ── Bangun data mingguan (kapasitas + klasifikasi + distribusi JP) per semester ──
  function buildDataPromes(semester: 'ganjil' | 'genap') {
    const semInfo = semester === 'ganjil' ? semesterGanjil : semesterGenap
    const bulanList = semester === 'ganjil' ? BULAN_SEM1 : BULAN_SEM2
    const weeksByBulan = hitungMingguKapasitas(semInfo.tanggalMulai, semInfo.tanggalSelesai, hariLiburSet, jpPerHari)

    const [a, b] = tahunAjaran.split('/')
    const tahunAwal = parseInt(a), tahunAkhir = parseInt(b)
    const getBulanKey = (bln: string) => {
      const idx = NAMA_BULAN.indexOf(bln)
      const tahun = idx >= 6 ? tahunAwal : tahunAkhir
      return `${tahun}-${String(idx + 1).padStart(2, '0')}`
    }

    const weeksFlat: WeekFlat[] = []
    bulanList.forEach(bln => {
      const bulanKey = getBulanKey(bln)
      ;(weeksByBulan[bulanKey] || []).forEach(w => {
        weeksFlat.push({ key: `${bulanKey}::${w.mingguKe}`, bulan: bln, mingguKe: w.mingguKe, status: klasifikasiMinggu(w), capacityJp: w.capacityJp })
      })
    })

    const rows = protaRowsFull.filter(r => r.semester === semester)
    const { alokasi, totalDialokasikan } = distribusikanJp(weeksFlat, rows.map(r => ({ id: r.id, jp: r.jp })))
    const capJpEfektif = semester === 'ganjil' ? capJpSem1 : capJpSem2
    const jpCadangan = Math.max(0, capJpEfektif - totalDialokasikan)

    return { semInfo, bulanList, weeksByBulan, weeksFlat, rows, alokasi, totalDialokasikan, capJpEfektif, jpCadangan, getBulanKey }
  }

  async function handleEkspor(jenis: string, mode: 'unduh' | 'preview' = 'unduh') {
    if (!filterGuruId || !filterMapelId || !filterRombelId) {
      alert('Pilih Guru, Mata Pelajaran, dan Kelas terlebih dahulu.')
      return
    }
    if (protaRowsFull.length === 0) {
      alert('Tidak ada data TP untuk kombinasi Mapel & Kelas yang dipilih. Pastikan sudah dipetakan di halaman CP, TP & ATP.')
      return
    }
    setLoadingEkspor(jenis)
    try {
      const common = {
        profil,
        namaGuru: guruTerpilih?.nama || '',
        nuptk: guruTerpilih?.nip || '',
        namaMapel: mapelTerpilih?.nama || '',
        namaKelas: rombelTerpilih?.nama || '',
        tahunAjaran,
        rows: protaRowsFull,
        capJpSem1,
        capJpSem2,
      }
      if (jenis === 'prota-pdf') {
        const hasilUrl = await eksporProtaPDF({ ...common, mode })
        if (mode === 'preview' && hasilUrl) tampilkanPratinjau(hasilUrl as string)
      }
      else if (jenis === 'prota-xlsx') await eksporProtaExcel(common)
      else if (jenis === 'promes1-pdf' || jenis === 'promes1-xlsx' || jenis === 'promes2-pdf' || jenis === 'promes2-xlsx') {
        const semester: 'ganjil' | 'genap' = jenis.startsWith('promes1') ? 'ganjil' : 'genap'
        const d = buildDataPromes(semester)
        const paramsPromes = {
          profil, namaGuru: common.namaGuru, nuptk: common.nuptk, namaMapel: common.namaMapel,
          namaKelas: common.namaKelas, tahunAjaran, semester,
          rows: d.rows, alokasiJpPerMinggu, weeksByBulan: d.weeksByBulan, alokasiMingguan: d.alokasi,
          capJpEfektif: d.capJpEfektif,
        }
        if (jenis.endsWith('pdf')) {
          const hasilUrl = await eksporPromesPDF({ ...paramsPromes, mode })
          if (mode === 'preview' && hasilUrl) tampilkanPratinjau(hasilUrl as string)
        }
        else await eksporPromesExcel({ ...paramsPromes, weeksFlat: d.weeksFlat })
      }
    } catch (err) {
      console.error(err)
      alert('Gagal mengekspor. Pastikan sudah install:\nnpm install xlsx jspdf jspdf-autotable')
    } finally {
      setLoadingEkspor(null)
    }
  }

  // ── Render preview Promes (untuk ditampilkan di layar) ──
  const renderPreviewPromes = (semester: 'ganjil' | 'genap') => {
    const d = buildDataPromes(semester)
    const { bulanList, weeksByBulan, rows, alokasi, getBulanKey, capJpEfektif, jpCadangan } = d

    const warnaSel = (status: StatusMinggu) =>
      status === 'hitam' ? 'bg-slate-800 text-white'
        : status === 'abu' ? 'bg-slate-300 text-slate-700'
        : ''

    return (
      <div className="overflow-x-auto">
        <table className="text-[9px] border-collapse w-full min-w-[900px]">
          <thead>
            <tr className="bg-[#4a1263] text-white">
              <th className="border border-[#4a1263] p-1.5 text-center" rowSpan={2}>No</th>
              <th className="border border-[#4a1263] p-1.5 text-center" rowSpan={2}>Elemen/Materi</th>
              <th className="border border-[#4a1263] p-1.5 text-center" rowSpan={2}>Tujuan Pembelajaran</th>
              <th className="border border-[#4a1263] p-1.5 text-center" rowSpan={2}>Jml<br />(JP)</th>
              {bulanList.map(bln => (
                <th key={bln} className="border border-[#4a1263] p-1 text-center" colSpan={5}>{bln}</th>
              ))}
            </tr>
            <tr className="bg-[#5b1774] text-white">
              {bulanList.map(bln => [1, 2, 3, 4, 5].map(m => (
                <th key={`${bln}-${m}`} className="border border-[#4a1263] p-1 text-center w-6">{m}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4 + bulanList.length * 5} className="text-center py-8 text-slate-400">
                  {protaRowsFull.length === 0
                    ? 'Pilih Guru, Mapel, dan Kelas untuk melihat preview'
                    : `Belum ada TP yang ditetapkan ke Semester ${semester === 'ganjil' ? '1' : '2'} di tabel Prota di atas`}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#6A197D]/12'}>
                  <td className="border border-slate-200 p-1 text-center">{idx + 1}</td>
                  <td className="border border-slate-200 p-1 font-semibold text-[#6A197D]">{r.elemen}{r.materiNama ? ` — ${r.materiNama}` : ''}</td>
                  <td className="border border-slate-200 p-1">{r.tpNomor ? `${r.tpNomor} — ` : ''}{r.tpDeskripsi}</td>
                  <td className="border border-slate-200 p-1 text-center font-bold">{r.jp}</td>
                  {bulanList.map(bln => {
                    const bulanKey = getBulanKey(bln)
                    const list = weeksByBulan[bulanKey] || []
                    return [1, 2, 3, 4, 5].map(m => {
                      const w = list.find(x => x.mingguKe === m)
                      if (!w) return <td key={`${bln}-${m}`} className="border border-slate-200 p-1 bg-slate-50" />
                      const status = klasifikasiMinggu(w)
                      const jp = alokasi[r.id]?.[`${bulanKey}::${m}`] || 0
                      return (
                        <td key={`${bln}-${m}`} className={`border border-slate-200 p-1 text-center font-bold ${warnaSel(status)}`}>
                          {jp > 0 ? jp : ''}
                        </td>
                      )
                    })
                  })}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-bold text-[9px]">
              <td colSpan={4} className="border border-slate-200 p-1.5 text-right">Jumlah Jam Efektif</td>
              <td colSpan={bulanList.length * 5} className="border border-slate-200 p-1.5 text-[#6A197D] font-black">{capJpEfektif} JP</td>
            </tr>
            <tr className="bg-slate-50 font-bold text-[9px]">
              <td colSpan={4} className="border border-slate-200 p-1.5 text-right">Jumlah Jam Cadangan</td>
              <td colSpan={bulanList.length * 5} className="border border-slate-200 p-1.5 text-[#6A197D]">{jpCadangan} JP</td>
            </tr>
            <tr className="bg-[#6A197D]/8 font-black text-[9px]">
              <td colSpan={4} className="border border-slate-200 p-1.5 text-right text-[#5b1774]">Jumlah Jam Total Semester {semester === 'ganjil' ? 'Ganjil' : 'Genap'}</td>
              <td colSpan={bulanList.length * 5} className="border border-slate-200 p-1.5 text-[#4a1263] text-xs">{capJpEfektif} JP</td>
            </tr>
          </tfoot>
        </table>
        <div className="flex flex-wrap gap-3 mt-3 text-[9px]">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border border-slate-300 inline-block" /> Minggu efektif — tertulis JP riil</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300 inline-block" /> Tidak efektif utk lembaga, tapi efektif utk mapel (masih ada JP)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-800 inline-block" /> Tidak efektif (tidak ada JP)</span>
        </div>
      </div>
    )
  }

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Prota &amp; Promes...</div>
  if (diizinkanAkses === false) return null

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800">
      {/* FONT: Baloo 2 untuk teks tebal (heading, font-bold/black/semibold), Open Sans untuk teks tipis/isi */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Open+Sans:wght@300;400;500;600&display=swap');

        body {
          font-family: 'Open Sans', ui-sans-serif, system-ui, sans-serif;
          font-weight: 300;
        }
        h1, h2, h3, h4,
        .font-black, .font-extrabold, .font-bold, .font-semibold {
          font-family: 'Baloo 2', ui-sans-serif, system-ui, sans-serif;
        }
        .font-medium, .font-normal, p, span, td, th, label, input, select, textarea, button {
          font-family: 'Open Sans', ui-sans-serif, system-ui, sans-serif;
        }
        th.font-black, th.font-bold, th.font-semibold,
        td.font-black, td.font-bold, td.font-semibold {
          font-family: 'Baloo 2', ui-sans-serif, system-ui, sans-serif;
        }
      `}</style>

      {/* SIDEBAR */}
      <Sidebar />

      {/* MAIN */}
      <main className="flex-1 p-8 overflow-y-auto max-w-full mx-auto space-y-8">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-black text-slate-900">Program Tahunan &amp; Program Semester</h1>
          <p className="text-xs text-gray-500">
            Elemen, Materi, Tujuan Pembelajaran &amp; Semester diambil otomatis dari halaman CP, TP &amp; ATP. Anda hanya perlu
            mengisi Alokasi Waktu (JP) di tabel Prota — Promes akan otomatis mendistribusikan JP tsb
            ke minggu-minggu efektif berdasarkan Jadwal Pelajaran &amp; Kalender Pendidikan.
          </p>
        </header>

        {/* ── PROFIL SEKOLAH ── */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div
            className="flex justify-between items-center px-6 py-4 bg-slate-50 cursor-pointer select-none"
            onClick={() => setEditProfil(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Kop Dokumen &amp; Tanda Tangan</span>
              {(!profil.namaKepala || !profil.kota) && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FFDE59]/40 text-[#6A197D] font-bold border border-[#FFDE59]">Belum lengkap</span>
              )}
              {profil.namaKepala && profil.kota && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-bold border border-green-200">Siap cetak ✓</span>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${editProfil ? 'rotate-180' : ''}`} />
          </div>
          {editProfil && (
            <div className="px-6 py-5 space-y-4 border-t border-slate-100">
              <p className="text-[10px] text-slate-500">Nama lembaga, alamat, dan Kepala Sekolah diambil <strong>otomatis</strong> dari menu Identitas Lembaga &amp; Kelola Data Guru (mengikuti unit tempat guru yang dipilih bertugas) — tidak bisa diubah manual di sini. Hanya Titi Mangsa yang bisa disesuaikan.</p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 text-[11px]">
                <p><span className="font-bold text-slate-600">Satuan Pendidikan:</span> {profil.namaSekolah || '—'}</p>
                <p><span className="font-bold text-slate-600">Kota:</span> {profil.kota || '—'}</p>
                <p><span className="font-bold text-slate-600">Alamat:</span> {profil.alamat || '—'}</p>
                <p><span className="font-bold text-slate-600">Kepala Sekolah:</span> {profil.namaKepala || 'Belum diatur di Kelola Data Guru'}{profil.nip ? ` / NUPTK: ${profil.nip}` : ''}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1 block">Titi Mangsa (Tempat, Tanggal Penandatanganan)</label>
                  <div className="flex gap-2">
                    <input type="text" value={profil.titiMangsa || ''} onChange={e => setProfil(p => ({ ...p, titiMangsa: e.target.value }))}
                      placeholder={getTitiMangsa(profil.kota)}
                      className="flex-1 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6A197D]" />
                    <button type="button" onClick={() => setProfil(p => ({ ...p, titiMangsa: getTitiMangsa(p.kota) }))}
                      className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition shrink-0">
                      Hari ini
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    Kosongkan untuk memakai tanggal hari ini otomatis ({getTitiMangsa(profil.kota)}). Isi manual jika dokumen perlu tanggal penetapan tertentu (mis. awal tahun ajaran).
                  </p>
                </div>
              </div>
              <button onClick={simpanProfil}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-[#6A197D] hover:bg-[#57146a] text-white transition">
                Simpan Titi Mangsa
              </button>
            </div>
          )}
          {!editProfil && profil.namaKepala && (
            <div className="px-6 py-3 border-t border-slate-100 text-[10px] text-slate-600 flex gap-6">
              <span><strong>Titi Mangsa:</strong> {resolveTitiMangsa(profil)}</span>
              <span><strong>Kepala Sekolah:</strong> {profil.namaKepala} {profil.nip ? `/ NUPTK: ${profil.nip}` : ''}</span>
            </div>
          )}
        </section>

        {/* ── FILTER LEMBAGA / GURU / MAPEL / KELAS ── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3">Filter Lembaga, Guru, Mata Pelajaran &amp; Kelas</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">1. Lembaga / Unit</label>
              {cakupanGuru ? (
                <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 font-semibold text-slate-600">
                  {daftarLembaga.find(u => u.id === filterUnitId)?.nama || 'Lembaga Pusat'} <span className="text-[9px] font-normal text-slate-400">(unit Anda)</span>
                </div>
              ) : (
                <select value={filterUnitId} onChange={e => setFilterUnitId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-[#6A197D]">
                  <option value="">Lembaga Pusat (Mudir)</option>
                  {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
                </select>
              )}
              <p className="text-[9px] text-slate-400 mt-1">Menentukan Guru/Kelas yang muncul, serta Kepala Sekolah/Mudir di tanda tangan.</p>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">2. Guru</label>
              {cakupanGuru ? (
                <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 font-semibold text-slate-600">
                  {guruTerpilih?.nama || 'Anda'} <span className="text-[9px] font-normal text-slate-400">(akun Anda)</span>
                </div>
              ) : (
                <select value={filterGuruId} onChange={e => setFilterGuruId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-[#6A197D]">
                  <option value="">-- Pilih Guru --</option>
                  {(filterUnitId ? daftarGuru.filter((g: any) => (g.unitIds || []).includes(filterUnitId)) : daftarGuru).map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                </select>
              )}
              <p className="text-[9px] text-slate-400 mt-1">Daftar mengikuti guru yang ditugaskan di Unit terpilih.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">3. Mata Pelajaran</label>
              <select value={filterMapelId} onChange={e => setFilterMapelId(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-[#6A197D]">
                <option value="">-- Pilih Mapel --</option>
                {(() => {
                  const punyaMappingMapel = !!guruTerpilih?.mapelIds?.length
                  const list = (!filterGuruId || !punyaMappingMapel)
                    ? daftarMapel
                    : daftarMapel.filter(m => guruTerpilih?.mapelIds?.includes(m.id))
                  return list.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)
                })()}
              </select>
              <p className="text-[9px] text-slate-400 mt-1">Otomatis mengikuti mapel yang diampu Guru terpilih.</p>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">4. Kelas / Rombel</label>
              <select value={filterRombelId} onChange={e => setFilterRombelId(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-[#6A197D]">
                <option value="">-- Pilih Kelas --</option>
                {(() => {
                  const punyaMappingRombel = !!guruTerpilih?.rombelIds?.length
                  let list = (!filterGuruId || !punyaMappingRombel)
                    ? daftarRombel
                    : daftarRombel.filter(r => guruTerpilih?.rombelIds?.includes(r.id))
                  if (filterUnitId) {
                    list = list.filter(r => {
                      const t = daftarTingkat.find((tt: any) => tt.nama === r.tingkat)
                      return t?.lembagaId === filterUnitId
                    })
                  }
                  return list.map(r => <option key={r.id} value={r.id}>Kelas {r.nama}</option>)
                })()}
              </select>
              {daftarRombel.length === 0 && (
                <p className="text-[9px] text-rose-600 mt-1">
                  Belum ada data kelas/rombel terdaftar. Silakan daftarkan kelas terlebih dahulu di menu Master Rombel.
                </p>
              )}
            </div>
          </div>

          {filterGuruId && filterMapelId && filterRombelId && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
              {[
                { label: 'Alokasi JP/Minggu (dari Jadwal)', val: `${alokasiJpPerMinggu} JP`, color: 'bg-[#6A197D]/8 text-[#5b1774] border-[#6A197D]/20' },
                { label: 'Total TP', val: `${protaRows.length} TP`, color: 'bg-emerald-50 text-emerald-800 border-emerald-100' },
                { label: 'Kapasitas Minggu Efektif Sem 1', val: `${capJpSem1} JP`, color: 'bg-[#6A197D]/8 text-[#5b1774] border-[#6A197D]/20' },
                { label: 'Kapasitas Minggu Efektif Sem 2', val: `${capJpSem2} JP`, color: 'bg-[#6A197D]/8 text-[#5b1774] border-[#6A197D]/20' },
              ].map((item, i) => (
                <div key={i} className={`rounded-xl p-3 border text-xs ${item.color}`}>
                  <p className="font-black text-lg leading-none">{item.val}</p>
                  <p className="font-bold uppercase tracking-wider mt-1 opacity-70 text-[10px]">{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {filterGuruId && filterMapelId && filterRombelId && protaRows.length === 0 && (
            <div className="bg-[#FFDE59]/25 border border-[#FFDE59] rounded-xl p-4 text-xs text-[#4a1263] flex gap-2 items-start">
              <span className="mt-0.5">⚠</span>
              <span>Tidak ada TP yang dipetakan untuk <strong>{mapelTerpilih?.nama}</strong> di kelas <strong>{rombelTerpilih?.nama}</strong>.
                Pastikan sudah dipetakan di halaman <a href="/atp" className="underline font-bold">CP, TP &amp; ATP</a> (tab ATP).</span>
            </div>
          )}
        </section>

        {/* ── TABEL PROTA — ISI ALOKASI WAKTU (JP) ── */}
        {filterMapelId && filterRombelId && protaRows.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3">
              Program Tahunan — Isi Alokasi Waktu (JP)
            </h2>
            <p className="text-[10px] text-slate-500 -mt-2">
              Semester tiap TP mengikuti penetapan di halaman <a href="/atp" className="underline font-bold">CP, TP &amp; ATP</a> (tombol Ganjil/Genap pada kartu ATP).
              Di sini Anda hanya perlu mengisi Alokasi Waktu (JP) tiap TP.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[{ sem: 'ganjil' as const, label: 'Semester 1', total: totalJpTerisiSem1, cap: capJpSem1 },
                { sem: 'genap' as const, label: 'Semester 2', total: totalJpTerisiSem2, cap: capJpSem2 }].map(x => {
                const over = x.total > x.cap
                return (
                  <div key={x.sem} className={`rounded-xl p-3 border text-xs flex items-center justify-between ${over ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-100'}`}>
                    <div>
                      <p className="font-black uppercase tracking-wider text-[10px] opacity-70">{x.label}</p>
                      <p className={`font-black text-lg leading-none mt-0.5 ${over ? 'text-rose-700' : 'text-emerald-800'}`}>{x.total} / {x.cap} JP</p>
                    </div>
                    {over
                      ? <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                      : <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                  </div>
                )
              })}
            </div>
            {(totalJpTerisiSem1 > capJpSem1 || totalJpTerisiSem2 > capJpSem2) && (
              <p className="text-[10px] text-rose-700 font-semibold">
                ⚠ Total JP yang diisi melebihi kapasitas minggu efektif pada semester tersebut. Kurangi alokasi JP
                pada beberapa TP, atau periksa kembali data di halaman Minggu Efektif / Jadwal Pelajaran.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr className="bg-[#4a1263] text-white">
                    <th className="border border-[#4a1263] p-2 text-center w-10">No</th>
                    <th className="border border-[#4a1263] p-2 text-left w-32">Elemen</th>
                    <th className="border border-[#4a1263] p-2 text-left w-40">Materi</th>
                    <th className="border border-[#4a1263] p-2 text-left">Tujuan Pembelajaran</th>
                    <th className="border border-[#4a1263] p-2 text-center w-28">Alokasi Waktu (JP)</th>
                  </tr>
                </thead>
                <tbody>
                  {(['ganjil', 'genap'] as const).map(sem => {
                    const rs = protaRowsFull.filter(r => r.semester === sem)
                    if (rs.length === 0) return null
                    const total = sem === 'ganjil' ? totalJpTerisiSem1 : totalJpTerisiSem2
                    const cap = sem === 'ganjil' ? capJpSem1 : capJpSem2
                    const over = total > cap
                    return (
                      <Fragment key={sem}>
                        <tr className="bg-slate-800">
                          <td colSpan={5} className="p-2 font-black text-xs text-white uppercase tracking-wider">
                            {sem === 'ganjil' ? 'Semester 1' : 'Semester 2'}
                          </td>
                        </tr>
                        {rs.map((r, idx) => (
                          <tr key={r.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#6A197D]/10'}>
                            <td className="border border-slate-200 p-1.5 text-center">{idx + 1}</td>
                            <td className="border border-slate-200 p-1.5 font-semibold text-[#6A197D]">{r.elemen}</td>
                            <td className="border border-slate-200 p-1.5">{r.materiNama}</td>
                            <td className="border border-slate-200 p-1.5">{r.tpNomor ? `${r.tpNomor} — ` : ''}{r.tpDeskripsi}</td>
                            <td className="border border-slate-200 p-1.5">
                              <input type="number" min={0} value={r.jp || ''}
                                onChange={e => updateJp(r.id, Math.max(0, Number(e.target.value) || 0))}
                                placeholder="0"
                                className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-bold text-center outline-none focus:ring-2 focus:ring-[#6A197D]" />
                            </td>
                          </tr>
                        ))}
                        <tr className={`font-black text-xs ${over ? 'bg-rose-50' : 'bg-[#6A197D]/8'}`}>
                          <td colSpan={4} className={`border border-slate-200 p-2 text-right ${over ? 'text-rose-800' : 'text-[#5b1774]'}`}>
                            JUMLAH {sem === 'ganjil' ? 'SEMESTER 1' : 'SEMESTER 2'}
                          </td>
                          <td className={`border border-slate-200 p-2 text-center ${over ? 'text-rose-700' : 'text-[#4a1263]'}`}>
                            {total} / {cap} JP
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-black text-xs">
                    <td colSpan={4} className="border border-slate-200 p-2 text-right text-slate-700">JUMLAH KESELURUHAN</td>
                    <td className="border border-slate-200 p-2 text-center text-slate-900">{totalJpTerisiSem1 + totalJpTerisiSem2} JP</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        {/* ── TOMBOL DOWNLOAD ── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
            <Download className="w-4 h-4 text-[#6A197D]" /> Unduh Dokumen
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-[#6A197D]/20 rounded-xl p-4 space-y-3 bg-[#6A197D]/12">
              <p className="text-xs font-black text-[#5b1774] uppercase tracking-wider">Program Tahunan (Prota)</p>
              <div className="flex gap-2">
                <button onClick={() => handleEkspor('prota-pdf', 'preview')} disabled={loadingEkspor !== null}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition disabled:opacity-50" title="Pratinjau sebelum unduh">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleEkspor('prota-pdf')} disabled={loadingEkspor !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50">
                  <FileText className="w-3.5 h-3.5" /> {loadingEkspor === 'prota-pdf' ? 'Memproses...' : 'PDF'}
                </button>
                <button onClick={() => handleEkspor('prota-xlsx')} disabled={loadingEkspor !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> {loadingEkspor === 'prota-xlsx' ? 'Memproses...' : 'Excel'}
                </button>
              </div>
            </div>

            <div className="border border-[#6A197D]/20 rounded-xl p-4 space-y-3 bg-[#6A197D]/10">
              <p className="text-xs font-black text-[#5b1774] uppercase tracking-wider">Promes Semester 1 (Jul–Des)</p>
              <div className="flex gap-2">
                <button onClick={() => handleEkspor('promes1-pdf', 'preview')} disabled={loadingEkspor !== null}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition disabled:opacity-50" title="Pratinjau sebelum unduh">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleEkspor('promes1-pdf')} disabled={loadingEkspor !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50">
                  <FileText className="w-3.5 h-3.5" /> {loadingEkspor === 'promes1-pdf' ? 'Memproses...' : 'PDF'}
                </button>
                <button onClick={() => handleEkspor('promes1-xlsx')} disabled={loadingEkspor !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> {loadingEkspor === 'promes1-xlsx' ? 'Memproses...' : 'Excel'}
                </button>
              </div>
            </div>

            <div className="border border-[#6A197D]/20 rounded-xl p-4 space-y-3 bg-[#6A197D]/10">
              <p className="text-xs font-black text-[#5b1774] uppercase tracking-wider">Promes Semester 2 (Jan–Jun)</p>
              <div className="flex gap-2">
                <button onClick={() => handleEkspor('promes2-pdf', 'preview')} disabled={loadingEkspor !== null}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition disabled:opacity-50" title="Pratinjau sebelum unduh">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleEkspor('promes2-pdf')} disabled={loadingEkspor !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50">
                  <FileText className="w-3.5 h-3.5" /> {loadingEkspor === 'promes2-pdf' ? 'Memproses...' : 'PDF'}
                </button>
                <button onClick={() => handleEkspor('promes2-xlsx')} disabled={loadingEkspor !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> {loadingEkspor === 'promes2-xlsx' ? 'Memproses...' : 'Excel'}
                </button>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400">
            Butuh package: <code className="bg-slate-100 px-1 rounded">npm install xlsx jspdf jspdf-autotable</code>
          </p>
        </section>

        {/* ── PREVIEW DI LAYAR ── */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
            <Eye className="w-4 h-4 text-[#6A197D]" />
            <h2 className="text-sm font-bold text-slate-800">Preview Dokumen</h2>
            {!bolehEdit && (
              <span className="ml-auto text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                Mode Lihat Saja — gunakan tombol Unduh PDF/Excel di atas
              </span>
            )}
          </div>

          <div className="flex bg-slate-50 border-b border-slate-200 px-4 pt-2 gap-1">
            {([
              { key: 'preview-prota', label: 'Program Tahunan' },
              { key: 'preview-promes1', label: 'Promes Sem 1 (Jul–Des)' },
              { key: 'preview-promes2', label: 'Promes Sem 2 (Jan–Jun)' },
            ] as { key: typeof tabView; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setTabView(t.key)}
                className={`px-4 py-2 text-xs font-bold rounded-t-lg transition border-b-2 ${tabView === t.key ? 'bg-white border-[#6A197D] text-[#6A197D]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <fieldset disabled={!bolehEdit} className="p-6 border-0 m-0 min-w-0">
            {filterGuruId && filterMapelId && filterRombelId && (
              <div className="mb-4 p-4 border border-slate-200 rounded-xl bg-slate-50 text-[10px] space-y-1">
                <div className="text-center font-black text-sm text-slate-800">
                  {tabView === 'preview-prota' ? 'PROGRAM TAHUNAN' :
                   tabView === 'preview-promes1' ? 'PROGRAM SEMESTER 1' : 'PROGRAM SEMESTER 2'}
                </div>
                <div className="text-center font-bold text-slate-700">{profil.namaSekolah}</div>
                {profil.alamat && <div className="text-center text-slate-500">{profil.alamat}</div>}
                <div className="border-t border-slate-300 mt-2 pt-2 grid grid-cols-2 gap-1">
                  <span><strong>Mata Pelajaran :</strong> {mapelTerpilih?.nama}</span>
                  <span><strong>Kelas :</strong> {rombelTerpilih?.nama}</span>
                  <span><strong>Tahun Ajaran :</strong> {tahunAjaran}</span>
                  <span><strong>Guru :</strong> {guruTerpilih?.nama}</span>
                  {(tabView === 'preview-promes1' || tabView === 'preview-promes2') && (
                    <span><strong>Alokasi :</strong> {alokasiJpPerMinggu} jam/minggu</span>
                  )}
                </div>
              </div>
            )}

            {/* Preview Prota */}
            {tabView === 'preview-prota' && (
              <div className="overflow-x-auto">
                <table className="text-[9px] border-collapse w-full">
                  <thead>
                    <tr className="bg-[#4a1263] text-white">
                      <th className="border border-[#4a1263] p-2 text-center">Semester</th>
                      <th className="border border-[#4a1263] p-2">Elemen</th>
                      <th className="border border-[#4a1263] p-2">Materi</th>
                      <th className="border border-[#4a1263] p-2">Tujuan Pembelajaran</th>
                      <th className="border border-[#4a1263] p-2 text-center">Alokasi Waktu (JP)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {protaRowsFull.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-400">Pilih Guru, Mapel, dan Kelas untuk melihat preview</td>
                      </tr>
                    ) : (
                      <>
                        {(['ganjil', 'genap'] as const).map(sem => {
                          const rs = protaRowsFull.filter(r => r.semester === sem)
                          if (rs.length === 0) return null
                          const total = rs.reduce((a, r) => a + (r.jp || 0), 0)
                          const cap = sem === 'ganjil' ? capJpSem1 : capJpSem2
                          return (
                            <Fragment key={sem}>
                              {rs.map((r, i) => (
                                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#6A197D]/10'}>
                                  <td className="border border-slate-200 p-1.5 text-center font-bold text-[#6A197D]">
                                    {i === 0 ? (sem === 'ganjil' ? 'Semester 1' : 'Semester 2') : ''}
                                  </td>
                                  <td className="border border-slate-200 p-1.5 font-semibold text-[#6A197D]">{r.elemen}</td>
                                  <td className="border border-slate-200 p-1.5">{r.materiNama}</td>
                                  <td className="border border-slate-200 p-1.5">{r.tpNomor ? `${r.tpNomor} — ` : ''}{r.tpDeskripsi}</td>
                                  <td className="border border-slate-200 p-1.5 text-center font-bold">{r.jp} JP</td>
                                </tr>
                              ))}
                              <tr className="bg-[#6A197D]/8 font-black">
                                <td colSpan={4} className="border border-slate-200 p-2 text-right text-[#5b1774]">
                                  JUMLAH {sem === 'ganjil' ? 'SEMESTER 1' : 'SEMESTER 2'}
                                </td>
                                <td className={`border border-slate-200 p-2 text-center ${total > cap ? 'text-rose-700' : 'text-[#4a1263]'}`}>
                                  {total} / {cap} JP
                                </td>
                              </tr>
                            </Fragment>
                          )
                        })}
                      </>
                    )}
                  </tbody>
                </table>

                {protaRowsFull.length > 0 && (
                  <div className="mt-6 grid grid-cols-2 gap-8 text-[10px]">
                    <div className="space-y-1">
                      <p>Mengetahui,</p>
                      <p className="font-bold">Kepala Sekolah / Pimpinan,</p>
                      <div className="h-12" />
                      <p className="font-bold">{profil.namaKepala || '(Nama Kepala Sekolah)'}</p>
                      <p>NUPTK: {profil.nip || '-'}</p>
                    </div>
                    <div className="space-y-1 text-right">
                      <p>{resolveTitiMangsa(profil)}</p>
                      <p className="font-bold">Guru Mata Pelajaran,</p>
                      <div className="h-12" />
                      <p className="font-bold">{guruTerpilih?.nama || '(Nama Guru)'}</p>
                      <p>NUPTK: {guruTerpilih?.nip || '-'}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tabView === 'preview-promes1' && renderPreviewPromes('ganjil')}
            {tabView === 'preview-promes2' && renderPreviewPromes('genap')}

            {(tabView === 'preview-promes1' || tabView === 'preview-promes2') && protaRowsFull.length > 0 && (
              <div className="mt-6 grid grid-cols-2 gap-8 text-[10px]">
                <div className="space-y-1">
                  <p>Mengetahui,</p>
                  <p className="font-bold">Kepala Sekolah / Pimpinan,</p>
                  <div className="h-12" />
                  <p className="font-bold">{profil.namaKepala || '(Nama Kepala Sekolah)'}</p>
                  <p>NUPTK: {profil.nip || '-'}</p>
                </div>
                <div className="space-y-1 text-right">
                  <p>{resolveTitiMangsa(profil)}</p>
                  <p className="font-bold">Guru Mata Pelajaran,</p>
                  <div className="h-12" />
                  <p className="font-bold">{guruTerpilih?.nama || '(Nama Guru)'}</p>
                  <p>NUPTK: {guruTerpilih?.nip || '-'}</p>
                </div>
              </div>
            )}
          </fieldset>
        </section>

        {/* ── CATATAN LOGIKA ── */}
        <section className="bg-[#FFDE59]/25 border border-[#FFDE59] rounded-2xl p-5 text-xs text-[#4a1263] space-y-2">
          <p className="font-black">ℹ️ Catatan Logika Pengisian Prota &amp; Promes</p>
          <ul className="space-y-1 list-disc pl-4 font-medium">
            <li>Elemen, Materi, Tujuan Pembelajaran, dan <strong>Semester</strong> diambil otomatis dari halaman <strong>CP, TP &amp; ATP</strong> (tab ATP) sesuai Mapel dan tingkat kelas yang dipilih — semester ditentukan lewat tombol Ganjil/Genap pada tiap kartu ATP di sana. Guru hanya mengisi <strong>Alokasi Waktu (JP)</strong> di halaman ini.</li>
            <li>Total JP yang diisi per semester divalidasi terhadap <strong>kapasitas minggu efektif</strong> (jumlah minggu efektif × JP/minggu dari Jadwal Pelajaran) — akan diberi peringatan merah jika melebihi.</li>
            <li>Di Promes, sel minggu berwarna <strong>hitam</strong> jika minggu tidak efektif untuk lembaga <em>dan</em> tidak efektif untuk mapel (tidak ada hari mengajar yang lolos dari hari libur). Berwarna <strong>abu-abu</strong> jika tidak efektif untuk lembaga tapi tetap ada hari mengajar yang efektif untuk mapel. Selain itu berwarna putih/normal.</li>
            <li>Pada minggu yang masih ada kapasitas mengajar, dituliskan <strong>jumlah JP riil</strong> (dihitung per hari dari Jadwal Pelajaran, dikurangi hari yang bertepatan dengan hari libur), lalu JP tiap TP didistribusikan berurutan ke minggu-minggu tsb sampai habis.</li>
            <li>Data hari libur diambil dari <strong>Kalender Pendidikan</strong> (modul Kaldik). Data jam mengajar &amp; JP per hari diambil dari <strong>Jadwal Pelajaran</strong>. Pastikan kedua data tersebut sudah diisi.</li>
          </ul>
        </section>
      </main>
      <PratinjauPdfModal url={previewUrl} onClose={() => setPreviewUrl(null)} judul="Pratinjau Prota / Promes" />
    </div>
  )
}