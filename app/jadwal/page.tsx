'use client'
import { useAksesGuard } from '@/lib/useAksesGuard'
import { bisaMengeditModul, getAksesInfo } from '@/lib/aksesPeran'
import CatatanHanyaLihat from '@/components/CatatanHanyaLihat'

import Sidebar from '@/components/Sidebar'
import PratinjauPdfModal from '@/components/PratinjauPdfModal'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { kunciTahun } from '@/lib/tahunAjaran'
import {
  Clock, Trash2, Landmark, LogOut, Shield, BookOpen, CheckCircle,
  Building, CalendarDays, BarChart2, FileText, FileSpreadsheet, Home,
  Wand2, RefreshCw, Plus, Edit2, Check, Users, Layers, X,
  Download, Printer, RotateCcw, Calendar, Info, PenLine, ClipboardList, Ban, Eye
} from 'lucide-react'

// ============================================================
// TYPES
// ============================================================
interface WaktuSlot {
  id: string
  label: string
  jamKe: string
  mulai: string
  selesai: string
  jenis: 'mapel' | 'istirahat'
}

interface JadwalTetap {
  id: string
  nama: string
  hari: string                 // nama hari atau 'Semua'
  waktuId: string
  berlakuUntuk: 'semua' | 'lembaga' | 'rombel'
  lembagaIds: string[]
  rombelIds: string[]
  warna: string
  // BARU: Jadwal Tetap sekarang juga menggantikan fungsi "Kelas Gabungan" --
  // kalau jenis === 'mapel', ini sebenarnya adalah MATA PELAJARAN (bukan
  // sekadar nama kegiatan bebas) yang diajar oleh SATU guru untuk BEBERAPA
  // kelas SEKALIGUS (isi di rombelIds), dan otomatis ikut terhitung sebagai
  // jam mengajar guru tsb -- persis seperti jadwal mapel biasa, tapi dengan
  // "satu sumber data berlaku untuk banyak kelas" seperti jadwal kegiatan.
  // Kalau jenis kosong/'kegiatan' (data lama), berperilaku seperti sebelumnya.
  jenis?: 'kegiatan' | 'mapel'
  mapelId?: string
  guruId?: string
  kelompokId?: string // menghubungkan beberapa baris (slot berturutan) sebagai SATU sesi multi-JP
}

interface JadwalGiliran {
  id: string
  rombelId: string
  waktuId: string
  hari: string
  mapelGuruList: { mapelId: string; guruId: string }[]
  keterangan: string
}

interface KelasGabungan {
  id: string
  mapelId: string
  guruId: string | null
  rombelIds: string[]
  keterangan: string
}

// Aturan mapel yang TIDAK BOLEH ditempatkan tepat setelah mapel tertentu (beriringan/back-to-back).
// Bersifat SEARAH: setelahMapelId -> dilarangMapelIds. Mis. setelahMapelId=IPA, dilarangMapelIds=[Matematika]
// berarti "setelah IPA tidak boleh langsung Matematika", TAPI "setelah Matematika boleh langsung IPA"
// kecuali ada aturan terpisah yang menyatakan sebaliknya.
interface LaranganBeriringan {
  id: string
  setelahMapelId: string
  dilarangMapelIds: string[]
}

interface PiketGuru {
  id: string
  hari: string
  lembagaId: string   // unit lembaga tempat guru ini bertugas piket (mis. SMP, SMA)
  guruIds: string[]
}

interface TandaTangan {
  tempat: string
  tanggal: string                 // format bebas, cth "19 Januari 2026"
}

// Hasil deteksi otomatis satu penandatangan (Mudir Pusat / Kepala Satuan Unit)
interface Penandatangan {
  label: string      // cth "Mudir SMP ABS Bandung" / "Kepala SMP ABS Bandung"
  nama: string
  nuptk: string
  ttd?: string        // URL gambar tanda tangan (diunggah lewat Identitas Lembaga)
}

// Sepasang penandatangan untuk kop unit: Kepala Satuan (kiri) + Wakil Kepala Kurikulum (kanan).
// Untuk Lembaga Induk, sisi kanan tetap dipakai jika ada peran "waka kurikulum" yang terdaftar
// di tingkat induk (mis. Direktur Kurikulum Yayasan); jika tidak ada, kolom kanan dikosongkan.
interface PasanganPenandatangan {
  kepala: Penandatangan
  wakaKurikulum: Penandatangan
}

// ============================================================
// KONSTANTA
// ============================================================
// Jadwal pelajaran HANYA Senin s.d Jumat -- Sabtu sengaja TIDAK dipakai lagi
// untuk jadwal pelajaran (generate, input manual, semua form terkait jadwal
// mengikuti daftar ini). LIST_HARI_UNIT dipertahankan sebagai alias yang
// sama persis, supaya kode lama yang masih memakainya tetap konsisten.
const LIST_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat']
const LIST_HARI_UNIT = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat']

// ============================================================
// HELPER: PARSE FORMAT KETERSEDIAAN JAM "1-2,9-10"
// ============================================================
// Mengubah string seperti "1-2,9-10" menjadi himpunan nomor jam ke- yang diizinkan: {1,2,9,10}
// "-" => tidak tersedia sama sekali (himpunan kosong, ditandai available=false)
// "" / kosong => bebas kapan saja (available=true, allowedJamKe=null artinya semua boleh)
function parseKetersediaanJam(str: string): { available: boolean; allowedJamKe: Set<number> | null } {
  const trimmed = (str || '').trim()
  if (trimmed === '') return { available: true, allowedJamKe: null }
  if (trimmed === '-') return { available: false, allowedJamKe: new Set() }

  const allowed = new Set<number>()
  trimmed.split(',').forEach(seg => {
    const part = seg.trim()
    if (!part) return
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(x => Number(x.trim()))
      if (!isNaN(a) && !isNaN(b)) {
        const lo = Math.min(a, b), hi = Math.max(a, b)
        for (let i = lo; i <= hi; i++) allowed.add(i)
      }
    } else {
      const n = Number(part)
      if (!isNaN(n)) allowed.add(n)
    }
  })
  return { available: allowed.size > 0, allowedJamKe: allowed }
}

// Cek apakah sebuah blok JP berurutan (berdasar jamKe slot-slot yang dipakai) seluruhnya
// berada di dalam rentang jam yang diizinkan untuk guru pada hari tsb.
function blokSesuaiKetersediaan(str: string, jamKeList: number[]): boolean {
  const { available, allowedJamKe } = parseKetersediaanJam(str)
  if (!available) return false
  if (allowedJamKe === null) return true // bebas kapan saja
  return jamKeList.every(jk => allowedJamKe.has(jk))
}
const WARNA_OPTIONS = [
  { label: 'Biru', value: 'bg-blue-100 text-blue-800 border-blue-200' },
  { label: 'Hijau', value: 'bg-green-100 text-green-800 border-green-200' },
  { label: 'Amber', value: 'bg-amber-100 text-amber-800 border-amber-200' },
  { label: 'Merah Muda', value: 'bg-pink-100 text-pink-800 border-pink-200' },
  { label: 'Ungu', value: 'bg-purple-100 text-purple-800 border-purple-200' },
  { label: 'Teal', value: 'bg-teal-100 text-teal-800 border-teal-200' },
]

// ============================================================
// HELPER: SINGKATAN KODE MAPEL (dipakai khusus pada jadwal lembaga PUSAT
// karena kolom kelasnya banyak sekaligus, supaya nama mapel tidak memakan tempat)
// ============================================================
const STOPWORDS_MAPEL = new Set(['dan', 'di', 'ke', 'dari', 'pada', 'untuk', 'atau', 'yang'])
function generateKodeMapel(namaAsli: string): string {
  const nama = (namaAsli || '').trim()
  if (!nama) return '-'
  const words = nama.split(/\s+/).map(w => w.replace(/[.,]/g, '')).filter(Boolean)
  const bermakna = words.filter(w => !STOPWORDS_MAPEL.has(w.toLowerCase()))
  if (bermakna.length >= 2) {
    return bermakna.map(w => w[0]).join('').toUpperCase().slice(0, 5)
  }
  const satuKata = bermakna[0] || words[0] || nama
  return satuKata.slice(0, 4).toUpperCase()
}

// ============================================================
// HELPER: URUTKAN ROMBEL/KELAS SECARA NATURAL (1, 1A, 1B, 2, 3, ... 7, dst)
// ============================================================
function urutkanRombelKelas<T extends { nama?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ma = (a.nama || '').match(/^(\d+)\s*[-–_]?\s*([A-Za-z]*\d*)/)
    const mb = (b.nama || '').match(/^(\d+)\s*[-–_]?\s*([A-Za-z]*\d*)/)
    const numA = ma ? parseInt(ma[1], 10) : Number.MAX_SAFE_INTEGER
    const numB = mb ? parseInt(mb[1], 10) : Number.MAX_SAFE_INTEGER
    if (numA !== numB) return numA - numB
    const subA = ma ? ma[2] : (a.nama || '')
    const subB = mb ? mb[2] : (b.nama || '')
    // Kalau sisa setelah angka depan SAMA-SAMA angka (mis. "5-1" vs "5-2" ->
    // sisa "1" vs "2"), urutkan SECARA NUMERIK -- bukan alfabet -- supaya
    // "5-2", "5-10" tidak terbalik jadi "5-10" sebelum "5-2".
    const subNumA = /^\d+$/.test(subA) ? parseInt(subA, 10) : null
    const subNumB = /^\d+$/.test(subB) ? parseInt(subB, 10) : null
    if (subNumA !== null && subNumB !== null) return subNumA - subNumB
    return subA.localeCompare(subB, 'id')
  })
}

/** Jaring pengaman TAMBAHAN: paksa kelas-kelas yang tergabung dalam satu grup
 *  KELAS GABUNGAN untuk selalu bersebelahan (adjacent) di urutan kolom tabel,
 *  APAPUN nama kelasnya -- supaya penggabungan sel (colspan) di tabel jadwal
 *  SELALU bisa terjadi. HTML cuma bisa menggabungkan kolom yang bersebelahan;
 *  kalau dua kelas gabungan kebetulan tidak berurutan secara alami (mis. beda
 *  jenjang/format nama), penggabungan sel tidak akan pernah terjadi tanpa ini. */
function dorongKelasGabunganBersebelahan<T extends { id: string }>(list: T[], daftarKelasGabungan: any[]): T[] {
  if (!daftarKelasGabungan.length) return list
  let hasil = [...list]
  daftarKelasGabungan.forEach(kg => {
    if (!kg.rombelIds || kg.rombelIds.length < 2) return
    const idxAnggota = kg.rombelIds
      .map((rid: string) => hasil.findIndex(x => x.id === rid))
      .filter((idx: number) => idx !== -1)
      .sort((a: number, b: number) => a - b)
    if (idxAnggota.length < 2) return
    // Ambil semua anggota grup ini (dalam urutan posisi SEKARANG), keluarkan
    // dari daftar, lalu sisipkan kembali berurutan tepat di posisi anggota
    // pertama -- hasilnya semua anggota grup ini pasti bersebelahan.
    const idAnggotaUrut = idxAnggota.map((idx: number) => hasil[idx].id)
    const posSisip = idxAnggota[0]
    hasil = hasil.filter(x => !idAnggotaUrut.includes(x.id))
    const anggotaObj = idAnggotaUrut.map((id: string) => list.find(x => x.id === id)!)
    hasil.splice(posSisip, 0, ...anggotaObj)
  })
  return hasil
}

// ============================================================
// HELPER: BUAT HTML UNTUK CETAK / UNDUH
// ============================================================
function generatePrintHtml(p: {
  namaUnitTampil: string
  alamat: string
  logoKiri: string
  logoKanan: string
  semester: string
  tahunAjaran: string
  rombelFiltered: any[]
  allSlots: WaktuSlot[]
  hariList: string[]
  daftarJadwal: any[]
  daftarJadwalTetap: JadwalTetap[]
  daftarJadwalGiliran: JadwalGiliran[]
  daftarGuru: any[]
  daftarMapel: any[]
  daftarRombel: any[]
  daftarKelasGabungan: KelasGabungan[]
  daftarTingkat: any[]
  daftarPiket: PiketGuru[]
  ttd: TandaTangan
  penandatangan: PasanganPenandatangan
  keterangan: string
  ketYayasan: string // keterangan lengkap yayasan, bisa 2 baris (dipisah \n)
  namaLembagaBaris: string // satu baris nama: Lembaga Pusat (jadwal keseluruhan) atau nama unit (jadwal unit)
  tampilkanWakaKurikulum: boolean // false untuk jadwal keseluruhan (hanya Mudir), true untuk jadwal unit
  piketUnitId: string | null // null/'semua' = jadwal keseluruhan (gabungkan piket SEMUA unit); diisi id unit = jadwal unit (hanya piket unit tsb)
  sematkanTtd?: boolean // true = sematkan gambar tanda tangan digital (kalau sudah diunggah), false = kosongkan (utk ttd basah manual)
}): string {
  const {
    namaUnitTampil, alamat, logoKiri, logoKanan, semester, tahunAjaran,
    rombelFiltered, allSlots, hariList, daftarJadwal, daftarJadwalTetap, daftarJadwalGiliran,
    daftarGuru, daftarMapel, daftarRombel, daftarKelasGabungan, daftarTingkat,
    daftarPiket, ttd, penandatangan, keterangan, ketYayasan, namaLembagaBaris, tampilkanWakaKurikulum, piketUnitId,
    sematkanTtd = true,
  } = p

  // Ambil daftar guru piket pada satu hari, sesuai cakupan:
  // - Jadwal UNIT (piketUnitId terisi): hanya guru piket yang ditugaskan untuk unit tsb.
  // - Jadwal KESELURUHAN (piketUnitId null/'semua'): gabungkan & hilangkan duplikat dari SEMUA unit.
  const getPiketGuruIdsHari = (hari: string): string[] => {
    if (piketUnitId && piketUnitId !== 'semua') {
      const entry = daftarPiket.find(pk => pk.hari === hari && pk.lembagaId === piketUnitId)
      return entry ? entry.guruIds : []
    }
    const idSet = new Set<string>()
    daftarPiket.filter(pk => pk.hari === hari).forEach(pk => pk.guruIds.forEach(gid => idSet.add(gid)))
    return Array.from(idSet)
  }

  const getRombelLembagaId = (rombelId: string) => {
    const r = daftarRombel.find((rr: any) => rr.id === rombelId)
    if (!r) return null
    const t = daftarTingkat.find((tt: any) => tt.id === r.tingkatId)
    return t ? t.lembagaId : null
  }

  const getTetap = (hari: string, waktuId: string, rombelId: string) => {
    return daftarJadwalTetap.find(jt => {
      const hariOk = jt.hari === hari || jt.hari === 'Semua'
      if (!hariOk || jt.waktuId !== waktuId) return false
      if (jt.berlakuUntuk === 'semua') return true
      if (jt.berlakuUntuk === 'rombel') return jt.rombelIds.includes(rombelId)
      if (jt.berlakuUntuk === 'lembaga') {
        const lId = getRombelLembagaId(rombelId)
        return lId ? jt.lembagaIds.includes(lId) : false
      }
      return false
    })
  }

  // Mirip cara kerja Jadwal Berlaku Umum (Jadwal Tetap): kalau kelas ini
  // bagian dari grup KELAS GABUNGAN, jadwal yang "berlaku" utk kelas ini
  // dicari dari SEMBARANG anggota grup yang sudah punya data -- BUKAN wajib
  // dari data milik kelas ini sendiri. Jadi walau yang benar-benar tersimpan
  // di database cuma 1 baris (mis. utk kelas 5-2 saja), kelas 5-1 (anggota
  // grup yang sama) akan tetap dianggap "punya" jadwal itu juga.
  const cariJadwalGabunganLintasKelas = (hari: string, slotId: string, rombelId: string) => {
    const grup = daftarKelasGabungan.filter(kg => kg.rombelIds?.includes(rombelId) && kg.rombelIds?.length > 1)
    for (const kg of grup) {
      const jGab = daftarJadwal.find(jj => jj.hari === hari && jj.waktuId === slotId && jj.mapelId === kg.mapelId && kg.rombelIds.includes(jj.rombelId))
      if (jGab) return jGab
    }
    return null
  }

  const getCell = (hari: string, slotId: string, rombelId: string) => {
    const tetap = getTetap(hari, slotId, rombelId)
    if (tetap) {
      if (tetap.jenis === 'mapel') {
        const mapelTetap = daftarMapel.find((m: any) => m.id === tetap.mapelId)
        const guruTetap = daftarGuru.find((g: any) => g.id === tetap.guruId)
        // Dianggap tipe 'gabungan' (bukan 'tetap') supaya diberi kode mapel &
        // warna gabungan seperti mata pelajaran biasa, bukan warna kegiatan.
        return { label: mapelTetap?.nama || tetap.nama, sub: guruTetap?.nama || '', tipe: 'gabungan' as const, tetapId: tetap.id as string | null }
      }
      return { label: tetap.nama, sub: '', tipe: 'tetap' as const, tetapId: tetap.id as string | null }
    }

    const giliran = daftarJadwalGiliran.find(jg => jg.rombelId === rombelId && jg.waktuId === slotId && jg.hari === hari)
    const j = daftarJadwal.find(jj => jj.hari === hari && jj.waktuId === slotId && jj.rombelId === rombelId) || cariJadwalGabunganLintasKelas(hari, slotId, rombelId)

    if (giliran && !j) {
      const labelGab = giliran.mapelGuruList.map(mg => daftarMapel.find((m: any) => m.id === mg.mapelId)?.nama || '').filter(Boolean).join('/')
      return { label: labelGab, sub: 'Bergiliran', tipe: 'giliran' as const, tetapId: null as string | null }
    }

    if (!j) return null
    const mapel = daftarMapel.find((m: any) => m.id === j.mapelId)
    const guru = daftarGuru.find((g: any) => g.id === j.guruId)
    const isGab = daftarKelasGabungan.some(kg => kg.mapelId === j.mapelId && kg.rombelIds?.includes(rombelId) && kg.rombelIds?.length > 1)
    return { label: mapel?.nama || '-', sub: guru?.nama || '', tipe: isGab ? 'gabungan' as const : 'normal' as const, tetapId: null as string | null }
  }

  // === Header kolom: Hari -> Rombel ===
  const thHari = hariList.map(h =>
    `<th colspan="${rombelFiltered.length}" style="padding:4px 2px;font-size:9px;text-align:center;background:#EDE3F3;color:#1E0A28;border:1px solid #000">${h.toUpperCase()}</th>`
  ).join('')
  const thRombel = hariList.map(() =>
    rombelFiltered.map((r: any) => `<th style="padding:3px 2px;font-size:8px;text-align:center;background:#EDE3F3;color:#1E0A28;border:1px solid #000">${r.nama}</th>`).join('')
  ).join('')

  let istirahatIdx = 0
  const rowsHtml = allSlots.map(slot => {
    if (slot.jenis === 'istirahat') {
      istirahatIdx++
      const totalColsTanpaWaktu = hariList.length * rombelFiltered.length
      const tdWaktuIstirahat = `<td style="padding:3px 4px;font-size:7.5px;font-weight:700;background:#f1f5f9;border:1px solid #000;word-break:break-word;text-align:center">${slot.mulai} - ${slot.selesai}</td>`
      // Pakai label ASLI yang diisi admin di Master Waktu (mis. "Istirahat Sholat
      // dan Makan Siang"), BUKAN teks generik "ISTIRAHAT N" -- supaya hasil
      // unduhan selalu sama persis dengan yang tertulis di halaman Jadwal.
      const labelIstirahat = (slot.label || '').trim() || `ISTIRAHAT ${istirahatIdx}`
      return `<tr style="background:#cbd5e1"><td style="padding:3px 4px;font-size:7.5px;font-weight:700;background:#f1f5f9;border:1px solid #000;word-break:break-word;text-align:center">${slot.mulai} - ${slot.selesai}</td><td colspan="${totalColsTanpaWaktu}" style="padding:3px 8px;font-size:8px;font-weight:700;text-align:center;border:1px solid #000;color:#000">${labelIstirahat.toUpperCase()}</td></tr>`
    }
    const tdWaktu = `<td style="padding:3px 4px;font-size:7.5px;font-weight:700;background:#f1f5f9;border:1px solid #000;word-break:break-word;text-align:center">${slot.mulai} - ${slot.selesai}</td>`
    const tdCells = hariList.map(hari => {
      // Ambil cell untuk seluruh rombel pada hari ini dulu, supaya bisa dikelompokkan:
      // kolom-kolom kelas yang BERURUTAN dan punya jadwal TETAP yang sama (mis. Upacara
      // utk semua kelas) ATAU kelas GABUNGAN yang sama (mapel+guru sama) digabung jadi
      // satu sel (colspan), supaya tulisannya tidak diulang-ulang per kelas.
      const cellsHariIni = rombelFiltered.map((r: any) => getCell(hari, slot.id, r.id))

      type Grup = { cell: any; jumlahKolom: number }
      const grupList: Grup[] = []
      let i = 0
      while (i < cellsHariIni.length) {
        const c = cellsHariIni[i]
        if (c && (c.tipe === 'tetap' || c.tipe === 'gabungan')) {
          let j = i + 1
          while (
            j < cellsHariIni.length &&
            cellsHariIni[j] &&
            cellsHariIni[j]!.tipe === c.tipe &&
            (c.tipe === 'tetap' ? cellsHariIni[j]!.tetapId === c.tetapId : (cellsHariIni[j]!.label === c.label && cellsHariIni[j]!.sub === c.sub))
          ) j++
          grupList.push({ cell: c, jumlahKolom: j - i })
          i = j
        } else {
          grupList.push({ cell: c, jumlahKolom: 1 })
          i++
        }
      }

      return grupList.map((g, gi) => {
        const cell = g.cell
        if (!cell) return `<td key="${gi}" style="padding:3px 2px;border:1px solid #000;text-align:center;font-size:7px;color:#cbd5e1">-</td>`

        if (cell.tipe === 'tetap' && g.jumlahKolom > 1) {
          return `<td colspan="${g.jumlahKolom}" style="padding:3px 4px;border:1px solid #000;text-align:center;background:#dbeafe;vertical-align:middle">
            <span style="font-size:8px;font-weight:700;display:block;line-height:1.25;white-space:normal;word-break:break-word">${cell.label}</span>
          </td>`
        }

        let bg = '#fff'
        if (cell.tipe === 'tetap') bg = '#dbeafe'
        if (cell.tipe === 'gabungan') bg = '#d1fae5'
        if (cell.tipe === 'giliran') bg = '#ede9fe'
        // Jadwal LEMBAGA PUSAT (tampilkanWakaKurikulum=false) memiliki banyak kelas sekaligus
        // dalam satu tabel, sehingga nama mapel disingkat jadi kode agar kolom tidak melebar.
        // Jadwal UNIT tetap menampilkan nama mapel lengkap.
        let labelTampil = cell.label
        if (!tampilkanWakaKurikulum && cell.tipe !== 'tetap') {
          labelTampil = cell.tipe === 'giliran'
            ? cell.label.split('/').map(generateKodeMapel).join('/')
            : generateKodeMapel(cell.label)
        }
        // Catatan: nama guru SENGAJA tidak ditampilkan di sini -- sudah ada di tabel
        // "Daftar Pengajar & Mapel (Kelas)" di bawah tabel jadwal, supaya baris tidak
        // membengkak dan hasil cetak tetap muat rapi dalam satu halaman A4 landscape.
        // Jika nama mapel panjang, biarkan turun ke baris baru (word-wrap) -- JANGAN
        // dipaksakan tampil memanjang ke samping yang bisa merusak tata letak kolom.
        return `<td${g.jumlahKolom > 1 ? ` colspan="${g.jumlahKolom}"` : ''} style="padding:3px 2px;border:1px solid #000;text-align:center;background:${bg};vertical-align:middle">
          <span style="font-size:7.5px;font-weight:700;display:block;line-height:1.2;white-space:normal;word-break:break-word">${labelTampil}</span>
        </td>`
      }).join('')
    }).join('')
    return `<tr>${tdWaktu}${tdCells}</tr>`
  }).join('')

  // === Daftar Pengajar & Mapel (Kelas) - dua kolom seperti PDF asli ===
  type GuruMapelEntry = { nama: string; mapelKelas: string[] }
  const entries: GuruMapelEntry[] = []
  daftarGuru.forEach((g: any) => {
    if (!g.mapelIds?.length) return
    const mapelKelas: string[] = []
    g.mapelIds.forEach((mId: string) => {
      const mapel = daftarMapel.find((m: any) => m.id === mId)
      if (!mapel) return
      const rombelList: string[] = g.mapelRombel?.[mId] || g.rombelIds || []
      // Hanya tampilkan rombel yang termasuk dalam cakupan unduhan ini
      const rombelInScope = rombelList.filter(rid => rombelFiltered.some((rf: any) => rf.id === rid))
      if (rombelInScope.length === 0) return
      const namaKelas = rombelInScope.map(rid => daftarRombel.find((r: any) => r.id === rid)?.nama || rid).join(', ')
      mapelKelas.push(`${mapel.nama} (${namaKelas})`)
    })
    if (mapelKelas.length > 0) entries.push({ nama: g.nama, mapelKelas })
  })

  const half = Math.ceil(entries.length / 2)
  const colKiri = entries.slice(0, half)
  const colKanan = entries.slice(half)

  const renderGuruRows = (list: GuruMapelEntry[]) => list.map(e => `
    <tr>
      <td style="padding:3px 6px;font-size:8px;border:1px solid #000;font-weight:600">${e.nama}</td>
      <td style="padding:3px 6px;font-size:8px;border:1px solid #000">${e.mapelKelas.join('<br/>')}</td>
    </tr>`).join('')

  // Catatan: tabel pengajar TIDAK lagi membungkus dirinya sendiri dalam <div flex>,
  // supaya bisa digabung satu baris dengan blok tanda tangan (kolom sempit di kanan)
  // — meniru layout contoh PDF, sehingga halaman cetak tidak terlalu panjang ke bawah.
  const guruTableHtml = `
      <table style="flex:1;border-collapse:collapse;width:50%">
        <thead><tr>
          <th style="padding:4px 6px;font-size:8px;background:#EDE3F3;color:#1E0A28;border:1px solid #000;text-align:left">NAMA PENGAJAR</th>
          <th style="padding:4px 6px;font-size:8px;background:#EDE3F3;color:#1E0A28;border:1px solid #000;text-align:left">MATA PELAJARAN (KELAS)</th>
        </tr></thead>
        <tbody>${renderGuruRows(colKiri)}</tbody>
      </table>
      <table style="flex:1;border-collapse:collapse;width:50%">
        <thead><tr>
          <th style="padding:4px 6px;font-size:8px;background:#EDE3F3;color:#1E0A28;border:1px solid #000;text-align:left">NAMA PENGAJAR</th>
          <th style="padding:4px 6px;font-size:8px;background:#EDE3F3;color:#1E0A28;border:1px solid #000;text-align:left">MATA PELAJARAN (KELAS)</th>
        </tr></thead>
        <tbody>${renderGuruRows(colKanan)}</tbody>
      </table>`

  // === Jadwal Piket Guru (kolom kiri, lebih sempit) ===
  const piketHtml = `
      <table style="border-collapse:collapse;width:100%">
        <thead><tr>
          ${LIST_HARI.slice(0, 5).map(h => `<th style="padding:3px 5px;font-size:7.5px;background:#EDE3F3;color:#1E0A28;border:1px solid #000">${h}</th>`).join('')}
        </tr></thead>
        <tbody><tr>
          ${LIST_HARI.slice(0, 5).map(h => {
            const guruIdsPiket = getPiketGuruIdsHari(h)
            const namaList = guruIdsPiket.map(gid => daftarGuru.find((g: any) => g.id === gid)?.nama || '-')
            return `<td style="padding:3px 5px;font-size:7.5px;border:1px solid #000;vertical-align:top">${namaList.map(n => `<div>${n}</div>`).join('') || '-'}</td>`
          }).join('')}
        </tr></tbody>
      </table>`

  // === Keterangan tambahan (kolom kanan, sejajar dengan Jadwal Piket Guru) ===
  const keteranganHtml = keterangan && keterangan.trim() ? `
      <p style="font-size:8.5px;font-weight:900;color:#000;margin-bottom:4px">Keterangan:</p>
      <div style="font-size:8px;color:#374151;line-height:1.55;white-space:pre-line">${keterangan
        .split('\n')
        .filter(line => line.trim() !== '')
        .map((line, i) => `${i + 1}. ${line.replace(/^\d+\.\s*/, '')}`)
        .join('\n')}</div>` : ''

  // === Tanda Tangan ===
  // Aturan (sama di semua dokumen unduhan): Kepala Sekolah/Kepala Satuan
  // ("Mengetahui") SELALU di KIRI. Pihak lain (Waka Kurikulum) di KANAN,
  // dan titimangsa sejajar dengan kolom KANAN itu.
  const imgTtd = (url?: string) => (url && sematkanTtd)
    ? `<img src="${url}" style="height:22px;display:block;margin:2px auto;object-fit:contain" />`
    : `<div style="height:22px"></div>`

  const ttdHtml = tampilkanWakaKurikulum ? `
    <div style="width:215px;flex-shrink:0">
      <div style="display:flex;gap:4px">
        <div style="flex:1;text-align:center">
          <p style="font-size:7.5px;margin-bottom:4px">Mengetahui,</p>
          <p style="font-size:6.8px;margin-bottom:2px;line-height:1.3">${penandatangan.kepala.label || ''}</p>
          ${imgTtd(penandatangan.kepala.ttd)}
          <p style="font-size:6.8px;font-weight:700">${penandatangan.kepala.nama || ''}</p>
          <p style="font-size:6.3px">NUPTK: ${penandatangan.kepala.nuptk || '-'}</p>
        </div>
        <div style="flex:1;text-align:center">
          <p style="font-size:7.5px;margin-bottom:2px;white-space:nowrap">${ttd.tempat || ''}, ${ttd.tanggal || ''}</p>
          <p style="font-size:6.8px;margin-bottom:2px;line-height:1.3">${penandatangan.wakaKurikulum.label || ''}</p>
          ${imgTtd(penandatangan.wakaKurikulum.ttd)}
          <p style="font-size:6.8px;font-weight:700">${penandatangan.wakaKurikulum.nama || ''}</p>
          <p style="font-size:6.3px">NUPTK: ${penandatangan.wakaKurikulum.nuptk || '-'}</p>
        </div>
      </div>
    </div>` : `
    <div style="width:170px;flex-shrink:0;text-align:center">
      <p style="font-size:7.5px;margin-bottom:2px">${ttd.tempat || ''}, ${ttd.tanggal || ''}</p>
      <p style="font-size:7.5px;margin-bottom:2px;line-height:1.3">Mengetahui,<br/>${penandatangan.kepala.label || ''}</p>
      ${imgTtd(penandatangan.kepala.ttd)}
      <p style="font-size:7.5px;font-weight:700">${penandatangan.kepala.nama || ''}</p>
      ${(penandatangan.kepala.label || '').toLowerCase().includes('mudir') ? '' : `<p style="font-size:7px">NUPTK: ${penandatangan.kepala.nuptk || '-'}</p>`}
    </div>`

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<title>Jadwal ${namaUnitTampil} ${tahunAjaran.replace(/\//g, '-')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 9px; background: #fff; color:#111; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 8px; width: 100%; }
  .header img { width: 56px; height: 56px; object-fit: contain; flex-shrink: 0; }
  .header-logo-slot { width: 56px; height: 56px; flex-shrink: 0; }
  .header-text { flex: 1; text-align: center; }
  .header-text h1 { font-size: 11px; font-weight: 900; text-transform: uppercase; color: #000; line-height: 1.35; white-space: pre-line; }
  .header-text h2 { font-size: 12px; font-weight: 900; color: #000; margin-top: 2px; text-transform:uppercase; }
  .header-text p { font-size: 9px; color: #374151; margin-top: 1px; }
  .meta-row { display:flex; justify-content:space-between; font-size:9px; font-weight:700; color:#000; margin-bottom:6px; }
  .judul-jadwal { text-align:center; font-size:11px; font-weight:900; color:#000; text-transform:uppercase; margin: 6px 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { size: A4 landscape; margin: 10mm; } }
</style>
</head>
<body>
<div style="padding:14px">
  <div class="header">
    ${logoKiri ? `<img src="${logoKiri}" alt="logo kiri"/>` : '<div class="header-logo-slot"></div>'}
    <div class="header-text">
      <h1>${ketYayasan}</h1>
      <h2>${namaLembagaBaris}</h2>
      <p>${alamat}</p>
    </div>
    ${logoKanan ? `<img src="${logoKanan}" alt="logo kanan"/>` : '<div class="header-logo-slot"></div>'}
  </div>

  <div class="judul-jadwal">JADWAL PELAJARAN ${namaUnitTampil.toUpperCase()}</div>
  <div class="meta-row">
    <span>Semester &nbsp;: ${semester}</span>
    <span>Tahun Ajaran &nbsp;: ${tahunAjaran}</span>
  </div>

  <table style="width:100%;table-layout:fixed">
    <thead>
      <tr>
        <th rowspan="2" style="padding:4px;font-size:9px;background:#EDE3F3;color:#1E0A28;border:1px solid #000;width:62px">WAKTU</th>
        ${thHari}
      </tr>
      <tr>${thRombel}</tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <!-- Baris 1: tabel pengajar (kiri, melebar) + blok tanda tangan (kanan, sempit) -->
  <div style="display:flex;gap:14px;margin-top:14px;align-items:flex-start">
    <div style="flex:1;display:flex;gap:10px">
      ${guruTableHtml}
    </div>
    ${ttdHtml}
  </div>

  <!-- Baris 2: Jadwal Piket Guru (kiri, sempit) + Keterangan (kanan, mengisi sisa lebar) -->
  <div style="display:flex;gap:16px;margin-top:10px;align-items:flex-start">
    <div style="width:42%">
      <div style="font-size:8px;font-weight:700;color:#000;margin-bottom:4px">JADWAL PIKET GURU</div>
      ${piketHtml}
    </div>
    <div style="flex:1">
      ${keteranganHtml}
    </div>
  </div>
</div>
</body>
</html>`
}

// ============================================================
// HELPER: BUAT HTML JADWAL PER-GURU (format mengikuti contoh "JADWAL GURU ...")
// Dipakai untuk unduh PDF per-guru (satu-satu atau dibungkus ZIP semua guru).
// ============================================================
function generatePrintHtmlGuru(p: {
  guru: any
  namaUnitTampil: string
  namaSekolahCetak: string
  allSlots: WaktuSlot[]
  daftarJadwal: any[]
  daftarJadwalTetap: JadwalTetap[]
  daftarMapel: any[]
  daftarRombel: any[]
  daftarPiket: PiketGuru[]
  daftarGuru: any[]
  daftarLembaga: any[]
  keterangan: string
}): string {
  const { guru, namaSekolahCetak, allSlots, daftarJadwal, daftarJadwalTetap, daftarMapel, daftarRombel, daftarPiket, daftarGuru, daftarLembaga } = p

  const mapelDiampu = (guru.mapelIds || [])
    .map((mId: string) => daftarMapel.find((m: any) => m.id === mId))
    .filter(Boolean)

  // ── Header info: KIRI nama guru, KANAN daftar mapel yang diampu saja.
  //    Tidak ada NIP/NUPTK ataupun Total JP di sini, sesuai desain final.
  const infoKiri = `
    <div>
      <p style="font-size:16px;font-weight:900;color:#000">${guru.nama}</p>
    </div>`

  const infoKanan = `
    <div style="text-align:right">
      ${mapelDiampu.map((m: any) => `<p style="font-size:16px;font-weight:700;color:#000;line-height:1.3">${m.nama}</p>`).join('')}
    </div>`

  // ── Tabel jadwal utama ─────────────────────────────────────────────────────
  const thHari = LIST_HARI_UNIT.map(h =>
    `<th style="font-size:16px;font-weight:900;background:#EDE3F3;color:#000;border:1px solid #000;text-align:center;vertical-align:middle">${h}</th>`
  ).join('')

  const rowsHtml = allSlots.map(slot => {
    if (slot.jenis === 'istirahat') {
      const isZuhur = /dzuhur|sholat|solat/i.test(slot.label)
      return `<tr style="background:${isZuhur ? '#d1fae5' : '#fef9c3'}">
        <td style="font-size:16px;font-weight:800;border:1px solid #000;text-align:center;vertical-align:middle;white-space:normal;color:#000">${slot.mulai}-${slot.selesai}</td>
        <td colspan="${LIST_HARI_UNIT.length}" style="font-size:16px;font-weight:800;text-align:center;border:1px solid #000;vertical-align:middle;color:#000">${slot.label.toUpperCase()}</td>
      </tr>`
    }
    // Kolom Jam: SATU baris saja "07.30-08.10" -- boleh wrap kalau memang tidak
    // muat, TIDAK dipaksa jadi beberapa baris terpisah seperti sebelumnya.
    const tdWaktu = `<td style="font-size:16px;font-weight:700;background:#f8fafc;border:1px solid #000;text-align:center;vertical-align:middle;white-space:normal;color:#000">${slot.mulai}-${slot.selesai}</td>`

    const tdCells = LIST_HARI_UNIT.map(hari => {
      const j = daftarJadwal.find((jj: any) => jj.hari === hari && jj.waktuId === slot.id && jj.guruId === guru.id)
      // Jadwal Berlaku Umum (jenis Mata Pelajaran) yang melibatkan guru ini pada
      // hari+slot yang sama juga harus ikut tampil di jadwal pribadinya --
      // sebelumnya cuma daftarJadwal biasa yang dicek, sehingga jadwal jenis
      // ini "hilang" dari unduhan per-guru walau sudah benar di tabel utama.
      const jt = !j ? daftarJadwalTetap.find(t => t.jenis === 'mapel' && t.guruId === guru.id && (t.hari === hari || t.hari === 'Semua') && t.waktuId === slot.id) : null

      if (!j && !jt) return `<td style="border:1px solid #000;background:#262626;text-align:center"></td>`

      if (jt) {
        const mapelTetap = daftarMapel.find((m: any) => m.id === jt.mapelId)
        const kelasList = jt.berlakuUntuk === 'semua' ? 'Semua Kelas'
          : jt.berlakuUntuk === 'rombel' ? jt.rombelIds.map(rid => daftarRombel.find((r: any) => r.id === rid)?.nama).filter(Boolean).join(', ')
          : (daftarLembaga.find((l: any) => l.id === jt.lembagaIds?.[0])?.nama || 'Unit')
        return `<td style="border:1px solid #000;text-align:center;vertical-align:middle;background:#d1fae5">
          <span style="font-size:16px;font-weight:900;display:block;line-height:1.25;color:#000;text-align:center;white-space:normal;word-break:break-word">${mapelTetap?.kode || mapelTetap?.nama || jt.nama || '-'}</span>
          <span style="font-size:13px;font-weight:600;display:block;line-height:1.25;margin-top:1px;white-space:normal;word-break:break-word;color:#065f46;text-align:center">${kelasList}</span>
        </td>`
      }

      const rombel = daftarRombel.find((r: any) => r.id === j.rombelId)
      const mapel = daftarMapel.find((m: any) => m.id === j.mapelId)
      return `<td style="border:1px solid #000;text-align:center;vertical-align:middle;background:#eef2ff">
        <span style="font-size:16px;font-weight:900;display:block;line-height:1.25;color:#000;text-align:center;white-space:normal;word-break:break-word">${rombel?.nama || '-'}</span>
        <span style="font-size:16px;font-weight:600;display:block;line-height:1.25;margin-top:1px;white-space:normal;word-break:break-word;color:#000;text-align:center">${mapel?.nama || '-'}</span>
      </td>`
    }).join('')
    return `<tr>${tdWaktu}${tdCells}</tr>`
  }).join('')

  // ── Tabel piket guru ───────────────────────────────────────────────────────
  const getPiketGuruIdsHariGabungan = (hari: string): string[] => {
    const idSet = new Set<string>()
    daftarPiket.filter(pk => pk.hari === hari).forEach(pk => pk.guruIds.forEach(gid => idSet.add(gid)))
    return Array.from(idSet)
  }

  const hariPiketGuruIni = LIST_HARI.filter(h => daftarPiket.some(pk => pk.hari === h && pk.guruIds.includes(guru.id)))
  const piketLabel = hariPiketGuruIni.length > 0 ? `Bertugas piket pada hari: <strong>${hariPiketGuruIni.join(', ')}</strong>` : ''

  const hariPiketKolom = LIST_HARI.slice(0, 5)
  const piketGabunganPerHari = hariPiketKolom.map(h => getPiketGuruIdsHariGabungan(h))
  const maxBarisPiket = Math.max(...piketGabunganPerHari.map(ids => ids.length), 1)
  const namaUnitGuru = (guruObj: any): string => {
    const uid = guruObj?.unitIds?.[0]
    if (!uid) return ''
    const unit = daftarLembaga.find((l: any) => l.id === uid)
    if (!unit?.nama) return ''
    // Ambil kata pertama nama unit sebagai label singkat, mis. "SMP Aisyiyah..." -> "SMP"
    return unit.nama.trim().split(/\s+/)[0]
  }

  const piketTableRows = Array.from({ length: maxBarisPiket }).map((_, rowIdx) => {
    const cells = piketGabunganPerHari.map(ids => {
      const gId = ids[rowIdx]
      const guruPiket = gId ? daftarGuru.find((g: any) => g.id === gId) : null
      const namaG = guruPiket?.nama || ''
      const labelUnit = guruPiket ? namaUnitGuru(guruPiket) : ''
      return `<td style="padding:12px 6px;font-size:16px;border:1px solid #000;text-align:center;vertical-align:middle;white-space:normal;word-break:break-word;line-height:1.4">${namaG}${labelUnit ? `<br/><span style="font-size:14px;color:#000">(${labelUnit})</span>` : ''}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<title>Jadwal ${guru.nama.split(',')[0].trim()}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 16px; background:#fff; color:#000; }
  table { border-collapse: collapse; width:100%; table-layout:fixed; }
  td, th { vertical-align: middle; word-break: break-word; }
  .page-wrap { padding: 8mm 8mm 6mm 8mm; }
  .judul { text-align:center; font-size:19px; font-weight:900; color:#000; text-transform:uppercase; padding-bottom:12px; border-bottom:3px solid #000; margin-bottom:10px; line-height:1.4; }
  .kop-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; gap:16px; }
  .tabel-jadwal-guru th,
  .tabel-jadwal-guru td { padding: 9px 7px; }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    @page { size:A4 portrait; margin:8mm; }
  }
</style>
</head>
<body>
<div class="page-wrap">
  <div class="judul">JADWAL GURU — ${namaSekolahCetak.toUpperCase()}</div>

  <div class="kop-row">
    ${infoKiri}
    ${infoKanan}
  </div>

  <table class="tabel-jadwal-guru" style="margin-bottom:8px">
    <thead>
      <tr>
        <th style="font-size:16px;font-weight:900;background:#EDE3F3;color:#000;border:1px solid #000;text-align:center">Jam</th>
        ${thHari}
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div style="margin-top:10px">
    ${piketLabel ? `<p style="font-size:18px;font-weight:700;color:#000;margin-bottom:6px;line-height:1.4">${piketLabel}</p>` : ''}
    <p style="font-size:18px;color:#000;margin-bottom:8px;line-height:1.4">Apabila bapak/ibu berhalangan hadir, dapat menghubungi guru piket berikut:</p>
    <table style="table-layout:fixed">
      <thead>
        <tr>${hariPiketKolom.map(h => `<th style="padding:8px 6px;font-size:16px;font-weight:800;background:#EDE3F3;color:#000;border:1px solid #000;text-align:center">${h}</th>`).join('')}</tr>
      </thead>
      <tbody>${piketTableRows}</tbody>
    </table>
  </div>
</div>
</body>
</html>`
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function JadwalPelajaranPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const diizinkanAkses = useAksesGuard('jadwal')
  const bolehEdit = bisaMengeditModul('jadwal')

  // --- Identitas (dibaca dari halaman Identitas Lembaga & Dashboard) ---
  const [identitasInduk, setIdentitasInduk] = useState<any>({ nama: 'Lembaga / Yayasan Pusat', npsn: '', logo_utama: '', logo: '', kop: '', alamat: '', logoKiriSumber: 'pusat', logoKananSumber: 'pusat' })
  const [daftarLembaga, setDaftarLembaga] = useState<any[]>([]) // { id, nama, npsn, logo, kop, alamat }
  const [daftarTingkat, setDaftarTingkat] = useState<any[]>([])
  const [daftarRombel, setDaftarRombel] = useState<any[]>([])
  const [daftarMapel, setDaftarMapel] = useState<any[]>([])
  const [daftarGuru, setDaftarGuru] = useState<any[]>([])
  const [tahunAjaranAktif, setTahunAjaranAktif] = useState('2025/2026')

  // --- Penjadwalan ---
  const [daftarJadwal, setDaftarJadwal] = useState<any[]>([])
  const [daftarWaktu, setDaftarWaktu] = useState<WaktuSlot[]>([])
  const [daftarKelasGabungan, setDaftarKelasGabungan] = useState<KelasGabungan[]>([])
  const [daftarJadwalTetap, setDaftarJadwalTetap] = useState<JadwalTetap[]>([])
  const [daftarJadwalGiliran, setDaftarJadwalGiliran] = useState<JadwalGiliran[]>([])
  const [daftarLarangan, setDaftarLarangan] = useState<LaranganBeriringan[]>([])
  const [generateScope, setGenerateScope] = useState<string>('semua')

  // Batasi CAKUPAN GENERATE sesuai unit yang dikelola akun yang sedang login.
  // Admin BENERAN (login langsung via Supabase Auth, bukan akun Guru) tetap
  // bisa generate SEMUA unit. Akun Guru (termasuk yang diberi peran "Admin
  // SMP"/"Kurikulum SMP" dsb) HANYA boleh generate unit yang dia kelola
  // sendiri (sesuai unitIds di data guru tsb) -- unit lain harus terkunci.
  const unitScopeGenerate = (() => {
    const info = getAksesInfo()
    if (!info.isGuru) return null // admin beneran -> tidak dibatasi
    const guruData = daftarGuru.find((g: any) => g.id === info.guruId)
    const unitIds: string[] = guruData?.unitIds || []
    return unitIds.filter((uid: string) => uid !== 'lembaga-induk') // "lembaga-induk" bukan unit spesifik
  })()
  const lembagaGenerateBolehDipilih = unitScopeGenerate
    ? daftarLembaga.filter(l => unitScopeGenerate.includes(l.id))
    : daftarLembaga

  // Kalau akun ini dibatasi ke unit tertentu, pastikan generateScope tidak
  // pernah tersangkut di "semua" (seluruh lembaga) atau unit di luar skopnya.
  useEffect(() => {
    if (!unitScopeGenerate) return
    if (generateScope === 'semua' || !unitScopeGenerate.includes(generateScope)) {
      setGenerateScope(unitScopeGenerate[0] || '')
    }
  }, [unitScopeGenerate?.join(',')])
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateProgress, setGenerateProgress] = useState('')
  const generateCancelRef = useRef(false)
  const [daftarPiket, setDaftarPiket] = useState<PiketGuru[]>([])
  const [daftarPeran, setDaftarPeran] = useState<any[]>([]) // untuk deteksi otomatis Mudir / Kepala Satuan
  const [matriksRinciJp, setMatriksRinciJp] = useState<{ [key: string]: string }>({})
  const [requestHariJp, setRequestHariJp] = useState<{ [key: string]: string }>({})
  const [maksJpGuruPerHari, setMaksJpGuruPerHari] = useState(10)
  const [semesterAktif, setSemesterAktif] = useState('Genap')
  const [ttd, setTtd] = useState<TandaTangan>({ tempat: '', tanggal: '' })
  // Keterangan tambahan per-unit yang akan tampil di bawah tabel pada hasil unduhan/cetak.
  // Key 'semua' dipakai untuk cakupan Lembaga Induk/Keseluruhan; key lain = id lembaga unit.
  const [keteranganUnit, setKeteranganUnit] = useState<{ [unitId: string]: string }>({})

  // --- UI State ---
  const [tabView, setTabView] = useState<'waktu' | 'pengaturan_kelas' | 'input' | 'rekap_guru' | 'rekap_jadwal'>('input')

  useEffect(() => {
    // Akses lihat-saja tidak boleh berada di tab yang berisi form isian
    // (Master Waktu / Pengaturan / Plot Matriks) -- paksa ke Rekap Jadwal.
    if (!bolehEdit && (tabView === 'waktu' || tabView === 'pengaturan_kelas' || tabView === 'input')) {
      setTabView('rekap_jadwal')
    }
  }, [bolehEdit, tabView])
  const [subTabKelas, setSubTabKelas] = useState<'identitas' | 'giliran' | 'tetap' | 'larangan' | 'titimangsa'>('identitas')
  const [hariPlotTabel, setHariPlotTabel] = useState('Senin')
  const [editingCell, setEditingCell] = useState<string | null>(null)
  const [editGuruMapel, setEditGuruMapel] = useState<string>('')
  const [cariGuruMapel, setCariGuruMapel] = useState<string>('')

  // Dukungan keyboard ala Excel: tekan Delete/Backspace untuk mengosongkan
  // sel jadwal yang sedang terbuka (tanpa perlu klik "X" lalu "Simpan" lagi).
  // Diabaikan kalau fokus sedang di dalam kolom teks (mis. sedang mengetik
  // pencarian nama guru), supaya tidak mengganggu pengetikan huruf biasa.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!editingCell) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      const [hari, waktuId, rombelId] = editingCell.split('_')
      const existing = daftarJadwal.find(j => j.hari === hari && j.waktuId === waktuId && j.rombelId === rombelId)
      if (existing) {
        const f = daftarJadwal.filter(j => j.id !== existing.id)
        setDaftarJadwal(f)
        save('data_jadwal_pelajaran', f)
      }
      setEditingCell(null); setEditGuruMapel(''); setEditJumlahJp(null); setCariGuruMapel('')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingCell, daftarJadwal])
  const [editJumlahJp, setEditJumlahJp] = useState<number | null>(null)
  const [modeTampil, setModeTampil] = useState<'keseluruhan' | 'unit'>('keseluruhan')
  const [unitFilter, setUnitFilter] = useState<string>('lembaga-induk')
  const [cariGuruId, setCariGuruId] = useState('')

  // Form: Master Waktu
  const [labelWaktu, setLabelWaktu] = useState('')
  const [jamKeNomor, setJamKeNomor] = useState('1')
  const [waktuMulai, setWaktuMulai] = useState('07.30')
  const [waktuSelesai, setWaktuSelesai] = useState('08.10')
  const [jenisWaktu, setJenisWaktu] = useState<'mapel' | 'istirahat'>('mapel')
  const [editWaktuId, setEditWaktuId] = useState<string | null>(null)

  // Form: Kelas Gabungan
  const [editGabId, setEditGabId] = useState<string | null>(null)
  const [formGabMapelId, setFormGabMapelId] = useState('')
  const [formGabGuruId, setFormGabGuruId] = useState('')
  const [formGabRombelIds, setFormGabRombelIds] = useState<string[]>([])
  const [formGabKet, setFormGabKet] = useState('')

  // Form: Jadwal Giliran
  const [editGilId, setEditGilId] = useState<string | null>(null)
  const [formGilRombelId, setFormGilRombelId] = useState('')
  const [formGilHari, setFormGilHari] = useState('Senin')
  const [formGilWaktuId, setFormGilWaktuId] = useState('')
  const [formGilMapelGuru, setFormGilMapelGuru] = useState<{ mapelId: string; guruId: string }[]>([{ mapelId: '', guruId: '' }])
  const [formGilKet, setFormGilKet] = useState('')

  // Form: Jadwal Tetap
  const [editTetapId, setEditTetapId] = useState<string | null>(null)
  const [formTetapJenis, setFormTetapJenis] = useState<'kegiatan' | 'mapel'>('kegiatan')
  const [formTetapNama, setFormTetapNama] = useState('')
  const [formTetapMapelId, setFormTetapMapelId] = useState('')
  const [formTetapGuruId, setFormTetapGuruId] = useState('')
  const [formTetapJumlahJp, setFormTetapJumlahJp] = useState<number | null>(null)
  const [formTetapHari, setFormTetapHari] = useState('Senin')
  const [formTetapWaktuId, setFormTetapWaktuId] = useState('')
  const [formTetapBerlaku, setFormTetapBerlaku] = useState<'semua' | 'lembaga' | 'rombel'>('semua')
  const [formTetapLembagaIds, setFormTetapLembagaIds] = useState<string[]>([])
  const [formTetapRombelIds, setFormTetapRombelIds] = useState<string[]>([])
  const [formTetapWarna, setFormTetapWarna] = useState(WARNA_OPTIONS[0].value)

  // Form: Larangan Mapel Beriringan
  const [editLarId, setEditLarId] = useState<string | null>(null)
  const [formLarSetelahId, setFormLarSetelahId] = useState('')
  const [formLarDilarangIds, setFormLarDilarangIds] = useState<string[]>([])

  // Form: Piket Guru (per LEMBAGA UNIT -> per hari -> multi guru)
  const [piketFormLembagaId, setPiketFormLembagaId] = useState<string>('')
  const [piketSearchQuery, setPiketSearchQuery] = useState<Record<string, string>>({})
  const [piketDraft, setPiketDraft] = useState<{ [lembagaId: string]: { [hari: string]: string[] } }>({})

  // Download modal
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadTarget, setDownloadTarget] = useState<string>('semua')
  const [sematkanTtdJadwal, setSematkanTtdJadwal] = useState(true)

  // Modal & state untuk unduhan jadwal PER-GURU (satu-satu atau ZIP semua)
  const [showDownloadGuruModal, setShowDownloadGuruModal] = useState(false)
  const [guruDownloadTarget, setGuruDownloadTarget] = useState<string>('semua-zip')
  const [sedangMengunduhGuru, setSedangMengunduhGuru] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  useEffect(() => { return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) } }, [])
  const [progresUnduhGuru, setProgresUnduhGuru] = useState({ selesai: 0, total: 0 })

  // ============================================================
  // INIT
  // ============================================================
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const load = (key: string, setter: (v: any) => void, fallback: any = []) => {
        const raw = localStorage.getItem(kunciAsli(key))
        setter(raw ? JSON.parse(raw) : fallback)
      }

      const storedInduk = localStorage.getItem('identitas_induk')
      if (storedInduk) setIdentitasInduk(JSON.parse(storedInduk))

      const storedTa = localStorage.getItem('master_tahun_ajaran')
      if (storedTa) {
        const taList = JSON.parse(storedTa)
        const aktif = taList.find((t: any) => t.aktif)
        if (aktif) setTahunAjaranAktif(aktif.nama)
      }

      load('daftar_lembaga', setDaftarLembaga)
      load('master_tingkat', setDaftarTingkat)
      load('master_rombel', setDaftarRombel)
      load('master_mapel', setDaftarMapel)
      load('master_guru', setDaftarGuru)
      load('master_peran', setDaftarPeran)

      load('data_jadwal_pelajaran', setDaftarJadwal)
      cekUndoTersedia()

      // Bersihkan sisa data jadwal hari SABTU yang mungkin sudah terlanjur
      // tersimpan dari sebelum Sabtu dihapus dari daftar hari pelajaran --
      // supaya benar-benar tidak ada jadwal guru di hari Sabtu sama sekali,
      // bukan cuma tidak ditampilkan/tidak bisa diisi baru.
      try {
        const jadwalMentah = localStorage.getItem(kunciTahun('data_jadwal_pelajaran'))
        if (jadwalMentah) {
          const jadwalArr = JSON.parse(jadwalMentah)
          const adaSabtu = jadwalArr.some((j: any) => j.hari === 'Sabtu')
          if (adaSabtu) {
            const bersih = jadwalArr.filter((j: any) => j.hari !== 'Sabtu')
            setDaftarJadwal(bersih)
            save('data_jadwal_pelajaran', bersih)
          }
        }
        const tetapMentah = localStorage.getItem('master_jadwal_tetap')
        if (tetapMentah) {
          const tetapArr = JSON.parse(tetapMentah)
          const adaSabtuTetap = tetapArr.some((j: any) => j.hari === 'Sabtu')
          if (adaSabtuTetap) {
            const bersihTetap = tetapArr.filter((j: any) => j.hari !== 'Sabtu')
            setDaftarJadwalTetap(bersihTetap)
            save('master_jadwal_tetap', bersihTetap)
          }
        }
        const giliranMentah = localStorage.getItem('master_jadwal_giliran')
        if (giliranMentah) {
          const giliranArr = JSON.parse(giliranMentah)
          const adaSabtuGiliran = giliranArr.some((j: any) => j.hari === 'Sabtu')
          if (adaSabtuGiliran) {
            const bersihGiliran = giliranArr.filter((j: any) => j.hari !== 'Sabtu')
            setDaftarJadwalGiliran(bersihGiliran)
            save('master_jadwal_giliran', bersihGiliran)
          }
        }
      } catch (e) {
        console.warn('Pembersihan sisa jadwal Sabtu gagal:', e)
      }
      load('master_pemetaan_waktu', setDaftarWaktu)
      load('master_kelas_gabungan', setDaftarKelasGabungan)
      load('master_jadwal_tetap', setDaftarJadwalTetap)
      load('master_jadwal_giliran', setDaftarJadwalGiliran)
      load('master_larangan_beriringan', setDaftarLarangan)
      load('master_piket_guru', setDaftarPiket)
      load('matriks_alokasi_rinci_samping', setMatriksRinciJp, {})
      load('request_hari_jp_guru', setRequestHariJp, {})

      // Migrasi otomatis (sekali jalan, aman diulang): untuk data yang sudah
      // terlanjur ada SEBELUM auto-isi kelas gabungan ini dibuat -- kalau ada
      // grup Kelas Gabungan yang SEBAGIAN kelasnya sudah diisi JP di Matriks
      // Alokasi tapi kelas lain dalam grup yang sama masih kosong, samakan
      // otomatis (pakai nilai dari kelas yang sudah terisi). Ini yang
      // menyebabkan sebagian kelas gabungan tidak pernah ikut ter-generate
      // sebelumnya -- bukan bug generate, tapi input JP yang kosong itu.
      try {
        const rinciMentah = localStorage.getItem(kunciTahun('matriks_alokasi_rinci_samping'))
        const gabunganMentah = localStorage.getItem('master_kelas_gabungan')
        if (rinciMentah && gabunganMentah) {
          const rinci = JSON.parse(rinciMentah)
          const gabungan = JSON.parse(gabunganMentah)
          let adaPerubahan = false
          const rinciBaru = { ...rinci }
          gabungan.forEach((kg: any) => {
            if (!kg.rombelIds || kg.rombelIds.length < 2) return
            // Cari semua kombinasi guru yang relevan dari key yang sudah ada (format guruId_mapelId_rombelId)
            const guruIdSet = new Set<string>()
            Object.keys(rinci).forEach(k => {
              const parts = k.split('_')
              if (parts.length === 3 && parts[1] === kg.mapelId && kg.rombelIds.includes(parts[2])) guruIdSet.add(parts[0])
            })
            guruIdSet.forEach(guruId => {
              const nilaiTerisi = kg.rombelIds.map((rid: string) => rinci[`${guruId}_${kg.mapelId}_${rid}`]).find((v: string) => v && v.trim())
              if (!nilaiTerisi) return
              kg.rombelIds.forEach((rid: string) => {
                const key = `${guruId}_${kg.mapelId}_${rid}`
                if (!rinciBaru[key] || !rinciBaru[key].trim()) { rinciBaru[key] = nilaiTerisi; adaPerubahan = true }
              })
            })
          })
          if (adaPerubahan) {
            setMatriksRinciJp(rinciBaru)
            save('matriks_alokasi_rinci_samping', rinciBaru)
          }
        }
      } catch (e) {
        console.warn('Migrasi auto-isi kelas gabungan gagal:', e)
      }

      const storedSemester = localStorage.getItem(kunciTahun('jadwal_semester_aktif'))
      if (storedSemester) setSemesterAktif(storedSemester)

      const storedTtd = localStorage.getItem(kunciTahun('jadwal_titimangsa_ttd'))
      if (storedTtd) setTtd(JSON.parse(storedTtd))

      const storedKetUnit = localStorage.getItem(kunciTahun('jadwal_keterangan_unit'))
      if (storedKetUnit) setKeteranganUnit(JSON.parse(storedKetUnit))

      const mj = localStorage.getItem(kunciTahun('master_maks_jp_guru_per_hari'))
      if (mj) setMaksJpGuruPerHari(Number(mj) || 10)

      setLoading(false)
    }
    init()
  }, [router])

  // Sinkronkan draft piket dari data tersimpan setiap kali daftarPiket berubah / tab dibuka
  useEffect(() => {
    const draft: { [lembagaId: string]: { [hari: string]: string[] } } = {}
    daftarPiket.forEach(p => {
      if (!p.lembagaId) return
      if (!draft[p.lembagaId]) draft[p.lembagaId] = {}
      draft[p.lembagaId][p.hari] = p.guruIds
    })
    setPiketDraft(draft)
  }, [daftarPiket])

  // Pastikan selalu ada lembaga terpilih pada form Jadwal Piket Guru begitu daftar lembaga tersedia
  useEffect(() => {
    if (!piketFormLembagaId && daftarLembaga.length > 0) {
      setPiketFormLembagaId(daftarLembaga[0].id)
    }
  }, [daftarLembaga, piketFormLembagaId])

  // Reset hari terpilih di Plot Matriks jika beralih ke mode unit dan Sabtu sedang dipilih
  useEffect(() => {
    if (modeTampil === 'unit' && unitFilter !== 'lembaga-induk' && hariPlotTabel === 'Sabtu') {
      setHariPlotTabel('Senin')
    }
  }, [modeTampil, unitFilter])

  // ============================================================
  // HELPERS UMUM
  // ============================================================
  // Kunci-kunci yang MERUPAKAN isian tahunan (harus diarsipkan per tahun ajaran).
  // PENTING: sebelumnya fungsi save()/load() di bawah ini menulis LANGSUNG ke
  // localStorage TANPA melalui kunciTahun() -- padahal modul lain (mis. Minggu
  // Efektif) membaca data ini SUDAH dengan kunciTahun(). Akibatnya data jadwal,
  // master waktu, dsb tidak pernah "ketemu" saat disilangkan modul lain, karena
  // nama kuncinya beda (satu polos, satu berlabel tahun ajaran). Diperbaiki di
  // sini secara terpusat, supaya SEMUA pemanggilan save('key', ...)/load('key', ...)
  // di bawah otomatis konsisten tanpa perlu mengubah satu-satu titik pemanggilannya.
  const KUNCI_TAHUN_JADWAL = new Set([
    'data_jadwal_pelajaran', 'master_pemetaan_waktu', 'master_kelas_gabungan',
    'master_jadwal_tetap', 'master_jadwal_giliran', 'master_larangan_beriringan',
    'master_piket_guru', 'matriks_alokasi_rinci_samping', 'request_hari_jp_guru',
    'jadwal_semester_aktif', 'jadwal_titimangsa_ttd', 'jadwal_keterangan_unit',
    'master_maks_jp_guru_per_hari',
  ])
  const kunciAsli = (key: string) => KUNCI_TAHUN_JADWAL.has(key) ? kunciTahun(key) : key
  const save = (key: string, data: any) => localStorage.setItem(kunciAsli(key), JSON.stringify(data))

  // --- Identitas & Kop: Lembaga Pusat (Yayasan) dan Unit ---
  const updateIdentitasIndukField = (field: string, value: string) => {
    setIdentitasInduk((prev: any) => ({ ...prev, [field]: value }))
  }
  const handleSimpanIdentitasInduk = (e: React.FormEvent) => {
    e.preventDefault()
    save('identitas_induk', identitasInduk)
    alert('Identitas & kop Lembaga Pusat berhasil disimpan.')
  }
  const updateUnitField = (unitId: string, field: string, value: string) => {
    setDaftarLembaga(prev => prev.map(l => (l.id === unitId ? { ...l, [field]: value } : l)))
  }
  const handleSimpanUnit = (unitId: string) => {
    save('daftar_lembaga', daftarLembaga)
    const unit = daftarLembaga.find(l => l.id === unitId)
    alert(`Identitas unit "${unit?.nama || ''}" berhasil disimpan.`)
  }

  // Mengembalikan URL logo aktual berdasarkan pilihan sumber ('pusat' atau id unit lembaga)
  const resolveLogoUrl = (sumber: string | undefined): string => {
    if (!sumber || sumber === 'pusat') return identitasInduk.logo_utama || identitasInduk.logo || ''
    const unit = daftarLembaga.find(l => l.id === sumber)
    return unit?.logo || ''
  }

  const getRombelsByLembaga = (lembagaId: string) => {
    if (lembagaId === 'lembaga-induk') return daftarRombel
    const tingkatIds = daftarTingkat.filter(t => t.lembagaId === lembagaId).map(t => t.id)
    return daftarRombel.filter(r => tingkatIds.includes(r.tingkatId))
  }

  // Guru-guru yang mengajar minimal satu rombel di lembaga unit tertentu --
  // dipakai untuk menyaring pilihan nama guru pada form Jadwal Piket Guru per-unit.
  const getGuruIdsMengajarDiLembaga = (lembagaId: string): string[] => {
    if (lembagaId === 'lembaga-induk') return daftarGuru.map((g: any) => g.id)
    const rombelLembagaIds = getRombelsByLembaga(lembagaId).map(r => r.id)
    return daftarGuru
      .filter((g: any) => (g.mapelIds || []).some((mId: string) => {
        const rombelList: string[] = g.mapelRombel?.[mId] || g.rombelIds || []
        return rombelList.some((rid: string) => rombelLembagaIds.includes(rid))
      }))
      .map((g: any) => g.id)
  }

  const getRombelLembagaId = (rombelId: string) => {
    const r = daftarRombel.find(rr => rr.id === rombelId)
    if (!r) return null
    const t = daftarTingkat.find(tt => tt.id === r.tingkatId)
    return t ? t.lembagaId : null
  }

  // ============================================================
  // CRUD: WAKTU
  // ============================================================
  const handleSimpanWaktu = (e: React.FormEvent) => {
    e.preventDefault()
    let updated: WaktuSlot[]
    if (editWaktuId) {
      updated = daftarWaktu.map(w => w.id === editWaktuId ? {
        ...w,
        label: labelWaktu || (jenisWaktu === 'mapel' ? `Jam ke-${jamKeNomor}` : 'Istirahat'),
        jamKe: jamKeNomor,
        mulai: waktuMulai,
        selesai: waktuSelesai,
        jenis: jenisWaktu,
      } : w)
    } else {
      const w: WaktuSlot = {
        id: 'waktu-' + Date.now(),
        label: labelWaktu || (jenisWaktu === 'mapel' ? `Jam ke-${jamKeNomor}` : 'Istirahat'),
        jamKe: jamKeNomor,
        mulai: waktuMulai,
        selesai: waktuSelesai,
        jenis: jenisWaktu
      }
      updated = [...daftarWaktu, w]
    }
    updated = updated.sort((a, b) => {
      if (a.jenis === 'mapel' && b.jenis === 'mapel') return Number(a.jamKe) - Number(b.jamKe)
      return 0
    })
    setDaftarWaktu(updated); save('master_pemetaan_waktu', updated)
    setLabelWaktu(''); setEditWaktuId(null); setJamKeNomor('1'); setWaktuMulai('07.30'); setWaktuSelesai('08.10'); setJenisWaktu('mapel')
  }

  const handleEditWaktuClick = (w: WaktuSlot) => {
    setEditWaktuId(w.id)
    setJenisWaktu(w.jenis)
    setJamKeNomor(String(w.jamKe || '1'))
    setLabelWaktu(w.label || '')
    setWaktuMulai(w.mulai)
    setWaktuSelesai(w.selesai)
  }

  const handleBatalEditWaktu = () => {
    setEditWaktuId(null); setLabelWaktu(''); setJamKeNomor('1'); setWaktuMulai('07.30'); setWaktuSelesai('08.10'); setJenisWaktu('mapel')
  }

  const handleHapusWaktu = (id: string) => {
    if (!confirm('Hapus slot waktu ini?')) return
    const filtered = daftarWaktu.filter(w => w.id !== id)
    setDaftarWaktu(filtered); save('master_pemetaan_waktu', filtered)
    const jf = daftarJadwal.filter(j => j.waktuId !== id)
    setDaftarJadwal(jf); save('data_jadwal_pelajaran', jf)
  }

  // ============================================================
  // CRUD: KELAS GABUNGAN (dengan EDIT)
  // ============================================================
  const resetFormGabungan = () => {
    setEditGabId(null); setFormGabMapelId(''); setFormGabGuruId(''); setFormGabRombelIds([]); setFormGabKet('')
  }

  const handleSimpanGabungan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formGabMapelId || formGabRombelIds.length < 2) { alert('Pilih mapel dan minimal 2 rombel.'); return }

    if (editGabId) {
      const updated = daftarKelasGabungan.map(kg => kg.id === editGabId ? {
        ...kg, mapelId: formGabMapelId, guruId: formGabGuruId || null, rombelIds: formGabRombelIds, keterangan: formGabKet
      } : kg)
      setDaftarKelasGabungan(updated); save('master_kelas_gabungan', updated)
    } else {
      const kg: KelasGabungan = { id: 'gabung-' + Date.now(), mapelId: formGabMapelId, guruId: formGabGuruId || null, rombelIds: formGabRombelIds, keterangan: formGabKet }
      const updated = [...daftarKelasGabungan, kg]
      setDaftarKelasGabungan(updated); save('master_kelas_gabungan', updated)
    }
    resetFormGabungan()
  }

  const handleEditGabungan = (kg: KelasGabungan) => {
    setEditGabId(kg.id); setFormGabMapelId(kg.mapelId); setFormGabGuruId(kg.guruId || ''); setFormGabRombelIds(kg.rombelIds); setFormGabKet(kg.keterangan || '')
  }

  const handleHapusGabungan = (id: string) => {
    if (!confirm('Hapus aturan kelas gabungan ini?')) return
    const filtered = daftarKelasGabungan.filter(kg => kg.id !== id)
    setDaftarKelasGabungan(filtered); save('master_kelas_gabungan', filtered)
    if (editGabId === id) resetFormGabungan()
  }

  // ============================================================
  // CRUD: JADWAL GILIRAN (dengan EDIT)
  // ============================================================
  const resetFormGiliran = () => {
    setEditGilId(null); setFormGilRombelId(''); setFormGilWaktuId(''); setFormGilMapelGuru([{ mapelId: '', guruId: '' }]); setFormGilKet(''); setFormGilHari('Senin')
  }

  const handleSimpanGiliran = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formGilRombelId || !formGilWaktuId || formGilMapelGuru.filter(mg => mg.mapelId).length < 2) {
      alert('Pilih rombel, waktu, dan minimal 2 mapel yang bergiliran.'); return
    }
    if (editGilId) {
      const updated = daftarJadwalGiliran.map(jg => jg.id === editGilId ? {
        ...jg, rombelId: formGilRombelId, hari: formGilHari, waktuId: formGilWaktuId,
        mapelGuruList: formGilMapelGuru.filter(mg => mg.mapelId), keterangan: formGilKet
      } : jg)
      setDaftarJadwalGiliran(updated); save('master_jadwal_giliran', updated)
    } else {
      const jg: JadwalGiliran = { id: 'gilir-' + Date.now(), rombelId: formGilRombelId, hari: formGilHari, waktuId: formGilWaktuId, mapelGuruList: formGilMapelGuru.filter(mg => mg.mapelId), keterangan: formGilKet }
      const updated = [...daftarJadwalGiliran, jg]
      setDaftarJadwalGiliran(updated); save('master_jadwal_giliran', updated)
    }
    resetFormGiliran()
  }

  const handleEditGiliran = (jg: JadwalGiliran) => {
    setEditGilId(jg.id); setFormGilRombelId(jg.rombelId); setFormGilHari(jg.hari); setFormGilWaktuId(jg.waktuId)
    setFormGilMapelGuru(jg.mapelGuruList.length ? jg.mapelGuruList : [{ mapelId: '', guruId: '' }])
    setFormGilKet(jg.keterangan || '')
  }

  const handleHapusGiliran = (id: string) => {
    if (!confirm('Hapus jadwal giliran ini?')) return
    const filtered = daftarJadwalGiliran.filter(jg => jg.id !== id)
    setDaftarJadwalGiliran(filtered); save('master_jadwal_giliran', filtered)
    if (editGilId === id) resetFormGiliran()
  }

  // ============================================================
  // CRUD: JADWAL TETAP (dengan EDIT)
  // ============================================================
  const resetFormTetap = () => {
    setEditTetapId(null); setFormTetapJenis('kegiatan'); setFormTetapNama(''); setFormTetapMapelId(''); setFormTetapGuruId(''); setFormTetapJumlahJp(null)
    setFormTetapHari('Senin'); setFormTetapWaktuId('')
    setFormTetapBerlaku('semua'); setFormTetapLembagaIds([]); setFormTetapRombelIds([]); setFormTetapWarna(WARNA_OPTIONS[0].value)
  }

  // Ambil pilihan JP (segmen sesi) dari Matriks Alokasi JP untuk kombinasi
  // guru+mapel+kelas ini -- mis. kalau di Matriks tertulis "3, 2", hasilnya
  // [3, 2] -- admin memilih salah satu sebagai panjang sesi utk entri ini.
  const opsiJpTetapDariMatriks = (): number[] => {
    if (!formTetapGuruId || !formTetapMapelId) return []
    const rombelAcuan = formTetapBerlaku === 'rombel' ? formTetapRombelIds[0] : daftarRombel[0]?.id
    if (!rombelAcuan) return []
    const str = matriksRinciJp[`${formTetapGuruId}_${formTetapMapelId}_${rombelAcuan}`] || ''
    return str.split(',').map(x => Number(x.trim())).filter(n => n > 0)
  }

  const handleSimpanTetap = (e: React.FormEvent) => {
    e.preventDefault()
    if (formTetapJenis === 'mapel') {
      if (!formTetapMapelId || !formTetapGuruId || !formTetapWaktuId) { alert('Pilih mata pelajaran, pendidik, dan slot waktu.'); return }
      if (formTetapBerlaku === 'rombel' && formTetapRombelIds.length < 2) { alert('Untuk jenis Mata Pelajaran, pilih minimal 2 kelas (kalau cuma 1 kelas, cukup diisi lewat Plot Jadwal biasa).'); return }
      const opsiJp = opsiJpTetapDariMatriks()
      if (opsiJp.length > 1 && !formTetapJumlahJp) { alert('Pilih berapa JP untuk sesi ini (sesuai Matriks Alokasi JP).'); return }
    } else {
      if (!formTetapNama || !formTetapWaktuId) { alert('Isi nama kegiatan dan pilih slot waktu.'); return }
    }
    const namaAkhir = formTetapJenis === 'mapel' ? (daftarMapel.find((m: any) => m.id === formTetapMapelId)?.nama || '') : formTetapNama

    // Untuk jenis Mata Pelajaran: tentukan berapa slot BERTURUTAN yang perlu
    // diisi, sesuai Matriks Alokasi JP (mis. "3" -> 3 slot berturutan sekali
    // jalan, otomatis, tidak perlu diklik-isi satu-satu).
    const opsiJp = formTetapJenis === 'mapel' ? opsiJpTetapDariMatriks() : []
    const jumlahJp = formTetapJenis === 'mapel' ? (formTetapJumlahJp || opsiJp[0] || 1) : 1

    if (editTetapId) {
      // Edit: hanya ubah baris yang sedang diedit (tidak mengubah jumlah slot -- kalau mau ubah JP, hapus & buat ulang).
      const updated = daftarJadwalTetap.map(jt => jt.id === editTetapId ? {
        ...jt, jenis: formTetapJenis, nama: namaAkhir, mapelId: formTetapJenis === 'mapel' ? formTetapMapelId : undefined, guruId: formTetapJenis === 'mapel' ? formTetapGuruId : undefined,
        hari: formTetapHari, waktuId: formTetapWaktuId,
        berlakuUntuk: formTetapBerlaku, lembagaIds: formTetapLembagaIds, rombelIds: formTetapRombelIds, warna: formTetapWarna
      } : jt)
      setDaftarJadwalTetap(updated); save('master_jadwal_tetap', updated)
    } else if (formTetapJenis === 'mapel' && jumlahJp > 1) {
      // Isi OTOMATIS beberapa slot berturutan mulai dari slot yang dipilih.
      const slotUrutMapel = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
      const idxMulai = slotUrutMapel.findIndex(s => s.id === formTetapWaktuId)
      if (idxMulai < 0) { alert('Slot waktu tidak valid.'); return }
      const slotTarget = slotUrutMapel.slice(idxMulai, idxMulai + jumlahJp)
      if (slotTarget.length < jumlahJp) { alert(`⚠️ Slot tidak cukup untuk menampung ${jumlahJp} JP berturutan mulai dari sini. Pilih slot yang lebih awal.`); return }
      const kelompokId = 'tetapgrp-' + Date.now()
      const barisBaru: JadwalTetap[] = slotTarget.map(s => ({
        id: 'tetap-' + Date.now() + '-' + s.id, jenis: 'mapel', nama: namaAkhir, mapelId: formTetapMapelId, guruId: formTetapGuruId,
        hari: formTetapHari, waktuId: s.id, berlakuUntuk: formTetapBerlaku, lembagaIds: formTetapLembagaIds, rombelIds: formTetapRombelIds, warna: formTetapWarna,
        kelompokId,
      }))
      const updated = [...daftarJadwalTetap, ...barisBaru]
      setDaftarJadwalTetap(updated); save('master_jadwal_tetap', updated)
    } else {
      const jt: JadwalTetap = {
        id: 'tetap-' + Date.now(), jenis: formTetapJenis, nama: namaAkhir,
        mapelId: formTetapJenis === 'mapel' ? formTetapMapelId : undefined, guruId: formTetapJenis === 'mapel' ? formTetapGuruId : undefined,
        hari: formTetapHari, waktuId: formTetapWaktuId, berlakuUntuk: formTetapBerlaku, lembagaIds: formTetapLembagaIds, rombelIds: formTetapRombelIds, warna: formTetapWarna
      }
      const updated = [...daftarJadwalTetap, jt]
      setDaftarJadwalTetap(updated); save('master_jadwal_tetap', updated)
    }
    resetFormTetap()
  }

  const handleEditTetap = (jt: JadwalTetap) => {
    setEditTetapId(jt.id); setFormTetapJenis(jt.jenis || 'kegiatan'); setFormTetapNama(jt.nama)
    setFormTetapMapelId(jt.mapelId || ''); setFormTetapGuruId(jt.guruId || '')
    setFormTetapHari(jt.hari); setFormTetapWaktuId(jt.waktuId)
    setFormTetapBerlaku(jt.berlakuUntuk); setFormTetapLembagaIds(jt.lembagaIds || []); setFormTetapRombelIds(jt.rombelIds || []); setFormTetapWarna(jt.warna)
  }

  const handleHapusTetap = (id: string) => {
    const target = daftarJadwalTetap.find(jt => jt.id === id)
    const pesanKonfirmasi = target?.kelompokId
      ? 'Jadwal ini adalah bagian dari sesi multi-JP berturutan. Hapus SEMUA slot dalam sesi ini sekaligus?'
      : 'Hapus jadwal tetap ini?'
    if (!confirm(pesanKonfirmasi)) return
    const filtered = target?.kelompokId
      ? daftarJadwalTetap.filter(jt => jt.kelompokId !== target.kelompokId)
      : daftarJadwalTetap.filter(jt => jt.id !== id)
    setDaftarJadwalTetap(filtered); save('master_jadwal_tetap', filtered)
    if (editTetapId === id) resetFormTetap()
  }

  // ============================================================
  // CRUD: LARANGAN MAPEL BERIRINGAN (dengan EDIT)
  // ============================================================
  const resetFormLarangan = () => {
    setEditLarId(null); setFormLarSetelahId(''); setFormLarDilarangIds([])
  }

  const handleSimpanLarangan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formLarSetelahId || !formLarDilarangIds.length) { alert('Pilih mapel "Setelah" dan minimal satu mapel yang dilarang.'); return }
    if (formLarDilarangIds.includes(formLarSetelahId)) { alert('Mapel "Setelah" tidak boleh sama dengan mapel yang dilarang.'); return }

    if (editLarId) {
      const updated = daftarLarangan.map(l => l.id === editLarId ? { ...l, setelahMapelId: formLarSetelahId, dilarangMapelIds: formLarDilarangIds } : l)
      setDaftarLarangan(updated); save('master_larangan_beriringan', updated)
    } else {
      const l: LaranganBeriringan = { id: 'larangan-' + Date.now(), setelahMapelId: formLarSetelahId, dilarangMapelIds: formLarDilarangIds }
      const updated = [...daftarLarangan, l]
      setDaftarLarangan(updated); save('master_larangan_beriringan', updated)
    }
    resetFormLarangan()
  }

  const handleEditLarangan = (l: LaranganBeriringan) => {
    setEditLarId(l.id); setFormLarSetelahId(l.setelahMapelId); setFormLarDilarangIds(l.dilarangMapelIds || [])
  }

  const handleHapusLarangan = (id: string) => {
    if (!confirm('Hapus aturan larangan beriringan ini?')) return
    const filtered = daftarLarangan.filter(l => l.id !== id)
    setDaftarLarangan(filtered); save('master_larangan_beriringan', filtered)
    if (editLarId === id) resetFormLarangan()
  }

  // ============================================================
  // CRUD: PIKET GURU
  // ============================================================
  const handleTogglePiket = (lembagaId: string, hari: string, guruId: string) => {
    const currentLembagaDraft = piketDraft[lembagaId] || {}
    const current = currentLembagaDraft[hari] || []
    const updated = current.includes(guruId) ? current.filter(g => g !== guruId) : [...current, guruId]
    const newDraft = { ...piketDraft, [lembagaId]: { ...currentLembagaDraft, [hari]: updated } }
    setPiketDraft(newDraft)

    const newPiketList: PiketGuru[] = Object.keys(newDraft).flatMap(lId =>
      LIST_HARI.map(h => ({
        id: `piket-${lId}-${h}`,
        hari: h,
        lembagaId: lId,
        guruIds: newDraft[lId]?.[h] || []
      }))
    ).filter(p => p.guruIds.length > 0)
    setDaftarPiket(newPiketList)
    save('master_piket_guru', newPiketList)
  }

  // ============================================================
  // SIMPAN SEMESTER & TITIMANGSA/TTD
  // ============================================================
  const handleSimpanSemester = (val: string) => {
    setSemesterAktif(val); save('jadwal_semester_aktif', val)
  }

  const handleSimpanTtd = (e: React.FormEvent) => {
    e.preventDefault()
    save('jadwal_titimangsa_ttd', ttd)
    alert('Titimangsa berhasil disimpan!')
  }

  const updateTtdField = (field: keyof TandaTangan, value: string) => {
    setTtd(prev => ({ ...prev, [field]: value }))
  }

  // Update keterangan untuk satu unit (key 'semua' = Lembaga Induk/Keseluruhan), auto-save ke localStorage.
  const updateKeteranganUnit = (unitId: string, value: string) => {
    const updated = { ...keteranganUnit, [unitId]: value }
    setKeteranganUnit(updated)
    save('jadwal_keterangan_unit', updated)
  }

  // --- DETEKSI OTOMATIS: MUDIR LEMBAGA INDUK ---
  // Logikanya sama persis dengan halaman Identitas Lembaga: cari peran yang namanya
  // mengandung "mudir" atau "pimpinan yayasan", lalu cari guru dengan unitIds berisi
  // 'lembaga-induk' dan peranIds berisi peran tsb.
  const getMudirPusat = (): Penandatangan => {
    const peranMudir = daftarPeran.find(
      p => p.nama?.toLowerCase().includes('mudir') || p.nama?.toLowerCase().includes('pimpinan yayasan')
    )
    if (!peranMudir) return { label: 'Mudir / Pimpinan Yayasan', nama: '(Peran Mudir belum diatur)', nuptk: '-' }
    const mudir = daftarGuru.find(g => g.unitIds?.includes('lembaga-induk') && g.peranIds?.includes(peranMudir.id))
    return {
      label: `Mudir ${identitasInduk.nama || ''}`.trim(),
      nama: mudir ? mudir.nama : '(Mudir belum ditugaskan di Kelola Data Guru)',
      nuptk: mudir?.nuptk || mudir?.nip || '-',
      ttd: identitasInduk.ttdKepala || '',
    }
  }

  // --- DETEKSI OTOMATIS: KEPALA SATUAN UNIT ---
  // Sama dengan logika getKepalaSekolahUnit() di halaman Identitas Lembaga: cari peran
  // "kepala sekolah" / "pimpinan unit", lalu cari guru dengan unitIds berisi unitId tsb.
  const getKepalaSatuanUnit = (unitId: string): Penandatangan => {
    const unit = daftarLembaga.find(l => l.id === unitId)
    const namaUnit = unit?.nama || 'Unit'
    const peranKepsek = daftarPeran.find(
      p => p.nama?.toLowerCase().includes('kepala sekolah') || p.nama?.toLowerCase().includes('pimpinan unit')
    )
    if (!peranKepsek) return { label: `Kepala ${namaUnit}`, nama: '(Peran Kepala Sekolah belum diatur)', nuptk: '-' }
    const kepsek = daftarGuru.find(g => g.unitIds?.includes(unitId) && g.peranIds?.includes(peranKepsek.id))
    return {
      label: `Kepala ${namaUnit}`,
      nama: kepsek ? kepsek.nama : '(Kepala Sekolah belum ditugaskan di Kelola Data Guru)',
      nuptk: kepsek?.nuptk || kepsek?.nip || '-',
      ttd: unit?.ttdKepala || '',
    }
  }

  // --- DETEKSI OTOMATIS: WAKA KURIKULUM UNIT (atau Direktur Kurikulum untuk Lembaga Induk) ---
  // Sama pola dengan Mudir/Kepala Satuan: cari peran yang namanya mengandung "waka kurikulum",
  // "wakil kepala kurikulum", atau "kurikulum", lalu cari guru dengan unitIds berisi unitId tsb.
  const getWakaKurikulumUnit = (unitId: string): Penandatangan => {
    const unit = daftarLembaga.find(l => l.id === unitId)
    const namaUnit = unitId === 'lembaga-induk' || unitId === 'semua' ? (identitasInduk.nama || 'Lembaga') : (unit?.nama || 'Unit')
    const peranWaka = daftarPeran.find(
      p => p.nama?.toLowerCase().includes('waka kurikulum') ||
           p.nama?.toLowerCase().includes('wakil kepala kurikulum') ||
           p.nama?.toLowerCase().includes('kurikulum')
    )
    if (!peranWaka) return { label: `Wakakur ${namaUnit}`, nama: '(Peran Waka Kurikulum belum diatur)', nuptk: '-' }
    const scopeId = unitId === 'semua' ? 'lembaga-induk' : unitId
    const waka = daftarGuru.find(g => g.unitIds?.includes(scopeId) && g.peranIds?.includes(peranWaka.id))
    return {
      label: `Wakakur ${namaUnit}`,
      nama: waka ? waka.nama : '(Waka Kurikulum belum ditugaskan di Kelola Data Guru)',
      nuptk: waka?.nuptk || waka?.nip || '-',
      ttd: (unitId === 'semua' || unitId === 'lembaga-induk') ? (identitasInduk.ttdWakakur || '') : (unit?.ttdWakakur || ''),
    }
  }

  // Tentukan penandatangan sesuai cakupan yang sedang ditampilkan/diunduh:
  // - 'semua' (Lembaga Induk / Keseluruhan) -> Mudir
  // - unit tertentu -> Kepala Satuan unit tsb
  const getPenandatangan = (targetLembagaId: string): Penandatangan => {
    if (targetLembagaId === 'semua') return getMudirPusat()
    return getKepalaSatuanUnit(targetLembagaId)
  }

  // Gabungan sepasang penandatangan (Kepala/Mudir di kiri, Waka Kurikulum di kanan) sesuai cakupan unduhan.
  const getPenandatanganPasangan = (targetLembagaId: string): PasanganPenandatangan => {
    return {
      kepala: getPenandatangan(targetLembagaId),
      wakaKurikulum: getWakaKurikulumUnit(targetLembagaId)
    }
  }

  // ============================================================
  // VALIDASI
  // ============================================================
  const isPasanganGabungan = (mapelId: string, rA: string, rB: string) => {
    if (rA === rB) return true
    return daftarKelasGabungan.some(kg => kg.mapelId === mapelId && kg.rombelIds?.includes(rA) && kg.rombelIds?.includes(rB))
  }

  const hitungJpGuruHari = (guruId: string, hari: string, kecuali?: string) => {
    const s = new Set<string>()
    daftarJadwal.forEach(j => {
      if (j.guruId !== guruId || j.hari !== hari || j.id === kecuali) return
      const sw = daftarWaktu.find(w => w.id === j.waktuId)
      if (sw && sw.jenis === 'mapel') s.add(j.waktuId)
    })
    // Jadwal Berlaku Umum (jenis Mata Pelajaran) yang melibatkan guru ini
    // pada hari yang sama juga ikut dihitung, supaya rekap per hari selalu
    // konsisten dengan Total JP (yang sudah menghitungnya sejak awal).
    daftarJadwalTetap.forEach(jt => {
      if (jt.jenis !== 'mapel' || jt.guruId !== guruId || jt.id === kecuali) return
      const hariOk = jt.hari === hari || jt.hari === 'Semua'
      if (!hariOk) return
      const sw = daftarWaktu.find(w => w.id === jt.waktuId)
      if (sw && sw.jenis === 'mapel') s.add(jt.waktuId)
    })
    return s.size
  }

  // Hitung target JP (per-sesi) yang BELUM terpakai untuk kombinasi
  // guru+mapel+rombel tertentu, dengan MEMPERHITUNGKAN sesi yang sudah final
  // di hari-hari LAIN (di luar "hariDiabaikan", biasanya hari yang sedang
  // diedit). Dipakai bersama oleh validasiSlot (blokir) dan UI pilihan JP
  // (supaya opsi yang sudah terpakai tidak ditawarkan lagi).
  const hitungTargetTersisaJp = (guruId: string, mapelId: string, rombelId: string, hariDiabaikan: string, kecuali?: string): number[] => {
    const kuotaStr = matriksRinciJp[`${guruId}_${mapelId}_${rombelId}`] || ''
    const target = kuotaStr.split(',').map(x => Number(x.trim())).filter(n => !isNaN(n) && n > 0)
    if (!target.length) return []
    const slotSorted = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
    const entriHariLain = daftarJadwal.filter(j =>
      j.id !== kecuali && j.hari !== hariDiabaikan && j.guruId === guruId && j.rombelId === rombelId && j.mapelId === mapelId
    )
    const perHariLain = new Map<string, number[]>()
    entriHariLain.forEach(j => {
      const idx = slotSorted.findIndex(s => s.id === j.waktuId)
      if (idx < 0) return
      if (!perHariLain.has(j.hari)) perHariLain.set(j.hari, [])
      perHariLain.get(j.hari)!.push(idx)
    })
    const sisa = [...target]
    perHariLain.forEach(idxList => {
      idxList.sort((a, b) => a - b)
      let panjang = 1, maxPanjang = 1
      for (let i = 1; i < idxList.length; i++) {
        panjang = idxList[i] === idxList[i - 1] + 1 ? panjang + 1 : 1
        maxPanjang = Math.max(maxPanjang, panjang)
      }
      const pos = sisa.indexOf(maxPanjang)
      if (pos >= 0) sisa.splice(pos, 1)
    })
    return sisa
  }

  const validasiSlot = (params: { hari: string; waktuId: string; rombelId: string; guruId: string; mapelId: string; kecuali?: string }) => {
    const { hari, waktuId, rombelId, guruId, mapelId, kecuali } = params
    const sw = daftarWaktu.find(w => w.id === waktuId)
    if (!sw || sw.jenis !== 'mapel') return { ok: true }
    const namaG = daftarGuru.find(g => g.id === guruId)?.nama || 'Pendidik'

    // Kombinasi guru+mapel+kelas ini sudah diatur lewat Jadwal Berlaku Umum
    // (jenis Mata Pelajaran) -- TIDAK BOLEH diisi manual lagi di sini, supaya
    // tidak dobel. Kalau mau ubah, edit lewat Jadwal Berlaku Umum.
    const sudahDiBerlakuUmum = daftarJadwalTetap.some(jt =>
      jt.jenis === 'mapel' && jt.guruId === guruId && jt.mapelId === mapelId &&
      (jt.berlakuUntuk === 'semua' || (jt.berlakuUntuk === 'rombel' && jt.rombelIds?.includes(rombelId)) || (jt.berlakuUntuk === 'lembaga' && getRombelLembagaId(rombelId) && jt.lembagaIds?.includes(getRombelLembagaId(rombelId)!)))
    )
    if (sudahDiBerlakuUmum) {
      const namaM = daftarMapel.find((m: any) => m.id === mapelId)?.nama || mapelId
      return { ok: false, pesan: `${namaM} untuk ${namaG} di kelas ini SUDAH diatur lewat Jadwal Berlaku Umum. Tidak bisa diisi manual lagi di sini (supaya tidak dobel) -- kalau mau ubah, edit lewat menu Jadwal Berlaku Umum.` }
    }

    // Guru ini sudah "sibuk" di jam ini karena ada Jadwal Berlaku Umum
    // (kegiatan ATAU mata pelajaran) yang melibatkan dia di hari+jam yang
    // sama -- tidak boleh dijadwalkan mengajar hal lain di jam yang sama.
    const bentrokDiBerlakuUmum = daftarJadwalTetap.find(jt => {
      if (jt.guruId !== guruId) return false
      const hariOk = jt.hari === hari || jt.hari === 'Semua'
      if (!hariOk || jt.waktuId !== waktuId) return false
      return true
    })
    if (bentrokDiBerlakuUmum) {
      return { ok: false, pesan: `BENTROK PENDIDIK: ${namaG} sudah terjadwal di Jadwal Berlaku Umum ("${bentrokDiBerlakuUmum.nama}") pada ${hari} jam yang sama.` }
    }

    const bentrokGuru = daftarJadwal.find(j => {
      if (j.id === kecuali) return false
      if (!(j.hari === hari && j.waktuId === waktuId && j.guruId === guruId)) return false
      return !(j.mapelId === mapelId && isPasanganGabungan(mapelId, rombelId, j.rombelId))
    })
    if (bentrokGuru) {
      const namaR = daftarRombel.find(r => r.id === bentrokGuru.rombelId)?.nama || bentrokGuru.rombelId
      return { ok: false, pesan: `BENTROK PENDIDIK: ${namaG} sudah terjadwal di Kelas ${namaR} pada ${hari} jam yang sama.` }
    }

    const bentrokRombel = daftarJadwal.find(j =>
      j.id !== kecuali && j.hari === hari && j.waktuId === waktuId && j.rombelId === rombelId &&
      !(j.mapelId === mapelId && isPasanganGabungan(mapelId, rombelId, j.rombelId))
    )
    if (bentrokRombel) {
      const namaR = daftarRombel.find(r => r.id === rombelId)?.nama || rombelId
      const namaM = daftarMapel.find(m => m.id === bentrokRombel.mapelId)?.nama || ''
      return { ok: false, pesan: `BENTROK KELAS: Kelas ${namaR} sudah ada "${namaM}" di ${hari} jam yang sama.` }
    }

    // ── Aturan keras: guru TIDAK BOLEH mengajar SESI TERPISAH di rombel yang
    //    sama pada hari yang sama (mis. sudah ada sesi 2JP, lalu mencoba
    //    menambah sesi 3JP LAGI di hari yang sama) -- tapi slot yang BERTURUTAN
    //    (bersambung langsung, tanpa jeda slot lain) dianggap BAGIAN DARI SATU
    //    SESI yang sama sedang disusun (mis. 3JP = 3 sel berturutan), jadi
    //    itu tetap diperbolehkan.
    const slotMapelSorted = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
    const idxSlotIni = slotMapelSorted.findIndex(s => s.id === waktuId)
    const entriRombelHariIni = daftarJadwal.filter(j =>
      j.id !== kecuali && j.hari === hari && j.guruId === guruId && j.rombelId === rombelId && j.waktuId !== waktuId
    )
    if (entriRombelHariIni.length > 0) {
      const adaYangBerturutan = entriRombelHariIni.some(j => {
        const idxLain = slotMapelSorted.findIndex(s => s.id === j.waktuId)
        return idxLain >= 0 && idxSlotIni >= 0 && Math.abs(idxLain - idxSlotIni) === 1
      })
      if (!adaYangBerturutan) {
        const namaR = daftarRombel.find(r => r.id === rombelId)?.nama || rombelId
        return { ok: false, pesan: `SESI TERPISAH DI HARI SAMA: ${namaG} sudah punya sesi mengajar Kelas ${namaR} pada ${hari} di jam lain (tidak berturutan) — satu guru tidak boleh punya 2 sesi terpisah di kelas yang sama dalam sehari. Kalau ini masih bagian sesi yang sama, isi jam yang bersambung langsung.` }
      }
    }

    // ── Aturan keras: panjang SATU SESI berturutan harus PAS sesuai salah satu
    //    angka yang tertulis di Matriks Alokasi JP (mis. "2,3" = sesi harus 2
    //    ATAU 3 JP, tidak boleh 4/5/dst). Kalau sesi 3-nya SUDAH terisi penuh
    //    di hari lain, sisa target tinggal "2" -- jadi sesi yang sedang
    //    disusun ini tidak boleh melebihi 2 JP lagi (tidak boleh dipecah jadi
    //    ukuran lain di luar yang tersisa di matriks).
    const kuotaStrCek = matriksRinciJp[`${guruId}_${mapelId}_${rombelId}`] || ''
    if (kuotaStrCek) {
      const targetTersisa = hitungTargetTersisaJp(guruId, mapelId, rombelId, hari, kecuali)
      const maksSesi = targetTersisa.length > 0 ? Math.max(...targetTersisa) : 0
      if (maksSesi > 0) {
        // Cari seluruh rangkaian slot BERTURUTAN (termasuk slot baru ini) untuk
        // kombinasi guru+mapel+rombel+hari ini, lalu hitung total panjangnya.
        const semuaEntriHariIni = daftarJadwal.filter(j =>
          j.id !== kecuali && j.hari === hari && j.guruId === guruId && j.rombelId === rombelId && j.mapelId === mapelId
        )
        const idxTerpakai = new Set(semuaEntriHariIni.map(j => slotMapelSorted.findIndex(s => s.id === j.waktuId)).filter(i => i >= 0))
        idxTerpakai.add(idxSlotIni)
        // Rayapi ke kiri & kanan dari slot baru ini untuk menemukan panjang rangkaian berturutan yang memuatnya.
        let kiri = idxSlotIni, kanan = idxSlotIni
        while (idxTerpakai.has(kiri - 1)) kiri--
        while (idxTerpakai.has(kanan + 1)) kanan++
        const panjangSesi = kanan - kiri + 1
        if (panjangSesi > maksSesi) {
          return { ok: false, pesan: `SESI TIDAK SESUAI MATRIKS: Alokasi JP untuk kombinasi ini adalah "${kuotaStrCek}". Sisa sesi yang belum terpakai maksimal ${maksSesi} JP, tapi sesi yang sedang disusun ini akan jadi ${panjangSesi} JP berturutan. Sesi tidak boleh dipecah/melebihi ukuran yang tersisa di Matriks.` }
        }
      } else {
        return { ok: false, pesan: `SEMUA SESI SUDAH TERPAKAI: Alokasi JP "${kuotaStrCek}" untuk kombinasi ini sudah terisi penuh sesuai jumlah & ukuran sesinya. Tidak bisa menambah sesi baru lagi.` }
      }
    }

    // ── Aturan keras: Request Ketersediaan Hari (tanda "-") -- kalau guru ini
    //    memang ditandai TIDAK BISA pada hari tsb, nama guru tidak bisa
    //    diinputkan sama sekali di hari itu.
    const reqStr = requestHariJp[`${guruId}_${hari}`] || ''
    if (reqStr.trim() === '-') {
      return { ok: false, pesan: `TIDAK TERSEDIA: ${namaG} ditandai TIDAK BISA mengajar pada hari ${hari} (lihat Request Ketersediaan Hari). Nama guru tidak bisa diinputkan di hari ini.` }
    }
    if (!blokSesuaiKetersediaan(reqStr, [Number(sw.jamKe)])) {
      return { ok: false, pesan: `DI LUAR JAM TERSEDIA: ${namaG} hanya bersedia mengajar pada jam tertentu di hari ${hari} sesuai Request Ketersediaan Hari, dan jam ${sw.jamKe} ini berada di luar itu.` }
    }

    // ── Aturan keras: kuota JP mingguan sesuai Matriks Alokasi JP (mis. "2,3"
    //    = 2 sesi/minggu, total 5 JP) -- kalau sudah terpenuhi semua, TIDAK
    //    BISA ditambah lagi sesi/JP baru untuk kombinasi guru+mapel+kelas ini,
    //    karena jam mengajarnya memang sudah habis dijadwalkan sesuai matriks.
    const kuotaStr = matriksRinciJp[`${guruId}_${mapelId}_${rombelId}`] || ''
    const infoTambahan: string[] = []
    if (kuotaStr) {
      const totalKuota = hitungJpStr(kuotaStr)
      const sudahDipakai = new Set(
        daftarJadwal.filter(j => j.id !== kecuali && j.guruId === guruId && j.mapelId === mapelId && j.rombelId === rombelId).map(j => `${j.hari}_${j.waktuId}`)
      ).size
      if (sudahDipakai + 1 > totalKuota) {
        return { ok: false, pesan: `KUOTA JP HABIS: Matriks Alokasi JP untuk kombinasi ini cuma ${totalKuota} JP/minggu (${kuotaStr}), dan itu sudah terpenuhi semua. Tidak bisa menambah jam mengajar lagi untuk kombinasi guru+mapel+kelas ini minggu ini.` }
      }
      const sisaSetelahIni = totalKuota - (sudahDipakai + 1)
      if (sisaSetelahIni > 0) {
        infoTambahan.push(`Info: masih ada sisa ${sisaSetelahIni} JP lagi untuk kombinasi ini minggu ini sesuai Matriks Alokasi JP.`)
      }
    }

    const sudahGuru = daftarJadwal.some(j => j.id !== kecuali && j.guruId === guruId && j.hari === hari && j.waktuId === waktuId)
    const jpHari = hitungJpGuruHari(guruId, hari, kecuali)
    if (!sudahGuru && jpHari + 1 > maksJpGuruPerHari) {
      return { ok: false, pesan: `MELEBIHI BATAS: ${namaG} sudah ${jpHari} JP pada ${hari} (maks ${maksJpGuruPerHari}).` }
    }

    // ── Informasi (bukan blokir): guru piket ──────────────────────────────
    const piketHariIni = daftarPiket.find(pk => pk.hari === hari && pk.guruIds.includes(guruId))
    if (piketHariIni) {
      infoTambahan.push(`Perhatian: ${namaG} bertugas PIKET pada hari ${hari} ini.`)
    }

    return { ok: true, info: infoTambahan.length > 0 ? infoTambahan.join(' ') : undefined }
  }

  // ============================================================
  // MATRIKS HELPER
  // ============================================================
  const hitungJpStr = (s: string) => s ? s.split(',').map(x => Number(x.trim())).filter(n => !isNaN(n)).reduce((a, b) => a + b, 0) : 0

  const getMatriksRows = () => {
    const rows: any[] = []
    daftarGuru.forEach(guru => {
      if (!guru.mapelIds?.length) return
      guru.mapelIds.forEach((mId: string) => {
        const mapel = daftarMapel.find(m => m.id === mId)
        if (!mapel) return
        const rombelRelevant: string[] = guru.mapelRombel?.[mId] || guru.rombelIds || []
        rows.push({ guru, mapel, rombelRelevant })
      })
    })
    return rows
  }

  // ============================================================
  // ============================================================
  // GENERATE OTOMATIS — Window-paired 3JP + async multi-attempt
  // ============================================================
  // ── UNDO satu langkah terakhir ───────────────────────────────────────────
  // Sebelum tindakan yang MENGHAPUS/MENIMPA jadwal secara besar-besaran
  // (Hapus Hasil Generate, Generate Otomatis), simpan dulu kondisi jadwal
  // SEBELUM tindakan itu ke localStorage (bukan lewat cloud sync, cukup
  // lokal saja, karena ini cuma jaring pengaman sesaat) -- supaya kalau
  // ternyata hasilnya tidak sesuai harapan, bisa dikembalikan satu langkah.
  const simpanSnapshotUndo = (deskripsi: string) => {
    try {
      localStorage.setItem(kunciTahun('_undo_jadwal_snapshot'), JSON.stringify({
        data: daftarJadwal, waktu: Date.now(), deskripsi,
      }))
    } catch (e) { console.warn('Gagal menyimpan snapshot undo:', e) }
  }

  const [undoTersedia, setUndoTersedia] = useState<{ deskripsi: string; waktu: number } | null>(null)

  const cekUndoTersedia = () => {
    try {
      const s = localStorage.getItem(kunciTahun('_undo_jadwal_snapshot'))
      if (s) { const parsed = JSON.parse(s); setUndoTersedia({ deskripsi: parsed.deskripsi, waktu: parsed.waktu }) }
      else setUndoTersedia(null)
    } catch { setUndoTersedia(null) }
  }

  const handleUndoJadwal = () => {
    try {
      const s = localStorage.getItem(kunciTahun('_undo_jadwal_snapshot'))
      if (!s) { alert('Tidak ada tindakan untuk dibatalkan.'); return }
      const parsed = JSON.parse(s)
      if (!confirm(`Kembalikan jadwal ke kondisi SEBELUM "${parsed.deskripsi}"? Jadwal yang ada SEKARANG akan diganti dengan kondisi sebelumnya.`)) return
      setDaftarJadwal(parsed.data)
      save('data_jadwal_pelajaran', parsed.data)
      localStorage.removeItem(kunciTahun('_undo_jadwal_snapshot'))
      setUndoTersedia(null)
      alert('Berhasil dikembalikan ke kondisi sebelumnya.')
    } catch (e) {
      alert('Gagal undo: ' + String(e))
    }
  }

  const handleHapusHasilGenerate = () => {
    if (unitScopeGenerate && (generateScope === 'semua' || !unitScopeGenerate.includes(generateScope))) {
      alert('Akun Anda tidak berwenang untuk cakupan ini. Hanya bisa menghapus/generate jadwal untuk unit yang Anda kelola.')
      return
    }
    const rombelTarget: string[] = generateScope === 'semua'
      ? daftarRombel.map(r => r.id)
      : getRombelsByLembaga(generateScope).map((r: any) => r.id)
    const rombelTargetSet = new Set(rombelTarget)
    if (!rombelTarget.length) { alert('Tidak ada kelas/rombel pada cakupan yang dipilih.'); return }

    const namaCakupan = generateScope === 'semua' ? 'SELURUH LEMBAGA'
      : (daftarLembaga.find(l => l.id === generateScope)?.nama || 'unit terpilih')
    const jumlahTerdampak = daftarJadwal.filter(j => rombelTargetSet.has(j.rombelId)).length
    if (!jumlahTerdampak) { alert(`Tidak ada jadwal untuk cakupan "${namaCakupan}" yang perlu dihapus.`); return }
    if (!confirm(`Hapus SELURUH jadwal (${jumlahTerdampak} slot) untuk cakupan: ${namaCakupan}?\nBisa di-undo satu kali kalau ternyata salah.`)) return

    simpanSnapshotUndo(`Hapus Hasil Generate (${namaCakupan})`)
    const sisa = daftarJadwal.filter(j => !rombelTargetSet.has(j.rombelId))
    setDaftarJadwal(sisa)
    save('data_jadwal_pelajaran', sisa)
    setUndoTersedia({ deskripsi: `Hapus Hasil Generate (${namaCakupan})`, waktu: Date.now() })
    alert(`Berhasil menghapus ${jumlahTerdampak} slot jadwal untuk cakupan "${namaCakupan}". (Bisa di-undo lewat tombol "Undo Terakhir" kalau perlu.)`)
  }

  const handleGenerate = () => {
    if (isGenerating) { generateCancelRef.current = true; return }
    if (unitScopeGenerate && (generateScope === 'semua' || !unitScopeGenerate.includes(generateScope))) {
      alert('Akun Anda tidak berwenang untuk cakupan ini. Hanya bisa men-generate jadwal untuk unit yang Anda kelola.')
      return
    }
    const matriksRows = getMatriksRows()
    if (!matriksRows.length) { alert('Belum ada data guru/matriks.'); return }

    const rombelTarget: string[] = generateScope === 'semua'
      ? daftarRombel.map(r => r.id)
      : getRombelsByLembaga(generateScope).map((r: any) => r.id)
    const rombelTargetSet = new Set(rombelTarget)
    if (!rombelTarget.length) { alert('Tidak ada kelas/rombel pada cakupan yang dipilih.'); return }

    const namaCakupan = generateScope === 'semua' ? 'SELURUH LEMBAGA'
      : (daftarLembaga.find(l => l.id === generateScope)?.nama || 'unit terpilih')
    if (!confirm(`Generate jadwal untuk: ${namaCakupan}.\nProses berjalan di latar hingga sempurna. Lanjutkan?`)) return

    const jadwalLuar: any[] = daftarJadwal.filter(j => !rombelTargetSet.has(j.rombelId))
    const slotMapel = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
    if (!slotMapel.length) { alert('Belum ada slot waktu JP.'); return }
    const allSlotsUrut = [...daftarWaktu].sort((a, b) => Number(a.jamKe || 0) - Number(b.jamKe || 0))

    // ── Jendela 2×3JP per hari (KETAT: hanya slot ini untuk 3JP berpasangan) ─
    // Senin     : jam 5-10  → half1=5,6,7  half2=8,9,10
    // Sel-Kamis : jam 1-6   → half1=1,2,3  half2=4,5,6
    // Jumat     : jam 3-8   → half1=3,4,5  half2=6,7,8
    const JENDELA: Record<string, [number, number]> = {
      'Senin': [5, 8], 'Selasa': [1, 4], 'Rabu': [1, 4], 'Kamis': [1, 4], 'Jumat': [3, 6]
    }
    const slotByJam = (j: number) => slotMapel.find(s => Number(s.jamKe) === j)
    const half = (j: number) => [slotByJam(j), slotByJam(j+1), slotByJam(j+2)].filter(Boolean) as any[]

    // ── Helpers ───────────────────────────────────────────────────────────────
    const adaIstirahat = (idA: string, idB: string) => {
      const iA = allSlotsUrut.findIndex(s => s.id === idA), iB = allSlotsUrut.findIndex(s => s.id === idB)
      if (iA < 0 || iB < 0) return false
      const lo = Math.min(iA, iB), hi = Math.max(iA, iB)
      return allSlotsUrut.slice(lo, hi + 1).some(s => s.jenis === 'istirahat')
    }

    const getTetap = (hari: string, wId: string, rId: string) => daftarJadwalTetap.find(jt => {
      if ((jt.hari !== hari && jt.hari !== 'Semua') || jt.waktuId !== wId) return false
      if (jt.berlakuUntuk === 'semua') return true
      if (jt.berlakuUntuk === 'rombel') return jt.rombelIds.includes(rId)
      if (jt.berlakuUntuk === 'lembaga') { const lId = getRombelLembagaId(rId); return lId ? jt.lembagaIds.includes(lId) : false }
      return false
    })

    const slotBebas = (arr: any[], hari: string, wId: string, rId: string, guruId: string): boolean => {
      if (arr.some(x => x.hari === hari && x.waktuId === wId && x.guruId === guruId && x.rombelId !== rId)) return false
      if (arr.some(x => x.hari === hari && x.waktuId === wId && x.rombelId === rId)) return false
      if (getTetap(hari, wId, rId)) return false
      return true
    }

    const jpHari = (arr: any[], gId: string, hari: string) =>
      new Set(arr.filter(x => x.hari === hari && x.guruId === gId).map(x => x.waktuId)).size

    const cekBer = (arr: any[], hari: string, blok: any[], rId: string, mId: string): boolean => {
      if (!daftarLarangan.length) return false
      const iA = slotMapel.findIndex(s => s.id === blok[0].id)
      const iZ = slotMapel.findIndex(s => s.id === blok[blok.length - 1].id)
      if (iA > 0) {
        const prev = slotMapel[iA - 1]
        if (!adaIstirahat(prev.id, blok[0].id)) {
          const mP = arr.find(x => x.hari === hari && x.waktuId === prev.id && x.rombelId === rId)?.mapelId
          if (mP && daftarLarangan.find(l => l.setelahMapelId === mP)?.dilarangMapelIds.includes(mId)) return true
        }
      }
      if (iZ < slotMapel.length - 1) {
        const next = slotMapel[iZ + 1]
        if (!adaIstirahat(blok[blok.length - 1].id, next.id)) {
          const mN = arr.find(x => x.hari === hari && x.waktuId === next.id && x.rombelId === rId)?.mapelId
          if (mN && daftarLarangan.find(l => l.setelahMapelId === mId)?.dilarangMapelIds.includes(mN)) return true
        }
      }
      return false
    }

    // ── Susun tugas ───────────────────────────────────────────────────────────
    interface T { guru: any; mapel: any; rId: string; panjang: number; sesiIdx: number; hD: Set<string>; ks: Record<string,string> }
    const semuaTugas: T[] = []
    // Kombinasi guru+mapel+kelas yang SUDAH diatur lewat Jadwal Berlaku Umum
    // (jenis Mata Pelajaran) TIDAK BOLEH ikut digenerate lagi di sini --
    // kalau tetap digenerate, jadwalnya jadi DOBEL (satu dari Jadwal Berlaku
    // Umum, satu lagi hasil generate biasa).
    const sudahDiaturBerlakuUmum = (guruId: string, mapelId: string, rombelId: string): boolean =>
      daftarJadwalTetap.some(jt =>
        jt.jenis === 'mapel' && jt.guruId === guruId && jt.mapelId === mapelId &&
        (jt.berlakuUntuk === 'semua' || (jt.berlakuUntuk === 'rombel' && jt.rombelIds?.includes(rombelId)) || (jt.berlakuUntuk === 'lembaga' && getRombelLembagaId(rombelId) && jt.lembagaIds?.includes(getRombelLembagaId(rombelId)!)))
      )
    matriksRows.forEach(({ guru, mapel, rombelRelevant }) => {
      rombelRelevant.filter((r: string) => rombelTargetSet.has(r)).forEach((rId: string) => {
        if (sudahDiaturBerlakuUmum(guru.id, mapel.id, rId)) return
        const str = matriksRinciJp[`${guru.id}_${mapel.id}_${rId}`] || ''
        if (!str) return
        const sesi = str.split(',').map(x => Number(x.trim())).filter(n => n > 0)
        const ks: Record<string,string> = {}, hD = new Set<string>()
        LIST_HARI.forEach(h => { const v = requestHariJp[`${guru.id}_${h}`] || ''; ks[h] = v; if (v.trim() === '-') hD.add(h) })
        sesi.forEach((panjang, sesiIdx) => semuaTugas.push({ guru, mapel, rId, panjang, sesiIdx, hD, ks }))
      })
    })
    // PENTING: kelas GABUNGAN (satu guru+mapel yang sama diajar bareng utk
    // beberapa kelas SEKALIGUS) diproses PALING AWAL, sebelum tugas kelas
    // biasa lainnya -- supaya slotnya masih paling longgar/banyak pilihan
    // saat dicarikan waktu, sehingga jauh lebih mungkin semua kelas dalam
    // grup gabungan itu mendapat slot yang SAMA (bukan tercecer beda waktu
    // karena keburu kehabisan slot kosong akibat diproses belakangan).
    const isTugasGabungan = (t: T) => daftarKelasGabungan.some(kg => kg.mapelId === t.mapel.id && kg.rombelIds?.includes(t.rId) && kg.rombelIds?.length > 1)
    semuaTugas.sort((a, b) => Number(isTugasGabungan(b)) - Number(isTugasGabungan(a)))

    // ── Fungsi satu percobaan ─────────────────────────────────────────────────
    type Hasil = { arr: any[]; gagal: string[]; req: string[]; ber: string[] }

    const acak = <T,>(a: T[]): T[] => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a }
    // Acak bertingkat: tugas kelas GABUNGAN tetap didahulukan (diacak di antara
    // sesamanya), baru kemudian tugas biasa (diacak di antara sesamanya) --
    // supaya urutan prioritas dari semuaTugas.sort() di atas tidak hilang
    // begitu saja saat di-acak untuk variasi, tapi keragaman jadwal antar
    // percobaan generate tetap terjaga.
    const acakPrioritasGabungan = (a: T[]): T[] => {
      const gab = acak(a.filter(isTugasGabungan))
      const biasa = acak(a.filter(t => !isTugasGabungan(t)))
      return [...gab, ...biasa]
    }

    const satu = (): Hasil => {
      const arr: any[] = jadwalLuar.slice()
      const gagal: string[] = [], req: string[] = [], ber: string[] = []

      // hariUsed: cegah mapel yang sama muncul dua kali di hari yang sama untuk kelas yang sama
      const huMap = new Map<string, Set<string>>()
      const getHU = (t: T) => { const k=`${t.guru.id}_${t.mapel.id}_${t.rId}`; if(!huMap.has(k)) huMap.set(k,new Set()); return huMap.get(k)! }
      const nm = (t: T) => `${t.guru.nama}-${t.mapel.nama}(${daftarRombel.find((r:any)=>r.id===t.rId)?.nama||t.rId})s${t.sesiIdx+1}`

      // Slot ID yang termasuk window hari tertentu
      const winIds = (hari: string): Set<string> => {
        const j=JENDELA[hari]; if(!j) return new Set()
        const s=new Set<string>()
        half(j[0]).forEach((x:any)=>s.add(x.id)); half(j[1]).forEach((x:any)=>s.add(x.id))
        return s
      }

      // tanam biasa: cek konflik guru + kelas + jadwal tetap + guru masuk kelas sama 2x sehari
      // Guru dianggap "sibuk" di suatu hari+slot kalau dia terlibat di Jadwal
      // Berlaku Umum (kegiatan ATAU mata pelajaran) pada hari+slot itu --
      // tidak boleh dijadwalkan mengajar hal lain di waktu yang sama.
      const guruSibukDiBerlakuUmum = (gId: string, hari: string, waktuId: string): boolean =>
        daftarJadwalTetap.some(jt => jt.guruId === gId && (jt.hari === hari || jt.hari === 'Semua') && jt.waktuId === waktuId)

      const tanam = (arr:any[], hari:string, blok:any[], rId:string, gId:string, mId:string):boolean => {
        // Aturan keras: satu guru TIDAK BOLEH masuk ke rombel yang sama dua kali
        // dalam satu hari, walau beda mata pelajaran/jam (kecuali sebagai bagian
        // dari blok yang sama yang sedang ditanam saat ini).
        if (arr.some(x=>x.hari===hari&&x.guruId===gId&&x.rombelId===rId)) return false
        for (const s of blok) {
          if (arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.guruId===gId&&x.rombelId!==rId)) return false
          if (arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.rombelId===rId)) return false
          if (getTetap(hari,s.id,rId)) return false
          if (guruSibukDiBerlakuUmum(gId,hari,s.id)) return false
        }
        for (const s of blok) arr.push({id:`j-${gId}-${rId}-${mId}-${hari}-${s.id}-${Math.random().toString(36).slice(2,5)}`,hari,waktuId:s.id,rombelId:rId,guruId:gId,mapelId:mId})
        return true
      }

      // tanamForce: HANYA cek kelas + jadwal tetap (ABAIKAN konflik guru) — last resort
      const tanamForce = (arr:any[], hari:string, blok:any[], rId:string, gId:string, mId:string):boolean => {
        for (const s of blok) {
          if (arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.rombelId===rId)) return false
          if (getTetap(hari,s.id,rId)) return false
          if (guruSibukDiBerlakuUmum(gId,hari,s.id)) return false
        }
        for (const s of blok) arr.push({id:`j-${gId}-${rId}-${mId}-${hari}-${s.id}-${Math.random().toString(36).slice(2,5)}`,hari,waktuId:s.id,rombelId:rId,guruId:gId,mapelId:mId})
        return true
      }

      const jpH = (gId:string,hari:string)=>new Set(arr.filter(x=>x.hari===hari&&x.guruId===gId).map(x=>x.waktuId)).size

      // ── Sebaran Pagi/Siang untuk mapel dengan >1 pertemuan/minggu ──────────
      // "Pagi" = sebelum istirahat PERTAMA dalam sehari, "Siang" = sesudahnya.
      // Dipakai sebagai PREFERENSI (bukan aturan mutlak): kalau sesi pertama
      // suatu (guru,mapel,rombel) sudah jatuh di pagi, sesi berikutnya lebih
      // diutamakan dicarikan slot di siang, dan sebaliknya -- supaya jadwal
      // seorang guru untuk mapel yang sama tidak menumpuk di waktu yang sama terus.
      const idxIstirahatPertama = allSlotsUrut.findIndex(s => s.jenis === 'istirahat')
      const bagianHari = (slotId: string): 'pagi' | 'siang' => {
        if (idxIstirahatPertama < 0) return 'pagi'
        const idx = allSlotsUrut.findIndex(s => s.id === slotId)
        return idx >= 0 && idx < idxIstirahatPertama ? 'pagi' : 'siang'
      }
      // key = "guruId_mapelId_rombelId" -> bagian hari yang SUDAH dipakai sesi sebelumnya
      const bagianTerpakai = new Map<string, Set<'pagi'|'siang'>>()
      const catatBagian = (t: {guru:any;mapel:any;rId:string}, blok:any[]) => {
        const k = `${t.guru.id}_${t.mapel.id}_${t.rId}`
        if (!bagianTerpakai.has(k)) bagianTerpakai.set(k, new Set())
        bagianTerpakai.get(k)!.add(bagianHari(blok[0].id))
      }

      // ═══════════════════════════════════════════════════════════════════
      // FASE 1: Tempatkan SEMUA 3JP sebagai pasangan dalam window
      // ═══════════════════════════════════════════════════════════════════
      // ATURAN:
      // 1. Setiap window (6 slot) diisi SEPASANG 3JP: A di half1, B di half2 (atau sebaliknya)
      // 2. Pasangan dicari lintas kelas (cross-rombel) — rotasi antar kelas muncul alami
      // 3. Solo 3JP (tidak dapat dipasangkan): coba di luar window terlebih dahulu
      // 4. Last resort: force placement (abaikan konflik guru, catat sebagai peringatan)
      // 5. FASE 2 (2JP) HANYA dimulai setelah SELURUH antrian 3JP habis diproses
      // ═══════════════════════════════════════════════════════════════════

      const Q3 = acakPrioritasGabungan(semuaTugas.filter(t=>t.panjang===3).slice())
      Q3.sort((a,b)=>b.hD.size-a.hD.size) // guru paling banyak hari '-' duluan

      while (Q3.length>0) {
        const tA=Q3.shift()!
        const huA=getHU(tA)
        let ok=false

        // ─── Coba PASANGKAN tA dengan siapapun di antrian (cross-rombel) ────
        // 4 level relaksasi hari, selalu coba kedua orientasi A-B dan B-A
        const hariLevel = [
          LIST_HARI.filter(h=>!tA.hD.has(h)&&!huA.has(h)),   // L0: non-forbidden, hari baru
          LIST_HARI.filter(h=>!tA.hD.has(h)),                  // L1: non-forbidden (abaikan hariUsed)
          LIST_HARI.slice(),                                     // L2: semua hari (abaikan '-')
        ]

        pairLoop: for (const hSet of hariLevel) {
          for (const hari of acak(hSet.slice())) {
            const jen=JENDELA[hari]; if(!jen) continue
            const h1=half(jen[0]), h2=half(jen[1])
            if (h1.length<3||h2.length<3) continue
            if (adaIstirahat(h1[0].id,h1[2].id)||adaIstirahat(h2[0].id,h2[2].id)) continue

            for (let bi=0;bi<Q3.length;bi++) {
              const tB=Q3[bi]; const huB=getHU(tB)

              for (const [hA,hB] of [[h1,h2],[h2,h1]] as any[]) {
                if (jpH(tA.guru.id,hari)+3>maksJpGuruPerHari) continue
                if (jpH(tB.guru.id,hari)+3>maksJpGuruPerHari) continue
                if (!hA.every((s:any)=>!arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.guruId===tA.guru.id&&x.rombelId!==tA.rId))) continue
                if (!hA.every((s:any)=>!arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.rombelId===tA.rId))) continue
                if (!hB.every((s:any)=>!arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.guruId===tB.guru.id&&x.rombelId!==tB.rId))) continue
                if (!hB.every((s:any)=>!arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.rombelId===tB.rId))) continue
                if (hA.some((s:any)=>getTetap(hari,s.id,tA.rId))||hB.some((s:any)=>getTetap(hari,s.id,tB.rId))) continue
                const bkp=arr.length
                if(!tanam(arr,hari,hA,tA.rId,tA.guru.id,tA.mapel.id)){arr.length=bkp;continue}
                if(!tanam(arr,hari,hB,tB.rId,tB.guru.id,tB.mapel.id)){arr.length=bkp;continue}
                // BERHASIL dipasangkan!
                huA.add(hari); huB.add(hari); Q3.splice(bi,1); ok=true
                catatBagian(tA,hA); catatBagian(tB,hB)
                if(!blokSesuaiKetersediaan(tA.ks[hari],hA.map((s:any)=>Number(s.jamKe)))) req.push(`${nm(tA)}(${hari})-req jam`)
                if(!blokSesuaiKetersediaan(tB.ks[hari],hB.map((s:any)=>Number(s.jamKe)))) req.push(`${nm(tB)}(${hari})-req jam`)
                const berAB=daftarLarangan.find(l=>l.setelahMapelId===tA.mapel.id)?.dilarangMapelIds.includes(tB.mapel.id)
                const berBA=daftarLarangan.find(l=>l.setelahMapelId===tB.mapel.id)?.dilarangMapelIds.includes(tA.mapel.id)
                if(berAB||berBA) ber.push(`${nm(tA)}&${nm(tB)}(${hari})-beriringan`)
                break pairLoop
              }
            }
          }
        }
        if (ok) continue

        // ─── SOLO: tidak dapat dipasangkan — coba luar window dulu ──────────
        // Urutan: luar window + non-forbidden → luar window + any → dalam window + non-forbidden
        //       → dalam window + any → force (abaikan konflik guru) → GAGAL
        const hSoloSets = [
          LIST_HARI.filter(h=>!tA.hD.has(h)&&!huA.has(h)),
          LIST_HARI.filter(h=>!tA.hD.has(h)),
          LIST_HARI.slice()
        ]

        // Luar window
        for (const hSet of hSoloSets) {
          for (const hari of acak(hSet.slice())) {
            const wid=winIds(hari)
            for (let a=0;a<=slotMapel.length-3;a++) {
              const blok=slotMapel.slice(a,a+3)
              if (blok.some((s:any)=>wid.has(s.id))) continue
              if (adaIstirahat(blok[0].id,blok[2].id)) continue
              if (jpH(tA.guru.id,hari)+3>maksJpGuruPerHari) continue
              if (!tanam(arr,hari,blok,tA.rId,tA.guru.id,tA.mapel.id)) continue
              huA.add(hari); ok=true; catatBagian(tA,blok); req.push(`${nm(tA)}(${hari})-solo luar window`); break
            }
            if (ok) break
          }
          if (ok) break
        }
        if (ok) continue

        // Dalam window (half manapun)
        for (const hSet of hSoloSets) {
          for (const hari of acak(hSet.slice())) {
            const jen=JENDELA[hari]; if(!jen) continue
            for (const jStart of [jen[0],jen[1]]) {
              const blok=half(jStart)
              if (blok.length<3||adaIstirahat(blok[0].id,blok[2].id)) continue
              if (jpH(tA.guru.id,hari)+3>maksJpGuruPerHari) continue
              if (!tanam(arr,hari,blok,tA.rId,tA.guru.id,tA.mapel.id)) continue
              huA.add(hari); ok=true; catatBagian(tA,blok); req.push(`${nm(tA)}(${hari})-solo dalam window`); break
            }
            if (ok) break
          }
          if (ok) break
        }
        if (ok) continue

        // Force: abaikan konflik guru, hanya pastikan slot kelas bebas
        for (const hari of [...LIST_HARI.filter(h=>!tA.hD.has(h)), ...LIST_HARI]) {
          for (let a=0;a<=slotMapel.length-3;a++) {
            const blok=slotMapel.slice(a,a+3)
            if (adaIstirahat(blok[0].id,blok[2].id)) continue
            if (!tanamForce(arr,hari,blok,tA.rId,tA.guru.id,tA.mapel.id)) continue
            ok=true; catatBagian(tA,blok); req.push(`${nm(tA)}(${hari})-FORCE (konflik guru, wajib edit manual)`); break
          }
          if (ok) break
        }
        if (!ok) gagal.push(`${nm(tA)}(3JP)->slot kelas benar-benar penuh, cek alokasi JP`)
      }

      // ═══════════════════════════════════════════════════════════════════
      // FASE 2: Tempatkan semua 2JP
      // Setelah SELURUH 3JP selesai, 2JP boleh masuk slot manapun termasuk sisa window.
      // ═══════════════════════════════════════════════════════════════════
      const Q2=acakPrioritasGabungan(semuaTugas.filter(t=>t.panjang===2).slice())
      Q2.sort((a,b)=>b.hD.size-a.hD.size)
      const hu2=new Map<string,Set<string>>()
      const getHU2=(t:T)=>{const k=`${t.guru.id}_${t.mapel.id}_${t.rId}`;if(!hu2.has(k))hu2.set(k,new Set());return hu2.get(k)!}

      Q2.forEach(t=>{
        const hu=getHU2(t)
        const nm2=`${t.guru.nama}-${t.mapel.nama}(${daftarRombel.find((r:any)=>r.id===t.rId)?.nama||t.rId})s${t.sesiIdx+1}(2JP)`
        const kBagian = `${t.guru.id}_${t.mapel.id}_${t.rId}`
        const bagianSudahDipakai = bagianTerpakai.get(kBagian)
        // Kalau mapel ini punya sesi lain yang sudah kepasang di satu bagian hari
        // (pagi/siang), utamakan bagian yang BERLAWANAN dulu untuk sesi ini --
        // supaya tersebar, bukan menumpuk di waktu yang sama terus tiap minggu.
        const bagianDiutamakan: 'pagi' | 'siang' | null =
          bagianSudahDipakai && bagianSudahDipakai.size === 1
            ? (bagianSudahDipakai.has('pagi') ? 'siang' : 'pagi')
            : null

        const tryH=(hari:string,ignReq:boolean,ignBer:boolean,ignKap:boolean,force:boolean):boolean=>{
          if(!ignKap&&jpH(t.guru.id,hari)+2>maksJpGuruPerHari) return false
          // Susun kandidat blok 2-slot, diurutkan supaya bagian yang diutamakan dicoba lebih dulu.
          const kandidat: any[][] = []
          for(let a=0;a<=slotMapel.length-2;a++) kandidat.push(slotMapel.slice(a,a+2))
          const terurut = bagianDiutamakan
            ? [...kandidat.filter(b=>bagianHari(b[0].id)===bagianDiutamakan), ...kandidat.filter(b=>bagianHari(b[0].id)!==bagianDiutamakan)]
            : kandidat
          for (const blok of terurut) {
            if(adaIstirahat(blok[0].id,blok[1].id)) continue
            if(!ignReq&&!blokSesuaiKetersediaan(t.ks[hari],blok.map(s=>Number(s.jamKe)))) continue
            if(!ignBer&&cekBer(arr,hari,blok,t.rId,t.mapel.id)) continue
            const berhasil=force?tanamForce(arr,hari,blok,t.rId,t.guru.id,t.mapel.id):tanam(arr,hari,blok,t.rId,t.guru.id,t.mapel.id)
            if(berhasil) { catatBagian(t,blok); return true }
          }
          return false
        }

        let ok=false
        const hB=LIST_HARI.filter(h=>!t.hD.has(h)&&!hu.has(h))
        const hB2=LIST_HARI.filter(h=>!t.hD.has(h))
        const hAll=LIST_HARI.slice()

        for(const h of hB) {if(tryH(h,false,false,false,false)){hu.add(h);ok=true;break}}
        if(!ok)for(const h of hB) {if(tryH(h,false,true,false,false)){hu.add(h);ok=true;ber.push(`${nm2}(${h})-beriringan`);break}}
        if(!ok)for(const h of hB) {if(tryH(h,true,true,false,false)){hu.add(h);ok=true;req.push(`${nm2}(${h})-req jam`);break}}
        if(!ok)for(const h of hB2){if(tryH(h,true,true,false,false)){ok=true;req.push(`${nm2}(${h})-2sesi/hari`);break}}
        if(!ok)for(const h of hAll){if(tryH(h,true,true,false,false)){hu.add(h);ok=true;req.push(`${nm2}(${h})-hari '-'`);break}}
        if(!ok)for(const h of hAll){if(tryH(h,true,true,true,false)){ok=true;req.push(`${nm2}(${h})->batasJP`);break}}
        if(!ok)for(const h of hAll){if(tryH(h,true,true,true,true)){ok=true;req.push(`${nm2}(${h})-FORCE`);break}}
        if(!ok) gagal.push(`${nm2}->slot kelas penuh`)
      })

      return { arr, gagal, req, ber }
    }



    // ── Async loop: terus coba sampai sempurna atau batas waktu ──────────────
    setIsGenerating(true)
    generateCancelRef.current = false
    let best: Hasil = { arr: jadwalLuar.slice(), gagal: semuaTugas.map(()=>'x'), req:[], ber:[] }
    let attempt = 0
    const BATCH=10, MAX_ATT=3000, MAX_MS=120_000, t0=Date.now()

    const runBatch = () => {
      if (generateCancelRef.current) { setIsGenerating(false); setGenerateProgress(''); return }
      for (let i=0;i<BATCH;i++) {
        attempt++
        const h=satu()
        const s=h.gagal.length*1000000+h.ber.length*1000+h.req.length
        const sb=best.gagal.length*1000000+best.ber.length*1000+best.req.length
        if (s<sb) best=h
        if (!best.gagal.length && !best.ber.length && !best.req.length) break
      }
      setGenerateProgress(`Percobaan ${attempt} — gagal:${best.gagal.length} beriringan:${best.ber.length} req:${best.req.length}`)
      const selesai = !best.gagal.length && !best.ber.length && !best.req.length
      const cukup   = !best.gagal.length && attempt>=300
      const elapsed = Date.now()-t0
      if (!selesai && !cukup && attempt<MAX_ATT && elapsed<MAX_MS && !generateCancelRef.current) { setTimeout(runBatch,0); return }

      // ── Perbaikan akhir: KELAS GABUNGAN ──────────────────────────────────
      // Algoritma generate menjadwalkan tiap (guru,mapel,rombel) sebagai
      // target TERPISAH, jadi kalau ada kelas gabungan (mis. mapel yang sama
      // diajar bareng utk Kelas 1A+1B), keduanya bisa saja jatuh di slot yg
      // BEDA. Di sini kita salin entri yang SUDAH terjadwal ke semua kelas
      // lain dalam grup gabungan yang sama tapi BELUM kebagian di slot itu
      // -- selama slotnya memang masih kosong di kelas tujuan (tidak
      // menimpa jadwal lain yang sudah ada di sana).
      let arrFinal = [...best.arr]
      const gabunganTerapkanUlang: string[] = []
      daftarKelasGabungan.forEach(kg => {
        if (!kg.rombelIds || kg.rombelIds.length < 2) return
        arrFinal.filter(j => j.mapelId === kg.mapelId && kg.rombelIds.includes(j.rombelId)).forEach(j => {
          kg.rombelIds.forEach((ridTujuan: string) => {
            if (ridTujuan === j.rombelId) return
            const sudahAda = arrFinal.some(x => x.hari === j.hari && x.waktuId === j.waktuId && x.rombelId === ridTujuan)
            if (sudahAda) return
            arrFinal.push({ id: `j-gab-${j.mapelId}-${ridTujuan}-${j.hari}-${j.waktuId}-${Math.random().toString(36).slice(2, 5)}`, hari: j.hari, waktuId: j.waktuId, rombelId: ridTujuan, guruId: j.guruId, mapelId: j.mapelId })
            const namaR = daftarRombel.find((r: any) => r.id === ridTujuan)?.nama || ridTujuan
            gabunganTerapkanUlang.push(`${j.hari} — ${namaR}: disalin dari kelas gabungannya`)
          })
        })
      })

      simpanSnapshotUndo(`Generate Jadwal Otomatis (percobaan ke-${attempt})`)
      setDaftarJadwal(arrFinal); save('data_jadwal_pelajaran', arrFinal)
      setUndoTersedia({ deskripsi: `Generate Jadwal Otomatis (percobaan ke-${attempt})`, waktu: Date.now() })
      setIsGenerating(false); setGenerateProgress('')
      const bg: string[]=[]
      if (gabunganTerapkanUlang.length) bg.push(`🟢 KELAS GABUNGAN disalin otomatis (${gabunganTerapkanUlang.length} slot):\\n${gabunganTerapkanUlang.join('\\n')}`)
      // Diagnostik khusus: berapa banyak sesi 3JP yang TIDAK berhasil dipasangkan
      // dengan 3JP lain (solo di luar/dalam window, atau terpaksa FORCE) --
      // supaya kelihatan jelas skala masalahnya, bukan cuma tersembunyi di
      // daftar peringatan umum.
      const tandaSolo3JP = ['-solo luar window', '-solo dalam window', '-FORCE (konflik guru, wajib edit manual)']
      const solo3JP = best.req.filter(r => tandaSolo3JP.some(t => r.includes(t)))
      if (solo3JP.length) {
        bg.push(`🔵 3JP TIDAK BERPASANGAN (${solo3JP.length} sesi) — seharusnya berpasangan dengan 3JP lain tapi tidak ketemu pasangan yang cocok (jumlah sesi 3JP mungkin ganjil, atau kelas/guru pasangannya sudah penuh di semua hari):\n${solo3JP.join('\n')}`)
      }
      if (best.gagal.length) bg.push(`🔴 GAGAL:\n${best.gagal.join('\n')}`)
      if (best.ber.length)   bg.push(`🟠 Beriringan:\n${best.ber.join('\n')}`)
      if (best.req.length)   bg.push(`🟡 Request:\n${best.req.join('\n')}`)

      // Pengecekan AKURAT: bandingkan target seharusnya (semuaTugas) dengan
      // yang BENAR-BENAR berhasil tertanam di arrFinal -- supaya pesan yang
      // ditampilkan ke pengguna SELALU akurat, tidak pernah bilang "berhasil"
      // padahal banyak slot yang sebenarnya masih kosong.
      const kebutuhanJp = new Map()
      semuaTugas.forEach(t => {
        const k = `${t.guru.id}_${t.mapel.id}_${t.rId}`
        kebutuhanJp.set(k, (kebutuhanJp.get(k) || 0) + t.panjang)
      })
      const realisasiJp = new Map()
      arrFinal.forEach(j => {
        const k = `${j.guruId}_${j.mapelId}_${j.rombelId}`
        realisasiJp.set(k, (realisasiJp.get(k) || 0) + 1)
      })
      const kekuranganJp: string[] = []
      kebutuhanJp.forEach((butuh, k) => {
        const [gId, mId, rId] = k.split('_')
        const ada = realisasiJp.get(k) || 0
        if (ada < butuh) {
          const namaG = daftarGuru.find((g) => g.id === gId)?.nama || gId
          const namaM = daftarMapel.find((m) => m.id === mId)?.nama || mId
          const namaR = daftarRombel.find((r) => r.id === rId)?.nama || rId
          kekuranganJp.push(namaG + ' \u2014 ' + namaM + ' (Kelas ' + namaR + '): butuh ' + butuh + ' JP, baru tergenerate ' + ada + ' JP (kurang ' + (butuh - ada) + ' JP)')
        }
      })
      if (kekuranganJp.length) bg.push('\uD83D\uDD34 BELUM TERGENERATE LENGKAP (' + kekuranganJp.length + ' kombinasi guru+mapel+kelas) \u2014 sisa JP ini HARUS diisi manual lewat Plot Jadwal:\n' + kekuranganJp.join('\n'))

      if (!bg.length) alert(`✅ Jadwal sempurna! (percobaan ke-${attempt})`)
      else alert(`Generate selesai (${attempt}x, ${Math.round(elapsed/1000)}d):\n\n${bg.join('\n\n')}`)
    }
    setTimeout(runBatch, 0)
  } // end handleGenerate


  // ============================================================
  // INLINE EDIT MATRIKS
  // ============================================================
  const handleInlineSave = (hari: string, waktuId: string, rombelId: string, existing: any) => {
    if (!editGuruMapel) {
      if (existing) {
        // Kalau slot ini bagian dari kelas gabungan, hapus juga entri kembar
        // di SEMUA kelas lain dalam grup gabungan yang sama -- supaya tidak
        // ada sisa jadwal "yatim" di kelas lain begitu salah satu dihapus.
        const kgHapus = daftarKelasGabungan.find(kg => kg.mapelId === existing.mapelId && kg.rombelIds?.includes(rombelId) && kg.rombelIds?.length > 1)
        const f = kgHapus
          ? daftarJadwal.filter(j => !(j.hari === hari && j.waktuId === waktuId && j.guruId === existing.guruId && j.mapelId === existing.mapelId && kgHapus.rombelIds.includes(j.rombelId)))
          : daftarJadwal.filter(j => j.id !== existing.id)
        setDaftarJadwal(f); save('data_jadwal_pelajaran', f)
      }
      setEditingCell(null); setEditGuruMapel(''); setEditJumlahJp(null)
      return
    }

    const [gId, mId] = editGuruMapel.split('|')
    const jumlahJp = editJumlahJp && editJumlahJp > 1 ? editJumlahJp : 1

    // PENTING: kalau kombinasi guru+mapel ini terdaftar sebagai KELAS GABUNGAN
    // (satu guru mengajar mapel yang sama utk beberapa kelas SEKALIGUS dalam
    // satu slot yg sama, mis. gabungan Kelas 1A+1B), maka begitu diisi/di-
    // generate di SALAH SATU kelasnya, jadwal yang SAMA harus otomatis
    // muncul juga di SEMUA kelas lain yang tergabung dalam grup itu -- bukan
    // cuma di kelas yang diklik/diinput.
    const kelasGabunganTerkait = daftarKelasGabungan.find(kg => kg.mapelId === mId && kg.rombelIds?.includes(rombelId) && kg.rombelIds?.length > 1)
    const targetRombelIds: string[] = kelasGabunganTerkait ? kelasGabunganTerkait.rombelIds : [rombelId]

    if (jumlahJp === 1) {
      // Isi 1 sel saja (perilaku lama, tetap dipertahankan kalau JP-nya cuma 1 pilihan atau tidak dipilih)
      // -- tapi diterapkan ke SEMUA kelas dalam grup gabungan sekaligus.
      for (const rid of targetRombelIds) {
        const existingDiSlot = daftarJadwal.find(j => j.hari === hari && j.waktuId === waktuId && j.rombelId === rid)
        const hasil = validasiSlot({ hari, waktuId, rombelId: rid, guruId: gId, mapelId: mId, kecuali: existingDiSlot?.id })
        if (!hasil.ok) { alert(`⚠️ ${hasil.pesan}${targetRombelIds.length > 1 ? ` (di kelas ${daftarRombel.find((r: any) => r.id === rid)?.nama || rid})` : ''}`); return }
      }
      let u = [...daftarJadwal]
      targetRombelIds.forEach(rid => {
        const existingDiSlot = u.find(j => j.hari === hari && j.waktuId === waktuId && j.rombelId === rid)
        if (existingDiSlot) {
          u = u.map(j => j.id === existingDiSlot.id ? { ...j, guruId: gId, mapelId: mId } : j)
        } else {
          u = [...u, { id: 'jdwl-' + Date.now() + '-' + rid, hari, waktuId, rombelId: rid, guruId: gId, mapelId: mId }]
        }
      })
      setDaftarJadwal(u); save('data_jadwal_pelajaran', u)
      setEditingCell(null); setEditGuruMapel(''); setEditJumlahJp(null)
      return
    }

    // ── Isi OTOMATIS beberapa sel berturutan sesuai jumlah JP yang dipilih ──
    // (mis. pilih "3 JP" -> otomatis mengisi 3 sel berturutan mulai dari sel
    // yang diklik, tidak perlu klik & isi satu-satu lagi). Diterapkan ke
    // SEMUA kelas dalam grup gabungan sekaligus (kalau ada).
    const slotUrutMapel = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
    const idxMulai = slotUrutMapel.findIndex(s => s.id === waktuId)
    if (idxMulai < 0) { alert('Slot waktu tidak valid.'); return }
    const slotTarget = slotUrutMapel.slice(idxMulai, idxMulai + jumlahJp)
    if (slotTarget.length < jumlahJp) {
      alert(`⚠️ Jam pelajaran di hari ${hari} tidak cukup untuk menampung ${jumlahJp} JP berturutan mulai dari slot ini. Coba mulai dari slot yang lebih awal.`)
      return
    }

    // Validasi SEMUA slot × SEMUA kelas dalam grup dulu sebelum benar-benar
    // menyimpan apapun (supaya tidak ada yang "setengah jadi" kalau salah
    // satu slot/kelas ternyata bentrok).
    for (const s of slotTarget) {
      for (const rid of targetRombelIds) {
        const existingDiSlot = daftarJadwal.find(j => j.hari === hari && j.waktuId === s.id && j.rombelId === rid)
        const hasil = validasiSlot({ hari, waktuId: s.id, rombelId: rid, guruId: gId, mapelId: mId, kecuali: existingDiSlot?.id })
        if (!hasil.ok) { alert(`⚠️ ${hasil.pesan}${targetRombelIds.length > 1 ? ` (di kelas ${daftarRombel.find((r: any) => r.id === rid)?.nama || rid})` : ''}`); return }
      }
    }

    let u = [...daftarJadwal]
    slotTarget.forEach(s => {
      targetRombelIds.forEach(rid => {
        const existingDiSlot = u.find(j => j.hari === hari && j.waktuId === s.id && j.rombelId === rid)
        if (existingDiSlot) {
          u = u.map(j => j.id === existingDiSlot.id ? { ...j, guruId: gId, mapelId: mId } : j)
        } else {
          u = [...u, { id: 'jdwl-' + Date.now() + '-' + s.id + '-' + rid, hari, waktuId: s.id, rombelId: rid, guruId: gId, mapelId: mId }]
        }
      })
    })
    setDaftarJadwal(u); save('data_jadwal_pelajaran', u)
    alert(`✅ Berhasil mengisi ${jumlahJp} JP berturutan (${slotTarget.map(s => s.jamKe).join(', ')}) untuk ${hari}${targetRombelIds.length > 1 ? ` di ${targetRombelIds.length} kelas gabungan` : ''}.`)
    setEditingCell(null); setEditGuruMapel(''); setEditJumlahJp(null)
  }

  // ============================================================
  // REKAP
  // ============================================================
  const rekapJamGuru = () => {
    const rec: { [gId: string]: Set<string> } = {}
    daftarJadwal.forEach(j => {
      const sw = daftarWaktu.find(w => w.id === j.waktuId)
      if (!sw || sw.jenis !== 'mapel') return
      if (!rec[j.guruId]) rec[j.guruId] = new Set()
      rec[j.guruId].add(`${j.hari}_${j.waktuId}`)
    })
    // Jadwal Tetap berjenis "mapel" (kelas gabungan) juga terhitung sebagai
    // jam mengajar guru -- satu sesi gabungan (walau berlaku utk banyak
    // kelas sekaligus) tetap dihitung SATU slot, bukan dikali jumlah kelas.
    daftarJadwalTetap.forEach(jt => {
      if (jt.jenis !== 'mapel' || !jt.guruId) return
      const sw = daftarWaktu.find(w => w.id === jt.waktuId)
      if (!sw || sw.jenis !== 'mapel') return
      const hariList = jt.hari === 'Semua' ? LIST_HARI : [jt.hari]
      hariList.forEach(h => {
        if (!rec[jt.guruId!]) rec[jt.guruId!] = new Set()
        rec[jt.guruId!].add(`${h}_${jt.waktuId}`)
      })
    })
    const r: { [k: string]: number } = {}
    Object.keys(rec).forEach(k => { r[k] = rec[k].size })
    return r
  }

  /** Cek kelengkapan penjadwalan seorang guru: bandingkan total JP yang
   *  SEHARUSNYA (dari Matriks Alokasi JP, utk semua kombinasi mapel+kelas
   *  guru ini) dengan yang SUDAH benar-benar terjadwal (dari Plot Jadwal
   *  biasa MAUPUN Jadwal Berlaku Umum jenis Mata Pelajaran). */
  const cekKelengkapanJpGuru = (guruId: string): { lengkap: boolean; kekurangan: { mapel: string; kelas: string; butuh: number; ada: number }[] } => {
    const butuhMap = new Map<string, number>() // key: mapelId_rombelId
    // PENTING: hanya hitung kombinasi yang MASIH BENAR-BENAR VALID sesuai
    // Pembagian Peran saat ini (matriksRows) -- localStorage matriksRinciJp
    // bisa saja masih menyimpan data LAMA untuk kombinasi guru+mapel+kelas
    // yang sudah tidak lagi ditugaskan (mis. guru dipindah dari Kelas 2A/2B
    // ke kelas lain), dan data lama itu TIDAK otomatis terhapus. Kalau tidak
    // difilter di sini, status kelengkapan akan salah terus-menerus
    // menyebut kekurangan JP di kelas yang sudah tidak diampu lagi.
    matriksRows.forEach(({ guru, mapel, rombelRelevant }) => {
      if (guru.id !== guruId) return
      rombelRelevant.forEach((rId: string) => {
        const jp = hitungJpStr(matriksRinciJp[`${guru.id}_${mapel.id}_${rId}`] || '')
        if (jp > 0) butuhMap.set(`${mapel.id}_${rId}`, (butuhMap.get(`${mapel.id}_${rId}`) || 0) + jp)
      })
    })

    const adaMap = new Map<string, number>()
    daftarJadwal.forEach(j => {
      if (j.guruId !== guruId) return
      const sw = daftarWaktu.find(w => w.id === j.waktuId)
      if (!sw || sw.jenis !== 'mapel') return
      const k = `${j.mapelId}_${j.rombelId}`
      adaMap.set(k, (adaMap.get(k) || 0) + 1)
    })
    daftarJadwalTetap.forEach(jt => {
      if (jt.jenis !== 'mapel' || jt.guruId !== guruId || !jt.mapelId) return
      const sw = daftarWaktu.find(w => w.id === jt.waktuId)
      if (!sw || sw.jenis !== 'mapel') return
      const hariList = jt.hari === 'Semua' ? LIST_HARI : [jt.hari]
      const rombelTerkait = jt.berlakuUntuk === 'rombel' ? jt.rombelIds : daftarRombel.map((r: any) => r.id)
      rombelTerkait.forEach(rId => {
        hariList.forEach(() => {
          const k = `${jt.mapelId}_${rId}`
          adaMap.set(k, (adaMap.get(k) || 0) + 1)
        })
      })
    })

    const kekurangan: { mapel: string; kelas: string; butuh: number; ada: number }[] = []
    butuhMap.forEach((butuh, k) => {
      const [mId, rId] = k.split('_')
      const ada = adaMap.get(k) || 0
      if (ada < butuh) {
        kekurangan.push({
          mapel: daftarMapel.find((m: any) => m.id === mId)?.nama || mId,
          kelas: daftarRombel.find((r: any) => r.id === rId)?.nama || rId,
          butuh, ada,
        })
      }
    })
    return { lengkap: kekurangan.length === 0, kekurangan }
  }

  const rekapPerHari = (guruId: string) => {
    const r: { [h: string]: number } = {}
    LIST_HARI.forEach(h => { r[h] = hitungJpGuruHari(guruId, h) })
    return r
  }

  // ============================================================
  // HELPER UNTUK JADWAL TETAP DI RENDER MATRIKS
  // ============================================================
  const getJadwalTetapUntukSlotRender = (hari: string, waktuId: string, rombelId: string) => daftarJadwalTetap.find(jt => {
    const hariOk = jt.hari === hari || jt.hari === 'Semua'
    if (!hariOk || jt.waktuId !== waktuId) return false
    if (jt.berlakuUntuk === 'semua') return true
    if (jt.berlakuUntuk === 'rombel') return jt.rombelIds.includes(rombelId)
    if (jt.berlakuUntuk === 'lembaga') { const lId = getRombelLembagaId(rombelId); return lId ? jt.lembagaIds.includes(lId) : false }
    return false
  })

  // Mirip cara kerja Jadwal Berlaku Umum (Jadwal Tetap): kalau kelas ini
  // bagian dari grup KELAS GABUNGAN, jadwal yang "berlaku" utk kelas ini
  // dicari dari SEMBARANG anggota grup yang sudah punya data -- BUKAN wajib
  // dari data milik kelas ini sendiri.
  const cariJadwalGabunganLintasKelas = (hari: string, waktuId: string, rombelId: string) => {
    const grup = daftarKelasGabungan.filter(kg => kg.rombelIds?.includes(rombelId) && kg.rombelIds?.length > 1)
    for (const kg of grup) {
      const jGab = daftarJadwal.find(jj => jj.hari === hari && jj.waktuId === waktuId && jj.mapelId === kg.mapelId && kg.rombelIds.includes(jj.rombelId))
      if (jGab) return jGab
    }
    return null
  }

  // Kelompokkan kolom kelas yang BERURUTAN dan punya jadwal TETAP yang SAMA
  // (mis. "Upacara Bendera" berlaku utk semua kelas) ATAU kelas GABUNGAN yang
  // sama, jadi satu sel gabung (colSpan) -- supaya tabel Plot Jadwal tidak
  // perlu mengulang teks yang sama di tiap kolom kelas dan lebih hemat lebar.
  // Sel jadwal BIASA (bisa diedit per-kelas) TETAP dirender satu per satu
  // apa adanya, supaya interaksi klik-untuk-edit tidak terganggu.
  type SegmenSel = { tipe: 'tetap'; rombelIds: string[]; tetapItem: any } | { tipe: 'gabungan'; rombelIds: string[]; jadwalItem: any } | { tipe: 'individual'; rombelId: string }
  const kelompokkanSelBaris = (hari: string, waktuId: string, rombelList: any[]): SegmenSel[] => {
    const segmen: SegmenSel[] = []
    let i = 0
    while (i < rombelList.length) {
      const r = rombelList[i]
      const tetap = getJadwalTetapUntukSlotRender(hari, waktuId, r.id)
      if (tetap) {
        const idsGrup = [r.id]
        let j = i + 1
        while (j < rombelList.length) {
          const tetapBerikut = getJadwalTetapUntukSlotRender(hari, waktuId, rombelList[j].id)
          if (tetapBerikut && tetapBerikut.id === tetap.id) { idsGrup.push(rombelList[j].id); j++ } else break
        }
        segmen.push({ tipe: 'tetap', rombelIds: idsGrup, tetapItem: tetap })
        i = j
        continue
      }
      const jadwalItem = daftarJadwal.find(j2 => j2.hari === hari && j2.waktuId === waktuId && j2.rombelId === r.id) || cariJadwalGabunganLintasKelas(hari, waktuId, r.id)
      const kelasGabungan = jadwalItem ? daftarKelasGabungan.find(kg => kg.mapelId === jadwalItem.mapelId && kg.rombelIds?.includes(r.id) && kg.rombelIds?.length > 1) : null
      if (jadwalItem && kelasGabungan) {
        const idsGrup = [r.id]
        let j = i + 1
        while (j < rombelList.length) {
          // Anggota berikutnya masuk grup gabungan yang sama selama dia
          // memang terdaftar dalam grup itu (kg.rombelIds) DAN mendapat
          // jadwal yang SAMA (guru+mapel) di slot ini -- baik dari data
          // miliknya sendiri MAUPUN dari lookup lintas kelas gabungan.
          const jBerikut = daftarJadwal.find(j2 => j2.hari === hari && j2.waktuId === waktuId && j2.rombelId === rombelList[j].id) || cariJadwalGabunganLintasKelas(hari, waktuId, rombelList[j].id)
          const masukGrupSama = jBerikut && jBerikut.guruId === jadwalItem.guruId && jBerikut.mapelId === jadwalItem.mapelId && kelasGabungan.rombelIds.includes(rombelList[j].id)
          if (masukGrupSama) { idsGrup.push(rombelList[j].id); j++ } else break
        }
        segmen.push({ tipe: 'gabungan', rombelIds: idsGrup, jadwalItem })
        i = j
        continue
      }
      segmen.push({ tipe: 'individual', rombelId: r.id })
      i++
    }
    return segmen
  }

  // ============================================================
  // DOWNLOAD
  // ============================================================
  const handleDownload = () => {
    let rombelFiltered = dorongKelasGabunganBersebelahan(urutkanRombelKelas(daftarRombel), daftarKelasGabungan)
    let namaUnitTampil = identitasInduk.nama || 'Lembaga'
    let logoKiri = resolveLogoUrl(identitasInduk.logoKiriSumber)
    let logoKanan = resolveLogoUrl(identitasInduk.logoKananSumber)
    let alamat = identitasInduk.alamat || ''
    let hariList = LIST_HARI // jadwal pelajaran: Senin s.d Jumat saja (Sabtu tidak dipakai)

    if (downloadTarget !== 'semua') {
      const unit = daftarLembaga.find(l => l.id === downloadTarget)
      rombelFiltered = dorongKelasGabunganBersebelahan(urutkanRombelKelas(getRombelsByLembaga(downloadTarget)), daftarKelasGabungan)
      namaUnitTampil = unit?.nama || namaUnitTampil
      logoKiri = resolveLogoUrl(unit?.logoKiriSumber)
      logoKanan = resolveLogoUrl(unit?.logoKananSumber)
      alamat = unit?.alamat || alamat
      hariList = LIST_HARI_UNIT // unit lembaga: hanya Senin s.d Jumat
    }

    const allSlotsUrut = [...daftarWaktu].sort((a, b) => Number(a.jamKe || 0) - Number(b.jamKe || 0))
    const penandatangan = getPenandatanganPasangan(downloadTarget)
    const keteranganTerpilih = keteranganUnit[downloadTarget] || ''

    // Baris nama lembaga: jadwal KESELURUHAN -> nama Lembaga Pusat. Jadwal UNIT -> nama unit saja
    // (nama Lembaga Pusat tidak diulang lagi di sini, supaya nama tidak tampil dobel).
    const namaLembagaBaris = downloadTarget === 'semua' ? (identitasInduk.nama || '') : namaUnitTampil

    const html = generatePrintHtml({
      namaUnitTampil, alamat, logoKiri, logoKanan,
      semester: semesterAktif, tahunAjaran: tahunAjaranAktif,
      rombelFiltered, allSlots: allSlotsUrut, hariList,
      daftarJadwal, daftarJadwalTetap, daftarJadwalGiliran,
      daftarGuru, daftarMapel, daftarRombel, daftarKelasGabungan, daftarTingkat,
      daftarPiket, ttd, penandatangan, keterangan: keteranganTerpilih,
      ketYayasan: identitasInduk.kop || 'MAJLIS PENDIDIKAN DASAR DAN MENENGAH\nPIMPINAN WILAYAH AISYIYAH JAWA BARAT',
      namaLembagaBaris,
      tampilkanWakaKurikulum: downloadTarget !== 'semua',
      piketUnitId: downloadTarget === 'semua' ? null : downloadTarget,
      sematkanTtd: sematkanTtdJadwal,
    })
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 500) }
    setShowDownloadModal(false)
  }

  // ============================================================
  // DOWNLOAD PER-GURU (PDF tunggal / ZIP semua guru)
  // ============================================================
  // Merender satu string HTML lengkap (halaman A4 landscape) menjadi sebuah PDF Blob, menggunakan
  // html2canvas (snapshot visual) + jsPDF (pembungkus halaman). Library dimuat secara dinamis (lazy
  // import) supaya tidak membebani initial load halaman ini, dan hanya diambil saat tombol unduh dipakai.
  const renderHtmlKePdfBlob = async (html: string, orientation: 'landscape' | 'portrait' = 'landscape'): Promise<Blob> => {
    const { default: html2canvas } = await import('html2canvas')
    const { jsPDF } = await import('jspdf')

    // Render HTML di dalam iframe tersembunyi supaya CSS internal (termasuk @page, reset style)
    // tidak bentrok dengan halaman aplikasi yang sedang berjalan. Lebar iframe disesuaikan dengan
    // orientasi halaman tujuan (landscape lebih lebar, portrait lebih sempit) pada resolusi tinggi,
    // sementara tinggi dibiarkan otomatis mengikuti tinggi konten asli (bukan dipatok), supaya
    // html2canvas men-capture persis sepanjang konten saja -- tidak ada area kosong berlebih, dan
    // hasil akhirnya tetap proporsional 1 halaman A4.
    const LEBAR_RENDER = orientation === 'portrait' ? 1000 : 1500 // px, lebar acuan render sebelum di-scale ke ukuran A4 oleh jsPDF
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.left = '-10000px'
    iframe.style.top = '0'
    iframe.style.width = `${LEBAR_RENDER}px`
    iframe.style.height = '10px' // sementara, akan disesuaikan otomatis setelah konten dimuat
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    try {
      const idoc = iframe.contentDocument
      if (!idoc) throw new Error('Gagal membuat dokumen render PDF.')
      idoc.open(); idoc.write(html); idoc.close()

      // Beri waktu agar gambar logo (jika ada, dimuat dari URL eksternal/base64) selesai dimuat.
      await new Promise(resolve => setTimeout(resolve, 600))

      // Sesuaikan tinggi iframe persis dengan tinggi konten aktual (scrollHeight), supaya html2canvas
      // tidak men-capture ruang kosong tambahan ataupun terpotong.
      const tinggiKonten = Math.max(idoc.body.scrollHeight, idoc.documentElement.scrollHeight)
      iframe.style.height = `${tinggiKonten}px`
      await new Promise(resolve => setTimeout(resolve, 100))

      const targetEl = idoc.body
      const canvas = await html2canvas(targetEl, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: LEBAR_RENDER,
        windowWidth: LEBAR_RENDER,
        height: tinggiKonten,
        windowHeight: tinggiKonten
      })
      const imgData = canvas.toDataURL('image/jpeg', 0.95)

      // Halaman A4 sesuai orientasi yang diminta (landscape 297x210mm, portrait 210x297mm). Gambar
      // di-skalakan agar mengisi LEBAR penuh halaman (dikurangi margin tipis), lalu tinggi mengikuti
      // rasio asli -- bukan dipaksa memenuhi tinggi halaman, supaya teks/tabel tidak terlihat melar
      // atau gepeng tidak proporsional.
      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const marginMm = 6
      const areaWidth = pageWidth - marginMm * 2
      const areaHeight = pageHeight - marginMm * 2

      const imgRatio = canvas.height / canvas.width
      let renderWidth = areaWidth
      let renderHeight = areaWidth * imgRatio
      // Jika konten ternyata lebih tinggi dari area halaman (mis. terlalu banyak baris), perkecil
      // proporsional berdasarkan tinggi supaya tetap utuh dalam SATU halaman A4 landscape -- tidak terpotong.
      if (renderHeight > areaHeight) {
        renderHeight = areaHeight
        renderWidth = areaHeight / imgRatio
      }
      const offsetX = (pageWidth - renderWidth) / 2
      const offsetY = marginMm
      pdf.addImage(imgData, 'JPEG', offsetX, offsetY, renderWidth, renderHeight)

      return pdf.output('blob')
    } finally {
      document.body.removeChild(iframe)
    }
  }

  // Nama file aman (tanpa karakter yang bermasalah di filesystem)
  const namaFileAman = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim()

  // Bangun HTML jadwal untuk satu guru (membungkus generatePrintHtmlGuru dengan data terkini halaman ini)
  const buatHtmlJadwalSatuGuru = (guru: any) => {
    const allSlotsUrutLokal = [...daftarWaktu].sort((a, b) => Number(a.jamKe || 0) - Number(b.jamKe || 0))

    // Deteksi unit mana saja yang BENAR-BENAR diajar guru ini (berdasarkan rombel yang ada di jadwalnya),
    // bukan hanya dari unitIds pendaftaran. Ini memastikan guru lintas lembaga tetap menampilkan
    // semua jadwal meskipun unit kerjanya terdaftar hanya di satu unit.
    const rombelDiajarBiasa = daftarJadwal.filter((j: any) => j.guruId === guru.id).map((j: any) => j.rombelId)
    const rombelDiajarBerlakuUmum = daftarJadwalTetap
      .filter((jt: any) => jt.jenis === 'mapel' && jt.guruId === guru.id && jt.berlakuUntuk === 'rombel')
      .flatMap((jt: any) => jt.rombelIds || [])
    const rombelDiajar = [...new Set([...rombelDiajarBiasa, ...rombelDiajarBerlakuUmum])]
    const unitDiajarIds = [...new Set(rombelDiajar.map(rId => getRombelLembagaId(rId)).filter(Boolean))]

    // Gabungkan dengan unitIds pendaftaran agar nama unit kerja utama juga ikut tampil
    const semuaUnitIds = [...new Set([...(guru.unitIds || []), ...unitDiajarIds])]
    const namaUnitList = semuaUnitIds
      .map(uid => daftarLembaga.find(l => l.id === uid)?.nama)
      .filter(Boolean)
    const namaUnitTampil = namaUnitList.length > 0
      ? namaUnitList.join(' & ')
      : (identitasInduk.nama || 'Lembaga')

    // Keterangan: gabungkan keterangan dari semua unit yang diajar (tidak terlewat satu pun)
    const bagianKeterangan: string[] = []
    semuaUnitIds.forEach(uid => {
      const ket = keteranganUnit[uid]
      if (ket && ket.trim()) bagianKeterangan.push(ket.trim())
    })
    // Tambahkan keterangan "semua" (lembaga induk) jika ada
    if (keteranganUnit['semua']?.trim()) bagianKeterangan.unshift(keteranganUnit['semua'].trim())
    const keteranganTerpilih = bagianKeterangan.join('\n')

    return generatePrintHtmlGuru({
      guru, namaUnitTampil, namaSekolahCetak: namaInduk, allSlots: allSlotsUrutLokal,
      daftarJadwal, daftarJadwalTetap, daftarMapel, daftarRombel, daftarPiket, daftarGuru, daftarLembaga,
      keterangan: keteranganTerpilih
    })
  }

  // Unduh jadwal SATU guru sebagai file PDF
  const handleDownloadSatuGuru = async (guru: any, aksi: 'unduh' | 'preview' = 'unduh') => {
    setSedangMengunduhGuru(true)
    setProgresUnduhGuru({ selesai: 0, total: 1 })
    try {
      const html = buatHtmlJadwalSatuGuru(guru)
      const blobMentah = await renderHtmlKePdfBlob(html, 'portrait')
      const namaFile = `Jadwal ${namaFileAman(guru.nama.split(',')[0].trim())}.pdf`
      const blob = new File([blobMentah], namaFile, { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      if (aksi === 'preview') {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = url
        setPreviewUrl(url)
        setProgresUnduhGuru({ selesai: 1, total: 1 })
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = namaFile
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setProgresUnduhGuru({ selesai: 1, total: 1 })
    } catch (err) {
      console.error(err)
      alert('Gagal membuat PDF jadwal guru. Pastikan package "jspdf" dan "html2canvas" sudah terpasang (npm install jspdf html2canvas).')
    } finally {
      setSedangMengunduhGuru(false)
    }
  }

  // Unduh jadwal SEMUA guru sekaligus, dibungkus dalam satu file ZIP (satu PDF per guru di dalamnya)
  const handleDownloadSemuaGuruZip = async () => {
    if (!daftarGuru.length) { alert('Belum ada data guru.'); return }
    setSedangMengunduhGuru(true)
    setProgresUnduhGuru({ selesai: 0, total: daftarGuru.length })
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()

      for (let i = 0; i < daftarGuru.length; i++) {
        const guru = daftarGuru[i]
        const html = buatHtmlJadwalSatuGuru(guru)
        const blob = await renderHtmlKePdfBlob(html, 'portrait')
        zip.file(`Jadwal ${namaFileAman(guru.nama.split(',')[0].trim())}.pdf`, blob)
        setProgresUnduhGuru({ selesai: i + 1, total: daftarGuru.length })
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Jadwal Semua Guru - ${namaFileAman(identitasInduk.nama || 'Lembaga')}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Gagal membuat ZIP jadwal guru. Pastikan package "jszip", "jspdf", dan "html2canvas" sudah terpasang (npm install jszip jspdf html2canvas).')
    } finally {
      setSedangMengunduhGuru(false)
    }
  }

  // Dipanggil dari tombol "Unduh" pada modal: arahkan ke unduhan satu guru atau ZIP semua, sesuai pilihan.
  const handleProsesDownloadGuru = async () => {
    if (guruDownloadTarget === 'semua-zip') {
      await handleDownloadSemuaGuruZip()
    } else {
      const guru = daftarGuru.find(g => g.id === guruDownloadTarget)
      if (guru) await handleDownloadSatuGuru(guru)
    }
    setShowDownloadGuruModal(false)
  }

  const handleProsesPreviewGuru = async () => {
    if (guruDownloadTarget === 'semua-zip') return // ZIP berisi banyak file, tidak bisa dipratinjau sebagai satu dokumen
    const guru = daftarGuru.find(g => g.id === guruDownloadTarget)
    if (guru) await handleDownloadSatuGuru(guru, 'preview')
  }

  // ============================================================
  // COMPUTED
  // ============================================================
  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul Penjadwalan...</div>
  if (diizinkanAkses === false) return null

  const slotMapelUrut = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
  const allSlotsUrut = [...daftarWaktu].sort((a, b) => Number(a.jamKe || 0) - Number(b.jamKe || 0))
  const namaInduk = identitasInduk.nama || 'Lembaga / Yayasan Pusat'
  const logoInduk = identitasInduk.logo_utama || identitasInduk.logo || ''

  const getRombelForUnit = () => {
    const dasar = modeTampil === 'keseluruhan' ? daftarRombel : (unitFilter === 'lembaga-induk' ? daftarRombel : getRombelsByLembaga(unitFilter))
    return dorongKelasGabunganBersebelahan(urutkanRombelKelas(dasar), daftarKelasGabungan)
  }

  // Jadwal unit (selain lembaga induk) hanya tampil Senin s.d Jumat
  const getHariTampil = () => {
    if (modeTampil === 'unit' && unitFilter !== 'lembaga-induk') return LIST_HARI_UNIT
    return LIST_HARI
  }

  const getMapelGuruUntukRombel = (rombelId: string) => {
    const result: { guruId: string; mapelId: string; guruNama: string; mapelNama: string }[] = []
    daftarGuru.forEach(g => {
      if (!g.mapelIds) return
      g.mapelIds.forEach((mId: string) => {
        const rombelList: string[] = g.mapelRombel?.[mId] || g.rombelIds || []
        if (rombelList.includes(rombelId)) {
          const mp = daftarMapel.find(m => m.id === mId)
          if (mp) result.push({ guruId: g.id, mapelId: mId, guruNama: g.nama, mapelNama: mp.nama })
        }
      })
    })
    return result
  }

  const matriksRows = getMatriksRows()

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800">

      {/* SIDEBAR */}
      <Sidebar />

      {/* MAIN */}
      <main className="flex-1 p-8 overflow-y-auto max-w-screen-2xl mx-auto space-y-8">

        {/* HEADER */}
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-slate-900">Modul Jadwal Pelajaran</h1>
            <p className="text-xs text-gray-500">Kelola master waktu, aturan kelas, plot matriks, dan unduh jadwal resmi.</p>
          </div>
          <button onClick={() => setShowDownloadModal(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition shrink-0">
            <Download className="w-4 h-4" /> Unduh / Cetak Jadwal
          </button>
        </header>

        {/* KONTROL */}
        <section className="bg-[#F7ECFA]/50 border border-[#F0DFF5] p-6 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div>
            <label className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider mb-1.5 block">Mode Tampilan</label>
            <select value={modeTampil} onChange={e => setModeTampil(e.target.value as any)} className="w-full px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]">
              <option value="keseluruhan">Keseluruhan (Semua Unit)</option>
              <option value="unit">Per Unit Lembaga</option>
            </select>
          </div>
          {modeTampil === 'unit' && (
            <div>
              <label className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider mb-1.5 block">Unit Ditampilkan</label>
              <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="w-full px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]">
                <option value="lembaga-induk">Lembaga Induk / Yayasan Pusat</option>
                {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider mb-1.5 block">Maks. JP / Hari (per Pendidik)</label>
            {bolehEdit ? (
              <input type="number" min={1} value={maksJpGuruPerHari} onChange={e => { const v = Number(e.target.value) || 1; setMaksJpGuruPerHari(v); save('master_maks_jp_guru_per_hari', v) }} className="w-full px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0]" />
            ) : (
              <p className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50 font-bold text-slate-500">{maksJpGuruPerHari} JP/hari</p>
            )}
          </div>

          {/* TAB NAV */}
          <div className="flex bg-white rounded-xl border border-slate-200 p-1.5 md:col-span-3 flex-wrap gap-1">
            {([
              ['waktu', '1. Master Waktu'],
              ['pengaturan_kelas', '2. Pengaturan'],
              ['input', '3. Plot Matriks'],
              ['rekap_guru', '4. Rekap Guru'],
              ['rekap_jadwal', '5. Rekap Jadwal'],
            ] as [typeof tabView, string][])
              .filter(([key]) => bolehEdit || key === 'rekap_guru' || key === 'rekap_jadwal')
              .map(([key, label]) => (
              <button key={key} onClick={() => setTabView(key)} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === key ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
            ))}
          </div>
        </section>

        {/* =========================================================
            TAB 1: MASTER WAKTU
        ========================================================= */}
        {bolehEdit && tabView === 'waktu' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <form onSubmit={handleSimpanWaktu} className="space-y-4 xl:col-span-1 border-r border-slate-100 pr-6">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <Clock className="w-4 h-4 text-[#6A197D]" />
                <h2 className="text-xs font-black text-slate-700">Petakan Slot Durasi Waktu</h2>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tipe Slot</label>
                <select value={jenisWaktu} onChange={e => setJenisWaktu(e.target.value as any)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                  <option value="mapel">Jam Pelajaran (JP)</option>
                  <option value="istirahat">Istirahat / Sholat</option>
                </select>
              </div>
              {jenisWaktu === 'mapel' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Urutan Jam Ke-</label>
                  <input type="text" placeholder="1" value={jamKeNomor} onChange={e => setJamKeNomor(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Label (Opsional)</label>
                <input type="text" placeholder="Cth: Istirahat 1" value={labelWaktu} onChange={e => setLabelWaktu(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mulai</label>
                  <input type="text" placeholder="07.30" value={waktuMulai} onChange={e => setWaktuMulai(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Selesai</label>
                  <input type="text" placeholder="08.10" value={waktuSelesai} onChange={e => setWaktuSelesai(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0]" required />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="flex-1 bg-[#6A197D] text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-[#571466] transition mt-2">
                  {editWaktuId ? 'Simpan Perubahan' : '+ Tambah Master Waktu'}
                </button>
                {editWaktuId && (
                  <button type="button" onClick={handleBatalEditWaktu} className="px-4 bg-slate-100 rounded-xl font-bold text-slate-600 text-xs mt-2">Batal</button>
                )}
              </div>
            </form>
            <div className="xl:col-span-2 space-y-4">
              <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Tabel Master Waktu</h2>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                      <th className="p-3">Slot</th><th className="p-3">Label</th><th className="p-3">Waktu</th><th className="p-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {daftarWaktu.map(w => (
                      <tr key={w.id} className="hover:bg-slate-50/70">
                        <td className="p-3"><span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase ${w.jenis === 'mapel' ? 'bg-[#F7ECFA] text-[#571466] border-[#F0DFF5]' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{w.jenis === 'mapel' ? `JP ${w.jamKe}` : 'Istirahat'}</span></td>
                        <td className="p-3 font-bold">{w.label}</td>
                        <td className="p-3 font-extrabold text-[#6A197D] tracking-wider">{w.mulai} – {w.selesai}</td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleEditWaktuClick(w)} className="p-1.5 text-[#8A2FA0] hover:text-[#571466] rounded-lg transition"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleHapusWaktu(w.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!daftarWaktu.length && <tr><td colSpan={4} className="py-12 text-center text-slate-400 text-xs">Belum ada pemetaan waktu.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 2: PENGATURAN KELAS (Gabungan, Giliran, Tetap, Titimangsa)
        ========================================================= */}
        {bolehEdit && tabView === 'pengaturan_kelas' && (
          <div className="space-y-6">
            {/* Sub-tab */}
            <div className="flex bg-white rounded-xl border border-slate-200 p-1.5 gap-1 w-fit flex-wrap">
              {([['identitas', 'Identitas & Kop'], ['giliran', 'Jadwal Giliran'], ['tetap', 'Jadwal Berlaku Umum'], ['larangan', 'Larangan Mapel Beriringan'], ['titimangsa', 'Semester, Titimangsa & TTD']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSubTabKelas(k)} className={`px-5 py-2 text-xs font-bold rounded-lg transition ${subTabKelas === k ? 'bg-[#6A197D] text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>

            {/* SUB: IDENTITAS & KOP (Lembaga Pusat / Yayasan & Unit) */}
            {subTabKelas === 'identitas' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <form onSubmit={handleSimpanIdentitasInduk} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Landmark className="w-4 h-4 text-[#6A197D]" />
                    <h2 className="text-xs font-black text-slate-700">Identitas & Kop — Lembaga Pusat</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Data ini tampil pada bagian kop (kepala surat) hasil unduhan jadwal <strong>keseluruhan</strong> dan <strong>per unit</strong>. Diambil <strong>otomatis</strong> dari menu <a href="/lembaga" className="underline font-bold text-[#571466]">Identitas Lembaga</a> — tidak bisa diubah manual di sini. Yang bisa diatur di sini hanya pilihan logo kiri/kanan untuk kop jadwal keseluruhan.
                  </p>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1 text-[11px]">
                    <p className="whitespace-pre-line"><span className="font-bold text-slate-600">Keterangan Yayasan:</span> {identitasInduk.kop || '—'}</p>
                    <p><span className="font-bold text-slate-600">Nama Lembaga Pusat:</span> {identitasInduk.nama || '—'}</p>
                    <p><span className="font-bold text-slate-600">Alamat:</span> {identitasInduk.alamat || '—'}</p>
                  </div>

                  <div className="bg-[#F7ECFA]/50 border border-[#F0DFF5] rounded-xl p-3 space-y-3">
                    <p className="text-[10px] font-bold text-[#571466]">Logo yang Ditampilkan di Kop (Jadwal Keseluruhan)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Logo Kiri</label>
                        <select
                          value={identitasInduk.logoKiriSumber || 'pusat'}
                          onChange={e => updateIdentitasIndukField('logoKiriSumber', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white"
                        >
                          <option value="pusat">Logo Lembaga Pusat</option>
                          {daftarLembaga.map(l => <option key={l.id} value={l.id}>Logo {l.nama}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Logo Kanan</label>
                        <select
                          value={identitasInduk.logoKananSumber || 'pusat'}
                          onChange={e => updateIdentitasIndukField('logoKananSumber', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white"
                        >
                          <option value="pusat">Logo Lembaga Pusat</option>
                          {daftarLembaga.map(l => <option key={l.id} value={l.id}>Logo {l.nama}</option>)}
                        </select>
                      </div>
                    </div>
                    <p className="text-[9px] text-slate-400">Berlaku untuk kop jadwal keseluruhan (semua unit). Jadwal per guru tidak memakai kop/logo.</p>
                  </div>

                  <button type="submit" className="w-full bg-[#6A197D] text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-[#571466] transition flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" /> Simpan Identitas Lembaga Pusat
                  </button>
                </form>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Building className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-xs font-black text-slate-700">Alamat & Logo Unit (SMP, SMA, dst.)</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Nama unit mengikuti data Dashboard. Lengkapi alamat masing-masing unit di bawah ini — alamat akan tampil pada kop hasil unduhan jadwal khusus unit tersebut (nama unit, mis. "SMP", otomatis tampil sebagai baris kedua kop). Tentukan juga logo kiri/kanan yang dipakai untuk unit ini.
                  </p>

                  <div className="space-y-4 max-h-[560px] overflow-y-auto pr-1">
                    {daftarLembaga.map(l => (
                      <div key={l.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-black text-slate-800">{l.nama}</p>
                        <input
                          type="text"
                          placeholder="Alamat unit ini"
                          value={l.alamat || ''}
                          onChange={e => updateUnitField(l.id, 'alamat', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Logo Kiri</label>
                            <select
                              value={l.logoKiriSumber || 'pusat'}
                              onChange={e => updateUnitField(l.id, 'logoKiriSumber', e.target.value)}
                              className="w-full px-2.5 py-1.5 border rounded-lg text-[11px] font-medium outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                            >
                              <option value="pusat">Logo Lembaga Pusat</option>
                              {daftarLembaga.map(u => <option key={u.id} value={u.id}>Logo {u.nama}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Logo Kanan</label>
                            <select
                              value={l.logoKananSumber || 'pusat'}
                              onChange={e => updateUnitField(l.id, 'logoKananSumber', e.target.value)}
                              className="w-full px-2.5 py-1.5 border rounded-lg text-[11px] font-medium outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                            >
                              <option value="pusat">Logo Lembaga Pusat</option>
                              {daftarLembaga.map(u => <option key={u.id} value={u.id}>Logo {u.nama}</option>)}
                            </select>
                          </div>
                        </div>
                        <button onClick={() => handleSimpanUnit(l.id)} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-700 transition flex items-center gap-1.5">
                          <Check className="w-3 h-3" /> Simpan {l.nama}
                        </button>
                      </div>
                    ))}
                    {!daftarLembaga.length && <p className="text-[10px] text-slate-400 italic">Belum ada unit lembaga terdaftar di halaman Dashboard.</p>}
                  </div>
                </div>
              </div>
            )}


            {/* SUB: JADWAL GILIRAN */}
            {subTabKelas === 'giliran' && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <form onSubmit={handleSimpanGiliran} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <RotateCcw className="w-4 h-4 text-violet-600" />
                    <h2 className="text-xs font-black text-slate-700">{editGilId ? 'Edit Jadwal Giliran' : 'Jadwal Giliran (Bergantian)'}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">Untuk slot tertentu di suatu kelas yang diisi dua mapel atau lebih secara bergantian tiap minggu (mis. Minggu 1: Kimia, Minggu 2: Matematika).</p>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Rombel / Kelas</label>
                    <select value={formGilRombelId} onChange={e => setFormGilRombelId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-white" required>
                      <option value="">-- Pilih Rombel --</option>
                      {daftarRombel.map(r => <option key={r.id} value={r.id}>{r.nama}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Hari</label>
                      <select value={formGilHari} onChange={e => setFormGilHari(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                        {LIST_HARI.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Slot Waktu (JP)</label>
                      <select value={formGilWaktuId} onChange={e => setFormGilWaktuId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-white" required>
                        <option value="">-- Pilih Slot --</option>
                        {slotMapelUrut.map(w => <option key={w.id} value={w.id}>{w.label} ({w.mulai}–{w.selesai})</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mapel & Pendidik Bergiliran (min. 2)</label>
                    <div className="space-y-2">
                      {formGilMapelGuru.map((mg, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <span className="text-[9px] font-black text-violet-600 w-5 shrink-0">M{idx + 1}</span>
                          <select value={mg.mapelId} onChange={e => { const u = [...formGilMapelGuru]; u[idx] = { ...u[idx], mapelId: e.target.value }; setFormGilMapelGuru(u) }} className="flex-1 px-3 py-1.5 border rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-violet-500 bg-white">
                            <option value="">-- Mapel --</option>
                            {daftarMapel.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
                          </select>
                          <select value={mg.guruId} onChange={e => { const u = [...formGilMapelGuru]; u[idx] = { ...u[idx], guruId: e.target.value }; setFormGilMapelGuru(u) }} className="flex-1 px-3 py-1.5 border rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-violet-500 bg-white">
                            <option value="">-- Pendidik --</option>
                            {daftarGuru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                          </select>
                          {idx > 0 && <button type="button" onClick={() => setFormGilMapelGuru(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>}
                        </div>
                      ))}
                      <button type="button" onClick={() => setFormGilMapelGuru(prev => [...prev, { mapelId: '', guruId: '' }])} className="text-[10px] font-bold text-violet-600 hover:text-violet-800 flex items-center gap-1 mt-1">
                        <Plus className="w-3 h-3" /> Tambah Mapel Giliran
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Keterangan (Opsional)</label>
                    <input type="text" value={formGilKet} onChange={e => setFormGilKet(e.target.value)} placeholder="Cth: Bergantian tiap minggu" className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-violet-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-violet-700 transition flex items-center justify-center gap-2">
                      {editGilId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editGilId ? 'Simpan Perubahan' : 'Simpan Jadwal Giliran'}
                    </button>
                    {editGilId && <button type="button" onClick={resetFormGiliran} className="px-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200">Batal</button>}
                  </div>
                </form>

                <div className="xl:col-span-2 space-y-3">
                  <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Daftar Jadwal Giliran Terdaftar</h2>
                  {daftarJadwalGiliran.map(jg => {
                    const namaRombel = daftarRombel.find(r => r.id === jg.rombelId)?.nama || '-'
                    const namaWaktu = daftarWaktu.find(w => w.id === jg.waktuId)?.label || '-'
                    return (
                      <div key={jg.id} className={`bg-white border rounded-2xl p-5 shadow-sm flex items-start justify-between gap-4 ${editGilId === jg.id ? 'border-amber-300 ring-1 ring-amber-200' : 'border-violet-100'}`}>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <RotateCcw className="w-4 h-4 text-violet-600" />
                            <span className="font-black text-slate-800 text-sm">Kelas {namaRombel}</span>
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{jg.hari} · {namaWaktu}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {jg.mapelGuruList.map((mg: any, i: number) => {
                              const namaMapel = daftarMapel.find(m => m.id === mg.mapelId)?.nama || '-'
                              const namaGuru = daftarGuru.find(g => g.id === mg.guruId)?.nama || '-'
                              return (
                                <div key={i} className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 text-[10px]">
                                  <span className="font-black text-violet-800">Giliran {i + 1}:</span>
                                  <span className="font-bold text-slate-700 ml-1">{namaMapel}</span>
                                  <span className="text-slate-400 ml-1">({namaGuru})</span>
                                </div>
                              )
                            })}
                          </div>
                          {jg.keterangan && <p className="text-[10px] text-slate-400">{jg.keterangan}</p>}
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => handleEditGiliran(jg)} className="p-2 text-slate-400 hover:text-[#6A197D] rounded-lg"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleHapusGiliran(jg.id)} className="p-2 text-slate-400 hover:text-red-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    )
                  })}
                  {!daftarJadwalGiliran.length && <div className="py-16 text-center text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">Belum ada jadwal giliran.</div>}
                </div>
              </div>
            )}

            {/* SUB: JADWAL TETAP / BERLAKU UMUM */}
            {subTabKelas === 'tetap' && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <form onSubmit={handleSimpanTetap} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Calendar className="w-4 h-4 text-sky-600" />
                    <h2 className="text-xs font-black text-slate-700">{editTetapId ? 'Edit Jadwal Berlaku Umum' : 'Jadwal Berlaku Umum'}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">Jadwal yang berlaku untuk semua kelas atau kelompok kelas tertentu. Bisa berupa kegiatan (Upacara, Literasi, Kewalikelasan, dst) ATAU mata pelajaran yang diajar satu guru untuk beberapa kelas sekaligus (menggantikan "Kelas Gabungan").</p>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Jenis</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setFormTetapJenis('kegiatan')} className={`py-2 rounded-xl text-xs font-bold border transition ${formTetapJenis === 'kegiatan' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Nama Kegiatan</button>
                      <button type="button" onClick={() => { setFormTetapJenis('mapel'); if (formTetapHari === 'Semua') setFormTetapHari('Senin') }} className={`py-2 rounded-xl text-xs font-bold border transition ${formTetapJenis === 'mapel' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Mata Pelajaran</button>
                    </div>
                  </div>

                  {formTetapJenis === 'kegiatan' ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nama Kegiatan</label>
                      <input type="text" value={formTetapNama} onChange={e => setFormTetapNama(e.target.value)} placeholder="Cth: Upacara Bendera, Literasi, Kewalikelasan" className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-sky-500" required />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pendidik</label>
                        <select value={formTetapGuruId} onChange={e => { setFormTetapGuruId(e.target.value); setFormTetapMapelId(''); setFormTetapJumlahJp(null) }} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                          <option value="">-- Pilih Guru --</option>
                          {daftarGuru.map((g: any) => <option key={g.id} value={g.id}>{g.nama}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mata Pelajaran</label>
                        <select value={formTetapMapelId} onChange={e => { setFormTetapMapelId(e.target.value); setFormTetapJumlahJp(null) }} disabled={!formTetapGuruId} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white disabled:bg-slate-50 disabled:text-slate-400">
                          <option value="">{formTetapGuruId ? '-- Pilih Mapel --' : '-- Pilih Pendidik dulu --'}</option>
                          {(() => {
                            // Hanya tampilkan mapel yang BENAR-BENAR diampu guru
                            // terpilih (sesuai Pembagian Peran/Matriks Alokasi),
                            // bukan semua mapel yang ada di sekolah.
                            const mapelIdSet = new Set(matriksRows.filter(({ guru }) => guru.id === formTetapGuruId).map(({ mapel }) => mapel.id))
                            return daftarMapel.filter((m: any) => mapelIdSet.has(m.id)).map((m: any) => <option key={m.id} value={m.id}>{m.nama}</option>)
                          })()}
                        </select>
                      </div>
                      <p className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">Untuk kelas gabungan: pilih "Berlaku Untuk" = Kelas Tertentu di bawah, lalu centang minimal 2 kelas yang digabung.</p>
                      {formTetapGuruId && formTetapMapelId && (() => {
                        const opsiJp = opsiJpTetapDariMatriks()
                        if (opsiJp.length === 0) {
                          return <p className="text-[9px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">⚠ Belum ada Alokasi JP untuk kombinasi guru+mapel+kelas ini di Matriks Alokasi JP. Isi dulu di sana supaya JP terisi otomatis.</p>
                        }
                        if (opsiJp.length === 1) {
                          return <p className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">✓ Akan otomatis mengisi {opsiJp[0]} JP berturutan (sesuai Matriks Alokasi JP).</p>
                        }
                        return (
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Berapa JP? (sesuai Matriks: {opsiJp.join(', ')})</label>
                            <div className="flex gap-2">
                              {opsiJp.map(jp => (
                                <button key={jp} type="button" onClick={() => setFormTetapJumlahJp(jp)}
                                  className={`flex-1 py-2 rounded-xl text-xs font-extrabold border transition ${formTetapJumlahJp === jp ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-emerald-700 hover:bg-emerald-50'}`}>
                                  {jp} JP
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Hari</label>
                      <select value={formTetapHari} onChange={e => { setFormTetapHari(e.target.value); setFormTetapWaktuId('') }} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                        {formTetapJenis === 'kegiatan' && <option value="Semua">Semua Hari</option>}
                        {LIST_HARI.map(h => {
                          if (formTetapJenis === 'mapel' && formTetapGuruId) {
                            const reqStr = requestHariJp[`${formTetapGuruId}_${h}`] || ''
                            if (reqStr.trim() === '-') return null // guru ini sama sekali tidak bisa di hari ini
                          }
                          return <option key={h} value={h}>{h}</option>
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Slot Waktu</label>
                      <select value={formTetapWaktuId} onChange={e => setFormTetapWaktuId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 bg-white" required>
                        <option value="">-- Pilih Slot --</option>
                        {daftarWaktu.filter(w => {
                          // Untuk jenis Mata Pelajaran, hanya tampilkan slot yang
                          // SESUAI Request Ketersediaan Hari guru terpilih pada
                          // hari yang sedang dipilih -- supaya jadwal berlaku umum
                          // tidak bisa dibuat di jam yang memang tidak bisa diisi guru itu.
                          if (formTetapJenis !== 'mapel' || !formTetapGuruId || formTetapHari === 'Semua') return true
                          const reqStr = requestHariJp[`${formTetapGuruId}_${formTetapHari}`] || ''
                          return blokSesuaiKetersediaan(reqStr, [Number(w.jamKe)])
                        }).map(w => <option key={w.id} value={w.id}>{w.label} ({w.mulai}–{w.selesai})</option>)}
                      </select>
                      {formTetapJenis === 'mapel' && formTetapGuruId && formTetapHari !== 'Semua' && (requestHariJp[`${formTetapGuruId}_${formTetapHari}`] || '').trim() && (
                        <p className="text-[9px] text-slate-400 mt-1">Sesuai Request Ketersediaan: {requestHariJp[`${formTetapGuruId}_${formTetapHari}`]}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Berlaku Untuk</label>
                    <select value={formTetapBerlaku} onChange={e => setFormTetapBerlaku(e.target.value as any)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                      <option value="semua">Semua Kelas</option>
                      <option value="lembaga">Per Unit Lembaga</option>
                      <option value="rombel">Kelas Tertentu</option>
                    </select>
                  </div>

                  {formTetapBerlaku === 'lembaga' && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pilih Unit Lembaga</label>
                      <div className="grid grid-cols-2 gap-2 border rounded-xl p-3 bg-slate-50">
                        {daftarLembaga.map(l => (
                          <label key={l.id} className="flex items-center gap-1.5 text-[10px] font-bold cursor-pointer">
                            <input type="checkbox" checked={formTetapLembagaIds.includes(l.id)} onChange={() => setFormTetapLembagaIds(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])} className="rounded accent-sky-600" />
                            {l.nama}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {formTetapBerlaku === 'rombel' && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pilih Rombel</label>
                      <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto border rounded-xl p-3 bg-slate-50">
                        {daftarRombel.map(r => (
                          <label key={r.id} className="flex items-center gap-1.5 text-[10px] font-bold cursor-pointer">
                            <input type="checkbox" checked={formTetapRombelIds.includes(r.id)} onChange={() => setFormTetapRombelIds(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id])} className="rounded accent-sky-600" />
                            {r.nama}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Warna Badge</label>
                    <div className="flex flex-wrap gap-2">
                      {WARNA_OPTIONS.map(w => (
                        <button type="button" key={w.value} onClick={() => setFormTetapWarna(w.value)} className={`px-3 py-1 rounded-lg text-[10px] font-bold border ${w.value} ${formTetapWarna === w.value ? 'ring-2 ring-offset-1 ring-sky-500' : ''}`}>{w.label}</button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-sky-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-sky-700 transition flex items-center justify-center gap-2">
                      {editTetapId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editTetapId ? 'Simpan Perubahan' : 'Simpan Jadwal Tetap'}
                    </button>
                    {editTetapId && <button type="button" onClick={resetFormTetap} className="px-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200">Batal</button>}
                  </div>
                </form>

                <div className="xl:col-span-2 space-y-3">
                  <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Daftar Jadwal Berlaku Umum</h2>
                  {daftarJadwalTetap.map(jt => {
                    const namaWaktu = daftarWaktu.find(w => w.id === jt.waktuId)?.label || '-'
                    const berlakuLabel = jt.berlakuUntuk === 'semua' ? 'Semua Kelas' :
                      jt.berlakuUntuk === 'lembaga' ? `Unit: ${jt.lembagaIds.map((lid: string) => daftarLembaga.find(l => l.id === lid)?.nama || lid).join(', ')}` :
                      `Kelas: ${jt.rombelIds.map((rid: string) => daftarRombel.find(r => r.id === rid)?.nama || rid).join(', ')}`
                    return (
                      <div key={jt.id} className={`bg-white border rounded-2xl p-5 shadow-sm flex items-start justify-between gap-4 ${editTetapId === jt.id ? 'border-amber-300 ring-1 ring-amber-200' : 'border-sky-100'}`}>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Calendar className="w-4 h-4 text-sky-600" />
                            <span className="font-black text-slate-800 text-sm">{jt.nama}</span>
                            <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold border ${jt.warna}`}>{jt.nama}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-bold">Hari: {jt.hari}</span>
                            <span className="bg-[#F7ECFA] text-[#571466] px-2.5 py-1 rounded-lg font-bold">{namaWaktu}</span>
                            <span className="bg-sky-50 text-sky-700 px-2.5 py-1 rounded-lg font-bold">{berlakuLabel}</span>
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => handleEditTetap(jt)} className="p-2 text-slate-400 hover:text-[#6A197D] rounded-lg"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleHapusTetap(jt.id)} className="p-2 text-slate-400 hover:text-red-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    )
                  })}
                  {!daftarJadwalTetap.length && <div className="py-16 text-center text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">Belum ada jadwal berlaku umum.</div>}
                </div>
              </div>
            )}

            {/* SUB: LARANGAN MAPEL BERIRINGAN */}
            {subTabKelas === 'larangan' && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <form onSubmit={handleSimpanLarangan} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Ban className="w-4 h-4 text-rose-600" />
                    <h2 className="text-xs font-black text-slate-700">{editLarId ? 'Edit Larangan Beriringan' : 'Larangan Mapel Beriringan'}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Aturan ini bersifat <strong>satu arah</strong>. Contoh: jika "Setelah IPA" dilarang "Matematika",
                    maka IPA → Matematika dilarang, tetapi Matematika → IPA <em>masih boleh</em> kecuali ada aturan terpisah yang membaliknya.
                  </p>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Setelah Mapel</label>
                    <select value={formLarSetelahId} onChange={e => setFormLarSetelahId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-rose-500 bg-white" required>
                      <option value="">-- Pilih Mapel --</option>
                      {daftarMapel.map((m: any) => <option key={m.id} value={m.id}>{m.nama}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tidak Boleh Langsung Diikuti Oleh</label>
                    <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto border rounded-xl p-3 bg-slate-50">
                      {daftarMapel.filter((m: any) => m.id !== formLarSetelahId).map((m: any) => (
                        <label key={m.id} className="flex items-center gap-2 text-[10px] font-bold cursor-pointer hover:bg-rose-50 px-2 py-1 rounded-lg">
                          <input
                            type="checkbox"
                            checked={formLarDilarangIds.includes(m.id)}
                            onChange={() => setFormLarDilarangIds(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                            className="rounded accent-rose-600"
                          />
                          {m.nama}
                        </label>
                      ))}
                      {!daftarMapel.length && <p className="text-[10px] text-slate-400 italic">Belum ada data mapel.</p>}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-rose-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-rose-700 transition flex items-center justify-center gap-2">
                      {editLarId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editLarId ? 'Simpan Perubahan' : 'Simpan Larangan'}
                    </button>
                    {editLarId && <button type="button" onClick={resetFormLarangan} className="px-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200">Batal</button>}
                  </div>
                </form>

                <div className="xl:col-span-2 space-y-3">
                  <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Daftar Aturan Larangan</h2>

                  {!daftarLarangan.length && (
                    <div className="py-16 text-center text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">Belum ada aturan larangan beriringan.</div>
                  )}

                  {daftarLarangan.map(l => {
                    const namaSetelah = daftarMapel.find((m: any) => m.id === l.setelahMapelId)?.nama || '-'
                    const namaDilarang = l.dilarangMapelIds.map((did: string) => daftarMapel.find((m: any) => m.id === did)?.nama || did)
                    return (
                      <div key={l.id} className={`bg-white border rounded-2xl p-5 shadow-sm flex items-start justify-between gap-4 ${editLarId === l.id ? 'border-amber-300 ring-1 ring-amber-200' : 'border-rose-100'}`}>
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Ban className="w-4 h-4 text-rose-500 shrink-0" />
                            <span className="font-black text-slate-800 text-sm">Setelah: <span className="text-[#571466]">{namaSetelah}</span></span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">Tidak boleh langsung diikuti:</span>
                            {namaDilarang.map((n: string, i: number) => (
                              <span key={i} className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">{n}</span>
                            ))}
                          </div>
                          <p className="text-[9px] text-slate-400 italic">Berlaku searah — kebalikannya tidak terpengaruh kecuali ada aturan terpisah.</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => handleEditLarangan(l)} className="p-2 text-slate-400 hover:text-[#6A197D] rounded-lg"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleHapusLarangan(l.id)} className="p-2 text-slate-400 hover:text-red-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* SUB: SEMESTER, TITIMANGSA & TANDA TANGAN */}
            {subTabKelas === 'titimangsa' && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Calendar className="w-4 h-4 text-[#6A197D]" />
                    <h2 className="text-xs font-black text-slate-700">Pengaturan Semester</h2>
                  </div>
                  <p className="text-[10px] text-slate-500">Semester ini akan tampil pada kop hasil unduhan jadwal.</p>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Semester Aktif</label>
                    <select value={semesterAktif} onChange={e => handleSimpanSemester(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                      <option value="Ganjil">Ganjil</option>
                      <option value="Genap">Genap</option>
                    </select>
                  </div>
                  <div className="bg-[#F7ECFA]/50 border border-[#F0DFF5] rounded-xl p-3 text-[10px] text-[#571466] font-semibold">
                    Tahun Ajaran mengikuti data yang aktif di halaman Dashboard: <strong>{tahunAjaranAktif}</strong>
                  </div>
                </div>

                <form onSubmit={handleSimpanTtd} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <PenLine className="w-4 h-4 text-amber-600" />
                    <h2 className="text-xs font-black text-slate-700">Titimangsa</h2>
                  </div>
                  <p className="text-[10px] text-slate-500">Diisi sekali, akan tampil otomatis di bagian bawah hasil unduhan jadwal (di atas tanda tangan).</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tempat</label>
                      <input type="text" placeholder="Cth: Bandung" value={ttd.tempat} onChange={e => updateTtdField('tempat', e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tanggal</label>
                      <input type="text" placeholder="Cth: 19 Januari 2026" value={ttd.tanggal} onChange={e => updateTtdField('tanggal', e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500" />
                    </div>
                  </div>

                  <button type="submit" className="w-full bg-amber-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-amber-700 transition flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" /> Simpan Titimangsa
                  </button>
                </form>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-2">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Shield className="w-4 h-4 text-[#6A197D]" />
                    <h2 className="text-xs font-black text-slate-700">Penandatangan (Terdeteksi Otomatis)</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Penandatangan jadwal <strong>tidak diisi manual di sini</strong>. Jadwal <strong>keseluruhan</strong> (Lembaga Induk) hanya menampilkan <strong>1 penandatangan: Mudir</strong> — tanpa Waka Kurikulum. Jadwal per <strong>unit</strong> menampilkan <strong>2 penandatangan</strong>: Kepala Satuan (kiri) dan Waka Kurikulum (kanan). Data nama diambil otomatis dari halaman <a href="/lembaga" className="underline font-bold text-[#571466]">Identitas Lembaga</a> dan penugasan peran di <a href="/peran/guru" className="underline font-bold text-[#571466]">Kelola Data Guru</a> — pastikan ada guru dengan peran "Waka Kurikulum" yang ditugaskan ke unit terkait agar nama tampil otomatis di kop hasil unduhan unit.
                  </p>

                  <div className="space-y-3">
                    <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4">
                      <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Jadwal Keseluruhan (Lembaga Induk) → Mudir</p>
                      <p className="text-sm font-black text-slate-900">{getMudirPusat().nama}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{getMudirPusat().label} {getMudirPusat().nuptk !== '-' && `· NUPTK: ${getMudirPusat().nuptk}`}</p>
                    </div>

                    {daftarLembaga.map(l => {
                      const p = getKepalaSatuanUnit(l.id)
                      const w = getWakaKurikulumUnit(l.id)
                      return (
                        <div key={l.id} className="bg-sky-50/50 border border-sky-100 rounded-xl p-4 grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[9px] font-black text-sky-600 uppercase tracking-widest mb-1">Unit: {l.nama} → Kepala Satuan</p>
                            <p className="text-sm font-black text-slate-900">{p.nama}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{p.label} {p.nuptk !== '-' && `· NUPTK: ${p.nuptk}`}</p>
                          </div>
                          <div className="border-l border-sky-200 pl-4">
                            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Unit: {l.nama} → Waka Kurikulum</p>
                            <p className="text-sm font-black text-slate-900">{w.nama}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{w.label} {w.nuptk !== '-' && `· NUPTK: ${w.nuptk}`}</p>
                          </div>
                        </div>
                      )
                    })}
                    {!daftarLembaga.length && <p className="text-[10px] text-slate-400 italic">Belum ada unit lembaga terdaftar di halaman Dashboard.</p>}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Info className="w-4 h-4 text-rose-500" />
                    <h2 className="text-xs font-black text-slate-700">Keterangan Tambahan per Unit (Tampil di Hasil Unduhan)</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Tulis keterangan khusus yang ingin ditampilkan di bagian bawah tabel jadwal saat diunduh/dicetak — <strong>satu baris untuk satu poin</strong> (akan otomatis diberi nomor urut). Keterangan untuk setiap unit <strong>berbeda-beda</strong> dan tidak saling memengaruhi. Contoh: "Jadwal Bahasa Inggris dan Kimia bergantian setiap minggu".
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-[#571466] uppercase tracking-wider mb-1.5 block">Keterangan — Lembaga Induk / Keseluruhan</label>
                      <textarea
                        value={keteranganUnit['semua'] || ''}
                        onChange={e => updateKeteranganUnit('semua', e.target.value)}
                        rows={4}
                        placeholder={'Jadwal Bahasa Inggris dan Kimia bergantian setiap minggu\nLiterasi dan Kewalikelasan bergantian setiap minggu'}
                        className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#8A2FA0] resize-y"
                      />
                    </div>
                    {daftarLembaga.map(l => (
                      <div key={l.id}>
                        <label className="text-[10px] font-bold text-sky-700 uppercase tracking-wider mb-1.5 block">Keterangan — {l.nama}</label>
                        <textarea
                          value={keteranganUnit[l.id] || ''}
                          onChange={e => updateKeteranganUnit(l.id, e.target.value)}
                          rows={4}
                          placeholder={'Jadwal Bahasa Inggris dan Kimia bergantian setiap minggu\nLiterasi dan Kewalikelasan bergantian setiap minggu'}
                          className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-sky-500 resize-y"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-400">Tersimpan otomatis setiap perubahan.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            TAB 3: PLOT MATRIKS
        ========================================================= */}
        {bolehEdit && tabView === 'input' && (
          <div className="space-y-8">

            {/* MATRIKS ALOKASI JP */}
            <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-[#6A197D]" />
                  <h2 className="font-bold text-slate-800 text-sm">Matriks Alokasi JP (per Guru × Mapel × Kelas)</h2>
                </div>
                <p className="text-[10px] text-slate-500 max-w-xl">Isikan alokasi JP dengan format: <strong className="text-[#571466]">3</strong> = 3 JP 1 sesi, atau <strong className="text-[#571466]">2, 3</strong> = 5 JP dalam 2 sesi berbeda hari. Data guru bersumber dari Modul Data Pendidik. <span className="text-amber-600 font-semibold">Catatan: sesi 2 JP otomatis ditempatkan berurutan tanpa terpotong istirahat; sesi 3 JP boleh terpotong istirahat.</span></p>
              </div>

              {daftarGuru.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[11px] text-amber-800 font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" />
                  Belum ada data guru. Silakan daftarkan guru terlebih dahulu di halaman <a href="/peran/guru" className="underline font-black">Modul Data Pendidik</a>.
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[400px]">
                <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                      <th className="p-4 min-w-[150px] sticky left-0 z-20 bg-slate-50 border-r border-slate-200">Pendidik</th>
                      <th className="p-4 min-w-[150px] sticky left-[150px] z-20 bg-slate-50 border-r border-slate-200">Mata Pelajaran</th>
                      {daftarRombel.map(r => (
                        <th key={r.id} className="p-4 text-center min-w-[75px] bg-sky-50/50 text-sky-800 border-l border-sky-100 uppercase tracking-widest text-[10px]">{r.nama}</th>
                      ))}
                      <th className="p-4 text-center min-w-[65px] bg-[#F7ECFA]/70 text-[#450F52] border-l border-[#F0DFF5] text-[10px]">Total JP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {matriksRows.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 group">
                        <td className="p-4 font-black text-slate-800 border-r border-slate-200 sticky left-0 z-10 bg-white group-hover:bg-slate-50">{item.guru.nama}</td>
                        <td className="p-4 text-[#571466] font-bold border-r border-slate-200 sticky left-[150px] z-10 bg-white group-hover:bg-slate-50">{item.mapel.nama}</td>
                        {daftarRombel.map(r => {
                          const isPJ = item.rombelRelevant.includes(r.id)
                          const key = `${item.guru.id}_${item.mapel.id}_${r.id}`
                          const sudahDiBerlakuUmum = daftarJadwalTetap.some(jt =>
                            jt.jenis === 'mapel' && jt.guruId === item.guru.id && jt.mapelId === item.mapel.id &&
                            (jt.berlakuUntuk === 'semua' || (jt.berlakuUntuk === 'rombel' && jt.rombelIds?.includes(r.id)) || (jt.berlakuUntuk === 'lembaga' && getRombelLembagaId(r.id) && jt.lembagaIds?.includes(getRombelLembagaId(r.id)!)))
                          )
                          if (isPJ && sudahDiBerlakuUmum) {
                            return (
                              <td key={r.id} className="p-2 text-center border-l border-slate-100 bg-emerald-50">
                                <span title="Sudah diatur lewat Jadwal Berlaku Umum -- tidak perlu diisi lagi di sini" className="text-[9px] font-bold text-emerald-700">✓ Berlaku Umum</span>
                              </td>
                            )
                          }
                          return (
                            <td key={r.id} className="p-2 text-center border-l border-slate-100">
                              {isPJ ? (
                                <input type="text" placeholder="–" value={matriksRinciJp[key] || ''}
                                  onChange={e => { const u = { ...matriksRinciJp, [key]: e.target.value }; setMatriksRinciJp(u) }}
                                  onBlur={e => {
                                    const nilai = e.target.value.trim()
                                    if (!nilai) { save('matriks_alokasi_rinci_samping', matriksRinciJp); return }
                                    const segmen = nilai.split(',').map(x => x.trim()).filter(Boolean)
                                    const adaSatuJp = segmen.some(s => Number(s) === 1)
                                    if (adaSatuJp) {
                                      alert('Alokasi JP per sesi tidak boleh 1 JP. Gunakan minimal 2 JP per sesi (mis. "2" atau "2, 3"), sesuai aturan penjadwalan.')
                                      const u = { ...matriksRinciJp, [key]: '' }
                                      setMatriksRinciJp(u)
                                      save('matriks_alokasi_rinci_samping', u)
                                      return
                                    }
                                    // PENTING: kalau kelas ini bagian dari grup KELAS GABUNGAN untuk
                                    // mapel ini, otomatis isi JP yang SAMA ke semua kelas lain dalam
                                    // grup itu juga -- supaya admin tidak perlu mengetik ulang nilai
                                    // yang sama satu-satu per kelas (dan tidak ada yang kelewatan
                                    // kosong, yang menyebabkan kelas itu tidak pernah ikut digenerate).
                                    const kelasGabunganTerkait = daftarKelasGabungan.find((kg: any) => kg.mapelId === item.mapel.id && kg.rombelIds?.includes(r.id) && kg.rombelIds?.length > 1)
                                    let u = { ...matriksRinciJp, [key]: nilai }
                                    if (kelasGabunganTerkait) {
                                      kelasGabunganTerkait.rombelIds.forEach((ridLain: string) => {
                                        if (ridLain === r.id) return
                                        const keyLain = `${item.guru.id}_${item.mapel.id}_${ridLain}`
                                        u[keyLain] = nilai
                                      })
                                    }
                                    setMatriksRinciJp(u)
                                    save('matriks_alokasi_rinci_samping', u)
                                  }}
                                  className="w-16 h-8 border border-slate-200 rounded-lg text-center outline-none focus:ring-2 focus:ring-[#8A2FA0] font-extrabold text-xs shadow-sm bg-white" />
                              ) : <span className="text-slate-300 text-[10px]">–</span>}
                            </td>
                          )
                        })}
                        <td className="p-4 text-center border-l border-slate-100 font-black bg-[#F7ECFA]/30 text-[#330B40]">
                          {daftarRombel.reduce((s, r) => {
                            if (!item.rombelRelevant.includes(r.id)) return s
                            return s + hitungJpStr(matriksRinciJp[`${item.guru.id}_${item.mapel.id}_${r.id}`] || '')
                          }, 0)} JP
                        </td>
                      </tr>
                    ))}
                    {!matriksRows.length && <tr><td colSpan={3 + daftarRombel.length} className="py-16 text-center text-slate-400 text-xs">Belum ada pemetaan penugasan guru.</td></tr>}
                  </tbody>
                  {matriksRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#F7ECFA] border-t-2 border-[#E3C2ED] font-black text-[#330B40]">
                        <td colSpan={2} className="p-4 sticky left-0 z-10 bg-[#F7ECFA] border-r border-slate-200">Total JP / Kelas</td>
                        {daftarRombel.map(r => {
                          const totalKelas = matriksRows.reduce((sum, item) => {
                            if (!item.rombelRelevant.includes(r.id)) return sum
                            return sum + hitungJpStr(matriksRinciJp[`${item.guru.id}_${item.mapel.id}_${r.id}`] || '')
                          }, 0)
                          return <td key={r.id} className="p-4 text-center border-l border-sky-100">{totalKelas} JP</td>
                        })}
                        <td className="p-4 text-center border-l border-[#E3C2ED] bg-[#F0DFF5]">
                          {daftarRombel.reduce((grand, r) => {
                            return grand + matriksRows.reduce((sum, item) => {
                              if (!item.rombelRelevant.includes(r.id)) return sum
                              return sum + hitungJpStr(matriksRinciJp[`${item.guru.id}_${item.mapel.id}_${r.id}`] || '')
                            }, 0)
                          }, 0)} JP
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>

            {/* REQUEST HARI */}
            <section className="bg-amber-50/30 border border-amber-100 p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-amber-200 pb-3">
                <Shield className="w-5 h-5 text-amber-700" />
                <div>
                  <h2 className="font-black text-amber-900 text-sm">Request Ketersediaan Hari Pendidik</h2>
                  <p className="text-[10px] font-semibold text-amber-600 mt-0.5">Isi rentang jam ke- yang tersedia, cth: <strong>1-2,9-10</strong> (hanya bisa jam ke-1 s/d 2 dan jam ke-9 s/d 10). Isi <strong>–</strong> jika sama sekali tidak bisa di hari itu. Kosongkan jika bebas kapan saja.</p>
                </div>
              </div>
              <div className="overflow-x-auto border border-amber-200 rounded-xl max-h-[300px]">
                <table className="w-full text-xs border-collapse whitespace-nowrap bg-white">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-amber-50 border-b border-amber-200 text-amber-800 font-black tracking-wider">
                      <th className="p-4 min-w-[160px] sticky left-0 z-20 bg-amber-50 border-r border-amber-200">Pendidik</th>
                      {LIST_HARI.map(h => <th key={h} className="p-4 text-center min-w-[110px] border-l border-amber-100 text-[10px]">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {daftarGuru.map(g => (
                      <tr key={g.id} className="hover:bg-amber-50/30 group">
                        <td className="p-4 font-black text-slate-800 sticky left-0 z-10 bg-white border-r border-amber-100 group-hover:bg-amber-50/30">{g.nama}</td>
                        {LIST_HARI.map(h => {
                          const key = `${g.id}_${h}`
                          return (
                            <td key={h} className="p-2 text-center border-l border-amber-50">
                              <input type="text" placeholder="cth: 1-2,9-10" value={requestHariJp[key] || ''} onChange={e => { const u = { ...requestHariJp, [key]: e.target.value }; setRequestHariJp(u); save('request_hari_jp_guru', u) }} className="w-24 h-8 border border-amber-200 rounded-lg text-center outline-none focus:ring-1 focus:ring-amber-500 font-bold text-[10px] bg-amber-50/10" />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {!daftarGuru.length && <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-xs">Belum ada data guru.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-4 pt-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-[#571466] uppercase tracking-wider">Cakupan Generate</label>
                  <select
                    value={generateScope}
                    onChange={e => setGenerateScope(e.target.value)}
                    disabled={!!unitScopeGenerate && lembagaGenerateBolehDipilih.length <= 1}
                    className="px-4 py-2.5 border border-[#E3C2ED] rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white min-w-[220px] disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    {!unitScopeGenerate && <option value="semua">Seluruh Lembaga (semua unit)</option>}
                    {lembagaGenerateBolehDipilih.map(l => <option key={l.id} value={l.id}>Unit: {l.nama} saja</option>)}
                  </select>
                  <p className="text-[9px] text-slate-400 max-w-xs">
                    {generateScope === 'semua'
                      ? 'Semua jadwal akan di-generate ulang dari awal.'
                      : `Hanya jadwal unit "${daftarLembaga.find(l => l.id === generateScope)?.nama}" yang akan di-generate ulang. Jadwal unit lain dipertahankan.`}
                  </p>
                  {unitScopeGenerate && (
                    <p className="text-[9px] text-amber-600 font-semibold max-w-xs">🔒 Akun Anda hanya berwenang men-generate jadwal untuk unit yang Anda kelola.</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 h-fit">
                  <div className="flex gap-2">
                    <button onClick={handleGenerate} className={`flex items-center gap-2 ${isGenerating ? 'bg-red-500 hover:bg-red-600' : 'bg-[#6A197D] hover:bg-[#571466]'} text-white px-6 py-3 rounded-xl font-extrabold text-xs shadow-md transition`}>
                      <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                      {isGenerating ? 'Batalkan' : 'Generate Jadwal Otomatis'}
                    </button>
                    <button onClick={handleHapusHasilGenerate} disabled={isGenerating}
                      className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-5 py-3 rounded-xl font-extrabold text-xs shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
                      <Trash2 className="w-4 h-4" /> Hapus Hasil Generate
                    </button>
                    {undoTersedia && (
                      <button onClick={handleUndoJadwal} disabled={isGenerating}
                        className="flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-5 py-3 rounded-xl font-extrabold text-xs shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title={`Kembalikan ke kondisi sebelum: ${undoTersedia.deskripsi}`}>
                        <RotateCcw className="w-4 h-4" /> Undo Terakhir
                      </button>
                    )}
                  </div>
                  {undoTersedia && <p className="text-[9px] text-amber-600 max-w-xs">Bisa dikembalikan ke sebelum: "{undoTersedia.deskripsi}"</p>}
                  {generateProgress && <p className="text-[10px] text-[#6A197D] font-semibold animate-pulse max-w-xs">{generateProgress}</p>}
                </div>
              </div>
            </section>

            {/* JADWAL PIKET GURU */}
            <section className="bg-teal-50/30 border border-teal-100 p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-teal-200 pb-3">
                <ClipboardList className="w-5 h-5 text-teal-700" />
                <div>
                  <h2 className="font-black text-teal-900 text-sm">Jadwal Piket Guru</h2>
                  <p className="text-[10px] font-semibold text-teal-600 mt-0.5">Pilih lembaga/unit terlebih dahulu, lalu cari nama guru yang bertugas piket pada tiap hari untuk unit tersebut.</p>
                </div>
              </div>

              {/* Pilih lembaga / unit */}
              <div className="flex flex-wrap gap-2">
                {daftarLembaga.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setPiketFormLembagaId(l.id)}
                    className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition ${piketFormLembagaId === l.id ? 'bg-teal-600 border-teal-600 text-white shadow-sm' : 'bg-white border-teal-200 text-teal-700 hover:bg-teal-50'}`}
                  >
                    {l.nama}
                  </button>
                ))}
                {!daftarLembaga.length && <span className="text-[10px] text-slate-400">Belum ada data lembaga/unit. Tambahkan dahulu di halaman Identitas Lembaga.</span>}
              </div>

              {piketFormLembagaId && (
                <>
                  {/* Keterangan lembaga yang sedang diedit */}
                  <div className="flex items-center gap-2 bg-teal-100/60 border border-teal-200 rounded-xl px-3.5 py-2">
                    <Info className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                    <p className="text-[10.5px] font-bold text-teal-800">
                      Mengatur piket untuk: <span className="text-teal-900">{daftarLembaga.find(l => l.id === piketFormLembagaId)?.nama || '-'}</span>
                      <span className="font-semibold text-teal-600"> — hanya tampil pada jadwal unit ini & jadwal keseluruhan.</span>
                    </p>
                  </div>

                  <div className="overflow-x-auto border border-teal-200 rounded-xl max-h-[320px] overflow-y-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-30">
                        <tr className="bg-teal-50 border-b border-teal-200 text-teal-800 font-black tracking-wider">
                          {LIST_HARI.slice(0, 5).map(h => <th key={h} className="p-3 text-center border-l border-teal-100 text-[10px] min-w-[150px]">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {LIST_HARI.slice(0, 5).map(h => {
                            const guruDiLembagaIni = daftarGuru.filter((g: any) => getGuruIdsMengajarDiLembaga(piketFormLembagaId).includes(g.id))
                            const idTerpilih: string[] = piketDraft[piketFormLembagaId]?.[h] || []
                            const query = (piketSearchQuery[h] || '').trim().toLowerCase()
                            const hasilCari = query
                              ? guruDiLembagaIni.filter((g: any) => !idTerpilih.includes(g.id) && g.nama.toLowerCase().includes(query))
                              : []
                            return (
                              <td key={h} className="p-3 align-top border-l border-teal-50 bg-white">
                                <div className="relative">
                                  <input
                                    type="text"
                                    value={piketSearchQuery[h] || ''}
                                    onChange={e => setPiketSearchQuery(prev => ({ ...prev, [h]: e.target.value }))}
                                    placeholder="Cari nama guru..."
                                    className="w-full text-[10px] font-semibold px-2.5 py-1.5 border border-teal-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-300"
                                  />
                                  {query && (
                                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-teal-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                      {hasilCari.length > 0 ? hasilCari.map((g: any) => (
                                        <button
                                          key={g.id}
                                          type="button"
                                          onClick={() => { handleTogglePiket(piketFormLembagaId, h, g.id); setPiketSearchQuery(prev => ({ ...prev, [h]: '' })) }}
                                          className="w-full text-left px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-teal-50"
                                        >
                                          + {g.nama}
                                        </button>
                                      )) : (
                                        <p className="px-2.5 py-1.5 text-[10px] text-slate-400 italic">Tidak ditemukan.</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {idTerpilih.map(gid => {
                                    const g = guruDiLembagaIni.find((x: any) => x.id === gid)
                                    if (!g) return null
                                    return (
                                      <span key={gid} className="flex items-center gap-1 bg-teal-100 text-teal-800 text-[10px] font-semibold px-2 py-1 rounded-full">
                                        {g.nama}
                                        <button type="button" onClick={() => handleTogglePiket(piketFormLembagaId, h, gid)} className="text-teal-600 hover:text-teal-900">
                                          <X className="w-3 h-3" />
                                        </button>
                                      </span>
                                    )
                                  })}
                                  {idTerpilih.length === 0 && <span className="text-[9px] text-slate-400">Belum ada guru piket.</span>}
                                </div>
                                {!guruDiLembagaIni.length && <span className="text-[9px] text-slate-400">Belum ada guru yang mengajar di unit ini.</span>}
                              </td>
                            )
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            {/* MATRIKS PLOT TABEL */}
            <div className="space-y-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 flex-wrap gap-4">
                <div>
                  <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">Tabel Plot Jadwal – Klik Sel untuk Edit</h2>
                  <p className="text-[9px] text-slate-400 font-semibold mt-0.5">Jadwal tetap (Upacara, Literasi, dll.) ditampilkan otomatis sesuai pengaturan. Sel berwarna biru = jadwal tetap (tidak bisa di-edit di sini).</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold text-[#330B40] uppercase tracking-wider">Hari:</span>
                  <select value={hariPlotTabel} onChange={e => setHariPlotTabel(e.target.value)} className="px-3 py-1.5 border border-[#E3C2ED] rounded-xl text-xs bg-[#F7ECFA] font-black text-[#220729] outline-none">
                    {getHariTampil().map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
              {modeTampil === 'unit' && unitFilter !== 'lembaga-induk' && (
                <p className="text-[10px] text-amber-600 font-semibold -mt-2">Catatan: jadwal untuk unit lembaga hanya ditampilkan/dicetak Senin s.d. Jumat.</p>
              )}

              <div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-[11px] border-collapse whitespace-nowrap">
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-[#220729] text-white font-black tracking-wider text-[10px] uppercase">
                      <th className="p-2 border-r border-[#330B40] min-w-[70px] sticky left-0 z-20 bg-[#220729]">Waktu</th>
                      {getRombelForUnit().map(r => (
                        <th key={r.id} className="p-2 border-l border-[#330B40] text-center min-w-[95px]">Kelas {r.nama}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {allSlotsUrut.map(slot => (
                      <tr key={slot.id} className={slot.jenis === 'istirahat' ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                        <td className="p-1.5 bg-slate-50 border-r border-slate-200 font-black text-[#330B40] sticky left-0 z-10 text-center">
                          <p className="text-[9px] font-extrabold text-[#6A197D]">{slot.mulai}–{slot.selesai}</p>
                        </td>
                        {slot.jenis === 'istirahat' ? (
                          <td colSpan={getRombelForUnit().length} className="text-center text-[10px] font-bold text-amber-700 py-1">— {slot.label} —</td>
                        ) : (
                          kelompokkanSelBaris(hariPlotTabel, slot.id, getRombelForUnit()).map((segmen, segIdx) => {
                            if (segmen.tipe === 'tetap') {
                              const tetapItem = segmen.tetapItem
                              if (tetapItem.jenis === 'mapel') {
                                const mapelTetap = daftarMapel.find((m: any) => m.id === tetapItem.mapelId)
                                const guruTetap = daftarGuru.find((g: any) => g.id === tetapItem.guruId)
                                return (
                                  <td key={`tetap-${segIdx}`} colSpan={segmen.rombelIds.length} className="p-1.5 border-l border-slate-100 text-center align-middle bg-emerald-50">
                                    <p className="text-[#220729] font-black text-sm leading-none" title={`${mapelTetap?.nama || ''}${guruTetap?.nama ? ' — ' + guruTetap.nama : ''}`}>{mapelTetap?.kode || mapelTetap?.nama || '–'}</p>
                                  </td>
                                )
                              }
                              return (
                                <td key={`tetap-${segIdx}`} colSpan={segmen.rombelIds.length} className={`p-1.5 border-l border-slate-100 text-center align-middle ${tetapItem.warna}`}>
                                  <p className="font-black text-xs leading-none">{tetapItem.nama}</p>
                                </td>
                              )
                            }

                            // Baik 'gabungan' maupun 'individual' memakai persis logika sel
                            // biasa di bawah -- bedanya cuma 'gabungan' dirender SATU kali
                            // dengan colSpan (mewakili semua kelas dalam grupnya), memakai
                            // kelas PERTAMA dalam grup sebagai representasi untuk keperluan
                            // klik-untuk-edit (konsisten dengan data kelas gabungan yang
                            // memang satu penugasan guru+mapel utk semua kelas dalam grup itu).
                            const r = getRombelForUnit().find((rr: any) => rr.id === (segmen.tipe === 'gabungan' ? segmen.rombelIds[0] : segmen.rombelId))!
                            const colSpanIni = segmen.tipe === 'gabungan' ? segmen.rombelIds.length : 1
                            const cellKey = `${hariPlotTabel}_${slot.id}_${r.id}`
                            const jadwalGiliran = daftarJadwalGiliran.find(jg => jg.rombelId === r.id && jg.waktuId === slot.id && jg.hari === hariPlotTabel)
                            const jadwalItem = daftarJadwal.find(j => j.hari === hariPlotTabel && j.waktuId === slot.id && j.rombelId === r.id) || cariJadwalGabunganLintasKelas(hariPlotTabel, slot.id, r.id)
                            const mapelItem = daftarMapel.find(m => m.id === jadwalItem?.mapelId)
                            const guruItem = daftarGuru.find(g => g.id === jadwalItem?.guruId)
                            const isGabungan = segmen.tipe === 'gabungan'
                            const labelGiliran = jadwalGiliran ? jadwalGiliran.mapelGuruList.map(mg => daftarMapel.find(m => m.id === mg.mapelId)?.nama || '').filter(Boolean).join('/') : ''
                            const guruGiliran = jadwalGiliran ? jadwalGiliran.mapelGuruList.map(mg => daftarGuru.find(g => g.id === mg.guruId)?.nama || '').filter(Boolean).join(' / ') : ''

                            return (
                              <td key={r.id} colSpan={colSpanIni} onClick={() => { setEditingCell(cellKey); setEditGuruMapel(jadwalItem ? `${jadwalItem.guruId}|${jadwalItem.mapelId}` : ''); setEditJumlahJp(null); setCariGuruMapel('') }} className={`p-1.5 border-l border-slate-100 text-center align-middle cursor-pointer transition-colors relative min-h-[38px] ${editingCell === cellKey ? 'bg-amber-50/70 ring-1 ring-amber-400' : 'hover:bg-[#F7ECFA]/30'}`}>
                                {editingCell === cellKey ? (
                                  <div className="flex flex-col gap-1.5 items-center justify-center bg-white p-2.5 rounded-xl border border-slate-100 shadow-xl z-20 absolute top-2 left-2 right-2">
                                {(() => {
                                  const opsiSemua = getMapelGuruUntukRombel(r.id)
                                  const terpilih = editGuruMapel ? opsiSemua.find(mg => `${mg.guruId}|${mg.mapelId}` === editGuruMapel) : null
                                  const queryCari = cariGuruMapel.trim().toLowerCase()
                                  const hasilCari = queryCari
                                    ? opsiSemua.filter(mg => (mg.guruNama + ' ' + mg.mapelNama).toLowerCase().includes(queryCari)).slice(0, 8)
                                    : []
                                  const pilihOpsi = (mg: any) => {
                                    const val = `${mg.guruId}|${mg.mapelId}`
                                    setEditGuruMapel(val)
                                    setCariGuruMapel('')
                                    const opsiJp = hitungTargetTersisaJp(mg.guruId, mg.mapelId, r.id, hariPlotTabel, jadwalItem?.id)
                                    setEditJumlahJp(opsiJp.length === 1 ? opsiJp[0] : null)
                                  }
                                  return (
                                    <div className="w-full relative" onClick={e => e.stopPropagation()}>
                                      {terpilih ? (
                                        <div className="flex items-center justify-between gap-1 bg-[#F7ECFA] border border-[#E3C2ED] rounded-lg px-2 py-1.5">
                                          <span className="text-[9px] font-bold text-[#571466] truncate">{terpilih.guruNama} – {terpilih.mapelNama}</span>
                                          <button onClick={() => { setEditGuruMapel(''); setEditJumlahJp(null) }} className="text-[#8A3499] hover:text-[#571466] shrink-0"><X className="w-3 h-3" /></button>
                                        </div>
                                      ) : (
                                        <input
                                          type="text"
                                          autoFocus
                                          value={cariGuruMapel}
                                          onChange={e => setCariGuruMapel(e.target.value)}
                                          placeholder="Cari nama guru/mapel..."
                                          className="w-full text-[9px] font-bold border border-slate-200 rounded-lg px-2 py-1.5 outline-none bg-slate-50 focus:ring-1 focus:ring-[#8A2FA0]"
                                        />
                                      )}
                                      {queryCari && !terpilih && (
                                        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-36 overflow-y-auto">
                                          {hasilCari.length > 0 ? hasilCari.map(mg => (
                                            <button key={`${mg.guruId}-${mg.mapelId}`} type="button" onClick={() => pilihOpsi(mg)}
                                              className="w-full text-left px-2 py-1.5 text-[9px] font-semibold text-slate-700 hover:bg-[#F7ECFA] border-b border-slate-50 last:border-0">
                                              {mg.guruNama} – {mg.mapelNama}
                                            </button>
                                          )) : (
                                            <p className="px-2 py-1.5 text-[9px] text-slate-400 italic">Tidak ditemukan.</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}
                                    {editGuruMapel && (() => {
                                      const [gIdSel, mIdSel] = editGuruMapel.split('|')
                                      const kuotaSel = matriksRinciJp[`${gIdSel}_${mIdSel}_${r.id}`] || ''
                                      const opsiJp = hitungTargetTersisaJp(gIdSel, mIdSel, r.id, hariPlotTabel, jadwalItem?.id)
                                      if (!kuotaSel) return null
                                      if (opsiJp.length === 0) {
                                        return <p className="text-[8px] text-red-500 font-bold w-full">✕ Semua sesi ({kuotaSel}) untuk kombinasi ini sudah terpakai penuh.</p>
                                      }
                                      if (opsiJp.length === 1) {
                                        return (
                                          <p className="text-[8px] text-emerald-600 font-bold w-full">✓ Akan otomatis mengisi {opsiJp[0]} JP berturutan (sisa satu-satunya dari Matriks: {kuotaSel}).</p>
                                        )
                                      }
                                      return (
                                        <div className="w-full" onClick={e => e.stopPropagation()}>
                                          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">Isi berapa JP? (sisa dari Matriks {kuotaSel})</p>
                                          <div className="flex gap-1">
                                            {opsiJp.map(jp => (
                                              <button key={jp} onClick={() => setEditJumlahJp(jp)}
                                                className={`flex-1 py-1 rounded-lg text-[9px] font-extrabold border transition ${editJumlahJp === jp ? 'bg-[#6A197D] text-white border-[#6A197D]' : 'bg-white text-[#6A197D] border-[#E3C2ED] hover:bg-[#F7ECFA]'}`}>
                                                {jp} JP
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      )
                                    })()}
                                    <div className="flex gap-1 w-full">
                                      <button onClick={e => { e.stopPropagation(); handleInlineSave(hariPlotTabel, slot.id, r.id, jadwalItem) }} className="flex-1 bg-[#6A197D] text-white text-[9px] font-extrabold py-1.5 rounded-lg flex items-center justify-center gap-1"><Check className="w-3 h-3" /> Simpan</button>
                                      <button onClick={e => { e.stopPropagation(); setEditingCell(null); setEditJumlahJp(null) }} className="flex-1 bg-slate-100 text-slate-600 text-[9px] font-bold py-1.5 rounded-lg">Batal</button>
                                    </div>
                                  </div>
                                ) : jadwalItem ? (
                                  <div className="relative">
                                    {isGabungan && <span title="Kelas Gabungan" className="absolute -top-1 -right-1"><Layers className="w-3 h-3 text-emerald-500" /></span>}
                                    {jadwalGiliran && <span title="Jadwal Giliran" className="absolute -top-1 -left-1"><RotateCcw className="w-3 h-3 text-violet-500" /></span>}
                                    <p className="text-[#220729] font-black text-sm leading-none" title={`${mapelItem?.nama || ''}${guruItem?.nama ? ' — ' + guruItem.nama : ''}`}>{mapelItem?.kode || mapelItem?.nama || '–'}</p>
                                  </div>
                                ) : (
                                  jadwalGiliran ? (
                                    <div className="text-center">
                                      <p className="text-violet-700 font-black text-xs leading-none">{labelGiliran}</p>
                                      <p className="text-violet-400 font-semibold text-[9px] mt-1.5 truncate max-w-[100px] mx-auto">{guruGiliran}</p>
                                    </div>
                                  ) : <span className="text-slate-300 text-[10px]">–</span>
                                )}
                              </td>
                            )
                          })
                        )}
                      </tr>
                    ))}
                    {!allSlotsUrut.length && <tr><td colSpan={1 + getRombelForUnit().length} className="py-24 text-center text-slate-400">Belum ada pemetaan waktu.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-4 text-[9px] text-slate-400 font-semibold pt-1">
                <span className="flex items-center gap-1"><Layers className="w-3 h-3 text-emerald-500" /> Kelas Gabungan</span>
                <span className="flex items-center gap-1"><RotateCcw className="w-3 h-3 text-violet-500" /> Jadwal Giliran</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-200 inline-block" /> Jadwal Tetap/Umum</span>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 4: REKAP GURU
        ========================================================= */}
        {tabView === 'rekap_guru' && (
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#6A197D]" />
                <h2 className="font-bold text-slate-800 text-sm">{bolehEdit ? 'Rekapitulasi Beban Jam Mengajar Pendidik' : 'Unduh Jadwal Per Pendidik'}</h2>
              </div>
              <button
                onClick={() => { setGuruDownloadTarget('semua-zip'); setShowDownloadGuruModal(true) }}
                className="flex items-center gap-2 bg-[#6A197D] hover:bg-[#571466] text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-md transition"
              >
                <Download className="w-4 h-4" /> Unduh Jadwal Per Guru (PDF)
              </button>
            </div>
            <div className="md:w-1/3">
              <select value={cariGuruId} onChange={e => setCariGuruId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#8A2FA0] bg-white">
                <option value="">🔍 Semua pendidik</option>
                {daftarGuru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                    <th className="p-4 sticky left-0 z-20 bg-slate-50 border-r border-slate-200 min-w-[140px]">Pendidik</th>
                    {bolehEdit && <th className="p-4">Mapel Diampu</th>}
                    {bolehEdit && <th className="p-4 text-center">Total JP</th>}
                    {bolehEdit && <th className="p-4 text-center">Status Penjadwalan</th>}
                    {bolehEdit && <th className="p-4">JP per Hari</th>}
                    <th className="p-4 text-center">Unduh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {daftarGuru.filter(g => !cariGuruId || g.id === cariGuruId).map(g => {
                    const rekap = rekapPerHari(g.id)
                    const totalJp = rekapJamGuru()[g.id] || 0
                    return (
                      <tr key={g.id} className="hover:bg-slate-50/70 group">
                        <td className="p-4 text-sm font-black text-slate-800 sticky left-0 z-10 bg-white border-r border-slate-200 group-hover:bg-slate-50/70">{g.nama}</td>
                        {bolehEdit && (
                        <td className="p-4">
                          <ul className="list-disc pl-3 text-[#571466]">
                            {g.mapelIds?.map((mId: string) => <li key={mId}>{daftarMapel.find(m => m.id === mId)?.nama || mId}</li>)}
                          </ul>
                        </td>
                        )}
                        {bolehEdit && (
                        <td className="p-4 text-center">
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 font-black px-4 py-1.5 rounded-xl text-xs whitespace-nowrap inline-block">{totalJp} JP</span>
                        </td>
                        )}
                        {bolehEdit && (() => {
                          const status = cekKelengkapanJpGuru(g.id)
                          return (
                            <td className="p-4 text-center">
                              {status.lengkap ? (
                                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-3 py-1.5 rounded-xl text-[11px]">
                                  <CheckCircle className="w-3.5 h-3.5" /> Lengkap
                                </span>
                              ) : (
                                <div className="text-left" title="Beberapa mapel/kelas belum tergenerate lengkap">
                                  <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 font-bold px-3 py-1.5 rounded-xl text-[11px] mb-1">
                                    <Ban className="w-3.5 h-3.5" /> Belum lengkap ({status.kekurangan.length})
                                  </span>
                                  <ul className="text-[10px] text-rose-600 space-y-0.5 pl-1">
                                    {status.kekurangan.map((k, i) => (
                                      <li key={i}>{k.mapel} (Kelas {k.kelas}): butuh {k.butuh} JP, baru {k.ada} JP</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </td>
                          )
                        })()}
                        {bolehEdit && (
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1.5">
                            {LIST_HARI.map(h => (
                              <span key={h} className={`px-2 py-1 rounded-lg text-[9px] font-extrabold border ${rekap[h] >= maksJpGuruPerHari ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                {h.slice(0, 3)}: {rekap[h]}
                              </span>
                            ))}
                          </div>
                        </td>
                        )}
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleDownloadSatuGuru(g, 'preview')}
                              disabled={sedangMengunduhGuru}
                              title="Pratinjau jadwal guru ini"
                              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDownloadSatuGuru(g)}
                              disabled={sedangMengunduhGuru}
                              title="Unduh PDF jadwal guru ini"
                              className="p-2 text-[#8A2FA0] hover:text-[#571466] hover:bg-[#F7ECFA] rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {!daftarGuru.length && <tr><td colSpan={bolehEdit ? 5 : 2} className="py-12 text-center text-slate-400 text-xs">Belum ada data guru.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* =========================================================
            TAB 5: REKAP JADWAL
        ========================================================= */}
        {tabView === 'rekap_jadwal' && (
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-[#6A197D]" />
                <h2 className="font-bold text-slate-800 text-sm">Rekap Jadwal Lengkap</h2>
              </div>
              <div className="text-[10px] text-slate-500 font-semibold">
                {modeTampil === 'unit' ? (
                  <span>Menampilkan kelas untuk unit: <strong className="text-[#571466]">{daftarLembaga.find(l => l.id === unitFilter)?.nama || 'Lembaga Induk'}</strong>{unitFilter !== 'lembaga-induk' && <span className="text-amber-600"> · hanya Senin–Jumat</span>}</span>
                ) : <span>Menampilkan semua kelas (keseluruhan lembaga)</span>}
              </div>
            </div>

            <div className="space-y-8">
              {getHariTampil().map(hari => {
                const rombelTampil = getRombelForUnit()
                const jadwalHariIni = daftarJadwal.filter(j => j.hari === hari)
                const adaJadwal = jadwalHariIni.length > 0 || daftarJadwalTetap.some(jt => jt.hari === hari || jt.hari === 'Semua')
                if (!adaJadwal && modeTampil !== 'keseluruhan') return null

                return (
                  <div key={hari} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="bg-[#220729] text-white px-5 py-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span className="font-black text-sm uppercase tracking-wider">{hari}</span>
                      <span className="text-[#B36BC7] text-[10px] font-semibold ml-auto">{jadwalHariIni.length} slot terjadwal</span>
                    </div>
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="sticky top-0 z-30">
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                            <th className="p-3 min-w-[90px] sticky left-0 z-20 bg-slate-50 border-r border-slate-200">Waktu</th>
                            {rombelTampil.map(r => (
                              <th key={r.id} className="p-3 text-center border-l border-slate-200 min-w-[120px]">Kelas {r.nama}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allSlotsUrut.map(slot => {
                            if (slot.jenis === 'istirahat') {
                              return (
                                <tr key={slot.id} className="bg-amber-50">
                                  <td colSpan={rombelTampil.length + 1} className="py-2 text-center text-[10px] font-bold text-amber-700">— {slot.label} · {slot.mulai}–{slot.selesai} —</td>
                                </tr>
                              )
                            }
                            return (
                              <tr key={slot.id} className="hover:bg-slate-50/50">
                                <td className="p-3 font-black text-[#330B40] bg-slate-50 border-r border-slate-200 sticky left-0 z-10">
                                  <p className="text-[10px]">{slot.label}</p>
                                  <p className="text-[9px] text-[#6A197D] font-extrabold">{slot.mulai}–{slot.selesai}</p>
                                </td>
                                {rombelTampil.map(r => {
                                  const tetap = getJadwalTetapUntukSlotRender(hari, slot.id, r.id)
                                  if (tetap) return (
                                    <td key={r.id} className={`p-3 text-center border-l border-slate-100 ${tetap.warna}`}>
                                      <span className="font-black text-xs">{tetap.nama}</span>
                                    </td>
                                  )

                                  const giliran = daftarJadwalGiliran.find(jg => jg.rombelId === r.id && jg.waktuId === slot.id && jg.hari === hari)
                                  const j = daftarJadwal.find(jj => jj.hari === hari && jj.waktuId === slot.id && jj.rombelId === r.id) || cariJadwalGabunganLintasKelas(hari, slot.id, r.id)
                                  const mapel = daftarMapel.find(m => m.id === j?.mapelId)
                                  const guru = daftarGuru.find(g => g.id === j?.guruId)
                                  const isGab = j ? daftarKelasGabungan.some(kg => kg.mapelId === j.mapelId && kg.rombelIds?.includes(r.id) && kg.rombelIds?.length > 1) : false
                                  const labelGiliran = giliran ? giliran.mapelGuruList.map(mg => daftarMapel.find(m => m.id === mg.mapelId)?.nama || '').filter(Boolean).join('/') : ''
                                  const guruGiliran = giliran ? giliran.mapelGuruList.map(mg => daftarGuru.find(g => g.id === mg.guruId)?.nama || '').filter(Boolean).join(' / ') : ''

                                  return (
                                    <td key={r.id} className={`p-3 text-center border-l border-slate-100 ${isGab ? 'bg-emerald-50/40' : ''}`}>
                                      {j ? (
                                        <div>
                                          <p className="font-black text-slate-800 text-sm leading-none" title={`${mapel?.nama || ''}${guru?.nama ? ' — ' + guru.nama : ''}`}>{(mapel as any)?.kode || mapel?.nama || '–'}</p>
                                          {isGab && <span className="text-[8px] text-emerald-600 font-bold">Gabungan</span>}
                                        </div>
                                      ) : giliran ? (
                                        <div>
                                          <p className="font-black text-violet-700 text-xs leading-none">{labelGiliran}</p>
                                          <p className="text-violet-400 text-[9px] mt-1">{guruGiliran}</p>
                                        </div>
                                      ) : (
                                        <span className="text-slate-300 text-[10px]">–</span>
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </main>

      {/* =========================================================
          MODAL DOWNLOAD
      ========================================================= */}
      {showDownloadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-slate-800 text-lg flex items-center gap-2"><Download className="w-5 h-5 text-emerald-600" /> Unduh / Cetak Jadwal</h2>
              <button onClick={() => setShowDownloadModal(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Pilih cakupan jadwal yang akan dicetak. Format mengikuti template resmi sekolah (landscape, kop sesuai Identitas Lembaga, lengkap dengan daftar pengajar, jadwal piket, dan tanda tangan).</p>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Cakupan Jadwal</label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                  <input type="radio" name="dl" value="semua" checked={downloadTarget === 'semua'} onChange={() => setDownloadTarget('semua')} className="accent-emerald-600" />
                  <div>
                    <p className="font-bold text-sm text-slate-800">Lembaga Induk / Semua Unit</p>
                    <p className="text-[10px] text-slate-500">Semua kelas dari semua unit dalam satu tabel. Kop mengikuti Identitas Lembaga Induk.</p>
                  </div>
                </label>
                {daftarLembaga.map(l => (
                  <label key={l.id} className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input type="radio" name="dl" value={l.id} checked={downloadTarget === l.id} onChange={() => setDownloadTarget(l.id)} className="accent-emerald-600" />
                    <div>
                      <p className="font-bold text-sm text-slate-800">{l.nama}</p>
                      <p className="text-[10px] text-slate-500">Hanya kelas yang terdaftar di unit ini. Kop mengikuti Identitas Unit (jika diatur).</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[10px] text-slate-600 space-y-1">
              <p><strong>Semester:</strong> {semesterAktif} <span className="text-slate-400">(diatur di Pengaturan Kelas)</span></p>
              <p><strong>Tahun Ajaran:</strong> {tahunAjaranAktif} <span className="text-slate-400">(diatur di Dashboard)</span></p>
            </div>

            <label className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={sematkanTtdJadwal} onChange={e => setSematkanTtdJadwal(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
              <span className="text-xs font-semibold text-slate-700">Sematkan tanda tangan digital (kalau sudah diunggah di Identitas Lembaga)</span>
            </label>

            <div className="flex gap-3 pt-2">
              <button onClick={handleDownload} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition">
                <Eye className="w-4 h-4" /> Buka & Cetak
              </button>
              <button onClick={() => setShowDownloadModal(false)} className="px-5 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          MODAL DOWNLOAD PER-GURU (PDF satu-satu / ZIP semua)
      ========================================================= */}
      {showDownloadGuruModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-slate-800 text-lg flex items-center gap-2"><Download className="w-5 h-5 text-[#6A197D]" /> Unduh Jadwal Per Guru</h2>
              <button onClick={() => !sedangMengunduhGuru && setShowDownloadGuruModal(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Format mengikuti template "Jadwal Guru" (potret/portrait, tanpa kop/logo — kop hanya dipakai pada jadwal keseluruhan, tabel hari × jam, jadwal piket dan kontak piket). File diunduh sebagai PDF.</p>

            {!sedangMengunduhGuru ? (
              <>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Pilih Cakupan</label>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    <label className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                      <input type="radio" name="dlg" value="semua-zip" checked={guruDownloadTarget === 'semua-zip'} onChange={() => setGuruDownloadTarget('semua-zip')} className="accent-[#6A197D]" />
                      <div>
                        <p className="font-bold text-sm text-slate-800">Semua Guru (ZIP)</p>
                        <p className="text-[10px] text-slate-500">Satu file ZIP berisi PDF jadwal untuk setiap pendidik ({daftarGuru.length} guru).</p>
                      </div>
                    </label>
                    {daftarGuru.map(g => (
                      <label key={g.id} className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                        <input type="radio" name="dlg" value={g.id} checked={guruDownloadTarget === g.id} onChange={() => setGuruDownloadTarget(g.id)} className="accent-[#6A197D]" />
                        <div>
                          <p className="font-bold text-sm text-slate-800">{g.nama}</p>
                          <p className="text-[10px] text-slate-500">Unduh PDF jadwal pendidik ini saja.</p>
                        </div>
                      </label>
                    ))}
                    {!daftarGuru.length && <p className="text-[10px] text-slate-400 italic p-3">Belum ada data guru.</p>}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  {guruDownloadTarget !== 'semua-zip' && (
                    <button onClick={handleProsesPreviewGuru} disabled={!daftarGuru.length} title="Pratinjau sebelum unduh"
                      className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed">
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={handleProsesDownloadGuru} disabled={!daftarGuru.length} className="flex-1 bg-[#6A197D] hover:bg-[#571466] text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed">
                    <Download className="w-4 h-4" /> Unduh
                  </button>
                  <button onClick={() => setShowDownloadGuruModal(false)} className="px-5 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition">Batal</button>
                </div>
              </>
            ) : (
              <div className="py-6 space-y-3">
                <div className="flex items-center justify-center">
                  <RotateCcw className="w-6 h-6 text-[#8A2FA0] animate-spin" />
                </div>
                <p className="text-center text-xs font-bold text-slate-700">
                  Membuat PDF... {progresUnduhGuru.selesai} / {progresUnduhGuru.total}
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[#6A197D] h-2 rounded-full transition-all"
                    style={{ width: `${progresUnduhGuru.total > 0 ? (progresUnduhGuru.selesai / progresUnduhGuru.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-center text-[10px] text-slate-400">Mohon tunggu, jangan tutup jendela ini.</p>
              </div>
            )}
          </div>
        </div>
      )}
      <PratinjauPdfModal url={previewUrl} onClose={() => setPreviewUrl(null)} judul="Pratinjau Jadwal Guru" />
    </div>
  )
}