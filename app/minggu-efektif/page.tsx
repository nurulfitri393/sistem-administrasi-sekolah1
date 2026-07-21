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
// Bersihkan karakter yang tidak boleh ada di nama file (filesystem-unsafe),
// tanpa mengubah huruf besar/kecil atau spasi -- nama file tetap mudah dibaca.
function namaFileAman(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

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

// Cari rombel lain di TINGKAT yang sama yang jadwalnya (himpunan hari mengajar guru+mapel
// ini) PERSIS SAMA dengan rombel terpilih -- dipakai supaya Analisis Alokasi Waktu cukup
// dibuat SATU dokumen gabungan kalau beberapa kelas sejenjang benar-benar diajar di hari
// yang sama persis (mis. 1A & 1B sama-sama Rabu), dan tetap dipisah kalau himpunan harinya
// beda walau SEBAGIAN hari kebetulan sama (mis. 2A Senin+Kamis vs 2B Senin+Rabu -- sama-sama
// Senin tapi pertemuan ke-2 beda hari, jadi TIDAK digabung). Hasil selalu memuat rombel
// terpilih sendiri, terurut alfabetis.
// Ambil ANGKA/ROMAWI kelas dari nama rombel (mis. "6-1" -> "6", "5-2" -> "5", "VII B" ->
// "VII") -- dipakai cariRombelSejadwal untuk memastikan penggabungan kelas HANYA terjadi
// antar kelas dengan TINGKAT/ANGKA KELAS YANG BENAR-BENAR SAMA. Tidak bisa mengandalkan
// tingkatId semata: granularitas Tingkat diatur bebas oleh Admin (lihat placeholder-nya,
// "Contoh: Kelas 7 atau Fase D") -- satu Tingkat "Fase C" misalnya bisa saja mencakup
// kelas 5 DAN 6 sekaligus, jadi dua kelas beda angka bisa kebetulan sama tingkatId-nya.
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
  daftarRombel: any[],
  daftarJadwal: any[],
): any[] {
  const rombel = daftarRombel.find((r: any) => r.id === rombelId)
  if (!rombel) return []
  if (!guruId || !mapelId) return [rombel]

  const hariSet = (rid: string): Set<string> => new Set(
    daftarJadwal.filter((j: any) => j.guruId === guruId && j.mapelId === mapelId && j.rombelId === rid).map((j: any) => j.hari)
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
    ? daftarRombel.filter((r: any) => angkaKelasDariNamaRombel(r.nama) === kelasRombelIni)
    : (rombel.tingkatId ? daftarRombel.filter((r: any) => r.tingkatId === rombel.tingkatId) : [rombel])
  const gabungan = kandidat.filter((r: any) => r.id === rombelId || hariSama(hariSet(r.id), hariRombelIni))
  gabungan.sort((a: any, b: any) => (a.nama || '').localeCompare(b.nama || ''))
  return gabungan
}

// Ganti bagian angka/tingkat di AWAL nama rombel dengan "Nama Kelas Resmi" yang
// DIKETIK LANGSUNG oleh Admin di Master Tingkat Kelas (Dashboard), mis. Tingkat "1"
// (internal SMP) diisi Admin "7" -> rombel "1-1" tampil "7-1". HANYA dipakai saat
// analisis sedang dilihat/dicetak atas nama Lembaga Unit (bukan Lembaga Pusat).
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

// Gabungkan nama-nama rombel jadi satu label: "1A" / "1A dan 1B" / "1A, 1B, dan 1C".
function labelKelasGabungan(rombelList: any[], daftarTingkat: any[], tampilkanResmi = false): string {
  const nama = rombelList.map((r: any) => konversiNamaKelasResmi(r, daftarTingkat, tampilkanResmi)).filter(Boolean)
  if (nama.length <= 1) return nama[0] || ''
  if (nama.length === 2) return `${nama[0]} dan ${nama[1]}`
  return `${nama.slice(0, -1).join(', ')}, dan ${nama[nama.length - 1]}`
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
// memotong hari efektif kelas ini.
//
// ATURAN MAPEL (berbeda dari aturan Lembaga di hitungMingguEfektif):
// - Lembaga: minggu tidak efektif kalau >=3 hari (dari Senin-Jumat) kena
//   libur/kegiatan, TANPA melihat jadwal guru/mapel mana pun.
// - Mapel: minggu tetap dihitung EFEKTIF untuk guru+mapel tsb selama ADA
//   hari mengajarnya yang tidak kena libur -- meski minggu itu berstatus
//   "tidak efektif" untuk Lembaga (mis. libur Senin-Rabu tapi guru ini
//   mengajar Kamis-Jumat).
// - JP efektif dihitung PER HARI JADWAL (bukan langsung total JP/minggu):
//   tiap entri Jadwal Pelajaran = 1 JP pada hari itu. Hari yang kena libur
//   TIDAK menyumbang JP; hari yang tidak kena libur tetap menyumbang JP
//   sesuai jadwalnya. Jadi kalau guru mengajar Senin 2 JP & Rabu 3 JP, dan
//   Senin kena kegiatan tapi Rabu tidak, minggu itu hanya terhitung 3 JP
//   efektif -- bukan 5 JP penuh.
function hitungHariEfektifGuru(
  hasilRombel: HasilPerhitungan,
  jadwalTerjadwal: { hari: string }[],  // entri jadwal (hari) utk kombinasi guru+mapel+rombel ini -- 1 entri = 1 JP
  liburSet: Set<string>
): HasilHariEfektif {
  const HARI_MAP: { [k: string]: number } = { Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6 }

  // JP per hari = banyaknya entri jadwal (jam pelajaran) guru ini mengajar mapel
  // ini di kelas ini pada hari tsb -- presisi per hari, bukan dibagi rata dari
  // total JP/minggu, supaya distribusi JP tiap hari (mis. Senin 2 JP, Rabu 3 JP)
  // tetap akurat saat sebagian hari kena libur.
  const jpPerHari: { [hari: string]: number } = {}
  jadwalTerjadwal.forEach(j => { jpPerHari[j.hari] = (jpPerHari[j.hari] || 0) + 1 })
  const hariMengajar = Object.keys(jpPerHari).filter(h => HARI_MAP[h])

  let totalHariMengajar = 0
  let totalJpEfektif = 0

  const perMinggu: HasilHariEfektif['perMinggu'] = []

  hasilRombel.detail.forEach(minggu => {
    const hariEfektifDiMingguIni: string[] = []
    let jpMingguIni = 0

    hariMengajar.forEach(hari => {
      const offset = (HARI_MAP[hari] || 1) - 1
      const tglHari = toDateStr(addDays(parseDate(minggu.tanggalMulai), offset))
      const tgl = parseDate(tglHari)
      const mulaiMinggu = parseDate(minggu.tanggalMulai)
      const endMinggu = addDays(mulaiMinggu, 6)

      if (tgl >= mulaiMinggu && tgl <= endMinggu && !liburSet.has(tglHari)) {
        hariEfektifDiMingguIni.push(hari)
        jpMingguIni += jpPerHari[hari]
      }
    })

    totalHariMengajar += hariEfektifDiMingguIni.length
    totalJpEfektif += jpMingguIni

    if (hariEfektifDiMingguIni.length > 0 || hariMengajar.length > 0) {
      perMinggu.push({
        // `efektif` di sini SENGAJA tetap status LEMBAGA (minggu.efektif) --
        // dipakai utk mendeteksi "minggu tidak efektif Lembaga tapi tetap ada
        // KBM mapel ini" pada catatan info di layar. Status efektif KHUSUS
        // mapel ada di `jpEfektif > 0`.
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
  totalJpOverride,
  hariEfektifInfo,
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
  // JP total yang SUDAH dihitung presisi per hari jadwal (aturan Mapel) --
  // kalau diisi, dipakai menggantikan hasil.mingguEfektif * jpPerMinggu,
  // karena JP mapel bisa berbeda dari sekadar minggu-efektif dikali rata JP
  // per minggu (lihat aturan #5: sebagian hari dalam satu minggu bisa kena
  // libur sementara hari lain tidak).
  totalJpOverride?: number
  // Total hari mengajar efektif (aturan Mapel) -- kalau diisi, ditampilkan
  // sebagai baris "Jumlah Hari Efektif" di antara III (Minggu Efektif) dan
  // Jumlah Jam Efektif.
  hariEfektifInfo?: { totalHari: number; perHari: { hari: string; jumlah: number }[] }
  showDownload?: boolean
  onDownloadGanjil?: () => void
  onDownloadGenap?: () => void
  onPreviewGanjil?: () => void
  onPreviewGenap?: () => void
  expandDetail: boolean
  onToggleExpand: () => void
  footnote?: string
}) {
  const totalJp = totalJpOverride !== undefined
    ? totalJpOverride
    : (jpKnown && jpPerMinggu !== undefined ? hasil.mingguEfektif * jpPerMinggu : null)

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
        {/* Jumlah Hari Efektif & Jumlah Jam Efektif (IV & V) HANYA relevan untuk
            tampilan per-Mapel (hariEfektifInfo terisi) -- konsepnya berbasis jadwal
            mengajar satu guru/mapel per hari, tidak berlaku di level Lembaga. Untuk
            Lembaga, kartu ini cukup berhenti di III. Jumlah Minggu Efektif. */}
        {hariEfektifInfo && (
          <>
            <p className="pt-1"><strong>IV. Jumlah Hari Efektif</strong> = Jumlah hari mengajar yang tidak kena libur (dijumlahkan per minggu)</p>
            <p className="text-[#4A1159] font-black pl-4">
              = <span className="text-lg">{hariEfektifInfo.totalHari} Hari</span>{' '}
              <span className="text-[10px] font-semibold text-slate-500">
                ({hariEfektifInfo.perHari.map(h => `${h.hari}(${h.jumlah}x)`).join(', ') || '-'})
              </span>
            </p>
            <p className="pt-1"><strong>V. Jumlah Jam Efektif</strong> = Jumlah JP pada tiap hari mengajar yang tidak kena libur (dijumlahkan per minggu)</p>
            <p className="text-[#4A1159] font-black pl-4">= <span className="text-lg">{totalJp} Jam Pelajaran</span> <span className="text-[10px] font-semibold text-slate-500">(dihitung dari Jadwal Pelajaran per hari, bukan sekadar {hasil.mingguEfektif} minggu × {jpPerMinggu ?? 0} JP/minggu)</span></p>
          </>
        )}
        {!hariEfektifInfo && footnote && (
          <p className="text-slate-500 pl-4 text-[10px]">{footnote}</p>
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

      // PENTING -- perbaikan akar masalah "akun Guru cuma tampil 'Anda', Mapel/Kelas
      // tidak otomatis terisi, Analisis Alokasi Waktu berhenti di Minggu Efektif saja
      // (Jumlah Jam & Hari tidak muncul)": getCakupanMengajarGuru() (dipanggil di baris
      // paling atas komponen ini, SEBELUM effect ini jalan) mencari data guru yang
      // sedang login di localStorage['master_guru'] SECARA SINKRON. Di sesi yang benar-
      // benar baru (perangkat baru, akun baru pertama kali login) localStorage itu bisa
      // saja masih kosong/belum lengkap selagi lib/cloudSync.ts masih menarik datanya di
      // latar belakang -- akibatnya pencarian guru itu GAGAL, cakupanGuru.guruId jadi
      // kosong, dan filterGuruId tidak pernah ke-set. Karena Mapel/Kelas otomatis
      // mengikuti filterGuruId, keduanya ikut kosong, sehingga hitungan Jumlah Jam/Hari
      // Efektif (yang butuh Guru+Mapel+Kelas terisi) tidak pernah bisa jalan -- persis
      // seolah "berhenti di Minggu Efektif saja".
      //
      // Supaya SELALU memakai data guru yang benar sebelum apa pun lain dibaca, ambil
      // dulu 'master_guru' LANGSUNG dari Supabase di sini (tidak menunggu/bergantung pada
      // cloudSync yang mungkin belum selesai), lalu hitung ulang cakupan guru dari data
      // yang sudah pasti terbaru itu -- bukan dari variabel cakupanGuru di luar (nilainya
      // sudah telanjur dihitung dari localStorage yang lama, SEBELUM effect ini jalan).
      let sg = localStorage.getItem('master_guru')
      try {
        const { data: rowGuru } = await supabase
          .from('app_storage')
          .select('value')
          .eq('key', 'master_guru')
          .maybeSingle()
        const nilaiGuru: string | undefined = (rowGuru?.value as string | undefined) ?? undefined
        if (nilaiGuru) {
          JSON.parse(nilaiGuru) // validasi dulu -- jangan timpa kalau ternyata rusak/bukan JSON valid
          sg = nilaiGuru
          localStorage.setItem('master_guru', nilaiGuru)
        }
      } catch (e) {
        console.warn('Gagal memuat master_guru langsung dari cloud, memakai cache localStorage (jika ada):', e)
      }
      if (sg) setDaftarGuru(JSON.parse(sg))

      // Kalau yang login adalah Guru, kunci ke akunnya sendiri -- tidak bisa
      // melihat/pilih data guru lain sama sekali. Pakai cakupan yang dihitung ULANG dari
      // data master_guru yang sudah pasti terbaru (bukan variabel cakupanGuru di luar).
      const cakupanGuruTerbaru = getCakupanMengajarGuru()
      if (cakupanGuruTerbaru?.guruId) setFilterGuruId(cakupanGuruTerbaru.guruId)
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

  // Unit-unit tempat Guru yang sedang login ditugaskan (bisa lebih dari satu, mis. guru
  // yang mengajar di SMP DAN SMA) -- dipakai supaya "Cakupan Perhitungan Minggu Efektif
  // Lembaga" TERKUNCI sesuai unit guru itu sendiri (bukan bebas memilih Lembaga Pusat atau
  // unit lain yang bukan tempatnya mengajar), dan dropdown Unit HANYA muncul kalau guru
  // itu memang ditugaskan di lebih dari satu unit.
  const unitIdsGuruSendiri = useMemo(() => {
    if (!cakupanGuru?.guruId) return []
    return daftarGuru.find(g => g.id === cakupanGuru.guruId)?.unitIds || []
  }, [cakupanGuru, daftarGuru])
  const daftarUnitScopeGuru = useMemo(
    () => daftarUnitScope.filter(u => unitIdsGuruSendiri.includes(u.id)),
    [daftarUnitScope, unitIdsGuruSendiri]
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
  // Kalau yang login adalah Guru, dibatasi lagi hanya kelas yang benar-benar diampu
  // guru tsb -- DAN kalau Mapel sudah dipilih, HARUS kelas yang diajar guru UNTUK
  // MAPEL ITU secara spesifik (lewat mapelRombel[mapelId]), bukan union semua kelas
  // dari seluruh mapel lagi. Mis. guru mengajar Informatika & Matematika di kelas
  // 5-1 tapi hanya Informatika di kelas 6-1 -- Mapel yang muncul menyesuaikan Kelas
  // yang dipilih (lihat daftarMapelSesuaiCakupan di bawah).
  const daftarRombelSesuaiCakupan = useMemo(() => {
    let list = daftarRombel
    if (unitAcuanCakupan) list = list.filter((r: any) => resolveUnitIdRombel(r) === unitAcuanCakupan)
    if (cakupanGuru) {
      const rombelIdGuru = new Set<string>()
      Object.values(cakupanGuru.mapelRombel || {}).forEach((ids: any) => (ids || []).forEach((id: string) => rombelIdGuru.add(id)))
      if (filterMapelId) {
        const rombelIdMapelIni = new Set(cakupanGuru.mapelRombel?.[filterMapelId] || [])
        list = rombelIdMapelIni.size > 0
          ? list.filter((r: any) => rombelIdMapelIni.has(r.id))
          : (rombelIdGuru.size > 0 ? list.filter((r: any) => rombelIdGuru.has(r.id)) : list)
      } else {
        list = list.filter((r: any) => rombelIdGuru.has(r.id))
      }
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daftarRombel, daftarTingkat, unitAcuanCakupan, cakupanGuru, filterMapelId])

  // Guru yang muncul juga HARUS mengikuti Unit yang sedang dipilih (guru yang
  // memang ditugaskan di unit tsb, lihat unitIds di Kelola Data Guru).
  const daftarGuruSesuaiCakupan = useMemo(() => {
    if (!unitAcuanCakupan) return daftarGuru
    return daftarGuru.filter((g: any) => (g.unitIds || []).includes(unitAcuanCakupan))
  }, [daftarGuru, unitAcuanCakupan])

  // Mapel yang muncul di tab "Per Mapel/Guru" HARUS mengikuti Guru yang
  // dipilih di dropdown -- baik itu karena login sebagai akun Guru (terkunci
  // otomatis) MAUPUN karena Admin memilih guru tertentu secara manual. Kalau
  // Kelas sudah dipilih, HARUS mapel yang benar-benar diajar guru DI KELAS ITU
  // (lewat mapelRombel), bukan seluruh mapel yang diampu guru secara umum.
  const daftarMapelSesuaiCakupan = useMemo(() => {
    if (!filterGuruId) return daftarMapel
    const guru = daftarGuru.find((g: any) => g.id === filterGuruId)
    if (!guru?.mapelIds?.length) return daftarMapel
    let hasil = daftarMapel.filter((m: any) => guru.mapelIds.includes(m.id))
    if (filterRombelId) {
      const listTersaring = hasil.filter((m: any) => (guru.mapelRombel?.[m.id] || []).includes(filterRombelId))
      // Kalau ternyata kosong (mis. data mapelRombel utk kombinasi ini belum
      // lengkap), jangan sampai dropdown Mapel jadi kosong total -- pakai daftar
      // semula (seluruh mapel guru) sbg jaga-jaga.
      if (listTersaring.length > 0) hasil = listTersaring
    }
    return hasil
  }, [daftarMapel, daftarGuru, filterGuruId, filterRombelId])

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

  // Kalau Guru diganti (atau Kelas berganti sehingga Mapel jadi tidak valid lagi utk
  // kelas itu) dan Mapel yang tadinya dipilih ternyata bukan mapel yang diampu guru
  // itu (di kelas itu), kosongkan lagi supaya tidak salah data.
  useEffect(() => {
    if (filterMapelId && !daftarMapelSesuaiCakupan.some((m: any) => m.id === filterMapelId)) {
      setFilterMapelId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterGuruId, filterRombelId, daftarMapelSesuaiCakupan])

  // Kalau Mapel diganti sehingga Kelas yang tadinya dipilih ternyata bukan kelas yang
  // diajar guru utk mapel baru itu, kosongkan lagi supaya tidak salah data.
  useEffect(() => {
    if (filterRombelId && !daftarRombelSesuaiCakupan.some((r: any) => r.id === filterRombelId)) {
      setFilterRombelId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMapelId, daftarRombelSesuaiCakupan])

  // Kalau yang login adalah Guru dan cuma ampu SATU mapel, langsung pilihkan otomatis --
  // supaya Analisis Alokasi Waktu (Jumlah Jam & Hari Efektif, yang butuh Guru+Mapel+Kelas
  // terisi) langsung tampil begitu guru itu login, tanpa harus memilih manual dulu.
  useEffect(() => {
    if (cakupanGuru && filterGuruId && !filterMapelId && daftarMapelSesuaiCakupan.length === 1) {
      setFilterMapelId(daftarMapelSesuaiCakupan[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterGuruId, daftarMapelSesuaiCakupan])

  // Akun Guru dikunci ke cakupan "Unit" (bukan "Lembaga (Pusat)" yang menggabungkan
  // SEMUA unit, termasuk unit lain yang bukan tempatnya mengajar) -- kalau ternyata
  // sedang di "pusat" (mis. nilai awal default sebelum cakupanGuru diketahui), paksa
  // pindah ke "unit" begitu terdeteksi akun ini adalah Guru.
  useEffect(() => {
    if (cakupanGuru && scopeLevel === 'pusat') setScopeLevel('unit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cakupanGuru])

  // Auto-pilih unit/kelas pertama begitu datanya tersedia, supaya selector tidak kosong.
  // Untuk akun Guru, unit yang dipilihkan otomatis HARUS dari unit-unit miliknya sendiri
  // (daftarUnitScopeGuru), bukan sembarang unit pertama di seluruh lembaga.
  useEffect(() => {
    const sumberUnit = cakupanGuru ? daftarUnitScopeGuru : daftarUnitScope
    if (scopeLevel === 'unit' && sumberUnit.length > 0 && !sumberUnit.some(u => u.id === scopeUnitId)) {
      setScopeUnitId(sumberUnit[0].id)
    }
    if (scopeLevel === 'kelas' && !scopeRombelId && daftarRombel.length > 0) {
      setScopeRombelId(daftarRombel[0].id)
    }
  }, [scopeLevel, daftarUnitScope, daftarUnitScopeGuru, cakupanGuru, daftarRombel, scopeUnitId, scopeRombelId])

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

  // Kelas lain di tingkat yang sama yang jadwalnya (utk guru+mapel terpilih) persis sama
  // dengan kelas terpilih -- kalau ada, Analisis Alokasi Waktu ditampilkan GABUNGAN utk
  // semua kelas itu sekaligus (satu dokumen, label "1A dan 1B"), bukan per-kelas terpisah.
  const kelasGabunganMapel = useMemo(
    () => cariRombelSejadwal(filterGuruId, filterMapelId, filterRombelId, daftarRombel, daftarJadwal),
    [filterGuruId, filterMapelId, filterRombelId, daftarRombel, daftarJadwal]
  )
  // Penomoran kelas RESMI (7,8,9/10,11,12) hanya ditampilkan saat cakupan yang aktif
  // BUKAN "Lembaga (Pusat)" -- selaras dgn toggle Cakupan Perhitungan Minggu Efektif
  // Lembaga di atas, yang memang sudah membedakan sudut pandang Pusat vs Unit/Kelas.
  const tampilkanKelasResmi = scopeLevel !== 'pusat'
  const namaKelasTampilMapel = labelKelasGabungan(kelasGabunganMapel.length > 0 ? kelasGabunganMapel : (rombelMapelObj ? [rombelMapelObj] : []), daftarTingkat, tampilkanKelasResmi)

  // Kalau kelas terpilih digabung dg kelas lain (jadwal identik), sebuah tanggal dianggap
  // tidak efektif untuk GABUNGAN ini kalau event Kaldik-nya berlaku utk SALAH SATU anggota
  // gabungan (union) -- bukan cuma kelas yang kebetulan dipilih duluan di dropdown.
  const agendaScopedMapel = useMemo(() => {
    if (!filterRombelId || !rombelMapelObj) return []
    const anggotaGabungan = kelasGabunganMapel.length > 0 ? kelasGabunganMapel : [rombelMapelObj]
    const gabungan = new Set<AgendaItem>()
    anggotaGabungan.forEach((r: any) => {
      filterAgendaByScope(daftarAgenda, 'kelas', unitIdRombelMapel, { id: r.id, tingkatId: r.tingkatId }).forEach(ev => gabungan.add(ev))
    })
    return [...gabungan]
  }, [daftarAgenda, filterRombelId, rombelMapelObj, unitIdRombelMapel, kelasGabunganMapel])

  const { liburSet: liburSetMapel, kegiatanPerTgl: kegiatanPerTglMapel } = useMemo(
    () => buildKaldikMaps(agendaScopedMapel),
    [agendaScopedMapel]
  )

  const hasilRombelMapel = useMemo(() => {
    if (!filterRombelId || !semesterSaatIni.tanggalMulai || !semesterSaatIni.tanggalSelesai) return null
    return hitungMingguEfektif(semesterSaatIni.tanggalMulai, semesterSaatIni.tanggalSelesai, liburSetMapel, kegiatanPerTglMapel)
  }, [filterRombelId, semesterSaatIni, liburSetMapel, kegiatanPerTglMapel])

  // Distribusi Alokasi Waktu (bagian B) -- diambil dari data TP/ATP di modul
  // CP, TP & ATP, disilangkan dengan JP yang SUDAH diisi guru di halaman Prota.
  // Dipakai BERSAMA oleh tampilan di layar ini DAN hasil unduhan PDF, supaya
  // keduanya selalu sinkron (satu sumber perhitungan, bukan dihitung dua kali).
  // Fungsi bersama (BUKAN sekadar useMemo) supaya bisa dipanggil untuk semester
  // APAPUN -- baik semester yang sedang aktif di layar, maupun semester lain
  // saat tombol "PDF Ganjil/Genap" diklik (yang bisa berbeda dari tab yang
  // sedang aktif). Dengan begini tampilan di layar dan hasil unduhan PDF
  // dijamin memakai logika & sumber data yang PERSIS SAMA.
  const hitungDistribusiTp = (mapelId: string, rombelId: string, semesterId: string) => {
    if (!mapelId || !rombelId) return []
    try {
      const daftarTpRaw = localStorage.getItem(kunciTahun('data_tp'))
      const daftarAtpRaw = localStorage.getItem(kunciTahun('data_atp'))
      const daftarTpX = daftarTpRaw ? JSON.parse(daftarTpRaw) : []
      const daftarAtpX = daftarAtpRaw ? JSON.parse(daftarAtpRaw) : []
      const alokasiRaw = localStorage.getItem(`prota_alokasi_${mapelId}_${rombelId}`)
      const alokasiMap = alokasiRaw ? JSON.parse(alokasiRaw) : {}

      const rombelObj = daftarRombel.find((r: any) => r.id === rombelId)
      const namaTingkatKelas = String(rombelObj?.tingkat || (rombelObj as any)?.kelas || rombelObj?.nama || '')
        .toUpperCase().replace(/^KELAS\s+/, '')
      const romawiMatch = namaTingkatKelas.match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/)
      const tingkatKelas = romawiMatch ? romawiMatch[1] : namaTingkatKelas

      return daftarAtpX
        .filter((a: any) => a.mapelId === mapelId && a.kelas === tingkatKelas && a.semester === semesterId)
        .sort((x: any, y: any) => (x.urutanDiKelas || 0) - (y.urutanDiKelas || 0))
        .map((a: any) => {
          const tp = daftarTpX.find((t: any) => t.id === a.tpId)
          return {
            id: a.id,
            nomor: tp?.nomor || '',
            deskripsi: tp?.deskripsi || '(TP tidak ditemukan)',
            jp: alokasiMap[a.id]?.jp || 0,
          }
        })
    } catch {
      return []
    }
  }

  const distribusiTpMapel = useMemo(
    () => hitungDistribusiTp(filterMapelId, filterRombelId, semesterAktif),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterMapelId, filterRombelId, semesterAktif, daftarRombel]
  )

  const totalAlokasiTpMapel = distribusiTpMapel.reduce((s: number, tp: any) => s + (tp.jp || 0), 0)

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
    return hitungHariEfektifGuru(hasilRombelMapel, jadwalTerjadwal, liburSetMapel)
  }, [hasilRombelMapel, jadwalTerjadwal, liburSetMapel, filterGuruId, filterMapelId, filterRombelId])

  // Versi hasilRombelMapel yang statusnya (minggu efektif/tidak per minggu)
  // SUDAH DIKOREKSI ke aturan MAPEL (rule #3): sebuah minggu efektif untuk
  // mapel ini selama ada hari mengajarnya yang tidak kena libur -- meskipun
  // Lembaga menganggap minggu itu tidak efektif. Dipakai supaya kartu
  // ringkasan DAN kotak formula III/IV di bawahnya selalu menunjukkan
  // kesimpulan yang SAMA (sebelumnya keduanya memakai sumber angka yang
  // berbeda sehingga bisa tidak sinkron).
  const hasilMapelTerkoreksi: HasilPerhitungan | null = useMemo(() => {
    if (!hasilRombelMapel || !hasilHariEfektif) return null
    const statusMapelPerMinggu = new Map(hasilHariEfektif.perMinggu.map(m => [m.mingguLabel, m.jpEfektif > 0]))
    const detail = hasilRombelMapel.detail.map(d => ({
      ...d,
      efektif: statusMapelPerMinggu.get(d.minggu) ?? d.efektif,
    }))
    const mingguTidakEfektif = detail.filter(d => !d.efektif).length
    return {
      totalMinggu: hasilRombelMapel.totalMinggu,
      mingguEfektif: hasilRombelMapel.totalMinggu - mingguTidakEfektif,
      mingguTidakEfektif,
      detail,
      detailTidakEfektif: hasilRombelMapel.detailTidakEfektif,
    }
  }, [hasilRombelMapel, hasilHariEfektif])

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

    let semHasil = hitungMingguEfektif(semester.tanggalMulai, semester.tanggalSelesai, baseLiburSet, baseKegiatanPerTgl)

    let namaGuru = ''
    let namaMapelPdf = ''
    let namaRombelPdf = ''
    let jpPerMingguPdf = 0
    let hasilHariPdf: HasilHariEfektif | null = null
    let cakupanLabel = ''
    let nuptkGuru = ''

    // Untuk unduhan per Mapel: status efektif TIAP MINGGU di semHasil dikoreksi
    // ke aturan Mapel (minggu tetap efektif kalau ADA hari mengajar guru ini yang
    // tidak kena libur, walau Lembaga menganggap minggu itu tidak efektif) --
    // PERSIS logika hasilMapelTerkoreksi di layar, supaya PDF & tampilan layar
    // selalu menunjukkan kesimpulan yang sama.
    if (isMapelMode) {
      hasilHariPdf = hitungHariEfektifGuru(semHasil, jadwalTerjadwal, baseLiburSet)
      const statusMapelPerMinggu = new Map(hasilHariPdf.perMinggu.map(m => [m.mingguLabel, m.jpEfektif > 0]))
      const detailTerkoreksi = semHasil.detail.map(d => ({
        ...d,
        efektif: statusMapelPerMinggu.get(d.minggu) ?? d.efektif,
      }))
      const mingguTidakEfektifTerkoreksi = detailTerkoreksi.filter(d => !d.efektif).length
      semHasil = {
        totalMinggu: semHasil.totalMinggu,
        mingguEfektif: semHasil.totalMinggu - mingguTidakEfektifTerkoreksi,
        mingguTidakEfektif: mingguTidakEfektifTerkoreksi,
        detail: detailTerkoreksi,
        detailTidakEfektif: semHasil.detailTidakEfektif,
      }
    }

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
    //     guru di halaman Prota — memakai fungsi bersama (hitungDistribusiTp)
    //     yang SAMA PERSIS dengan yang menampilkan tabel "B. Distribusi
    //     Alokasi Waktu" di layar, supaya PDF selalu sinkron dengan layar.
    const distribusiTp = isMapelMode
      ? hitungDistribusiTp(filterMapelId, filterRombelId, semester.id)
      : []

    if (isMapelMode) {
      namaGuru = daftarGuru.find((g: any) => g.id === filterGuruId)?.nama || ''
      nuptkGuru = daftarGuru.find((g: any) => g.id === filterGuruId)?.nip || ''
      namaMapelPdf = daftarMapel.find((m: any) => m.id === filterMapelId)?.nama || ''
      namaRombelPdf = namaKelasTampilMapel || konversiNamaKelasResmi(daftarRombel.find((r: any) => r.id === filterRombelId), daftarTingkat, tampilkanKelasResmi)
      jpPerMingguPdf = jpPerMingguAktif
      cakupanLabel = `Kelas: ${namaRombelPdf} — Mapel: ${namaMapelPdf}`
    } else {
      if (scopeLevel === 'kelas' && scopeRombelObj) namaRombelPdf = konversiNamaKelasResmi(scopeRombelObj, daftarTingkat, tampilkanKelasResmi)
      cakupanLabel = scopeLevel === 'pusat'
        ? 'Lembaga (Keseluruhan/Pusat)'
        : scopeLevel === 'unit'
          ? `Unit: ${daftarUnitScope.find(u => u.id === scopeUnitId)?.label || '-'}`
          : `Kelas: ${konversiNamaKelasResmi(scopeRombelObj, daftarTingkat, tampilkanKelasResmi) || '-'}`
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
      const blobMentah = await res.blob()
      const namaFile = `${namaFileAman(['Analisis Alokasi Waktu', isMapelMode ? namaMapelPdf : '', isMapelMode ? `Kelas ${namaRombelPdf}` : '', semester.nama, semester.tahunAjaran].filter(Boolean).join(' '))}.pdf`
      const blob = new File([blobMentah], namaFile, { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      if (aksi === 'preview') {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = url
        setPreviewUrl(url)
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = namaFile
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`Gagal membuat PDF: ${e?.message || e}`)
    }
  }

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Analisis Alokasi Waktu...</div>
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
          <h1 className="text-2xl font-black text-slate-900">Analisis Alokasi Waktu</h1>
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
              {(cakupanGuru
                // Akun Guru dikunci sesuai perannya -- "Lembaga (Pusat)" (gabungan SEMUA
                // unit, termasuk unit lain yang bukan tempatnya mengajar) sengaja tidak
                // ditawarkan sama sekali untuk akun Guru.
                ? ([
                    { v: 'unit', label: '🏫 Unit' },
                    { v: 'kelas', label: '🎓 Kelas / Rombel' },
                  ] as { v: ScopeLevel; label: string }[])
                : ([
                    { v: 'pusat', label: '🏛️ Lembaga (Pusat)' },
                    { v: 'unit', label: '🏫 Unit' },
                    { v: 'kelas', label: '🎓 Kelas / Rombel' },
                  ] as { v: ScopeLevel; label: string }[])
              ).map(opt => (
                <button key={opt.v} onClick={() => setScopeLevel(opt.v)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition ${scopeLevel === opt.v ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
                  {opt.label}
                </button>
              ))}
            </div>

            {scopeLevel === 'unit' && (
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Pilih Unit</label>
                {cakupanGuru ? (
                  unitIdsGuruSendiri.length > 1 ? (
                    // Guru yang mengajar di LEBIH dari satu unit -- dropdown SUNGGUHAN,
                    // tapi dibatasi hanya ke unit-unit miliknya sendiri (daftarUnitScopeGuru).
                    <select value={scopeUnitId} onChange={e => setScopeUnitId(e.target.value)}
                      className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white min-w-[200px]">
                      {daftarUnitScopeGuru.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  ) : (
                    // Guru dengan SATU unit saja -- terkunci, tidak perlu dropdown.
                    <div className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 min-w-[200px]">
                      {daftarUnitScope.find(u => u.id === scopeUnitId)?.label || '-'} <span className="text-[9px] font-normal text-slate-400">(unit Anda)</span>
                    </div>
                  )
                ) : (
                  <select value={scopeUnitId} onChange={e => setScopeUnitId(e.target.value)}
                    className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white min-w-[200px]">
                    {daftarUnitScope.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                )}
              </div>
            )}

            {scopeLevel === 'kelas' && (
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Pilih Kelas</label>
                <select value={scopeRombelId} onChange={e => setScopeRombelId(e.target.value)}
                  className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white min-w-[200px]">
                  {daftarRombel.map((r: any) => <option key={r.id} value={r.id}>Kelas {konversiNamaKelasResmi(r, daftarTingkat, tampilkanKelasResmi)}</option>)}
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
                      {daftarRombelSesuaiCakupan.map(r => <option key={r.id} value={r.id}>Kelas {konversiNamaKelasResmi(r, daftarTingkat, tampilkanKelasResmi)}</option>)}
                    </select>
                  </div>
                </div>

                {filterRombelId && hasilRombelMapel && (
                  <>
                  {/* KARTU RINGKASAN KHUSUS GURU+MAPEL+KELAS INI. Angkanya SENGAJA
                      disamakan persis dengan Tabel III/IV di kartu "Perhitungan
                      Minggu/Jam Efektif" tepat di bawah ini -- keduanya memakai
                      hasilMapelTerkoreksi (aturan MAPEL: minggu efektif kalau ADA
                      hari mengajar yang tidak kena libur, JP dihitung presisi per
                      hari jadwal) supaya kesimpulannya selalu konsisten. */}
                  {filterGuruId && filterMapelId && hasilMapelTerkoreksi && hasilHariEfektif && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: 'Total Minggu', val: hasilMapelTerkoreksi.totalMinggu, color: 'bg-slate-100 text-slate-800', icon: <Calendar className="w-5 h-5" /> },
                        { label: 'Minggu Efektif (Mapel Ini)', val: hasilMapelTerkoreksi.mingguEfektif, color: 'bg-[#FFDE59]/15 text-[#6A197D] border border-[#FFDE59]/60', icon: <CheckCircle2 className="w-5 h-5 text-[#6A197D]" /> },
                        { label: 'Minggu Tidak Efektif (Mapel Ini)', val: hasilMapelTerkoreksi.mingguTidakEfektif, color: 'bg-red-50 text-red-800 border border-red-100', icon: <AlertTriangle className="w-5 h-5 text-red-500" /> },
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
                    title={`Perhitungan Minggu / Jam Efektif — Kelas ${namaKelasTampilMapel || konversiNamaKelasResmi(daftarRombel.find(r => r.id === filterRombelId), daftarTingkat, tampilkanKelasResmi)}${filterMapelId ? ` (${daftarMapel.find(m => m.id === filterMapelId)?.nama || ''})` : ''}`}
                    subtitle="Disaring dari Kaldik khusus untuk kelas ini — bisa berbeda dari tabel Lembaga di atas"
                    hasil={(filterGuruId && filterMapelId && hasilMapelTerkoreksi) ? hasilMapelTerkoreksi : hasilRombelMapel}
                    jpPerMinggu={jpPerMingguAktif}
                    jpKnown={Boolean(filterGuruId && filterMapelId && filterRombelId && jpPerMingguAktif > 0)}
                    totalJpOverride={filterGuruId && filterMapelId && hasilHariEfektif ? hasilHariEfektif.totalJpEfektif : undefined}
                    hariEfektifInfo={filterGuruId && filterMapelId && hasilHariEfektif ? { totalHari: hasilHariEfektif.totalHariMengajar, perHari: hasilHariEfektif.perHari } : undefined}
                    showDownload={Boolean(filterGuruId && filterMapelId)}
                    onDownloadGanjil={() => handleDownloadPdf(semesterGanjil, 'mapel')}
                    onDownloadGenap={() => handleDownloadPdf(semesterGenap, 'mapel')}
                    onPreviewGanjil={() => handleDownloadPdf(semesterGanjil, 'mapel', 'preview')}
                    onPreviewGenap={() => handleDownloadPdf(semesterGenap, 'mapel', 'preview')}
                    expandDetail={expandDetailMapel}
                    onToggleExpand={() => setExpandDetailMapel(!expandDetailMapel)}
                    footnote={filterGuruId && filterMapelId ? undefined : '* Pilih Guru dan Mata Pelajaran juga untuk menghitung Jumlah Hari & Jam Efektif.'}
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

                {/* Catatan tambahan -- HANYA info nuansa, angka Hari Efektif-nya sendiri
                    sudah dipindah jadi baris IV di kartu "Perhitungan Minggu / Jam Efektif"
                    di atas (antara III. Minggu Efektif dan V. Jam Efektif), supaya tidak
                    dobel dan urutannya Minggu -> Hari -> Jam Efektif. */}
                {hasilHariEfektif && hasilHariEfektif.perMinggu.some(m => !m.efektif && m.hariMengajar.length > 0) && (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1.5 text-xs">
                    <p className="text-[10px] font-semibold text-[#6A197D] bg-[#FFDE59]/15 border border-[#FFDE59]/60 rounded-lg px-2.5 py-1.5">
                      ℹ️ Ada minggu yang berstatus "tidak efektif" untuk kelas ini (≥3 hari kena kegiatan/libur) namun tetap ada KBM
                      mapel ini pada hari yang tidak bertepatan dengan hari libur tersebut. Kartu ringkasan &amp; Tabel III/IV/V di atas
                      tetap mengikuti status resmi minggu tsb (tidak efektif), sesuai aturan Lembaga/Kelas.
                    </p>
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