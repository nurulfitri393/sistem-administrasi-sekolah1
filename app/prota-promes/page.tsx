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
  mapelRombel?: Record<string, string[]>
  unitIds?: string[]
}

interface Mapel { id: string; nama: string; kode?: string }
interface Rombel { id: string; nama: string; tingkat?: string; kelas?: string; tingkatId?: string }

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
  tingkatTerlibat?: string[]
  rombelTerlibat?: string[]
  tanggalMulai?: string
  nama?: string
  kategoriKlasifikasi?: string
}

interface KlasifikasiAgenda { id: string; label: string; hexColor: string }

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

// Bersihkan karakter yang tidak boleh ada di nama file (filesystem-unsafe),
// tanpa mengubah huruf besar/kecil atau spasi -- nama file tetap mudah dibaca.
// Contoh: "Prota Matematika Kelas 1 2025-2026"
function namaFileAman(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

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

/** Hitung total JP untuk guru-mapel-rombel dari matriks alokasi (fallback jika Jadwal kosong) */
/** Ubah warna hex (mis. "#dc2626") jadi array RGB [r,g,b] yang dipakai jsPDF. */
function hexKeRgb(hex: string): number[] {
  const bersih = hex.replace('#', '')
  const r = parseInt(bersih.substring(0, 2), 16) || 0
  const g = parseInt(bersih.substring(2, 4), 16) || 0
  const b = parseInt(bersih.substring(4, 6), 16) || 0
  return [r, g, b]
}

function hitungTotalJp(strAlokasi: string): number {
  if (!strAlokasi) return 0
  return strAlokasi
    .split(',')
    .map(x => Number(x.trim()))
    .filter(n => !isNaN(n) && n > 0)
    .reduce((a, b) => a + b, 0)
}

// Event kaldik berlaku untuk kelas/rombel tsb? Kalau event menargetkan ROMBEL
// atau TINGKAT tertentu secara eksplisit (dicentang di halaman Kaldik), itu
// sinyal paling akurat dan dicek DULUAN -- tidak lagi disyaratkan lolos cek
// lembagaTerlibat lebih dulu, karena id rombel/tingkat sudah unik & spesifik
// (dan data lembagaTerlibat/Master Tingkat kadang tidak lengkap/tidak sinkron
// -- kalau tetap disyaratkan, event yang sudah benar menyasar kelas tertentu
// bisa gagal ke-scope hanya gara-gara field lembaga-nya tidak sinkron).
// Field lembagaTerlibat HANYA dipakai sebagai fallback saat event tidak
// menargetkan rombel/tingkat spesifik apapun (berlaku utk seluruh unit).
function agendaBerlakuUntukKelas(ev: KaldikEvent, unitId: string, rombel?: { id: string; tingkatId: string }): boolean {
  if (ev.rombelTerlibat && ev.rombelTerlibat.length > 0) {
    return rombel ? ev.rombelTerlibat.includes(rombel.id) : false
  }
  if (ev.tingkatTerlibat && ev.tingkatTerlibat.length > 0) {
    return rombel ? ev.tingkatTerlibat.includes(rombel.tingkatId) : false
  }
  return !!ev.lembagaTerlibat?.includes(unitId)
}

/** Cari rombel lain di TINGKAT yang sama yang jadwalnya (himpunan hari mengajar guru+mapel
 *  ini) PERSIS SAMA dengan rombel terpilih -- dipakai supaya Analisis Alokasi Waktu, Prota
 *  & Promes cukup dibuat SATU dokumen gabungan kalau beberapa kelas sejenjang benar-benar
 *  diajar di hari yang sama persis (mis. 1A & 1B sama-sama Rabu), dan tetap dipisah kalau
 *  himpunan harinya beda walau SEBAGIAN hari kebetulan sama (mis. 2A Senin+Kamis vs
 *  2B Senin+Rabu -- sama-sama Senin tapi pertemuan ke-2 beda hari, jadi TIDAK digabung).
 *  Hasil selalu memuat rombel terpilih sendiri, terurut alfabetis. */
// Ambil ANGKA/ROMAWI kelas dari nama rombel (mis. "6-1" -> "6", "5-2" -> "5", "VII B" ->
// "VII") -- dipakai cariRombelSejadwal untuk memastikan penggabungan kelas HANYA terjadi
// antar kelas dengan TINGKAT/ANGKA KELAS YANG BENAR-BENAR SAMA. Tidak bisa mengandalkan
// tingkatId semata: granularitas Tingkat diatur bebas oleh Admin (mis. satu Tingkat
// "Fase C" bisa saja mencakup kelas 5 DAN 6 sekaligus), jadi dua kelas beda angka bisa
// kebetulan sama tingkatId-nya.
function angkaKelasDariNamaRombel(nama: string): string {
  if (!nama) return ''
  const bersih = String(nama).trim().toUpperCase()
  const angka = bersih.match(/^(\d{1,2})/)
  if (angka) return angka[1]
  const romawi = bersih.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/)
  if (romawi) return romawi[1]
  return ''
}

function cariRombelSejadwal(
  guruId: string,
  mapelId: string,
  rombelId: string,
  daftarRombel: Rombel[],
  daftarJadwal: { guruId: string; mapelId: string; rombelId: string; hari: string }[],
): Rombel[] {
  const rombel = daftarRombel.find(r => r.id === rombelId)
  if (!rombel) return []
  if (!guruId || !mapelId) return [rombel]

  const hariSet = (rid: string): Set<string> => new Set(
    daftarJadwal.filter(j => j.guruId === guruId && j.mapelId === mapelId && j.rombelId === rid).map(j => j.hari)
  )
  const hariSama = (a: Set<string>, b: Set<string>): boolean =>
    a.size > 0 && a.size === b.size && [...a].every(h => b.has(h))

  const hariRombelIni = hariSet(rombelId)
  if (hariRombelIni.size === 0) return [rombel]

  // Kandidat penggabungan HARUS kelas dengan angka/tingkat yang SAMA PERSIS (mis. "6-1"
  // dan "6-2" sama-sama "kelas 6" -> boleh digabung; "5-1" dan "6-1" beda angka kelas ->
  // TIDAK BOLEH digabung meski kebetulan jadwal mengajarnya di hari yang sama). Diprioritaskan
  // dari angka/romawi di awal NAMA rombel-nya sendiri -- kalau namanya tidak mengikuti pola
  // yang dikenali (jadi tidak bisa dipastikan sama/beda kelas), turun ke tingkatId sebagai
  // cadangan supaya perilaku lama tetap jalan untuk data yang penamaannya tidak baku.
  const kelasRombelIni = angkaKelasDariNamaRombel(rombel.nama)
  const kandidat = kelasRombelIni
    ? daftarRombel.filter(r => angkaKelasDariNamaRombel(r.nama) === kelasRombelIni)
    : (rombel.tingkatId ? daftarRombel.filter(r => r.tingkatId === rombel.tingkatId) : [rombel])
  const gabungan = kandidat.filter(r => r.id === rombelId || hariSama(hariSet(r.id), hariRombelIni))
  gabungan.sort((a, b) => a.nama.localeCompare(b.nama))
  return gabungan
}

// Ganti bagian angka/tingkat di AWAL nama rombel dengan "Nama Kelas Resmi" yang
// DIKETIK LANGSUNG oleh Admin di Master Tingkat Kelas (Dashboard), mis. Tingkat "1"
// (internal SMP) diisi Admin "7" -> rombel "1-1" tampil "7-1". HANYA dipakai saat
// dokumen sedang dilihat/dicetak atas nama Lembaga Unit (bukan Lembaga Pusat).
// TIDAK ADA tebakan/konversi otomatis (mis. +6) -- kalau Admin tidak mengisi "Nama
// Kelas Resmi" utk Tingkat rombel ybs, nama ditampilkan apa adanya tanpa diubah,
// supaya penamaan khusus apapun yang dipakai sekolah tidak salah tebak. Bagian nama
// SETELAH angka/tingkat (mis. "-1" pada "1-1") tidak diubah sama sekali.
function konversiNamaKelasResmi(rombel: { nama: string; tingkatId?: string } | undefined, daftarTingkat: any[], tampilkanResmi: boolean): string {
  const nama = rombel?.nama || ''
  if (!tampilkanResmi || !nama) return nama
  const tingkat = daftarTingkat.find((tt: any) => tt.id === rombel?.tingkatId)
  if (!tingkat?.namaResmi) return nama
  const cocok = String(nama).match(/^(\d{1,2}|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(.*)$/i)
  if (!cocok) return nama
  return `${tingkat.namaResmi}${cocok[2]}`
}

/** Gabungkan nama-nama rombel jadi satu label: "1A" / "1A dan 1B" / "1A, 1B, dan 1C". */
function labelKelasGabungan(rombelList: Rombel[], daftarTingkat: any[], tampilkanResmi = false): string {
  const nama = rombelList.map(r => konversiNamaKelasResmi(r, daftarTingkat, tampilkanResmi)).filter(Boolean)
  if (nama.length <= 1) return nama[0] || ''
  if (nama.length === 2) return `${nama[0]} dan ${nama[1]}`
  return `${nama.slice(0, -1).join(', ')}, dan ${nama[nama.length - 1]}`
}

/** Bangun set hari libur dari events kaldik -- HANYA yang berstatus 'libur'
 *  (event berstatus 'efektif', mis. Ujian/MPLS yang tetap ada KBM, TIDAK
 *  mengurangi hari efektif), sama seperti aturan di halaman Minggu Efektif. */
function buildHariLiburSet(events: KaldikEvent[]): Set<string> {
  const set = new Set<string>()
  events.forEach(ev => {
    if (ev.statusHari !== 'libur') return
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
  blokHarian: number[]      // rincian JP per HARI mengajar yang efektif minggu ini (mis. [2,3] utk
                             // Senin 2 JP + Rabu 3 JP, keduanya masuk) -- dipakai supaya alokasi JP
                             // per baris TP di Promes selalu mengambil satu hari PENUH sekaligus
                             // (2 atau 3), tidak pernah pecahan sisa sembarangan.
  warnaKegiatan?: string    // warna klasifikasi kegiatan Kaldik yang paling banyak muncul minggu ini (kalau tidak efektif)
  kegiatan?: string         // nama/keterangan kegiatan Kaldik yang membuat minggu ini tidak efektif
}

/** Bangun peta tanggal -> {warna, keterangan} kegiatan Kaldik, dari daftar event
 *  + daftar klasifikasinya -- dipakai supaya warna DAN nama kegiatan minggu "tidak
 *  efektif" di Promes SAMA PERSIS dengan yang tertulis di Kaldik, bukan abu-abu
 *  generik tanpa keterangan. */
function buildInfoKegiatanPerTanggal(events: KaldikEvent[], daftarKlasifikasi: KlasifikasiAgenda[]): Map<string, { warna: string; keterangan: string }> {
  const map = new Map<string, { warna: string; keterangan: string }>()
  events.forEach(ev => {
    const mulai = ev.tanggalMulai || ev.tanggal
    const selesai = ev.tanggalSelesai || mulai
    if (!mulai) return
    const warna = daftarKlasifikasi.find(k => k.id === ev.kategoriKlasifikasi)?.hexColor || '#4b5563'
    let cur = parseDate(mulai)
    const end = parseDate(selesai)
    while (cur <= end) {
      map.set(toDateStr(cur), { warna, keterangan: ev.keterangan })
      cur = addDays(cur, 1)
    }
  })
  return map
}

// Bulan "pemilik" sebuah minggu Senin-Jumat ditentukan oleh bulan tempat hari RABU jatuh
// (konsisten dengan getBulanMingguFromSenin di halaman Minggu Efektif).
function bulanPemilikMinggu(senin: Date): { tahun: number; bulan: number } {
  const rabu = addDays(senin, 2)
  return { tahun: rabu.getFullYear(), bulan: rabu.getMonth() }
}

/** Posisi minggu ke-N di dalam bulan (1..5), dihitung dari kalender bulan itu sendiri --
 *  BUKAN dari urutan kemunculan minggu di dalam rentang semester. Ini penting supaya kalau
 *  semester baru mulai di tengah bulan (mis. pertengahan Juli), minggu pertama yang benar-benar
 *  masuk rentang semester tetap diberi label sesuai posisi kalendernya (mis. "minggu ke-3"),
 *  bukan dipaksa jadi "minggu ke-1" -- yang akan membuat data (termasuk warna kegiatan Kaldik)
 *  tergeser ke kolom yang salah dan kolom-kolom terakhir bulan itu jadi hitam keliru. */
function mingguKeDalamBulan(senin: Date): number {
  const target = bulanPemilikMinggu(senin)
  let idx = 1
  let cur = senin
  for (;;) {
    const prev = addDays(cur, -7)
    const pemilik = bulanPemilikMinggu(prev)
    if (pemilik.tahun === target.tahun && pemilik.bulan === target.bulan) {
      idx++
      cur = prev
    } else break
  }
  return idx
}

/** Untuk Promes: hitung, per bulan dalam satu semester, status tiap minggu (efektif utk lembaga
 *  atau tidak) SEKALIGUS kapasitas JP riil minggu itu berdasarkan jadwal harian guru/mapel/kelas
 *  terpilih (jpPerHari) dikurangi hari-hari yang bertepatan dengan hari libur. */
function hitungMingguKapasitas(
  tanggalMulai: string,
  tanggalSelesai: string,
  hariLiburSet: Set<string>,
  jpPerHari: Record<number, number>,
  infoPerTanggal?: Map<string, { warna: string; keterangan: string }>,
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
      // Dihitung per NAMA kegiatan (keterangan), bukan per warna -- supaya kalau ada
      // dua kegiatan berbeda dengan warna sama, nama yang ditampilkan tetap kegiatan
      // yang paling banyak menutupi hari-hari minggu itu.
      const kegiatanHitungan = new Map<string, { warna: string; count: number }>()
      hariDlm.forEach(h => {
        if (hariLiburSet.has(toDateStr(h))) {
          hariLibur++
          const info = infoPerTanggal?.get(toDateStr(h))
          if (info) {
            const cur = kegiatanHitungan.get(info.keterangan)
            kegiatanHitungan.set(info.keterangan, { warna: info.warna, count: (cur?.count || 0) + 1 })
          }
        }
      })
      const efektifLembaga = hariLibur <= 2
      // Kegiatan yang dipakai (nama + warna) = kegiatan yang paling banyak muncul di minggu ini.
      let warnaKegiatan: string | undefined
      let kegiatan: string | undefined
      let maxCount = 0
      kegiatanHitungan.forEach((v, nama) => { if (v.count > maxCount) { maxCount = v.count; warnaKegiatan = v.warna; kegiatan = nama } })

      let capacityJp = 0
      const blokHarian: number[] = []
      Object.keys(jpPerHari).map(Number).sort((a, b) => a - b).forEach(hariNum => {
        const tgl = addDays(senin, hariNum - 1)
        if (tgl >= mulai && tgl <= selesai && !hariLiburSet.has(toDateStr(tgl))) {
          capacityJp += jpPerHari[hariNum] || 0
          if (jpPerHari[hariNum]) blokHarian.push(jpPerHari[hariNum])
        }
      })

      const pemilik = bulanPemilikMinggu(senin)
      const bulanKey = `${pemilik.tahun}-${String(pemilik.bulan + 1).padStart(2, '0')}`
      if (!hasil[bulanKey]) hasil[bulanKey] = []
      hasil[bulanKey].push({ mingguKe: mingguKeDalamBulan(senin), efektifLembaga, capacityJp, blokHarian, warnaKegiatan, kegiatan })
    }
    senin = addDays(senin, 7)
  }

  return hasil
}

type StatusMinggu = 'normal' | 'abu' | 'hitam' | 'tidak-ada'
function klasifikasiMinggu(w: MingguKapasitas | undefined): StatusMinggu {
  if (!w) return 'tidak-ada'
  if (w.efektifLembaga) return 'normal'
  return w.capacityJp > 0 ? 'abu' : 'hitam'
}

interface WeekFlat { key: string; bulan: string; mingguKe: number; status: StatusMinggu; capacityJp: number; blokHarian: number[] }

/** Distribusikan JP tiap baris TP (berurutan) ke minggu-minggu yang tersedia (weeksFlat), secara
 *  berurutan, memenuhi kapasitas tiap minggu sebelum lanjut ke minggu berikutnya.
 *
 *  Diambil per HARI MENGAJAR UTUH (blokHarian, mis. 2 atau 3 JP), BUKAN per satuan JP tunggal --
 *  supaya angka yang tampil di tiap sel minggu di Promes SELALU salah satu dari nilai JP per-hari
 *  jadwal aslinya (mis. selalu 2 atau 3, sesuai hari mana yang efektif minggu itu), tidak pernah
 *  pecahan sisa acak (mis. "1") yang tidak sesuai jadwal hari manapun -- satu hari mengajar tidak
 *  bisa "dipotong setengah" untuk disambung ke Tujuan Pembelajaran lain. Konsekuensinya, total JP
 *  yang benar-benar teralokasi untuk satu baris TP bisa sedikit LEBIH dari angka JP yang diisi di
 *  form (dibulatkan ke atas ke hari terakhir yang dipakai), sama seperti satu jam pelajaran nyata
 *  yang tetap dipakai penuh walau materi selesai lebih cepat. */
function distribusikanJp(
  weeksFlat: WeekFlat[],
  rows: { id: string; jp: number }[],
): { alokasi: Record<string, Record<string, number>>; totalDialokasikan: number } {
  const alokasi: Record<string, Record<string, number>> = {}
  let wi = 0
  let sisaBlok: number[] = [...(weeksFlat[0]?.blokHarian || [])]
  let totalDialokasikan = 0

  for (const row of rows) {
    let need = row.jp || 0
    alokasi[row.id] = {}
    while (need > 0 && wi < weeksFlat.length) {
      if (sisaBlok.length === 0) {
        wi++
        sisaBlok = [...(weeksFlat[wi]?.blokHarian || [])]
        continue
      }
      const blok = sisaBlok.shift() as number
      alokasi[row.id][weeksFlat[wi].key] = (alokasi[row.id][weeksFlat[wi].key] || 0) + blok
      need -= blok
      totalDialokasikan += blok
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
    rowsOut.push([label])
    if (rs.length === 0) {
      rowsOut.push(['', '', '', '(Belum ada Tujuan Pembelajaran untuk semester ini)', ''])
    }
    rs.forEach(r => {
      rowsOut.push([
        '',
        r.elemen,
        r.materiNama,
        `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`,
        r.jp,
      ])
      total += r.jp
    })
    rowsOut.push(['', '', '', `Jumlah Jam Total ${label}`, total])
    rowsOut.push(['', '', '', 'Jumlah Jam Efektif', cap])
    rowsOut.push(['', '', '', 'Jumlah Jam Cadangan', Math.max(0, cap - total)])
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
  rows.forEach(r => {
    const row: (string | number | null)[] = [no++, `${r.elemen} — ${r.materiNama}`, `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`, r.jp]
    bulanList.forEach(bln => {
      const bulanKey = getBulanKey(bln)
      const list = weeksByBulan[bulanKey] || []
      for (let m = 1; m <= 5; m++) {
        const w = list.find(x => x.mingguKe === m)
        if (!w) { row.push(null); continue }
        const status = klasifikasiMinggu(w)
        const jp = alokasiMingguan[r.id]?.[`${bulanKey}::${m}`] || 0
        row.push(status === 'hitam' ? (w.kegiatan || null) : (jp > 0 ? (status === 'abu' ? `${jp} Jp` : jp) : null))
      }
    })
    rowsOut.push(row)
  })

  // "Jumlah Jam Total" HARUS sama persis dengan Prota (jumlah kolom "Jml (JP)" di atas,
  // bukan capJpEfektif/totalDialokasikan) -- lihat catatan di buildDataPromes/totalJpNominal.
  const totalJpNominal = rows.reduce((a, r) => a + (r.jp || 0), 0)
  const jpCadangan = Math.max(0, capJpEfektif - totalJpNominal)
  rowsOut.push([])
  rowsOut.push(['', '', `Jumlah Jam Total Semester ${semLabel}`, totalJpNominal])
  rowsOut.push(['', '', 'Jumlah Jam Efektif', capJpEfektif])
  rowsOut.push(['', '', 'Jumlah Jam Cadangan', jpCadangan])
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

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const mL = 16, mR = 16
  const contentWidth = pageW - mL - mR
  let curY = 16

  // ── JUDUL & IDENTITAS ── format disamakan dengan halaman Analisis Alokasi
  // Waktu: judul tebal rata tengah, lalu baris identitas "Label : Value",
  // ditutup satu garis pemisah -- tanpa kop nama sekolah besar/alamat terpisah.
  doc.setFontSize(13); doc.setFont('times', 'bold'); doc.setTextColor(15, 23, 42)
  doc.text('PROGRAM TAHUNAN', pageW / 2, curY, { align: 'center' }); curY += 8

  doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(15, 23, 42)
  const labelWProta = 44
  const barisIdentitasProta = (label: string, value: string) => {
    doc.text(label, mL, curY)
    const lines = doc.splitTextToSize(`: ${value || ''}`, contentWidth - labelWProta)
    doc.text(lines, mL + labelWProta, curY)
    curY += lines.length * 4.6
  }
  barisIdentitasProta('Satuan Pendidikan', profil.namaSekolah || '')
  barisIdentitasProta('Mata Pelajaran', namaMapel)
  barisIdentitasProta('Kelas / Rombel', namaKelas)
  barisIdentitasProta('Tahun Ajaran', tahunAjaran)
  barisIdentitasProta('Guru Mata Pelajaran', namaGuru)
  curY += 3

  doc.setLineWidth(0.5); doc.setDrawColor(0, 0, 0)
  doc.line(mL, curY, pageW - mR, curY); curY += 5

  type Cell = string | { content: string; styles: Record<string, unknown> }
  const body: Cell[][] = []
  // Rentang baris [mulai, akhir] (indeks di `body`, inklusif) yang kolom Semester-nya
  // harus terlihat "menyatu" (Semester 1/2 ditulis sekali di baris `mulai`, kosong di
  // baris-baris sesudahnya sampai `akhir`). TIDAK pakai rowSpan bawaan jspdf-autotable
  // (itu penyebab tabel "meloncat" ke halaman baru dengan banyak ruang kosong & garis
  // hilang kalau sel gabungan kepotong halaman -- persis seperti dilaporkan) -- dibuat
  // sendiri lewat willDrawCell di bawah, dengan render dua tahap supaya batas halaman
  // yang sesungguhnya selalu tahu persis (garis di ujung halaman tidak pernah hilang).
  const rentangSemester: { mulai: number; akhir: number }[] = []
  const tulisSemester = (semester: 'ganjil' | 'genap', label: string, cap: number) => {
    const rs = rows.filter(r => r.semester === semester)
    let total = 0
    const mulai = body.length
    if (rs.length === 0) {
      body.push([label, '', '', { content: '(Belum ada Tujuan Pembelajaran untuk semester ini)', styles: { textColor: [0, 0, 0] as unknown as string } }, ''])
    }
    rs.forEach((r, i) => {
      body.push([
        i === 0 ? label : '',
        r.elemen, r.materiNama, `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`, `${r.jp} JP`,
      ])
      total += r.jp
    })
    const cadangan = Math.max(0, cap - total)
    body.push(['', '', '', { content: `Jumlah Jam Total ${label}`, styles: { halign: 'right' as unknown as string } },
      { content: `${total} JP`, styles: { textColor: [0, 0, 0] as unknown as string } }])
    body.push(['', '', '', { content: 'Jumlah Jam Efektif', styles: { halign: 'right' as unknown as string } },
      { content: `${cap} JP`, styles: {} }])
    body.push(['', '', '', { content: 'Jumlah Jam Cadangan', styles: { halign: 'right' as unknown as string } },
      { content: `${cadangan} JP`, styles: {} }])
    rentangSemester.push({ mulai, akhir: body.length - 1 })
    // Baris kosong pemisah antar-semester -- di LUAR rentang gabungan di atas.
    body.push(['', '', '', '', ''])
  }
  tulisSemester('ganjil', 'Semester 1', capJpSem1)
  tulisSemester('genap', 'Semester 2', capJpSem2)

  // Lebar kolom dihitung persis dari contentWidth supaya tabel TIDAK PERNAH melebihi
  // lebar halaman (penyebab teks tumpang tindih / terpotong pada cetakan sebelumnya).
  // Semester & Alokasi Waktu (JP) dilebarkan supaya kata-katanya tidak terpenggal.
  const wSemester = 30, wElemen = 24, wMateri = 24, wJp = 30
  const wTp = contentWidth - (wSemester + wElemen + wMateri + wJp)

  const headProta = [['Semester', 'Elemen', 'Materi', 'Tujuan Pembelajaran', 'Alokasi Waktu (JP)']]
  const headStylesProta = { font: 'times', fillColor: [237, 227, 243] as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: 'bold' as const, fontSize: 14, halign: 'center' as const, valign: 'middle' as const, cellPadding: 3.5, lineColor: [0, 0, 0] as [number, number, number], lineWidth: 0.15 }
  const bodyStylesProta = { font: 'times', fontSize: 12, valign: 'middle' as const, overflow: 'linebreak' as const, cellPadding: 3.2, lineColor: [0, 0, 0] as [number, number, number], lineWidth: 0.15, textColor: [0, 0, 0] as [number, number, number], fillColor: [255, 255, 255] as [number, number, number] }
  const columnStylesProta = {
    0: { cellWidth: wSemester, textColor: [0, 0, 0] as unknown as string },
    1: { cellWidth: wElemen },
    2: { cellWidth: wMateri },
    3: { cellWidth: wTp },
    4: { cellWidth: wJp, halign: 'center' as const },
  }

  // ── TAHAP 1: render UJI COBA ke dokumen sementara, cuma untuk tahu baris ke-i
  // benar-benar jatuh di halaman berapa -- supaya TAHAP 2 di bawah bisa memutuskan
  // sembunyikan garis atas/bawah kolom Semester dengan akurat (tidak menebak dari
  // data doang), persis pola yang sudah terbukti benar di halaman CP/TP/ATP.
  const halamanBarisProta: number[] = []
  const docUjiProta = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  autoTable(docUjiProta, {
    startY: curY, theme: 'plain', head: headProta, body,
    headStyles: headStylesProta, bodyStyles: bodyStylesProta, columnStyles: columnStylesProta,
    tableWidth: contentWidth, margin: { left: mL, right: mR },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.row.index >= 0) halamanBarisProta[data.row.index] = data.pageNumber
    },
  })

  autoTable(doc, {
    startY: curY,
    // theme 'plain' MATIKAN zebra-stripe bawaan jspdf-autotable (theme default
    // 'striped' tetap memberi warna selang-seling walau bodyStyles.fillColor
    // sudah diisi putih) -- badan tabel putih polos, ungu HANYA di header.
    theme: 'plain',
    head: headProta,
    body,
    headStyles: headStylesProta,
    bodyStyles: bodyStylesProta,
    columnStyles: columnStylesProta,
    tableWidth: contentWidth,
    margin: { left: mL, right: mR },
    // Kolom Semester dibuat terlihat menyatu dari baris label sampai baris "Jumlah Jam
    // Cadangan" -- garis atas/bawahnya cuma disembunyikan kalau baris tetangganya masih
    // di RENTANG yang sama DAN benar-benar di HALAMAN yang sama (bukan cuma kebetulan
    // sama-sama kosong), supaya garis di ujung halaman tidak pernah hilang.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    willDrawCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 0) return
      const i = data.row.index
      if (i < 0) return
      const rentangIni = rentangSemester.find(r => i >= r.mulai && i <= r.akhir)
      if (!rentangIni) return
      const bukanAwal = i > rentangIni.mulai && halamanBarisProta[i - 1] === halamanBarisProta[i]
      const bukanAkhir = i < rentangIni.akhir && halamanBarisProta[i + 1] === halamanBarisProta[i]
      data.cell.styles.lineWidth = {
        top: bukanAwal ? 0 : 0.15,
        bottom: bukanAkhir ? 0 : 0.15,
        left: 0.15,
        right: 0.15,
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawPage: (data: any) => {
      doc.setFontSize(8.5); doc.setFont('times', 'italic'); doc.setTextColor(148, 163, 184)
      doc.text(`Program Tahunan — ${namaMapel} — ${namaKelas} — ${tahunAjaran}   |   Hal. ${data.pageNumber}`,
        pageW / 2, pageH - 6, { align: 'center' })
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY: number = (doc as any).lastAutoTable?.finalY || 200
  const ttdY = finalY + 10 > pageH - 55 ? (() => { doc.addPage(); return 20 })() : finalY + 10

  const titiMangsa = resolveTitiMangsa(profil)
  const ttdColW = 60

  // Blok KIRI (Kepala Sekolah/Pimpinan) tetap di sisi KIRI halaman, blok KANAN
  // (Guru Mapel) tetap di sisi KANAN -- tapi teks di dalam masing-masing kolom
  // rata TENGAH (center) terhadap lebar kolomnya sendiri, bukan rata kiri/kanan
  // mentah, supaya blok tanda tangan terlihat rapi di tengah "ruang"-nya.
  const ttdKiriTengah = mL + ttdColW / 2
  doc.setFont('times', 'normal'); doc.setFontSize(9); doc.setTextColor(15, 23, 42)
  doc.text('Mengetahui,', ttdKiriTengah, ttdY, { align: 'center' })
  doc.text('Kepala Sekolah / Pimpinan,', ttdKiriTengah, ttdY + 5, { align: 'center' })
  doc.setFont('times', 'bold')
  const namaKepalaLines = doc.splitTextToSize(profil.namaKepala || '(Nama Kepala Sekolah)', ttdColW)
  doc.text(namaKepalaLines, ttdKiriTengah, ttdY + 39, { align: 'center' })
  doc.setFont('times', 'normal'); doc.setFontSize(8.5)
  doc.text(`NUPTK: ${profil.nuptk || profil.nip || '-'}`, ttdKiriTengah, ttdY + 39 + namaKepalaLines.length * 4, { align: 'center' })

  const ttdKananTengah = pageW - mR - ttdColW / 2
  doc.setFont('times', 'normal'); doc.setFontSize(9)
  const titiMangsaLines = doc.splitTextToSize(titiMangsa, ttdColW)
  doc.text(titiMangsaLines, ttdKananTengah, ttdY, { align: 'center' })
  doc.text('Guru Mata Pelajaran,', ttdKananTengah, ttdY + 4 + (titiMangsaLines.length - 1) * 4, { align: 'center' })
  doc.setFont('times', 'bold')
  const namaGuruLines = doc.splitTextToSize(namaGuru || '(Nama Guru)', ttdColW)
  doc.text(namaGuruLines, ttdKananTengah, ttdY + 39, { align: 'center' })
  doc.setFont('times', 'normal'); doc.setFontSize(8.5)
  doc.text(`NUPTK: ${nuptk || '-'}`, ttdKananTengah, ttdY + 39 + namaGuruLines.length * 4, { align: 'center' })

  if (mode === 'preview') {
    const namaFile = `${namaFileAman(`Prota ${namaMapel} ${namaKelas} ${tahunAjaran}`)}.pdf`
    const fileBernama = new File([doc.output('blob')], namaFile, { type: 'application/pdf' })
    return URL.createObjectURL(fileBernama)
  }
  doc.save(`${namaFileAman(`Prota ${namaMapel} ${namaKelas} ${tahunAjaran}`)}.pdf`)
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

  let curY = 14

  // ── JUDUL & IDENTITAS ── format disamakan dengan halaman Analisis Alokasi
  // Waktu: judul tebal rata tengah, lalu baris identitas "Label : Value",
  // ditutup satu garis pemisah -- tanpa kop nama sekolah besar/alamat terpisah.
  doc.setFontSize(13); doc.setFont('times', 'bold'); doc.setTextColor(15, 23, 42)
  doc.text('PROGRAM SEMESTER', pageW / 2, curY, { align: 'center' }); curY += 8

  doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(15, 23, 42)
  const labelWPromes = 40
  const barisIdentitasPromes = (label: string, value: string) => {
    doc.text(label, mL, curY)
    const lines = doc.splitTextToSize(`: ${value || ''}`, contentWidth - labelWPromes)
    doc.text(lines, mL + labelWPromes, curY)
    curY += lines.length * 4.6
  }
  barisIdentitasPromes('Satuan Pendidikan', profil.namaSekolah || '')
  barisIdentitasPromes('Mata Pelajaran', namaMapel)
  barisIdentitasPromes('Kelas', namaKelas)
  barisIdentitasPromes('Semester', semLabel)
  barisIdentitasPromes('Tahun Ajaran', tahunAjaran)
  barisIdentitasPromes('Guru Mata Pelajaran', namaGuru)
  barisIdentitasPromes('Alokasi Waktu', `${alokasiJpPerMinggu} jam/minggu`)
  curY += 1

  doc.setLineWidth(0.5); doc.setDrawColor(0, 0, 0)
  doc.line(mL, curY, pageW - mR, curY); curY += 5.5

  type Cell = string | { content: string; colSpan?: number; rowSpan?: number; styles?: Record<string, unknown> }
  const headRow1: Cell[] = [
    { content: 'No', rowSpan: 2 },
    { content: 'Elemen/Materi', rowSpan: 2 },
    { content: 'Tujuan Pembelajaran', rowSpan: 2 },
    { content: 'Jml\n(JP)', rowSpan: 2 },
  ]
  // Nama bulan digabung (colSpan:5) jadi SATU sel lebar membentang di atas
  // 5 kolom minggunya -- BUKAN didorong ke satu kolom sempit tanpa
  // penggabungan seperti sebelumnya (itu yang menyebabkan nama bulan
  // terpaksa dibungkus huruf demi huruf ke bawah karena kolomnya sempit).
  bulanList.forEach(bln => headRow1.push({ content: bln, colSpan: 5 }))
  const headRow2: Cell[] = []
  bulanList.forEach(() => { for (let i = 1; i <= 5; i++) headRow2.push(String(i)) })
  const body: Cell[][] = []
  let no = 1

  // Status tiap kolom minggu dihitung SEKALI di sini (bukan di dalam loop baris TP) --
  // statusnya murni dari kalender + jadwal mapel ini, TIDAK bergantung baris TP mana pun,
  // jadi sama persis untuk semua baris. Dipakai supaya keterangan kegiatan Kaldik di
  // kolom "hitam" (mis. "Libur Semester") cuma ditulis SEKALI di baris TP pertama, bukan
  // diulang-ulang di setiap baris seperti sebelumnya.
  const statusKolomMinggu: StatusMinggu[] = []
  bulanList.forEach(bln => {
    const bulanKey = getBulanKey(bln)
    const list = weeksByBulan[bulanKey] || []
    for (let m = 1; m <= 5; m++) statusKolomMinggu.push(klasifikasiMinggu(list.find(x => x.mingguKe === m)))
  })

  rows.forEach((r, rowIdx) => {
    const row: Cell[] = [String(no++), `${r.elemen} — ${r.materiNama}`, `${r.tpNomor ? r.tpNomor + ' - ' : ''}${r.tpDeskripsi}`, String(r.jp)]
    let kolomMinggu = 0
    bulanList.forEach(bln => {
      const bulanKey = getBulanKey(bln)
      const list = weeksByBulan[bulanKey] || []
      for (let m = 1; m <= 5; m++) {
        const idxKolomIni = kolomMinggu++
        const w = list.find(x => x.mingguKe === m)
        if (!w) {
          // Minggu ini memang TIDAK ADA di bulan tsb (mis. bulan yang cuma
          // punya 4 minggu efektif, kolom minggu ke-5 tidak ada tanggalnya
          // sama sekali) -- hitamkan penuh, bukan dibiarkan putih kosong.
          row.push({ content: '', styles: { fillColor: [20, 20, 20] as unknown as string } })
          continue
        }
        const status = statusKolomMinggu[idxKolomIni]
        const jp = alokasiMingguan[r.id]?.[`${bulanKey}::${m}`] || 0
        // Minggu tidak efektif ("abu" ATAU "hitam") selalu pakai warna KEGIATAN ASLI
        // dari Kaldik yang membuat minggu itu tidak efektif -- solid hitam pekat
        // HANYA dipakai kalau memang tidak ada info warna kegiatan sama sekali.
        // (Solid hitam untuk kolom minggu yang tidak ada sama sekali dalam rentang
        // semester ditangani terpisah di cabang `!w` di atas.)
        const bg = (status === 'hitam' || status === 'abu')
          ? (w.warnaKegiatan ? hexKeRgb(w.warnaKegiatan) : [30, 30, 30])
          : [255, 255, 255]
        const fg = (status === 'hitam' || status === 'abu') ? [255, 255, 255] : [15, 23, 42]
        // Sebaran jam pelajaran hanya ditulis di minggu yang benar-benar punya kapasitas
        // mengajar (efektif utk mapel, "normal" ATAU "abu"). Minggu "abu" (lembaga tidak
        // efektif tapi sebagian hari mengajar masih lolos) ditulis "X Jp" supaya jelas itu
        // JP yang bisa dicapai minggu itu, bukan alokasi penuh. Minggu "hitam" (kapasitas
        // 0 sama sekali) tidak diisi angka JP -- cukup nama kegiatan Kaldik yang membuat
        // minggu itu tidak efektif, DITULIS SEKALI SAJA di baris TP pertama (rowIdx===0),
        // baris-baris lain dikosongkan & digabung visual lewat willDrawCell di bawah.
        const isiSel = status === 'hitam'
          ? (rowIdx === 0 ? (w.kegiatan || '') : '')
          : (jp > 0 ? (status === 'abu' ? `${jp} Jp` : String(jp)) : '')
        row.push({ content: isiSel, styles: { halign: 'center' as unknown as string, fillColor: bg as unknown as string, textColor: fg as unknown as string, fontSize: (status === 'hitam' || status === 'abu') ? 6 : 11 } })
      }
    })
    body.push(row)
  })

  // "Jumlah Jam Total" HARUS sama persis dengan Prota (jumlah kolom "Jml (JP)" di atas,
  // bukan capJpEfektif/totalDialokasikan) -- lihat catatan di buildDataPromes/totalJpNominal.
  const totalJpNominal = rows.reduce((a, r) => a + (r.jp || 0), 0)
  const jpCadangan = Math.max(0, capJpEfektif - totalJpNominal)
  const nWeekCols = bulanList.length * 5

  // Ringkasan Jumlah Jam dimasukkan sebagai BARIS TABEL (bukan teks lepas di
  // bawah tabel) supaya sama persis dengan pola di Prota, urutan Total -> Efektif -> Cadangan.
  // Kolom-kolom minggu di baris ini digabung jadi SATU sel hitam pekat (bukan
  // dipisah-pisah kosong) karena baris ini memang tidak akan pernah diisi
  // data per-minggu apapun.
  const selKosongHitam = { content: '', colSpan: nWeekCols, styles: { fillColor: [20, 20, 20] as unknown as string } }
  body.push([
    { content: `Jumlah Jam Total ${semLabel}`, colSpan: 3, styles: { halign: 'right' as unknown as string, fontStyle: 'bold' as unknown as string } },
    { content: String(totalJpNominal), styles: { halign: 'center' as unknown as string, fontStyle: 'bold' as unknown as string, textColor: [0, 0, 0] as unknown as string } },
    selKosongHitam,
  ])
  body.push([
    { content: 'Jumlah Jam Efektif', colSpan: 3, styles: { halign: 'right' as unknown as string } },
    { content: String(capJpEfektif), styles: { halign: 'center' as unknown as string } },
    selKosongHitam,
  ])
  body.push([
    { content: 'Jumlah Jam Cadangan', colSpan: 3, styles: { halign: 'right' as unknown as string } },
    { content: String(jpCadangan), styles: { halign: 'center' as unknown as string } },
    selKosongHitam,
  ])

  // Lebar kolom dihitung persis dari contentWidth (bukan angka tetap sembarangan) supaya
  // TOTAL lebar tabel TIDAK PERNAH melebihi lebar halaman — sebelumnya kolom mingguan
  // (hingga 30 kolom × 8mm = 240mm) ditambah kolom tetap bisa jauh melebihi lebar
  // halaman landscape (±273mm), menyebabkan tabel terpotong / teks tumpang tindih.
  // No/Elemen-Materi/Jml(JP) dilebarkan supaya judul kolom & isinya tidak terpenggal
  // (sebelumnya "Elemen/Materi" & "Jml (JP)" pecah huruf-per-huruf karena kolomnya
  // terlalu sempit untuk fontSize 11).
  const wNo = 10, wElemen = 32, wJp = 14
  const wTpTarget = 45
  const remainingForWeeks = contentWidth - (wNo + wElemen + wJp + wTpTarget)
  const wWeek = Math.max(4.2, remainingForWeeks / nWeekCols)
  const wTp = contentWidth - (wNo + wElemen + wJp + wWeek * nWeekCols)

  const lebarKolom: { cellWidth: number; halign?: string }[] = [
    { cellWidth: wNo, halign: 'center' }, { cellWidth: wElemen }, { cellWidth: wTp }, { cellWidth: wJp, halign: 'center' },
  ]
  bulanList.forEach(() => { for (let i = 0; i < 5; i++) lebarKolom.push({ cellWidth: wWeek, halign: 'center' }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columnStylesPromes = lebarKolom.reduce((acc: any, col, idx) => { acc[idx] = col; return acc }, {})
  const headStylesPromes = { font: 'times', fillColor: [237, 227, 243] as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: 'bold' as const, fontSize: 10, halign: 'center' as const, valign: 'middle' as const, cellPadding: 2.8, lineColor: [0, 0, 0] as [number, number, number], lineWidth: 0.1 }
  const bodyStylesPromes = { font: 'times', fontSize: 11, valign: 'middle' as const, overflow: 'linebreak' as const, cellPadding: 2.6, lineColor: [0, 0, 0] as [number, number, number], lineWidth: 0.1, textColor: [0, 0, 0] as [number, number, number], fillColor: [255, 255, 255] as [number, number, number] }

  // ── TAHAP 1: render UJI COBA ke dokumen sementara, cuma untuk tahu baris TP ke-i
  // jatuh di halaman berapa -- dipakai TAHAP 2 di bawah supaya penyembunyian garis
  // atas/bawah kolom minggu "hitam" yang digabung akurat (tidak pernah menghilangkan
  // garis di ujung halaman), persis pola yang sudah terbukti benar di halaman CP/TP/ATP
  // & Prota.
  const halamanBarisPromes: number[] = []
  const docUjiPromes = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  autoTable(docUjiPromes, {
    startY: curY, theme: 'plain', head: [headRow1, headRow2], body,
    headStyles: headStylesPromes, bodyStyles: bodyStylesPromes, columnStyles: columnStylesPromes,
    tableWidth: contentWidth, margin: { left: mL, right: mR },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.row.index >= 0) halamanBarisPromes[data.row.index] = data.pageNumber
    },
  })

  autoTable(doc, {
    startY: curY,
    // theme 'plain' MATIKAN zebra-stripe bawaan jspdf-autotable (theme default
    // 'striped' tetap memberi warna selang-seling walau bodyStyles.fillColor
    // sudah diisi putih) -- badan tabel putih polos, ungu HANYA di header. Kolom
    // minggu tetap bisa berwarna sendiri (warna kegiatan Kaldik) lewat styles per-sel.
    theme: 'plain',
    head: [headRow1, headRow2],
    body,
    headStyles: headStylesPromes,
    bodyStyles: bodyStylesPromes,
    columnStyles: columnStylesPromes,
    tableWidth: contentWidth,
    margin: { left: mL, right: mR },
    // Kolom minggu "hitam" (kalender penuh tidak efektif) dibuat menyatu secara VERTIKAL
    // dari baris TP pertama sampai baris TP terakhir (keterangan kegiatan Kaldik-nya SAMA
    // untuk semua baris, murni ikut kalender -- bukan rowSpan bawaan jspdf-autotable,
    // supaya tidak rawan garis/isi hilang kalau kepotong halaman). Garis atas/bawah cuma
    // disembunyikan kalau baris tetangganya masih baris TP (bukan baris ringkasan) DAN
    // benar-benar di halaman yang sama.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    willDrawCell: (data: any) => {
      if (data.section !== 'body' || data.column.index < 4) return
      const idxKolomMinggu = data.column.index - 4
      if (statusKolomMinggu[idxKolomMinggu] !== 'hitam') return
      const i = data.row.index
      if (i < 0 || i >= rows.length) return
      const barisAtasAdalahTp = i > 0
      const barisBawahAdalahTp = i < rows.length - 1
      const bukanAwal = barisAtasAdalahTp && halamanBarisPromes[i - 1] === halamanBarisPromes[i]
      const bukanAkhir = barisBawahAdalahTp && halamanBarisPromes[i + 1] === halamanBarisPromes[i]
      data.cell.styles.lineWidth = {
        top: bukanAwal ? 0 : 0.1,
        bottom: bukanAkhir ? 0 : 0.1,
        left: 0.1,
        right: 0.1,
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawPage: (data: any) => {
      doc.setFontSize(7.5); doc.setFont('times', 'italic'); doc.setTextColor(148, 163, 184)
      doc.text(`Program Semester ${semLabel} — ${namaMapel} — ${namaKelas} — ${tahunAjaran}   |   Hal. ${data.pageNumber}`,
        pageW / 2, pageH - 4, { align: 'center' })
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let afterTableY: number = (doc as any).lastAutoTable?.finalY || 160
  afterTableY += 8
  if (afterTableY + 30 > pageH - 55) { doc.addPage(); afterTableY = 15 }

  if (afterTableY + 50 > pageH) { doc.addPage(); afterTableY = 15 }
  const titiMangsa = resolveTitiMangsa(profil)
  const ttdColW = 55

  // Blok KIRI (Kepala Sekolah/Pimpinan) tetap di sisi KIRI halaman, blok KANAN
  // (Guru Mapel) tetap di sisi KANAN -- tapi teks di dalam masing-masing kolom
  // rata TENGAH (center) terhadap lebar kolomnya sendiri, bukan rata kiri/kanan
  // mentah, supaya blok tanda tangan terlihat rapi di tengah "ruang"-nya.
  const ttdKiriTengah = mL + ttdColW / 2
  doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(15, 23, 42)
  doc.text('Mengetahui,', ttdKiriTengah, afterTableY, { align: 'center' })
  doc.text('Kepala Sekolah / Pimpinan,', ttdKiriTengah, afterTableY + 4, { align: 'center' })
  doc.setFont('times', 'bold'); doc.setFontSize(10)
  const namaKepalaLines = doc.splitTextToSize(profil.namaKepala || '(Nama Kepala Sekolah)', ttdColW)
  doc.text(namaKepalaLines, ttdKiriTengah, afterTableY + 34, { align: 'center' })
  doc.setFont('times', 'normal'); doc.setFontSize(9.5)
  doc.text(`NUPTK: ${profil.nuptk || profil.nip || '-'}`, ttdKiriTengah, afterTableY + 34 + namaKepalaLines.length * 4, { align: 'center' })

  const ttdKananTengah = pageW - mR - ttdColW / 2
  doc.setFontSize(10)
  const titiMangsaLines = doc.splitTextToSize(titiMangsa, ttdColW)
  doc.text(titiMangsaLines, ttdKananTengah, afterTableY, { align: 'center' })
  doc.text('Guru Mata Pelajaran,', ttdKananTengah, afterTableY + 4 + (titiMangsaLines.length - 1) * 4, { align: 'center' })
  doc.setFont('times', 'bold')
  const namaGuruLines = doc.splitTextToSize(namaGuru || '(Nama Guru)', ttdColW)
  doc.text(namaGuruLines, ttdKananTengah, afterTableY + 34, { align: 'center' })
  doc.setFont('times', 'normal'); doc.setFontSize(9.5)
  doc.text(`NUPTK: ${nuptk || '-'}`, ttdKananTengah, afterTableY + 34 + namaGuruLines.length * 4, { align: 'center' })

  if (mode === 'preview') {
    const namaFile = `${namaFileAman(`Promes ${semLabel} ${namaMapel} ${namaKelas} ${tahunAjaran}`)}.pdf`
    const fileBernama = new File([doc.output('blob')], namaFile, { type: 'application/pdf' })
    return URL.createObjectURL(fileBernama)
  }
  doc.save(`${namaFileAman(`Promes ${semLabel} ${namaMapel} ${namaKelas} ${tahunAjaran}`)}.pdf`)
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
  // Unit-unit tempat Guru yang sedang login ditugaskan (bisa lebih dari satu, mis. guru
  // yang mengajar di SMP DAN SMA) -- dipakai supaya guru dengan penugasan LEBIH dari satu
  // unit tetap bisa BERPINDAH antar unitnya sendiri, bukan terkunci permanen ke unit
  // pertama saja seperti sebelumnya.
  const unitIdsGuruSendiri = useMemo(() => {
    if (!cakupanGuru?.guruId) return []
    return daftarGuru.find(g => g.id === cakupanGuru.guruId)?.unitIds || []
  }, [cakupanGuru, daftarGuru])
  const [daftarMapel, setDaftarMapel] = useState<Mapel[]>([])
  const [daftarRombel, setDaftarRombel] = useState<Rombel[]>([])
  const [matriksJp, setMatriksJp] = useState<Record<string, string>>({})
  const [daftarJadwal, setDaftarJadwal] = useState<{ guruId: string; mapelId: string; rombelId: string; hari: string; waktuId: string }[]>([])
  const [daftarWaktu, setDaftarWaktu] = useState<{ id: string; jenis: string }[]>([])
  const [eventsKaldik, setEventsKaldik] = useState<KaldikEvent[]>([])
  const [daftarKlasifikasiKaldik, setDaftarKlasifikasiKaldik] = useState<KlasifikasiAgenda[]>([])

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
      const skl = localStorage.getItem('kaldik_klasifikasi_list')
      if (skl) setDaftarKlasifikasiKaldik(JSON.parse(skl))

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

  const guruTerpilih = daftarGuru.find(g => g.id === filterGuruId)
  const mapelTerpilih = daftarMapel.find(m => m.id === filterMapelId)
  const rombelTerpilih = daftarRombel.find(r => r.id === filterRombelId)
  const tahunAjaran = semesterGanjil.tahunAjaran

  // Tingkat (master_tingkat) & unit (lembagaId) tempat rombel terpilih berada --
  // dicocokkan lewat tingkatId (field asli yang benar-benar disimpan di master_rombel,
  // sama seperti halaman Jadwal & Minggu Efektif). Name-matching (tt.nama===r.tingkat)
  // dipakai HANYA sbg fallback terakhir untuk data lama yang belum punya tingkatId --
  // field "tingkat" (nama) pada Rombel umumnya TIDAK terisi oleh sumber data yang
  // sebenarnya, jadi mengandalkannya sebagai jalur utama membuat resolusi unit gagal
  // total (lihat catatan di agendaBerlakuUntukKelas).
  const tingkatRombelTerpilih = useMemo(
    () => daftarTingkat.find((tt: any) => tt.id === rombelTerpilih?.tingkatId)
      || daftarTingkat.find((tt: any) => tt.nama === rombelTerpilih?.tingkat),
    [daftarTingkat, rombelTerpilih]
  )
  const unitIdRombelTerpilih = tingkatRombelTerpilih?.lembagaId || ''

  // Kelas lain di tingkat yang sama yang jadwalnya (utk guru+mapel terpilih) persis sama
  // dengan kelas terpilih -- kalau ada, Analisis Alokasi Waktu/Prota/Promes ditampilkan
  // GABUNGAN utk semua kelas itu sekaligus (satu dokumen, label "1A dan 1B"), bukan
  // per-kelas terpisah, karena secara jadwal & kalender mereka memang identik.
  const kelasGabunganTerpilih = useMemo(
    () => cariRombelSejadwal(filterGuruId, filterMapelId, filterRombelId, daftarRombel, daftarJadwal),
    [filterGuruId, filterMapelId, filterRombelId, daftarRombel, daftarJadwal]
  )
  const namaKelasTampil = labelKelasGabungan(kelasGabunganTerpilih.length > 0 ? kelasGabunganTerpilih : (rombelTerpilih ? [rombelTerpilih] : []), daftarTingkat, !!filterUnitId)

  // Kaldik disaring khusus untuk kelas yang sedang dipilih (event yang hanya
  // menyasar kelas/unit lain TIDAK ikut memotong hari efektif kelas ini) --
  // supaya JP efektif di sini SAMA PERSIS dengan Analisis Alokasi Waktu.
  // Kalau kelas terpilih digabung dg kelas lain (jadwal identik, lihat
  // kelasGabunganTerpilih di atas), sebuah tanggal dianggap tidak efektif untuk
  // GABUNGAN ini kalau event Kaldik-nya berlaku utk SALAH SATU anggota gabungan
  // (union) -- bukan cuma kelas yang kebetulan dipilih duluan di dropdown.
  // CATATAN: unitIdRombelTerpilih boleh gagal resolve (mis. Master Tingkat
  // belum lengkap mengaitkan ke unit) -- itu HANYA memengaruhi event yang
  // menyasar seluruh unit tanpa rombel/tingkat spesifik. Event yang sudah
  // eksplisit menyasar rombel/tingkat (spt Fortasi yg dicentang ke rombel
  // tertentu) tetap harus ke-scope dengan benar walau unit gagal resolve --
  // makanya di sini TIDAK di-skip total hanya karena unitIdRombelTerpilih kosong.
  const eventsKaldikScopedKelas = useMemo(() => {
    if (!filterRombelId) return []
    const anggotaGabungan = kelasGabunganTerpilih.length > 0 ? kelasGabunganTerpilih : (rombelTerpilih ? [rombelTerpilih] : [])
    return eventsKaldik.filter(ev => anggotaGabungan.some(r =>
      agendaBerlakuUntukKelas(ev, unitIdRombelTerpilih, { id: r.id, tingkatId: tingkatRombelTerpilih?.id || '' })
    ))
  }, [eventsKaldik, filterRombelId, unitIdRombelTerpilih, rombelTerpilih, tingkatRombelTerpilih, kelasGabunganTerpilih])

  const hariLiburSet = useMemo(() => buildHariLiburSet(eventsKaldikScopedKelas), [eventsKaldikScopedKelas])
  const infoKegiatanPerTanggal = useMemo(() => buildInfoKegiatanPerTanggal(eventsKaldikScopedKelas, daftarKlasifikasiKaldik), [eventsKaldikScopedKelas, daftarKlasifikasiKaldik])

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

  // KAPASITAS JP (batas atas pengisian Prota) — dihitung PRESISI per hari jadwal
  // (jpPerHari x hariLiburSet lewat hitungMingguKapasitas, sama seperti sumber
  // "capacityJp" pada kalender mingguan Promes) supaya SAMA PERSIS dengan
  // "Jumlah Jam Efektif" di halaman Analisis Alokasi Waktu -- BUKAN sekadar
  // jumlah minggu efektif Lembaga dikali rata JP/minggu (bisa berbeda kalau
  // sebagian hari dalam satu minggu kena libur, sebagian tidak).
  const kapasitasMingguanSem1 = useMemo(() =>
    hitungMingguKapasitas(semesterGanjil.tanggalMulai, semesterGanjil.tanggalSelesai, hariLiburSet, jpPerHari),
    [semesterGanjil, hariLiburSet, jpPerHari]
  )
  const kapasitasMingguanSem2 = useMemo(() =>
    hitungMingguKapasitas(semesterGenap.tanggalMulai, semesterGenap.tanggalSelesai, hariLiburSet, jpPerHari),
    [semesterGenap, hariLiburSet, jpPerHari]
  )
  const capJpSem1 = useMemo(() =>
    Object.values(kapasitasMingguanSem1).flat().reduce((a, w) => a + w.capacityJp, 0),
    [kapasitasMingguanSem1]
  )
  const capJpSem2 = useMemo(() =>
    Object.values(kapasitasMingguanSem2).flat().reduce((a, w) => a + w.capacityJp, 0),
    [kapasitasMingguanSem2]
  )

  const totalJpTerisiSem1 = useMemo(() => protaRowsFull.filter(r => r.semester === 'ganjil').reduce((a, r) => a + (r.jp || 0), 0), [protaRowsFull])
  const totalJpTerisiSem2 = useMemo(() => protaRowsFull.filter(r => r.semester === 'genap').reduce((a, r) => a + (r.jp || 0), 0), [protaRowsFull])

  // ── Bangun data mingguan (kapasitas + klasifikasi + distribusi JP) per semester ──
  function buildDataPromes(semester: 'ganjil' | 'genap') {
    const semInfo = semester === 'ganjil' ? semesterGanjil : semesterGenap
    const bulanList = semester === 'ganjil' ? BULAN_SEM1 : BULAN_SEM2
    const weeksByBulan = hitungMingguKapasitas(semInfo.tanggalMulai, semInfo.tanggalSelesai, hariLiburSet, jpPerHari, infoKegiatanPerTanggal)

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
        weeksFlat.push({ key: `${bulanKey}::${w.mingguKe}`, bulan: bln, mingguKe: w.mingguKe, status: klasifikasiMinggu(w), capacityJp: w.capacityJp, blokHarian: w.blokHarian })
      })
    })

    const rows = protaRowsFull.filter(r => r.semester === semester)
    const { alokasi, totalDialokasikan } = distribusikanJp(weeksFlat, rows.map(r => ({ id: r.id, jp: r.jp })))
    const capJpEfektif = semester === 'ganjil' ? capJpSem1 : capJpSem2
    // "Jumlah Jam Total" Promes HARUS sama persis dengan Prota (jumlah JP yang diisi guru
    // per TP di form Prota) -- BUKAN totalDialokasikan. totalDialokasikan bisa lebih besar
    // karena distribusikanJp mengambil JP per HARI MENGAJAR UTUH (blokHarian), jadi baris TP
    // terakhir yang kebagian satu hari mengajar bisa "dibulatkan ke atas" ke kapasitas hari
    // itu (mis. minta 1 JP tapi hari itu kapasitasnya 3 JP, seluruh 3 JP tetap tercatat
    // dipakai hari itu) -- akurat untuk PENJADWALAN per minggu, tapi kalau dipakai sebagai
    // angka "Jumlah Jam Total" bikin Promes tampak beda dari Prota padahal datanya sama.
    const totalJpNominal = rows.reduce((a, r) => a + (r.jp || 0), 0)
    const jpCadangan = Math.max(0, capJpEfektif - totalJpNominal)

    return { semInfo, bulanList, weeksByBulan, weeksFlat, rows, alokasi, totalDialokasikan, totalJpNominal, capJpEfektif, jpCadangan, getBulanKey }
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
        namaKelas: namaKelasTampil || konversiNamaKelasResmi(rombelTerpilih, daftarTingkat, !!filterUnitId),
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
    const { bulanList, weeksByBulan, rows, alokasi, getBulanKey, capJpEfektif, jpCadangan, totalJpNominal } = d

    // Solid hitam sebagai fallback CSS class hanya dipakai kalau minggu tidak efektif
    // itu tidak punya info warna kegiatan Kaldik sama sekali (lihat `gayaWarna` di bawah,
    // yang mengutamakan warna kegiatan asli untuk status 'abu' MAUPUN 'hitam').
    const warnaSel = (status: StatusMinggu) =>
      status === 'hitam' || status === 'abu' ? 'bg-slate-800 text-white' : ''

    return (
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        {filterGuruId && filterMapelId && filterRombelId && (
          <p className="text-[10px] text-slate-600 mb-2">
            <strong>Mata Pelajaran:</strong> {mapelTerpilih?.nama} &nbsp;|&nbsp; <strong>Kelas:</strong> {namaKelasTampil || konversiNamaKelasResmi(rombelTerpilih, daftarTingkat, !!filterUnitId)} &nbsp;|&nbsp; <strong>Semester:</strong> {semester === 'ganjil' ? '1 (Ganjil)' : '2 (Genap)'} &nbsp;|&nbsp; <strong>Tahun Ajaran:</strong> {tahunAjaran} &nbsp;|&nbsp; <strong>Guru:</strong> {guruTerpilih?.nama}
          </p>
        )}
        <table className="text-[9px] border-collapse w-full min-w-[900px]">
          <thead className="sticky top-0 z-10">
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
                <tr key={r.id} className="bg-white">
                  <td className="border border-slate-200 p-1 text-center">{idx + 1}</td>
                  <td className="border border-slate-200 p-1 font-semibold text-[#6A197D]">{r.elemen}{r.materiNama ? ` — ${r.materiNama}` : ''}</td>
                  <td className="border border-slate-200 p-1">{r.tpNomor ? `${r.tpNomor} — ` : ''}{r.tpDeskripsi}</td>
                  <td className="border border-slate-200 p-1 text-center font-bold">{r.jp}</td>
                  {bulanList.map(bln => {
                    const bulanKey = getBulanKey(bln)
                    const list = weeksByBulan[bulanKey] || []
                    return [1, 2, 3, 4, 5].map(m => {
                      const w = list.find(x => x.mingguKe === m)
                      if (!w) return <td key={`${bln}-${m}`} className="border border-slate-200 p-1 bg-[#141414]" />
                      const status = klasifikasiMinggu(w)
                      const jp = alokasi[r.id]?.[`${bulanKey}::${m}`] || 0
                      const gayaWarna = (status === 'abu' || status === 'hitam') && w.warnaKegiatan ? { backgroundColor: w.warnaKegiatan, color: '#fff' } : undefined
                      // Minggu "hitam" (kapasitas 0) tampilkan nama kegiatan Kaldik, bukan
                      // angka JP. Minggu "abu" (masih ada kapasitas sebagian) tampilkan "X Jp".
                      const isiSel = status === 'hitam' ? (w.kegiatan || '') : (jp > 0 ? (status === 'abu' ? `${jp} Jp` : jp) : '')
                      return (
                        <td key={`${bln}-${m}`} style={gayaWarna} className={`border border-slate-200 p-1 text-center font-bold ${!gayaWarna ? warnaSel(status) : ''} ${status === 'hitam' || status === 'abu' ? 'text-[7px] leading-tight' : ''}`}>
                          {isiSel}
                        </td>
                      )
                    })
                  })}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="bg-[#6A197D]/8 font-black text-[9px]">
              <td colSpan={4} className="border border-slate-200 p-1.5 text-right text-[#5b1774]">Jumlah Jam Total Semester {semester === 'ganjil' ? 'Ganjil' : 'Genap'}</td>
              <td colSpan={bulanList.length * 5} className="border border-slate-200 p-1.5 text-[#4a1263] text-xs">{totalJpNominal} JP</td>
            </tr>
            <tr className="bg-slate-50 font-bold text-[9px]">
              <td colSpan={4} className="border border-slate-200 p-1.5 text-right">Jumlah Jam Efektif</td>
              <td colSpan={bulanList.length * 5} className="border border-slate-200 p-1.5 text-[#6A197D] font-black">{capJpEfektif} JP</td>
            </tr>
            <tr className="bg-slate-50 font-bold text-[9px]">
              <td colSpan={4} className="border border-slate-200 p-1.5 text-right">Jumlah Jam Cadangan</td>
              <td colSpan={bulanList.length * 5} className="border border-slate-200 p-1.5 text-[#6A197D]">{jpCadangan} JP</td>
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
                unitIdsGuruSendiri.length > 1 ? (
                  <select value={filterUnitId} onChange={e => setFilterUnitId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-[#6A197D]">
                    {unitIdsGuruSendiri.map((uid: string) => {
                      const u = daftarLembaga.find(l => l.id === uid)
                      return u ? <option key={uid} value={uid}>{u.nama}</option> : null
                    })}
                  </select>
                ) : (
                  <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 font-semibold text-slate-600">
                    {daftarLembaga.find(u => u.id === filterUnitId)?.nama || 'Lembaga Pusat'} <span className="text-[9px] font-normal text-slate-400">(unit Anda)</span>
                  </div>
                )
              ) : (
                <select value={filterUnitId} onChange={e => setFilterUnitId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-[#6A197D]">
                  <option value="">Lembaga Pusat (Mudir)</option>
                  {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
                </select>
              )}
              <p className="text-[9px] text-slate-400 mt-1">
                {unitIdsGuruSendiri.length > 1 ? 'Anda ditugaskan di lebih dari satu unit -- pilih unit yang ingin diisi/dilihat sekarang.' : 'Menentukan Guru/Kelas yang muncul, serta Kepala Sekolah/Mudir di tanda tangan.'}
              </p>
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
                  // PERBAIKAN: field "rombelIds" di data guru TIDAK PERNAH diisi
                  // sama sekali oleh Kelola Data Guru -- yang benar-benar tersimpan
                  // adalah "mapelRombel" (pemetaan per-mapel -> daftar kelas).
                  // Union dari semua kelas di seluruh mapelRombel guru itulah yang
                  // dipakai sebagai daftar kelas yang benar-benar diampu.
                  const rombelIdGuru = new Set<string>()
                  Object.values(guruTerpilih?.mapelRombel || {}).forEach((ids: any) => (ids || []).forEach((id: string) => rombelIdGuru.add(id)))
                  const punyaMappingRombel = rombelIdGuru.size > 0
                  let list = (!filterGuruId || !punyaMappingRombel)
                    ? daftarRombel
                    : daftarRombel.filter(r => rombelIdGuru.has(r.id))
                  if (filterUnitId) {
                    const listTersaring = list.filter(r => {
                      const t = daftarTingkat.find((tt: any) => tt.nama === r.tingkat)
                      return t?.lembagaId === filterUnitId
                    })
                    // Kalau penyaringan per-unit ternyata kosong (mis. data Master
                    // Tingkat belum lengkap mengaitkan ke unit), jangan sampai
                    // dropdown Kelas jadi kosong total -- tampilkan semua kelas
                    // saja sebagai jaga-jaga, lebih baik daripada tidak muncul.
                    if (listTersaring.length > 0) list = listTersaring
                  }
                  return list.map(r => <option key={r.id} value={r.id}>Kelas {konversiNamaKelasResmi(r, daftarTingkat, !!filterUnitId)}</option>)
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
              <span>Tidak ada TP yang dipetakan untuk <strong>{mapelTerpilih?.nama}</strong> di kelas <strong>{namaKelasTampil || konversiNamaKelasResmi(rombelTerpilih, daftarTingkat, !!filterUnitId)}</strong>.
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

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="text-xs border-collapse w-full">
                <thead className="sticky top-0 z-10">
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
                        {rs.length === 0 && (
                          <tr>
                            <td colSpan={5} className="border border-slate-200 p-3 text-center text-slate-400 italic">
                              Belum ada Tujuan Pembelajaran untuk semester ini — lengkapi dulu di modul CP, TP &amp; ATP.
                            </td>
                          </tr>
                        )}
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
                            Jumlah Jam Total {sem === 'ganjil' ? 'Semester 1' : 'Semester 2'}
                          </td>
                          <td className={`border border-slate-200 p-2 text-center ${over ? 'text-rose-700' : 'text-[#4a1263]'}`}>
                            {total} JP
                          </td>
                        </tr>
                        <tr className="font-bold text-xs bg-slate-50">
                          <td colSpan={4} className="border border-slate-200 p-2 text-right text-slate-600">Jumlah Jam Efektif</td>
                          <td className="border border-slate-200 p-2 text-center text-slate-700">{cap} JP</td>
                        </tr>
                        <tr className="font-bold text-xs bg-slate-50">
                          <td colSpan={4} className="border border-slate-200 p-2 text-right text-slate-600">Jumlah Jam Cadangan</td>
                          <td className="border border-slate-200 p-2 text-center text-slate-700">{Math.max(0, cap - total)} JP</td>
                        </tr>
                        <tr><td colSpan={5} className="h-3 border-0"></td></tr>
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

          <p className="text-[10px] text-slate-400">Kolom tanda tangan pada dokumen akan dibiarkan kosong untuk ditandatangani secara basah/manual setelah dicetak.</p>

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
            {/* Preview Prota */}
            {tabView === 'preview-prota' && (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                {filterGuruId && filterMapelId && filterRombelId && (
                  <p className="text-[10px] text-slate-600 mb-2">
                    <strong>Mata Pelajaran:</strong> {mapelTerpilih?.nama} &nbsp;|&nbsp; <strong>Kelas:</strong> {namaKelasTampil || konversiNamaKelasResmi(rombelTerpilih, daftarTingkat, !!filterUnitId)} &nbsp;|&nbsp; <strong>Tahun Ajaran:</strong> {tahunAjaran} &nbsp;|&nbsp; <strong>Guru:</strong> {guruTerpilih?.nama}
                  </p>
                )}
                <table className="text-[9px] border-collapse w-full">
                  <thead className="sticky top-0 z-10">
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
                          const total = rs.reduce((a, r) => a + (r.jp || 0), 0)
                          const cap = sem === 'ganjil' ? capJpSem1 : capJpSem2
                          return (
                            <Fragment key={sem}>
                              {rs.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="border border-slate-200 p-3 text-center text-slate-400 italic">
                                    {sem === 'ganjil' ? 'Semester 1' : 'Semester 2'}: belum ada Tujuan Pembelajaran untuk semester ini.
                                  </td>
                                </tr>
                              )}
                              {rs.map((r, i) => (
                                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#6A197D]/10'}>
                                  {i === 0 && (
                                    <td rowSpan={rs.length} className="border border-slate-200 p-1.5 text-center font-bold text-[#6A197D] align-middle">
                                      {sem === 'ganjil' ? 'Semester 1' : 'Semester 2'}
                                    </td>
                                  )}
                                  <td className="border border-slate-200 p-1.5 font-semibold text-[#6A197D]">{r.elemen}</td>
                                  <td className="border border-slate-200 p-1.5">{r.materiNama}</td>
                                  <td className="border border-slate-200 p-1.5">{r.tpNomor ? `${r.tpNomor} — ` : ''}{r.tpDeskripsi}</td>
                                  <td className="border border-slate-200 p-1.5 text-center font-bold">{r.jp} JP</td>
                                </tr>
                              ))}
                              <tr className="bg-[#6A197D]/8 font-black">
                                <td colSpan={4} className="border border-slate-200 p-2 text-right text-[#5b1774]">
                                  Jumlah Jam Total {sem === 'ganjil' ? 'Semester 1' : 'Semester 2'}
                                </td>
                                <td className={`border border-slate-200 p-2 text-center ${total > cap ? 'text-rose-700' : 'text-[#4a1263]'}`}>
                                  {total} JP
                                </td>
                              </tr>
                              <tr className="bg-slate-50">
                                <td colSpan={4} className="border border-slate-200 p-2 text-right text-slate-600">Jumlah Jam Efektif</td>
                                <td className="border border-slate-200 p-2 text-center text-slate-700">{cap} JP</td>
                              </tr>
                              <tr className="bg-slate-50">
                                <td colSpan={4} className="border border-slate-200 p-2 text-right text-slate-600">Jumlah Jam Cadangan</td>
                                <td className="border border-slate-200 p-2 text-center text-slate-700">{Math.max(0, cap - total)} JP</td>
                              </tr>
                              <tr><td colSpan={5} className="h-3 border-0"></td></tr>
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