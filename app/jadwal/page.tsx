'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import {
  Clock, Trash2, Landmark, LogOut, Shield, BookOpen, CheckCircle,
  Building, CalendarDays, BarChart2, FileText, FileSpreadsheet, Home,
  Wand2, RefreshCw, Plus, Edit2, Check, Users, Layers, X,
  Download, Printer, RotateCcw, Calendar, Info, PenLine, ClipboardList, Ban
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
const LIST_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const LIST_HARI_UNIT = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'] // jadwal unit hanya s.d Jumat

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
    const ma = (a.nama || '').match(/^(\d+)\s*([A-Za-z]*)/)
    const mb = (b.nama || '').match(/^(\d+)\s*([A-Za-z]*)/)
    const numA = ma ? parseInt(ma[1], 10) : Number.MAX_SAFE_INTEGER
    const numB = mb ? parseInt(mb[1], 10) : Number.MAX_SAFE_INTEGER
    if (numA !== numB) return numA - numB
    const subA = ma ? ma[2] : (a.nama || '')
    const subB = mb ? mb[2] : (b.nama || '')
    return subA.localeCompare(subB, 'id')
  })
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
}): string {
  const {
    namaUnitTampil, alamat, logoKiri, logoKanan, semester, tahunAjaran,
    rombelFiltered, allSlots, hariList, daftarJadwal, daftarJadwalTetap, daftarJadwalGiliran,
    daftarGuru, daftarMapel, daftarRombel, daftarKelasGabungan, daftarTingkat,
    daftarPiket, ttd, penandatangan, keterangan, ketYayasan, namaLembagaBaris, tampilkanWakaKurikulum, piketUnitId
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

  const getCell = (hari: string, slotId: string, rombelId: string) => {
    const tetap = getTetap(hari, slotId, rombelId)
    if (tetap) return { label: tetap.nama, sub: '', tipe: 'tetap' as const, tetapId: tetap.id as string | null }

    const giliran = daftarJadwalGiliran.find(jg => jg.rombelId === rombelId && jg.waktuId === slotId && jg.hari === hari)
    const j = daftarJadwal.find(jj => jj.hari === hari && jj.waktuId === slotId && jj.rombelId === rombelId)

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
    `<th colspan="${rombelFiltered.length}" style="padding:4px 2px;font-size:9px;text-align:center;background:#1e1b4b;color:#fff;border:1px solid #3730a3">${h.toUpperCase()}</th>`
  ).join('')
  const thRombel = hariList.map(() =>
    rombelFiltered.map((r: any) => `<th style="padding:3px 2px;font-size:8px;text-align:center;background:#312e81;color:#c7d2fe;border:1px solid #4338ca">${r.nama}</th>`).join('')
  ).join('')

  let istirahatIdx = 0
  const rowsHtml = allSlots.map(slot => {
    if (slot.jenis === 'istirahat') {
      istirahatIdx++
      const totalColsTanpaWaktu = hariList.length * rombelFiltered.length
      const tdWaktuIstirahat = `<td style="padding:3px 4px;font-size:7.5px;font-weight:700;background:#f1f5f9;border:1px solid #cbd5e1;word-break:break-word;text-align:center">${slot.mulai} - ${slot.selesai}</td>`
      return `<tr style="background:#94a3b8">${tdWaktuIstirahat}<td colspan="${totalColsTanpaWaktu}" style="padding:3px 8px;font-size:8px;font-weight:700;text-align:center;border:1px solid #cbd5e1;color:#fff">ISTIRAHAT ${istirahatIdx}</td></tr>`
    }
    const tdWaktu = `<td style="padding:3px 4px;font-size:7.5px;font-weight:700;background:#f1f5f9;border:1px solid #cbd5e1;word-break:break-word;text-align:center">${slot.mulai} - ${slot.selesai}</td>`
    const tdCells = hariList.map(hari => {
      // Ambil cell untuk seluruh rombel pada hari ini dulu, supaya bisa dideteksi
      // apakah semuanya berasal dari SATU jadwal tetap yang sama (mis. Upacara untuk
      // semua kelas). Jika ya, gabungkan (merge) jadi satu sel saja agar tulisannya
      // tidak diulang-ulang per kelas -- mirip perlakuan baris ISTIRAHAT.
      const cellsHariIni = rombelFiltered.map((r: any) => getCell(hari, slot.id, r.id))
      const semuaTetapSama =
        cellsHariIni.length > 0 &&
        cellsHariIni.every(c => c && c.tipe === 'tetap' && c.tetapId === cellsHariIni[0]!.tetapId)

      if (semuaTetapSama) {
        const cell = cellsHariIni[0]!
        return `<td colspan="${rombelFiltered.length}" style="padding:3px 4px;border:1px solid #cbd5e1;text-align:center;background:#dbeafe;vertical-align:middle">
          <span style="font-size:8px;font-weight:700;display:block;line-height:1.25;white-space:normal;word-break:break-word">${cell.label}</span>
        </td>`
      }

      return rombelFiltered.map((r: any, idx: number) => {
        const cell = cellsHariIni[idx]
        if (!cell) return `<td style="padding:3px 2px;border:1px solid #cbd5e1;text-align:center;font-size:7px;color:#cbd5e1">-</td>`
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
        return `<td style="padding:3px 2px;border:1px solid #cbd5e1;text-align:center;background:${bg};vertical-align:middle">
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
      <td style="padding:3px 6px;font-size:8px;border:1px solid #cbd5e1;font-weight:600">${e.nama}</td>
      <td style="padding:3px 6px;font-size:8px;border:1px solid #cbd5e1">${e.mapelKelas.join('<br/>')}</td>
    </tr>`).join('')

  // Catatan: tabel pengajar TIDAK lagi membungkus dirinya sendiri dalam <div flex>,
  // supaya bisa digabung satu baris dengan blok tanda tangan (kolom sempit di kanan)
  // — meniru layout contoh PDF, sehingga halaman cetak tidak terlalu panjang ke bawah.
  const guruTableHtml = `
      <table style="flex:1;border-collapse:collapse;width:50%">
        <thead><tr>
          <th style="padding:4px 6px;font-size:8px;background:#1e1b4b;color:#fff;border:1px solid #3730a3;text-align:left">NAMA PENGAJAR</th>
          <th style="padding:4px 6px;font-size:8px;background:#1e1b4b;color:#fff;border:1px solid #3730a3;text-align:left">MATA PELAJARAN (KELAS)</th>
        </tr></thead>
        <tbody>${renderGuruRows(colKiri)}</tbody>
      </table>
      <table style="flex:1;border-collapse:collapse;width:50%">
        <thead><tr>
          <th style="padding:4px 6px;font-size:8px;background:#1e1b4b;color:#fff;border:1px solid #3730a3;text-align:left">NAMA PENGAJAR</th>
          <th style="padding:4px 6px;font-size:8px;background:#1e1b4b;color:#fff;border:1px solid #3730a3;text-align:left">MATA PELAJARAN (KELAS)</th>
        </tr></thead>
        <tbody>${renderGuruRows(colKanan)}</tbody>
      </table>`

  // === Jadwal Piket Guru (kolom kiri, lebih sempit) ===
  const piketHtml = `
      <table style="border-collapse:collapse;width:100%">
        <thead><tr>
          ${LIST_HARI.slice(0, 5).map(h => `<th style="padding:3px 5px;font-size:7.5px;background:#1e1b4b;color:#fff;border:1px solid #3730a3">${h}</th>`).join('')}
        </tr></thead>
        <tbody><tr>
          ${LIST_HARI.slice(0, 5).map(h => {
            const guruIdsPiket = getPiketGuruIdsHari(h)
            const namaList = guruIdsPiket.map(gid => daftarGuru.find((g: any) => g.id === gid)?.nama || '-')
            return `<td style="padding:3px 5px;font-size:7.5px;border:1px solid #cbd5e1;vertical-align:top">${namaList.map(n => `<div>${n}</div>`).join('') || '-'}</td>`
          }).join('')}
        </tr></tbody>
      </table>`

  // === Keterangan tambahan (kolom kanan, sejajar dengan Jadwal Piket Guru) ===
  const keteranganHtml = keterangan && keterangan.trim() ? `
      <p style="font-size:8.5px;font-weight:900;color:#1e1b4b;margin-bottom:4px">Keterangan:</p>
      <div style="font-size:8px;color:#374151;line-height:1.55;white-space:pre-line">${keterangan
        .split('\n')
        .filter(line => line.trim() !== '')
        .map((line, i) => `${i + 1}. ${line.replace(/^\d+\.\s*/, '')}`)
        .join('\n')}</div>` : ''

  // === Tanda Tangan ===
  // Ditempatkan sebagai KOLOM SEMPIT DI KANAN (bukan baris penuh terpisah di bawah)
  // supaya halaman cetak tidak bertambah panjang ke bawah — meniru layout contoh PDF.
  // Jadwal KESELURUHAN (tampilkanWakaKurikulum=false): cukup 1 kolom Mudir, tidak ada Waka Kurikulum.
  // Jadwal UNIT (tampilkanWakaKurikulum=true): 2 sub-kolom mini -- Kepala Satuan & Waka Kurikulum.
  const ttdHtml = tampilkanWakaKurikulum ? `
    <div style="width:215px;flex-shrink:0;text-align:center">
      <p style="font-size:7.5px;margin-bottom:2px">${ttd.tempat || ''}, ${ttd.tanggal || ''}</p>
      <p style="font-size:7.5px;margin-bottom:4px">Mengetahui,</p>
      <div style="display:flex;gap:4px">
        <div style="flex:1;text-align:center">
          <p style="font-size:6.8px;margin-bottom:26px;line-height:1.3">${penandatangan.kepala.label || ''}</p>
          <p style="font-size:6.8px;font-weight:700;text-decoration:underline">${penandatangan.kepala.nama || ''}</p>
          <p style="font-size:6.3px">NUPTK: ${penandatangan.kepala.nuptk || '-'}</p>
        </div>
        <div style="flex:1;text-align:center">
          <p style="font-size:6.8px;margin-bottom:26px;line-height:1.3">${penandatangan.wakaKurikulum.label || ''}</p>
          <p style="font-size:6.8px;font-weight:700;text-decoration:underline">${penandatangan.wakaKurikulum.nama || ''}</p>
          <p style="font-size:6.3px">NUPTK: ${penandatangan.wakaKurikulum.nuptk || '-'}</p>
        </div>
      </div>
    </div>` : `
    <div style="width:170px;flex-shrink:0;text-align:center">
      <p style="font-size:7.5px;margin-bottom:2px">${ttd.tempat || ''}, ${ttd.tanggal || ''}</p>
      <p style="font-size:7.5px;margin-bottom:28px;line-height:1.3">Mengetahui,<br/>${penandatangan.kepala.label || ''}</p>
      <p style="font-size:7.5px;font-weight:700;text-decoration:underline">${penandatangan.kepala.nama || ''}</p>
      <p style="font-size:7px">NUPTK: ${penandatangan.kepala.nuptk || '-'}</p>
    </div>`

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<title>Jadwal Pelajaran - ${namaUnitTampil}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9px; background: #fff; color:#111; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #1e1b4b; padding-bottom: 8px; margin-bottom: 8px; width: 100%; }
  .header img { width: 56px; height: 56px; object-fit: contain; flex-shrink: 0; }
  .header-logo-slot { width: 56px; height: 56px; flex-shrink: 0; }
  .header-text { flex: 1; text-align: center; }
  .header-text h1 { font-size: 11px; font-weight: 900; text-transform: uppercase; color: #1e1b4b; line-height: 1.35; white-space: pre-line; }
  .header-text h2 { font-size: 12px; font-weight: 900; color: #1e1b4b; margin-top: 2px; text-transform:uppercase; }
  .header-text p { font-size: 9px; color: #374151; margin-top: 1px; }
  .meta-row { display:flex; justify-content:space-between; font-size:9px; font-weight:700; color:#1e1b4b; margin-bottom:6px; }
  .judul-jadwal { text-align:center; font-size:11px; font-weight:900; color:#1e1b4b; text-transform:uppercase; margin: 6px 0 8px; }
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
        <th rowspan="2" style="padding:4px;font-size:9px;background:#1e1b4b;color:#fff;border:1px solid #3730a3;width:62px">WAKTU</th>
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
      <div style="font-size:8px;font-weight:700;color:#1e1b4b;margin-bottom:4px">JADWAL PIKET GURU</div>
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
  allSlots: WaktuSlot[]
  daftarJadwal: any[]
  daftarMapel: any[]
  daftarRombel: any[]
  daftarPiket: PiketGuru[]
  daftarGuru: any[]
  keterangan: string
}): string {
  const { guru, namaUnitTampil, allSlots, daftarJadwal, daftarMapel, daftarRombel, daftarPiket, daftarGuru, keterangan } = p

  const mapelDiampu = (guru.mapelIds || [])
    .map((mId: string) => daftarMapel.find((m: any) => m.id === mId))
    .filter(Boolean)

  const slotUnikGuru = new Set(
    daftarJadwal.filter((j: any) => j.guruId === guru.id).map((j: any) => `${j.hari}_${j.waktuId}`)
  )
  const totalJp = slotUnikGuru.size

  // ── Header info kiri (nama, mapel, nip, total JP) ─────────────────────────
  const infoKiri = `
    <div>
      <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Nama Guru</p>
      <p style="font-size:17px;font-weight:900;color:#1e1b4b;margin-bottom:6px">${guru.nama}</p>
      ${guru.nip ? `<p style="font-size:13px;font-weight:600;color:#374151">NIP/NUPTK: ${guru.nip}</p>` : ''}
      <p style="font-size:13px;font-weight:600;color:#374151;margin-top:2px">Total Mengajar: <strong>${totalJp} JP / minggu</strong></p>
    </div>`

  const infoKanan = `
    <div style="text-align:right">
      <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Mata Pelajaran</p>
      ${mapelDiampu.map((m: any) => `<p style="font-size:14px;font-weight:700;color:#1e1b4b;line-height:1.5">${m.nama}</p>`).join('')}
    </div>`

  // ── Tabel jadwal utama ─────────────────────────────────────────────────────
  const thHari = LIST_HARI.map(h =>
    `<th style="padding:8px 6px;font-size:14px;font-weight:900;background:#1e1b4b;color:#fff;border:1px solid #312e81;text-align:center;vertical-align:middle">${h}</th>`
  ).join('')

  const rowsHtml = allSlots.map(slot => {
    if (slot.jenis === 'istirahat') {
      const isZuhur = /dzuhur|sholat|solat/i.test(slot.label)
      return `<tr style="background:${isZuhur ? '#d1fae5' : '#fef9c3'}">
        <td style="padding:7px 5px;font-size:13px;font-weight:800;border:1px solid #d1d5db;text-align:center;vertical-align:middle;white-space:nowrap;color:#374151">${slot.mulai}<br/>${slot.selesai}</td>
        <td colspan="${LIST_HARI.length}" style="padding:7px 8px;font-size:14px;font-weight:800;text-align:center;border:1px solid #d1d5db;vertical-align:middle;color:${isZuhur ? '#065f46' : '#92400e'}">${slot.label.toUpperCase()}</td>
      </tr>`
    }
    // Kolom waktu: waktu mulai & selesai dipisah 2 baris → tidak perlu lebar besar, cukup muat
    const tdWaktu = `<td style="padding:7px 4px;font-size:12px;font-weight:700;background:#f8fafc;border:1px solid #d1d5db;text-align:center;vertical-align:middle;white-space:nowrap;color:#374151;min-width:58px">${slot.mulai}<br/><span style="color:#94a3b8">–</span><br/>${slot.selesai}</td>`

    const tdCells = LIST_HARI.map(hari => {
      const j = daftarJadwal.find((jj: any) => jj.hari === hari && jj.waktuId === slot.id && jj.guruId === guru.id)
      if (!j) return `<td style="padding:7px 4px;border:1px solid #d1d5db;background:#fff;min-width:80px"></td>`
      const rombel = daftarRombel.find((r: any) => r.id === j.rombelId)
      const mapel = daftarMapel.find((m: any) => m.id === j.mapelId)
      return `<td style="padding:8px 6px;border:1px solid #d1d5db;text-align:center;vertical-align:middle;background:#eef2ff;min-width:80px">
        <span style="font-size:14px;font-weight:900;display:block;line-height:1.3;color:#1e1b4b">${rombel?.nama || '-'}</span>
        <span style="font-size:12px;font-weight:600;display:block;line-height:1.35;margin-top:3px;white-space:normal;word-break:break-word;color:#374151">${mapel?.nama || '-'}</span>
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
  const piketTableRows = Array.from({ length: maxBarisPiket }).map((_, rowIdx) => {
    const cells = piketGabunganPerHari.map(ids => {
      const gId = ids[rowIdx]
      const namaG = gId ? (daftarGuru.find((g: any) => g.id === gId)?.nama || '-') : ''
      return `<td style="padding:7px 6px;font-size:13px;border:1px solid #d1d5db;text-align:center;vertical-align:middle;white-space:normal;word-break:break-word">${namaG}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  // ── Keterangan ─────────────────────────────────────────────────────────────
  const keteranganHtml = keterangan && keterangan.trim() ? `
    <div style="margin-top:14px;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc">
      <p style="font-size:14px;font-weight:900;color:#1e1b4b;margin-bottom:5px">Keterangan:</p>
      <div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-line">${keterangan
        .split('\n').filter(l => l.trim()).map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s*/, '')}`).join('\n')}</div>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<title>Jadwal Guru - ${guru.nama}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 14px; background:#fff; color:#111; }
  table { border-collapse: collapse; width:100%; table-layout:fixed; }
  td, th { vertical-align: middle; word-break: break-word; }
  .page-wrap { padding: 14mm 14mm 10mm 14mm; }
  .judul { text-align:center; font-size:20px; font-weight:900; color:#1e1b4b; text-transform:uppercase; padding-bottom:8px; border-bottom:3px solid #1e1b4b; margin-bottom:12px; }
  .kop-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; gap:16px; }
  .tabel-jadwal-guru th:first-child,
  .tabel-jadwal-guru td:first-child { width:70px; }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    @page { size:A4 landscape; margin:8mm; }
  }
</style>
</head>
<body>
<div class="page-wrap">
  <div class="judul">JADWAL MENGAJAR GURU — ${namaUnitTampil.toUpperCase()}</div>

  <div class="kop-row">
    ${infoKiri}
    ${infoKanan}
  </div>

  <table class="tabel-jadwal-guru" style="margin-bottom:14px">
    <thead>
      <tr>
        <th style="padding:8px 4px;font-size:13px;font-weight:900;background:#1e1b4b;color:#fff;border:1px solid #312e81;text-align:center">Jam</th>
        ${thHari}
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div style="margin-bottom:12px">
    ${piketLabel ? `<p style="font-size:14px;font-weight:700;color:#1e1b4b;margin-bottom:6px">${piketLabel}</p>` : ''}
    <p style="font-size:13px;color:#374151;margin-bottom:6px">Apabila bapak/ibu berhalangan hadir, dapat menghubungi guru piket berikut:</p>
    <table style="table-layout:fixed">
      <thead>
        <tr>${hariPiketKolom.map(h => `<th style="padding:7px 6px;font-size:13px;font-weight:800;background:#1e1b4b;color:#fff;border:1px solid #312e81;text-align:center">${h}</th>`).join('')}</tr>
      </thead>
      <tbody>${piketTableRows}</tbody>
    </table>
  </div>

  ${keteranganHtml}
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
  const [subTabKelas, setSubTabKelas] = useState<'identitas' | 'gabungan' | 'giliran' | 'tetap' | 'larangan' | 'titimangsa'>('identitas')
  const [hariPlotTabel, setHariPlotTabel] = useState('Senin')
  const [editingCell, setEditingCell] = useState<string | null>(null)
  const [editGuruMapel, setEditGuruMapel] = useState<string>('')
  const [modeTampil, setModeTampil] = useState<'keseluruhan' | 'unit'>('keseluruhan')
  const [unitFilter, setUnitFilter] = useState<string>('lembaga-induk')
  const [cariGuruId, setCariGuruId] = useState('')

  // Form: Master Waktu
  const [labelWaktu, setLabelWaktu] = useState('')
  const [jamKeNomor, setJamKeNomor] = useState('1')
  const [waktuMulai, setWaktuMulai] = useState('07.30')
  const [waktuSelesai, setWaktuSelesai] = useState('08.10')
  const [jenisWaktu, setJenisWaktu] = useState<'mapel' | 'istirahat'>('mapel')

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
  const [formTetapNama, setFormTetapNama] = useState('')
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
  const [piketDraft, setPiketDraft] = useState<{ [lembagaId: string]: { [hari: string]: string[] } }>({})

  // Download modal
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadTarget, setDownloadTarget] = useState<string>('semua')

  // Modal & state untuk unduhan jadwal PER-GURU (satu-satu atau ZIP semua)
  const [showDownloadGuruModal, setShowDownloadGuruModal] = useState(false)
  const [guruDownloadTarget, setGuruDownloadTarget] = useState<string>('semua-zip')
  const [sedangMengunduhGuru, setSedangMengunduhGuru] = useState(false)
  const [progresUnduhGuru, setProgresUnduhGuru] = useState({ selesai: 0, total: 0 })

  // ============================================================
  // INIT
  // ============================================================
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const load = (key: string, setter: (v: any) => void, fallback: any = []) => {
        const raw = localStorage.getItem(key)
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
      load('master_pemetaan_waktu', setDaftarWaktu)
      load('master_kelas_gabungan', setDaftarKelasGabungan)
      load('master_jadwal_tetap', setDaftarJadwalTetap)
      load('master_jadwal_giliran', setDaftarJadwalGiliran)
      load('master_larangan_beriringan', setDaftarLarangan)
      load('master_piket_guru', setDaftarPiket)
      load('matriks_alokasi_rinci_samping', setMatriksRinciJp, {})
      load('request_hari_jp_guru', setRequestHariJp, {})

      const storedSemester = localStorage.getItem('jadwal_semester_aktif')
      if (storedSemester) setSemesterAktif(storedSemester)

      const storedTtd = localStorage.getItem('jadwal_titimangsa_ttd')
      if (storedTtd) setTtd(JSON.parse(storedTtd))

      const storedKetUnit = localStorage.getItem('jadwal_keterangan_unit')
      if (storedKetUnit) setKeteranganUnit(JSON.parse(storedKetUnit))

      const mj = localStorage.getItem('master_maks_jp_guru_per_hari')
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
  const save = (key: string, data: any) => localStorage.setItem(key, JSON.stringify(data))

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
    const w: WaktuSlot = {
      id: 'waktu-' + Date.now(),
      label: labelWaktu || (jenisWaktu === 'mapel' ? `Jam ke-${jamKeNomor}` : 'Istirahat'),
      jamKe: jamKeNomor,
      mulai: waktuMulai,
      selesai: waktuSelesai,
      jenis: jenisWaktu
    }
    const updated = [...daftarWaktu, w].sort((a, b) => {
      if (a.jenis === 'mapel' && b.jenis === 'mapel') return Number(a.jamKe) - Number(b.jamKe)
      return 0
    })
    setDaftarWaktu(updated); save('master_pemetaan_waktu', updated)
    setLabelWaktu('')
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
    setEditTetapId(null); setFormTetapNama(''); setFormTetapHari('Senin'); setFormTetapWaktuId('')
    setFormTetapBerlaku('semua'); setFormTetapLembagaIds([]); setFormTetapRombelIds([]); setFormTetapWarna(WARNA_OPTIONS[0].value)
  }

  const handleSimpanTetap = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formTetapNama || !formTetapWaktuId) { alert('Isi nama kegiatan dan pilih slot waktu.'); return }

    if (editTetapId) {
      const updated = daftarJadwalTetap.map(jt => jt.id === editTetapId ? {
        ...jt, nama: formTetapNama, hari: formTetapHari, waktuId: formTetapWaktuId,
        berlakuUntuk: formTetapBerlaku, lembagaIds: formTetapLembagaIds, rombelIds: formTetapRombelIds, warna: formTetapWarna
      } : jt)
      setDaftarJadwalTetap(updated); save('master_jadwal_tetap', updated)
    } else {
      const jt: JadwalTetap = { id: 'tetap-' + Date.now(), nama: formTetapNama, hari: formTetapHari, waktuId: formTetapWaktuId, berlakuUntuk: formTetapBerlaku, lembagaIds: formTetapLembagaIds, rombelIds: formTetapRombelIds, warna: formTetapWarna }
      const updated = [...daftarJadwalTetap, jt]
      setDaftarJadwalTetap(updated); save('master_jadwal_tetap', updated)
    }
    resetFormTetap()
  }

  const handleEditTetap = (jt: JadwalTetap) => {
    setEditTetapId(jt.id); setFormTetapNama(jt.nama); setFormTetapHari(jt.hari); setFormTetapWaktuId(jt.waktuId)
    setFormTetapBerlaku(jt.berlakuUntuk); setFormTetapLembagaIds(jt.lembagaIds || []); setFormTetapRombelIds(jt.rombelIds || []); setFormTetapWarna(jt.warna)
  }

  const handleHapusTetap = (id: string) => {
    if (!confirm('Hapus jadwal tetap ini?')) return
    const filtered = daftarJadwalTetap.filter(jt => jt.id !== id)
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
      nuptk: mudir?.nuptk || mudir?.nip || '-'
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
      nuptk: kepsek?.nuptk || kepsek?.nip || '-'
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
      nuptk: waka?.nuptk || waka?.nip || '-'
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
    return s.size
  }

  const validasiSlot = (params: { hari: string; waktuId: string; rombelId: string; guruId: string; mapelId: string; kecuali?: string }) => {
    const { hari, waktuId, rombelId, guruId, mapelId, kecuali } = params
    const sw = daftarWaktu.find(w => w.id === waktuId)
    if (!sw || sw.jenis !== 'mapel') return { ok: true }

    const bentrokGuru = daftarJadwal.find(j => {
      if (j.id === kecuali) return false
      if (!(j.hari === hari && j.waktuId === waktuId && j.guruId === guruId)) return false
      return !(j.mapelId === mapelId && isPasanganGabungan(mapelId, rombelId, j.rombelId))
    })
    if (bentrokGuru) {
      const namaG = daftarGuru.find(g => g.id === guruId)?.nama || 'Pendidik'
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

    const sudahGuru = daftarJadwal.some(j => j.id !== kecuali && j.guruId === guruId && j.hari === hari && j.waktuId === waktuId)
    const jpHari = hitungJpGuruHari(guruId, hari, kecuali)
    if (!sudahGuru && jpHari + 1 > maksJpGuruPerHari) {
      const namaG = daftarGuru.find(g => g.id === guruId)?.nama || 'Pendidik'
      return { ok: false, pesan: `MELEBIHI BATAS: ${namaG} sudah ${jpHari} JP pada ${hari} (maks ${maksJpGuruPerHari}).` }
    }
    return { ok: true }
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
  const handleGenerate = () => {
    if (isGenerating) { generateCancelRef.current = true; return }
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
    matriksRows.forEach(({ guru, mapel, rombelRelevant }) => {
      rombelRelevant.filter((r: string) => rombelTargetSet.has(r)).forEach((rId: string) => {
        const str = matriksRinciJp[`${guru.id}_${mapel.id}_${rId}`] || ''
        if (!str) return
        const sesi = str.split(',').map(x => Number(x.trim())).filter(n => n > 0)
        const ks: Record<string,string> = {}, hD = new Set<string>()
        LIST_HARI.forEach(h => { const v = requestHariJp[`${guru.id}_${h}`] || ''; ks[h] = v; if (v.trim() === '-') hD.add(h) })
        sesi.forEach((panjang, sesiIdx) => semuaTugas.push({ guru, mapel, rId, panjang, sesiIdx, hD, ks }))
      })
    })

    // ── Fungsi satu percobaan ─────────────────────────────────────────────────
    type Hasil = { arr: any[]; gagal: string[]; req: string[]; ber: string[] }

    const acak = <T,>(a: T[]): T[] => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a }

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

      // tanam biasa: cek konflik guru + kelas + jadwal tetap
      const tanam = (arr:any[], hari:string, blok:any[], rId:string, gId:string, mId:string):boolean => {
        for (const s of blok) {
          if (arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.guruId===gId&&x.rombelId!==rId)) return false
          if (arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.rombelId===rId)) return false
          if (getTetap(hari,s.id,rId)) return false
        }
        for (const s of blok) arr.push({id:`j-${gId}-${rId}-${mId}-${hari}-${s.id}-${Math.random().toString(36).slice(2,5)}`,hari,waktuId:s.id,rombelId:rId,guruId:gId,mapelId:mId})
        return true
      }

      // tanamForce: HANYA cek kelas + jadwal tetap (ABAIKAN konflik guru) — last resort
      const tanamForce = (arr:any[], hari:string, blok:any[], rId:string, gId:string, mId:string):boolean => {
        for (const s of blok) {
          if (arr.some(x=>x.hari===hari&&x.waktuId===s.id&&x.rombelId===rId)) return false
          if (getTetap(hari,s.id,rId)) return false
        }
        for (const s of blok) arr.push({id:`j-${gId}-${rId}-${mId}-${hari}-${s.id}-${Math.random().toString(36).slice(2,5)}`,hari,waktuId:s.id,rombelId:rId,guruId:gId,mapelId:mId})
        return true
      }

      const jpH = (gId:string,hari:string)=>new Set(arr.filter(x=>x.hari===hari&&x.guruId===gId).map(x=>x.waktuId)).size

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

      const Q3 = acak(semuaTugas.filter(t=>t.panjang===3).slice())
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
              huA.add(hari); ok=true; req.push(`${nm(tA)}(${hari})-solo luar window`); break
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
              huA.add(hari); ok=true; req.push(`${nm(tA)}(${hari})-solo dalam window`); break
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
            ok=true; req.push(`${nm(tA)}(${hari})-FORCE (konflik guru, wajib edit manual)`); break
          }
          if (ok) break
        }
        if (!ok) gagal.push(`${nm(tA)}(3JP)->slot kelas benar-benar penuh, cek alokasi JP`)
      }

      // ═══════════════════════════════════════════════════════════════════
      // FASE 2: Tempatkan semua 2JP
      // Setelah SELURUH 3JP selesai, 2JP boleh masuk slot manapun termasuk sisa window.
      // ═══════════════════════════════════════════════════════════════════
      const Q2=acak(semuaTugas.filter(t=>t.panjang===2).slice())
      Q2.sort((a,b)=>b.hD.size-a.hD.size)
      const hu2=new Map<string,Set<string>>()
      const getHU2=(t:T)=>{const k=`${t.guru.id}_${t.mapel.id}_${t.rId}`;if(!hu2.has(k))hu2.set(k,new Set());return hu2.get(k)!}

      Q2.forEach(t=>{
        const hu=getHU2(t)
        const nm2=`${t.guru.nama}-${t.mapel.nama}(${daftarRombel.find((r:any)=>r.id===t.rId)?.nama||t.rId})s${t.sesiIdx+1}(2JP)`

        const tryH=(hari:string,ignReq:boolean,ignBer:boolean,ignKap:boolean,force:boolean):boolean=>{
          if(!ignKap&&jpH(t.guru.id,hari)+2>maksJpGuruPerHari) return false
          for(let a=0;a<=slotMapel.length-2;a++){
            const blok=slotMapel.slice(a,a+2)
            if(adaIstirahat(blok[0].id,blok[1].id)) continue
            if(!ignReq&&!blokSesuaiKetersediaan(t.ks[hari],blok.map(s=>Number(s.jamKe)))) continue
            if(!ignBer&&cekBer(arr,hari,blok,t.rId,t.mapel.id)) continue
            const berhasil=force?tanamForce(arr,hari,blok,t.rId,t.guru.id,t.mapel.id):tanam(arr,hari,blok,t.rId,t.guru.id,t.mapel.id)
            if(berhasil) return true
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

      setDaftarJadwal(best.arr); save('data_jadwal_pelajaran', best.arr)
      setIsGenerating(false); setGenerateProgress('')
      const bg: string[]=[]
      if (best.gagal.length) bg.push(`🔴 GAGAL:\n${best.gagal.join('\n')}`)
      if (best.ber.length)   bg.push(`🟠 Beriringan:\n${best.ber.join('\n')}`)
      if (best.req.length)   bg.push(`🟡 Request:\n${best.req.join('\n')}`)
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
      if (existing) { const f = daftarJadwal.filter(j => j.id !== existing.id); setDaftarJadwal(f); save('data_jadwal_pelajaran', f) }
    } else {
      const [gId, mId] = editGuruMapel.split('|')
      const hasil = validasiSlot({ hari, waktuId, rombelId, guruId: gId, mapelId: mId, kecuali: existing?.id })
      if (!hasil.ok) { alert(`⚠️ ${hasil.pesan}`); return }
      if (existing) {
        const u = daftarJadwal.map(j => j.id === existing.id ? { ...j, guruId: gId, mapelId: mId } : j)
        setDaftarJadwal(u); save('data_jadwal_pelajaran', u)
      } else {
        const nj = { id: 'jdwl-' + Date.now(), hari, waktuId, rombelId, guruId: gId, mapelId: mId }
        const u = [...daftarJadwal, nj]; setDaftarJadwal(u); save('data_jadwal_pelajaran', u)
      }
    }
    setEditingCell(null); setEditGuruMapel('')
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
    const r: { [k: string]: number } = {}
    Object.keys(rec).forEach(k => { r[k] = rec[k].size })
    return r
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

  // ============================================================
  // DOWNLOAD
  // ============================================================
  const handleDownload = () => {
    let rombelFiltered = urutkanRombelKelas(daftarRombel)
    let namaUnitTampil = identitasInduk.nama || 'Lembaga'
    let logoKiri = resolveLogoUrl(identitasInduk.logoKiriSumber)
    let logoKanan = resolveLogoUrl(identitasInduk.logoKananSumber)
    let alamat = identitasInduk.alamat || ''
    let hariList = LIST_HARI // lembaga induk / semua unit: tampilkan s.d Sabtu

    if (downloadTarget !== 'semua') {
      const unit = daftarLembaga.find(l => l.id === downloadTarget)
      rombelFiltered = urutkanRombelKelas(getRombelsByLembaga(downloadTarget))
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
      ketYayasan: identitasInduk.kop || 'MAJLIS PENDIDIKAN DASAR DAN MENENGAH',
      namaLembagaBaris,
      tampilkanWakaKurikulum: downloadTarget !== 'semua',
      piketUnitId: downloadTarget === 'semua' ? null : downloadTarget
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
    const LEBAR_RENDER = orientation === 'portrait' ? 1400 : 1500 // px, lebar acuan render sebelum di-scale ke ukuran A4 oleh jsPDF
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
    const rombelDiajar = [...new Set(daftarJadwal.filter((j: any) => j.guruId === guru.id).map((j: any) => j.rombelId))]
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
      guru, namaUnitTampil, allSlots: allSlotsUrutLokal,
      daftarJadwal, daftarMapel, daftarRombel, daftarPiket, daftarGuru,
      keterangan: keteranganTerpilih
    })
  }

  // Unduh jadwal SATU guru sebagai file PDF
  const handleDownloadSatuGuru = async (guru: any) => {
    setSedangMengunduhGuru(true)
    setProgresUnduhGuru({ selesai: 0, total: 1 })
    try {
      const html = buatHtmlJadwalSatuGuru(guru)
      const blob = await renderHtmlKePdfBlob(html, 'portrait')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Jadwal Guru - ${namaFileAman(guru.nama)}.pdf`
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
        zip.file(`Jadwal Guru - ${namaFileAman(guru.nama)}.pdf`, blob)
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

  // ============================================================
  // COMPUTED
  // ============================================================
  if (loading) return <div className="p-8 text-center font-semibold text-indigo-600">Memuat Modul Penjadwalan...</div>

  const slotMapelUrut = daftarWaktu.filter(w => w.jenis === 'mapel').sort((a, b) => Number(a.jamKe) - Number(b.jamKe))
  const allSlotsUrut = [...daftarWaktu].sort((a, b) => Number(a.jamKe || 0) - Number(b.jamKe || 0))
  const namaInduk = identitasInduk.nama || 'Lembaga / Yayasan Pusat'
  const logoInduk = identitasInduk.logo_utama || identitasInduk.logo || ''

  const getRombelForUnit = () => {
    if (modeTampil === 'keseluruhan') return daftarRombel
    if (unitFilter === 'lembaga-induk') return daftarRombel
    return getRombelsByLembaga(unitFilter)
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
    <div className="flex min-h-screen bg-slate-50 text-slate-800">

      {/* SIDEBAR */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen shrink-0">
        <div className="overflow-y-auto">
          <div className="h-20 flex flex-col justify-center px-6 border-b border-slate-200 bg-indigo-50/40">
            <div className="flex items-center gap-3">
              {logoInduk ? <img src={logoInduk} alt="Logo" className="w-8 h-8 object-contain shrink-0" /> : <Landmark className="w-6 h-6 text-indigo-600" />}
              <h2 className="text-xs font-black text-indigo-950 uppercase tracking-widest truncate">{namaInduk}</h2>
            </div>
          </div>
          <nav className="p-4 space-y-1">
            <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Home className="w-4 h-4" /> Beranda Dasbor</a>
            <a href="/lembaga" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Building className="w-4 h-4" /> Identitas Lembaga</a>
            <a href="/peran" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><Shield className="w-4 h-4" /> Pembagian Peran & Guru</a>
            <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Modul Administrasi</div>
            <a href="/kaldik" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><CalendarDays className="w-4 h-4" /> Kalender Pendidikan</a>
            <a href="/jadwal" className="flex items-center gap-3 px-4 py-3 text-sm font-bold text-white bg-indigo-600 rounded-xl shadow-md"><Clock className="w-4 h-4" /> Jadwal Pelajaran</a>
            <a href="#" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><BarChart2 className="w-4 h-4" /> Minggu Efektif</a>
            <a href="#" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><FileText className="w-4 h-4" /> CP, TP & ATP</a>
            <a href="#" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"><BookOpen className="w-4 h-4" /> RPP / Modul Ajar</a>
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => { supabase.auth.signOut(); router.push('/') }} className="flex items-center gap-3 px-4 py-2.5 w-full text-sm font-bold text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition">
            <LogOut className="w-4 h-4" /> Keluar Sistem
          </button>
        </div>
      </aside>

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
        <section className="bg-indigo-50/50 border border-indigo-100 p-6 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div>
            <label className="text-[10px] font-extrabold text-indigo-900 uppercase tracking-wider mb-1.5 block">Mode Tampilan</label>
            <select value={modeTampil} onChange={e => setModeTampil(e.target.value as any)} className="w-full px-4 py-2.5 border border-indigo-200 rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="keseluruhan">Keseluruhan (Semua Unit)</option>
              <option value="unit">Per Unit Lembaga</option>
            </select>
          </div>
          {modeTampil === 'unit' && (
            <div>
              <label className="text-[10px] font-extrabold text-indigo-900 uppercase tracking-wider mb-1.5 block">Unit Ditampilkan</label>
              <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="w-full px-4 py-2.5 border border-indigo-200 rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="lembaga-induk">Lembaga Induk / Yayasan Pusat</option>
                {daftarLembaga.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-extrabold text-indigo-900 uppercase tracking-wider mb-1.5 block">Maks. JP / Hari (per Pendidik)</label>
            <input type="number" min={1} value={maksJpGuruPerHari} onChange={e => { const v = Number(e.target.value) || 1; setMaksJpGuruPerHari(v); save('master_maks_jp_guru_per_hari', v) }} className="w-full px-4 py-2.5 border border-indigo-200 rounded-xl text-xs bg-white font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          {/* TAB NAV */}
          <div className="flex bg-white rounded-xl border border-slate-200 p-1.5 md:col-span-3 flex-wrap gap-1">
            {([
              ['waktu', '1. Master Waktu'],
              ['pengaturan_kelas', '2. Pengaturan'],
              ['input', '3. Plot Matriks'],
              ['rekap_guru', '4. Rekap Guru'],
              ['rekap_jadwal', '5. Rekap Jadwal'],
            ] as [typeof tabView, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setTabView(key)} className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition ${tabView === key ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
            ))}
          </div>
        </section>

        {/* =========================================================
            TAB 1: MASTER WAKTU
        ========================================================= */}
        {tabView === 'waktu' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <form onSubmit={handleSimpanWaktu} className="space-y-4 xl:col-span-1 border-r border-slate-100 pr-6">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <Clock className="w-4 h-4 text-indigo-600" />
                <h2 className="text-xs font-black text-slate-700">Petakan Slot Durasi Waktu</h2>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tipe Slot</label>
                <select value={jenisWaktu} onChange={e => setJenisWaktu(e.target.value as any)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  <option value="mapel">Jam Pelajaran (JP)</option>
                  <option value="istirahat">Istirahat / Sholat</option>
                </select>
              </div>
              {jenisWaktu === 'mapel' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Urutan Jam Ke-</label>
                  <input type="text" placeholder="1" value={jamKeNomor} onChange={e => setJamKeNomor(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500" required />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Label (Opsional)</label>
                <input type="text" placeholder="Cth: Istirahat 1" value={labelWaktu} onChange={e => setLabelWaktu(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mulai</label>
                  <input type="text" placeholder="07.30" value={waktuMulai} onChange={e => setWaktuMulai(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500" required />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Selesai</label>
                  <input type="text" placeholder="08.10" value={waktuSelesai} onChange={e => setWaktuSelesai(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500" required />
                </div>
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-indigo-700 transition mt-2">+ Tambah Master Waktu</button>
            </form>
            <div className="xl:col-span-2 space-y-4">
              <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Tabel Master Waktu</h2>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                      <th className="p-3">Slot</th><th className="p-3">Label</th><th className="p-3">Waktu</th><th className="p-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {daftarWaktu.map(w => (
                      <tr key={w.id} className="hover:bg-slate-50/70">
                        <td className="p-3"><span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase ${w.jenis === 'mapel' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{w.jenis === 'mapel' ? `JP ${w.jamKe}` : 'Istirahat'}</span></td>
                        <td className="p-3 font-bold">{w.label}</td>
                        <td className="p-3 font-extrabold text-indigo-600 tracking-wider">{w.mulai} – {w.selesai}</td>
                        <td className="p-3 text-center"><button onClick={() => handleHapusWaktu(w.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition"><Trash2 className="w-4 h-4" /></button></td>
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
        {tabView === 'pengaturan_kelas' && (
          <div className="space-y-6">
            {/* Sub-tab */}
            <div className="flex bg-white rounded-xl border border-slate-200 p-1.5 gap-1 w-fit flex-wrap">
              {([['identitas', 'Identitas & Kop'], ['gabungan', 'Kelas Gabungan'], ['giliran', 'Jadwal Giliran'], ['tetap', 'Jadwal Berlaku Umum'], ['larangan', 'Larangan Mapel Beriringan'], ['titimangsa', 'Semester, Titimangsa & TTD']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSubTabKelas(k)} className={`px-5 py-2 text-xs font-bold rounded-lg transition ${subTabKelas === k ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>

            {/* SUB: IDENTITAS & KOP (Lembaga Pusat / Yayasan & Unit) */}
            {subTabKelas === 'identitas' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <form onSubmit={handleSimpanIdentitasInduk} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Landmark className="w-4 h-4 text-indigo-600" />
                    <h2 className="text-xs font-black text-slate-700">Identitas & Kop — Lembaga Pusat</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Data ini tampil pada bagian kop (kepala surat) hasil unduhan jadwal <strong>keseluruhan</strong> dan <strong>per unit</strong>. Jadwal per guru tidak memakai kop. Untuk unduhan jadwal keseluruhan, baris nama menampilkan nama Lembaga Pusat; untuk unduhan jadwal unit, baris nama otomatis berganti menjadi nama unit terkait (nama Lembaga Pusat tidak ditulis ulang).
                  </p>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Keterangan Lengkap Yayasan</label>
                    <textarea
                      rows={2}
                      placeholder={'Cth baris 1: MAJLIS PENDIDIKAN DASAR DAN MENENGAH\nCth baris 2: \'AISYIYAH BOARDING SCHOOL BANDUNG'}
                      value={identitasInduk.kop || ''}
                      onChange={e => updateIdentitasIndukField('kop', e.target.value)}
                      className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                    <p className="text-[9px] text-slate-400 mt-1">Bisa diisi 2 baris (tekan Enter untuk baris baru) — ini baris paling atas pada kop, bukan tautan/URL.</p>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nama Lembaga Pusat</label>
                    <input
                      type="text"
                      placeholder="Cth: SMP Aisyiyah Boarding School"
                      value={identitasInduk.nama || ''}
                      onChange={e => updateIdentitasIndukField('nama', e.target.value)}
                      className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[9px] text-slate-400 mt-1">Tampil sebagai baris nama (di bawah Keterangan Lengkap Yayasan) hanya saat mengunduh jadwal keseluruhan.</p>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Alamat Lembaga Pusat</label>
                    <input
                      type="text"
                      placeholder="Cth: Jl. Contoh No. 1, Bandung"
                      value={identitasInduk.alamat || ''}
                      onChange={e => updateIdentitasIndukField('alamat', e.target.value)}
                      className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">URL Logo</label>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={identitasInduk.logo_utama || identitasInduk.logo || ''}
                      onChange={e => updateIdentitasIndukField('logo_utama', e.target.value)}
                      className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[9px] text-slate-400 mt-1">Kolom ini khusus untuk gambar logo — bukan untuk diisi di kolom keterangan yayasan.</p>
                  </div>

                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 space-y-3">
                    <p className="text-[10px] font-bold text-indigo-700">Logo yang Ditampilkan di Kop (Jadwal Keseluruhan)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Logo Kiri</label>
                        <select
                          value={identitasInduk.logoKiriSumber || 'pusat'}
                          onChange={e => updateIdentitasIndukField('logoKiriSumber', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
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
                          className="w-full px-3 py-2 border rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                        >
                          <option value="pusat">Logo Lembaga Pusat</option>
                          {daftarLembaga.map(l => <option key={l.id} value={l.id}>Logo {l.nama}</option>)}
                        </select>
                      </div>
                    </div>
                    <p className="text-[9px] text-slate-400">Berlaku untuk kop jadwal keseluruhan (semua unit). Jadwal per guru tidak memakai kop/logo.</p>
                  </div>

                  <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-indigo-700 transition flex items-center justify-center gap-2">
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

            {/* SUB: KELAS GABUNGAN */}
            {subTabKelas === 'gabungan' && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <form onSubmit={handleSimpanGabungan} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 xl:col-span-1">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Users className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-xs font-black text-slate-700">{editGabId ? 'Edit Kelas Gabungan' : 'Daftarkan Kelas Gabungan'}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">Untuk mapel yang sengaja digabung antar rombel (diajar bersamaan). Sistem tidak akan menganggapnya bentrok.</p>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mata Pelajaran</label>
                    <select value={formGabMapelId} onChange={e => setFormGabMapelId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white" required>
                      <option value="">-- Pilih Mapel --</option>
                      {daftarMapel.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pendidik (Opsional)</label>
                    <select value={formGabGuruId} onChange={e => setFormGabGuruId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      <option value="">-- Tanpa filter pendidik --</option>
                      {daftarGuru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pilih Rombel (min. 2)</label>
                    <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-xl p-3 bg-slate-50">
                      {daftarRombel.map(r => (
                        <label key={r.id} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
                          <input type="checkbox" checked={formGabRombelIds.includes(r.id)} onChange={() => setFormGabRombelIds(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id])} className="rounded accent-emerald-600" />
                          {r.nama}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Keterangan (Opsional)</label>
                    <input type="text" value={formGabKet} onChange={e => setFormGabKet(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold text-xs shadow-md hover:bg-emerald-700 transition flex items-center justify-center gap-2">
                      {editGabId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editGabId ? 'Simpan Perubahan' : 'Simpan Kelas Gabungan'}
                    </button>
                    {editGabId && <button type="button" onClick={resetFormGabungan} className="px-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200">Batal</button>}
                  </div>
                </form>
                <div className="xl:col-span-2 space-y-3">
                  <h2 className="text-xs font-black text-slate-600 uppercase tracking-wider pb-2 border-b border-slate-100">Daftar Kelas Gabungan</h2>
                  {daftarKelasGabungan.map(kg => {
                    const namaMapel = daftarMapel.find(m => m.id === kg.mapelId)?.nama || '-'
                    const namaGuru = kg.guruId ? daftarGuru.find(g => g.id === kg.guruId)?.nama : null
                    return (
                      <div key={kg.id} className={`bg-white border rounded-2xl p-5 shadow-sm flex items-start justify-between gap-4 ${editGabId === kg.id ? 'border-amber-300 ring-1 ring-amber-200' : 'border-emerald-100'}`}>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-emerald-600" />
                            <span className="font-black text-slate-800 text-sm">{namaMapel}</span>
                            {namaGuru && <span className="text-[9px] font-bold text-slate-400 uppercase">• {namaGuru}</span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {kg.rombelIds.map((rid: string) => (
                              <span key={rid} className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-lg text-[10px] font-extrabold">
                                {daftarRombel.find(r => r.id === rid)?.nama || rid}
                              </span>
                            ))}
                          </div>
                          {kg.keterangan && <p className="text-[10px] text-slate-400">{kg.keterangan}</p>}
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => handleEditGabungan(kg)} className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleHapusGabungan(kg.id)} className="p-2 text-slate-400 hover:text-red-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    )
                  })}
                  {!daftarKelasGabungan.length && <div className="py-16 text-center text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">Belum ada kelas gabungan.</div>}
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
                          <button onClick={() => handleEditGiliran(jg)} className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg"><Edit2 className="w-4 h-4" /></button>
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
                  <p className="text-[10px] text-slate-500 leading-relaxed">Jadwal yang berlaku untuk semua kelas atau kelompok kelas tertentu, seperti Upacara, Literasi, Kewalikelasan, dst.</p>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nama Kegiatan</label>
                    <input type="text" value={formTetapNama} onChange={e => setFormTetapNama(e.target.value)} placeholder="Cth: Upacara Bendera, Literasi, Kewalikelasan" className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-sky-500" required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Hari</label>
                      <select value={formTetapHari} onChange={e => setFormTetapHari(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                        <option value="Semua">Semua Hari</option>
                        {LIST_HARI.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Slot Waktu</label>
                      <select value={formTetapWaktuId} onChange={e => setFormTetapWaktuId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 bg-white" required>
                        <option value="">-- Pilih Slot --</option>
                        {daftarWaktu.map(w => <option key={w.id} value={w.id}>{w.label} ({w.mulai}–{w.selesai})</option>)}
                      </select>
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
                            <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg font-bold">{namaWaktu}</span>
                            <span className="bg-sky-50 text-sky-700 px-2.5 py-1 rounded-lg font-bold">{berlakuLabel}</span>
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => handleEditTetap(jt)} className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg"><Edit2 className="w-4 h-4" /></button>
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
                            <span className="font-black text-slate-800 text-sm">Setelah: <span className="text-indigo-700">{namaSetelah}</span></span>
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
                          <button onClick={() => handleEditLarangan(l)} className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg"><Edit2 className="w-4 h-4" /></button>
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
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <h2 className="text-xs font-black text-slate-700">Pengaturan Semester</h2>
                  </div>
                  <p className="text-[10px] text-slate-500">Semester ini akan tampil pada kop hasil unduhan jadwal.</p>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Semester Aktif</label>
                    <select value={semesterAktif} onChange={e => handleSimpanSemester(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="Ganjil">Ganjil</option>
                      <option value="Genap">Genap</option>
                    </select>
                  </div>
                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 text-[10px] text-indigo-700 font-semibold">
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
                    <Shield className="w-4 h-4 text-indigo-600" />
                    <h2 className="text-xs font-black text-slate-700">Penandatangan (Terdeteksi Otomatis)</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Penandatangan jadwal <strong>tidak diisi manual di sini</strong>. Jadwal <strong>keseluruhan</strong> (Lembaga Induk) hanya menampilkan <strong>1 penandatangan: Mudir</strong> — tanpa Waka Kurikulum. Jadwal per <strong>unit</strong> menampilkan <strong>2 penandatangan</strong>: Kepala Satuan (kiri) dan Waka Kurikulum (kanan). Data nama diambil otomatis dari halaman <a href="/lembaga" className="underline font-bold text-indigo-700">Identitas Lembaga</a> dan penugasan peran di <a href="/peran/guru" className="underline font-bold text-indigo-700">Kelola Data Guru</a> — pastikan ada guru dengan peran "Waka Kurikulum" yang ditugaskan ke unit terkait agar nama tampil otomatis di kop hasil unduhan unit.
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
                      <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1.5 block">Keterangan — Lembaga Induk / Keseluruhan</label>
                      <textarea
                        value={keteranganUnit['semua'] || ''}
                        onChange={e => updateKeteranganUnit('semua', e.target.value)}
                        rows={4}
                        placeholder={'Jadwal Bahasa Inggris dan Kimia bergantian setiap minggu\nLiterasi dan Kewalikelasan bergantian setiap minggu'}
                        className="w-full px-4 py-2.5 border rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
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
        {tabView === 'input' && (
          <div className="space-y-8">

            {/* MATRIKS ALOKASI JP */}
            <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-indigo-600" />
                  <h2 className="font-bold text-slate-800 text-sm">Matriks Alokasi JP (per Guru × Mapel × Kelas)</h2>
                </div>
                <p className="text-[10px] text-slate-500 max-w-xl">Isikan alokasi JP dengan format: <strong className="text-indigo-700">3</strong> = 3 JP 1 sesi, atau <strong className="text-indigo-700">2, 3</strong> = 5 JP dalam 2 sesi berbeda hari. Data guru bersumber dari Modul Data Pendidik. <span className="text-amber-600 font-semibold">Catatan: sesi 2 JP otomatis ditempatkan berurutan tanpa terpotong istirahat; sesi 3 JP boleh terpotong istirahat.</span></p>
              </div>

              {daftarGuru.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[11px] text-amber-800 font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" />
                  Belum ada data guru. Silakan daftarkan guru terlebih dahulu di halaman <a href="/peran/guru" className="underline font-black">Modul Data Pendidik</a>.
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[400px]">
                <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                      <th className="p-4 min-w-[150px]">Pendidik</th>
                      <th className="p-4 min-w-[150px]">Mata Pelajaran</th>
                      {daftarRombel.map(r => (
                        <th key={r.id} className="p-4 text-center min-w-[75px] bg-sky-50/50 text-sky-800 border-l border-sky-100 uppercase tracking-widest text-[10px]">{r.nama}</th>
                      ))}
                      <th className="p-4 text-center min-w-[65px] bg-indigo-50/70 text-indigo-800 border-l border-indigo-100 text-[10px]">Total JP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {matriksRows.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="p-4 font-black text-slate-800 border-r border-slate-50">{item.guru.nama}</td>
                        <td className="p-4 text-indigo-700 font-bold border-r border-slate-50">{item.mapel.nama}</td>
                        {daftarRombel.map(r => {
                          const isPJ = item.rombelRelevant.includes(r.id)
                          const key = `${item.guru.id}_${item.mapel.id}_${r.id}`
                          return (
                            <td key={r.id} className="p-2 text-center border-l border-slate-100">
                              {isPJ ? (
                                <input type="text" placeholder="–" value={matriksRinciJp[key] || ''} onChange={e => { const u = { ...matriksRinciJp, [key]: e.target.value }; setMatriksRinciJp(u); save('matriks_alokasi_rinci_samping', u) }} className="w-16 h-8 border border-slate-200 rounded-lg text-center outline-none focus:ring-2 focus:ring-indigo-500 font-extrabold text-xs shadow-sm bg-white" />
                              ) : <span className="text-slate-300 text-[10px]">–</span>}
                            </td>
                          )
                        })}
                        <td className="p-4 text-center border-l border-slate-100 font-black bg-indigo-50/30 text-indigo-900">
                          {daftarRombel.reduce((s, r) => {
                            if (!item.rombelRelevant.includes(r.id)) return s
                            return s + hitungJpStr(matriksRinciJp[`${item.guru.id}_${item.mapel.id}_${r.id}`] || '')
                          }, 0)} JP
                        </td>
                      </tr>
                    ))}
                    {!matriksRows.length && <tr><td colSpan={3 + daftarRombel.length} className="py-16 text-center text-slate-400 text-xs">Belum ada pemetaan penugasan guru.</td></tr>}
                  </tbody>
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
                  <thead>
                    <tr className="bg-amber-50 border-b border-amber-200 text-amber-800 font-black tracking-wider">
                      <th className="p-4 min-w-[160px]">Pendidik</th>
                      {LIST_HARI.map(h => <th key={h} className="p-4 text-center min-w-[110px] border-l border-amber-100 text-[10px]">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {daftarGuru.map(g => (
                      <tr key={g.id} className="hover:bg-amber-50/30">
                        <td className="p-4 font-black text-slate-800">{g.nama}</td>
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
                  <label className="text-[10px] font-black text-indigo-700 uppercase tracking-wider">Cakupan Generate</label>
                  <select
                    value={generateScope}
                    onChange={e => setGenerateScope(e.target.value)}
                    className="px-4 py-2.5 border border-indigo-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white min-w-[220px]"
                  >
                    <option value="semua">Seluruh Lembaga (semua unit)</option>
                    {daftarLembaga.map(l => <option key={l.id} value={l.id}>Unit: {l.nama} saja</option>)}
                  </select>
                  <p className="text-[9px] text-slate-400 max-w-xs">
                    {generateScope === 'semua'
                      ? 'Semua jadwal akan di-generate ulang dari awal.'
                      : `Hanya jadwal unit "${daftarLembaga.find(l => l.id === generateScope)?.nama}" yang akan di-generate ulang. Jadwal unit lain dipertahankan.`}
                  </p>
                </div>
                <div className="flex flex-col gap-2 h-fit">
                  <button onClick={handleGenerate} className={`flex items-center gap-2 ${isGenerating ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'} text-white px-6 py-3 rounded-xl font-extrabold text-xs shadow-md transition`}>
                    <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    {isGenerating ? 'Batalkan' : 'Generate Jadwal Otomatis'}
                  </button>
                  {generateProgress && <p className="text-[10px] text-indigo-600 font-semibold animate-pulse max-w-xs">{generateProgress}</p>}
                </div>
              </div>
            </section>

            {/* JADWAL PIKET GURU */}
            <section className="bg-teal-50/30 border border-teal-100 p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-teal-200 pb-3">
                <ClipboardList className="w-5 h-5 text-teal-700" />
                <div>
                  <h2 className="font-black text-teal-900 text-sm">Jadwal Piket Guru</h2>
                  <p className="text-[10px] font-semibold text-teal-600 mt-0.5">Pilih lembaga/unit terlebih dahulu, lalu centang nama guru yang bertugas piket pada tiap hari untuk unit tersebut.</p>
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

                  <div className="overflow-x-auto border border-teal-200 rounded-xl">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-teal-50 border-b border-teal-200 text-teal-800 font-black tracking-wider">
                          {LIST_HARI.slice(0, 5).map(h => <th key={h} className="p-3 text-center border-l border-teal-100 text-[10px] min-w-[150px]">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {LIST_HARI.slice(0, 5).map(h => {
                            const guruDiLembagaIni = daftarGuru.filter((g: any) => getGuruIdsMengajarDiLembaga(piketFormLembagaId).includes(g.id))
                            return (
                              <td key={h} className="p-3 align-top border-l border-teal-50 bg-white">
                                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                  {guruDiLembagaIni.map(g => (
                                    <label key={g.id} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 cursor-pointer">
                                      <input type="checkbox" checked={(piketDraft[piketFormLembagaId]?.[h] || []).includes(g.id)} onChange={() => handleTogglePiket(piketFormLembagaId, h, g.id)} className="rounded accent-teal-600" />
                                      {g.nama}
                                    </label>
                                  ))}
                                  {!guruDiLembagaIni.length && <span className="text-[9px] text-slate-400">Belum ada guru yang mengajar di unit ini.</span>}
                                </div>
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
                  <span className="text-[10px] font-extrabold text-indigo-900 uppercase tracking-wider">Hari:</span>
                  <select value={hariPlotTabel} onChange={e => setHariPlotTabel(e.target.value)} className="px-3 py-1.5 border border-indigo-200 rounded-xl text-xs bg-indigo-50 font-black text-indigo-950 outline-none">
                    {getHariTampil().map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
              {modeTampil === 'unit' && unitFilter !== 'lembaga-induk' && (
                <p className="text-[10px] text-amber-600 font-semibold -mt-2">Catatan: jadwal untuk unit lembaga hanya ditampilkan/dicetak Senin s.d. Jumat.</p>
              )}

              <div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-[11px] border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-indigo-950 text-white font-black tracking-wider text-[10px] uppercase">
                      <th className="p-3.5 border-r border-indigo-900 min-w-[90px]">Waktu</th>
                      {getRombelForUnit().map(r => (
                        <th key={r.id} className="p-3.5 border-l border-indigo-900 text-center min-w-[130px]">Kelas {r.nama}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {allSlotsUrut.map(slot => (
                      <tr key={slot.id} className={slot.jenis === 'istirahat' ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                        <td className="p-3.5 bg-slate-50/70 border-r border-slate-200 font-black text-indigo-900">
                          <p className="text-[10px] uppercase tracking-widest">{slot.label}</p>
                          <p className="text-[9px] font-extrabold text-indigo-600 mt-1">{slot.mulai}–{slot.selesai}</p>
                        </td>
                        {slot.jenis === 'istirahat' ? (
                          <td colSpan={getRombelForUnit().length} className="text-center text-[10px] font-bold text-amber-700 py-2">— {slot.label} —</td>
                        ) : (
                          getRombelForUnit().map(r => {
                            const cellKey = `${hariPlotTabel}_${slot.id}_${r.id}`
                            const jadwalTetap = getJadwalTetapUntukSlotRender(hariPlotTabel, slot.id, r.id)
                            if (jadwalTetap) {
                              return (
                                <td key={r.id} className={`p-3 border-l border-slate-100 text-center align-middle ${jadwalTetap.warna}`}>
                                  <p className="font-black text-xs leading-none">{jadwalTetap.nama}</p>
                                </td>
                              )
                            }

                            const jadwalGiliran = daftarJadwalGiliran.find(jg => jg.rombelId === r.id && jg.waktuId === slot.id && jg.hari === hariPlotTabel)
                            const jadwalItem = daftarJadwal.find(j => j.hari === hariPlotTabel && j.waktuId === slot.id && j.rombelId === r.id)
                            const mapelItem = daftarMapel.find(m => m.id === jadwalItem?.mapelId)
                            const guruItem = daftarGuru.find(g => g.id === jadwalItem?.guruId)
                            const isGabungan = jadwalItem ? daftarKelasGabungan.some(kg => kg.mapelId === jadwalItem.mapelId && kg.rombelIds?.includes(r.id) && kg.rombelIds?.length > 1) : false
                            const labelGiliran = jadwalGiliran ? jadwalGiliran.mapelGuruList.map(mg => daftarMapel.find(m => m.id === mg.mapelId)?.nama || '').filter(Boolean).join('/') : ''
                            const guruGiliran = jadwalGiliran ? jadwalGiliran.mapelGuruList.map(mg => daftarGuru.find(g => g.id === mg.guruId)?.nama || '').filter(Boolean).join(' / ') : ''

                            return (
                              <td key={r.id} onClick={() => { setEditingCell(cellKey); setEditGuruMapel(jadwalItem ? `${jadwalItem.guruId}|${jadwalItem.mapelId}` : '') }} className={`p-3 border-l border-slate-100 text-center align-middle cursor-pointer transition-colors relative min-h-[60px] ${editingCell === cellKey ? 'bg-amber-50/70 ring-1 ring-amber-400' : 'hover:bg-indigo-50/30'}`}>
                                {editingCell === cellKey ? (
                                  <div className="flex flex-col gap-1.5 items-center justify-center bg-white p-2.5 rounded-xl border border-slate-100 shadow-xl z-20 absolute top-2 left-2 right-2">
                                    <select value={editGuruMapel} onChange={e => setEditGuruMapel(e.target.value)} onClick={e => e.stopPropagation()} className="w-full text-[9px] font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none bg-slate-50">
                                      <option value="">-- Kosongkan --</option>
                                      <optgroup label="Pendidik & Mapel">
                                        {getMapelGuruUntukRombel(r.id).map(mg => (
                                          <option key={`${mg.guruId}-${mg.mapelId}`} value={`${mg.guruId}|${mg.mapelId}`}>{mg.guruNama} – {mg.mapelNama}</option>
                                        ))}
                                      </optgroup>
                                    </select>
                                    <div className="flex gap-1 w-full">
                                      <button onClick={e => { e.stopPropagation(); handleInlineSave(hariPlotTabel, slot.id, r.id, jadwalItem) }} className="flex-1 bg-indigo-600 text-white text-[9px] font-extrabold py-1.5 rounded-lg flex items-center justify-center gap-1"><Check className="w-3 h-3" /> Simpan</button>
                                      <button onClick={e => { e.stopPropagation(); setEditingCell(null) }} className="flex-1 bg-slate-100 text-slate-600 text-[9px] font-bold py-1.5 rounded-lg">Batal</button>
                                    </div>
                                  </div>
                                ) : jadwalItem ? (
                                  <div className="relative">
                                    {isGabungan && <span title="Kelas Gabungan" className="absolute -top-1 -right-1"><Layers className="w-3 h-3 text-emerald-500" /></span>}
                                    {jadwalGiliran && <span title="Jadwal Giliran" className="absolute -top-1 -left-1"><RotateCcw className="w-3 h-3 text-violet-500" /></span>}
                                    <p className="text-indigo-950 font-black text-xs leading-none">{mapelItem?.nama || '–'}</p>
                                    <p className="text-slate-400 font-semibold text-[9px] mt-1.5 truncate max-w-[90px] mx-auto">{guruItem?.nama || '–'}</p>
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
                <Shield className="w-5 h-5 text-indigo-600" />
                <h2 className="font-bold text-slate-800 text-sm">Rekapitulasi Beban Jam Mengajar Pendidik</h2>
              </div>
              <button
                onClick={() => { setGuruDownloadTarget('semua-zip'); setShowDownloadGuruModal(true) }}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-md transition"
              >
                <Download className="w-4 h-4" /> Unduh Jadwal Per Guru (PDF)
              </button>
            </div>
            <div className="md:w-1/3">
              <select value={cariGuruId} onChange={e => setCariGuruId(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">🔍 Semua pendidik</option>
                {daftarGuru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                    <th className="p-4">Pendidik</th>
                    <th className="p-4">Mapel Diampu</th>
                    <th className="p-4 text-center">Total JP</th>
                    <th className="p-4">JP per Hari</th>
                    <th className="p-4 text-center">Unduh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {daftarGuru.filter(g => !cariGuruId || g.id === cariGuruId).map(g => {
                    const rekap = rekapPerHari(g.id)
                    const totalJp = rekapJamGuru()[g.id] || 0
                    return (
                      <tr key={g.id} className="hover:bg-slate-50/70">
                        <td className="p-4 text-sm font-black text-slate-800">{g.nama}</td>
                        <td className="p-4">
                          <ul className="list-disc pl-3 text-indigo-700">
                            {g.mapelIds?.map((mId: string) => <li key={mId}>{daftarMapel.find(m => m.id === mId)?.nama || mId}</li>)}
                          </ul>
                        </td>
                        <td className="p-4 text-center">
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 font-black px-4 py-1.5 rounded-xl text-xs">{totalJp} JP</span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1.5">
                            {LIST_HARI.map(h => (
                              <span key={h} className={`px-2 py-1 rounded-lg text-[9px] font-extrabold border ${rekap[h] >= maksJpGuruPerHari ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                {h.slice(0, 3)}: {rekap[h]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleDownloadSatuGuru(g)}
                            disabled={sedangMengunduhGuru}
                            title="Unduh PDF jadwal guru ini"
                            className="p-2 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!daftarGuru.length && <tr><td colSpan={5} className="py-12 text-center text-slate-400 text-xs">Belum ada data guru.</td></tr>}
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
                <CheckCircle className="w-5 h-5 text-indigo-600" />
                <h2 className="font-bold text-slate-800 text-sm">Rekap Jadwal Lengkap</h2>
              </div>
              <div className="text-[10px] text-slate-500 font-semibold">
                {modeTampil === 'unit' ? (
                  <span>Menampilkan kelas untuk unit: <strong className="text-indigo-700">{daftarLembaga.find(l => l.id === unitFilter)?.nama || 'Lembaga Induk'}</strong>{unitFilter !== 'lembaga-induk' && <span className="text-amber-600"> · hanya Senin–Jumat</span>}</span>
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
                    <div className="bg-indigo-950 text-white px-5 py-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span className="font-black text-sm uppercase tracking-wider">{hari}</span>
                      <span className="text-indigo-400 text-[10px] font-semibold ml-auto">{jadwalHariIni.length} slot terjadwal</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black tracking-wider">
                            <th className="p-3 min-w-[90px]">Waktu</th>
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
                                <td className="p-3 font-black text-indigo-900 bg-slate-50/50 border-r border-slate-200">
                                  <p className="text-[10px]">{slot.label}</p>
                                  <p className="text-[9px] text-indigo-600 font-extrabold">{slot.mulai}–{slot.selesai}</p>
                                </td>
                                {rombelTampil.map(r => {
                                  const tetap = getJadwalTetapUntukSlotRender(hari, slot.id, r.id)
                                  if (tetap) return (
                                    <td key={r.id} className={`p-3 text-center border-l border-slate-100 ${tetap.warna}`}>
                                      <span className="font-black text-xs">{tetap.nama}</span>
                                    </td>
                                  )

                                  const giliran = daftarJadwalGiliran.find(jg => jg.rombelId === r.id && jg.waktuId === slot.id && jg.hari === hari)
                                  const j = daftarJadwal.find(jj => jj.hari === hari && jj.waktuId === slot.id && jj.rombelId === r.id)
                                  const mapel = daftarMapel.find(m => m.id === j?.mapelId)
                                  const guru = daftarGuru.find(g => g.id === j?.guruId)
                                  const isGab = j ? daftarKelasGabungan.some(kg => kg.mapelId === j.mapelId && kg.rombelIds?.includes(r.id) && kg.rombelIds?.length > 1) : false
                                  const labelGiliran = giliran ? giliran.mapelGuruList.map(mg => daftarMapel.find(m => m.id === mg.mapelId)?.nama || '').filter(Boolean).join('/') : ''
                                  const guruGiliran = giliran ? giliran.mapelGuruList.map(mg => daftarGuru.find(g => g.id === mg.guruId)?.nama || '').filter(Boolean).join(' / ') : ''

                                  return (
                                    <td key={r.id} className={`p-3 text-center border-l border-slate-100 ${isGab ? 'bg-emerald-50/40' : ''}`}>
                                      {j ? (
                                        <div>
                                          <p className="font-black text-slate-800 text-xs leading-none">{mapel?.nama || '–'}</p>
                                          <p className="text-slate-500 text-[9px] mt-1">{guru?.nama || '–'}</p>
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

            <div className="flex gap-3 pt-2">
              <button onClick={handleDownload} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition">
                <Printer className="w-4 h-4" /> Buka & Cetak
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
              <h2 className="font-black text-slate-800 text-lg flex items-center gap-2"><Download className="w-5 h-5 text-indigo-600" /> Unduh Jadwal Per Guru</h2>
              <button onClick={() => !sedangMengunduhGuru && setShowDownloadGuruModal(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Format mengikuti template "Jadwal Guru" (potret/portrait, tanpa kop/logo — kop hanya dipakai pada jadwal keseluruhan, tabel hari × jam, jadwal piket dan kontak piket). File diunduh sebagai PDF.</p>

            {!sedangMengunduhGuru ? (
              <>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Pilih Cakupan</label>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    <label className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                      <input type="radio" name="dlg" value="semua-zip" checked={guruDownloadTarget === 'semua-zip'} onChange={() => setGuruDownloadTarget('semua-zip')} className="accent-indigo-600" />
                      <div>
                        <p className="font-bold text-sm text-slate-800">Semua Guru (ZIP)</p>
                        <p className="text-[10px] text-slate-500">Satu file ZIP berisi PDF jadwal untuk setiap pendidik ({daftarGuru.length} guru).</p>
                      </div>
                    </label>
                    {daftarGuru.map(g => (
                      <label key={g.id} className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                        <input type="radio" name="dlg" value={g.id} checked={guruDownloadTarget === g.id} onChange={() => setGuruDownloadTarget(g.id)} className="accent-indigo-600" />
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
                  <button onClick={handleProsesDownloadGuru} disabled={!daftarGuru.length} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed">
                    <Download className="w-4 h-4" /> Unduh
                  </button>
                  <button onClick={() => setShowDownloadGuruModal(false)} className="px-5 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition">Batal</button>
                </div>
              </>
            ) : (
              <div className="py-6 space-y-3">
                <div className="flex items-center justify-center">
                  <RotateCcw className="w-6 h-6 text-indigo-500 animate-spin" />
                </div>
                <p className="text-center text-xs font-bold text-slate-700">
                  Membuat PDF... {progresUnduhGuru.selesai} / {progresUnduhGuru.total}
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all"
                    style={{ width: `${progresUnduhGuru.total > 0 ? (progresUnduhGuru.selesai / progresUnduhGuru.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-center text-[10px] text-slate-400">Mohon tunggu, jangan tutup jendela ini.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}