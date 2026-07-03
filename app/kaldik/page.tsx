'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../supabase'
import { useGoogleLogin } from '@react-oauth/google'
import {
  CalendarDays, Home, ArrowLeft, Calendar, Plus, Trash2, RefreshCw,
  Tag, Edit2, Check, X, Download, Printer, FileText, ChevronDown,
  Settings, Eye,
} from 'lucide-react'

interface AgendaItem {
  tanggal: string
  tanggalSelesai?: string
  keterangan: string
  statusHari: string
  kategoriKlasifikasi: string
  lembagaTerlibat: string[]
  tingkatTerlibat?: string[]
  rombelTerlibat?: string[]
  sumberGoogle?: boolean
}

interface ProfilCetak {
  namaSekolah: string
  npsn: string
  alamat: string
  kota: string
  namaMudir: string
  nipMudir: string
  namaKepala: string
  nipKepala: string
  titiMangsa: string
}

interface UnitIdentitas {
  id: string
  nama?: string
  npsn?: string
  alamat?: string
  namaKepala?: string
  nipKepala?: string
}

interface IdentitasLembagaData {
  namaLembaga?: string
  npsn?: string
  alamat?: string
  kota?: string
  namaMudir?: string
  nipMudir?: string
  unitList?: UnitIdentitas[]
}

// Data guru & peran minimal yang dibutuhkan untuk deteksi otomatis Mudir/Kepala
// Sekolah — bentuknya mengikuti apa yang disimpan halaman Kelola Data Guru.
interface GuruRingkas {
  nama?: string
  nip?: string
  nipGuru?: string
  nomorInduk?: string
  unitIds?: string[]
  peranIds?: string[]
}
interface PeranRingkas { id: string; nama: string }

function ambilNipGuru(g: GuruRingkas): string {
  return g.nip || g.nipGuru || g.nomorInduk || ''
}

function cariPeranId(daftarPeran: PeranRingkas[], kataKunci: string[]): string | null {
  const p = daftarPeran.find(pr => kataKunci.some(k => pr.nama?.toLowerCase().includes(k)))
  return p?.id || null
}

/**
 * Mengambil identitas lembaga (nama, NPSN, Mudir, Kepala Sekolah tiap unit) dari
 * data yang SEBENARNYA disimpan oleh halaman "Identitas Lembaga":
 *  - identitas_induk  : {nama, npsn, logo_utama, logo, kop} — data yayasan pusat
 *  - daftar_lembaga   : [{id, nama, npsn, logo, kop}, ...]  — data unit/cabang
 *  - master_guru      : [{nama, unitIds, peranIds, ...}, ...]
 *  - master_peran     : [{id, nama}, ...]
 * Nama Mudir & Kepala Sekolah TIDAK disimpan langsung — keduanya dideteksi
 * otomatis dengan mencari guru yang unit-nya cocok DAN memegang peran yang
 * namanya mengandung "mudir" (untuk pusat) atau
 * "kepala sekolah" (untuk cabang), persis seperti logika di
 * halaman Identitas Lembaga (getNamaMudirPusat / getKepalaSekolahUnit).
 */
function ambilIdentitasLembaga(): IdentitasLembagaData|null {
  try {
    const rawInduk = localStorage.getItem('identitas_induk')
    const rawLembaga = localStorage.getItem('daftar_lembaga')
    const rawGuru = localStorage.getItem('master_guru')
    const rawPeran = localStorage.getItem('master_peran')
    if (!rawInduk && !rawLembaga) return null

    const induk = rawInduk ? JSON.parse(rawInduk) : {}
    const daftarLembaga: {id:string;nama?:string;npsn?:string}[] = rawLembaga ? JSON.parse(rawLembaga) : []
    const daftarGuru: GuruRingkas[] = rawGuru ? JSON.parse(rawGuru) : []
    const daftarPeran: PeranRingkas[] = rawPeran ? JSON.parse(rawPeran) : []

    const peranMudirId = cariPeranId(daftarPeran, ['mudir', 'pimpinan yayasan'])
    const peranKepsekId = cariPeranId(daftarPeran, ['kepala sekolah', 'pimpinan unit'])

    const mudir = peranMudirId
      ? daftarGuru.find(g => g.unitIds?.includes('lembaga-induk') && g.peranIds?.includes(peranMudirId))
      : undefined

    const unitList: UnitIdentitas[] = daftarLembaga.map(u => {
      const kepsek = peranKepsekId
        ? daftarGuru.find(g => g.unitIds?.includes(u.id) && g.peranIds?.includes(peranKepsekId))
        : undefined
      return {
        id: u.id,
        nama: u.nama,
        npsn: u.npsn,
        namaKepala: kepsek?.nama,
        nipKepala: kepsek ? ambilNipGuru(kepsek) : undefined,
      }
    })

    return {
      namaLembaga: induk.nama,
      npsn: induk.npsn,
      namaMudir: mudir?.nama,
      nipMudir: mudir ? ambilNipGuru(mudir) : undefined,
      unitList,
    }
  } catch { return null }
}

type CetakScope = 'keseluruhan' | 'unit'

const BULAN_PANJANG: Record<string, string> = {
  '01':'Januari','02':'Februari','03':'Maret','04':'April','05':'Mei','06':'Juni',
  '07':'Juli','08':'Agustus','09':'September','10':'Oktober','11':'November','12':'Desember',
}
const MONTH_NUMBER_MAP: Record<string, number> = {
  Juli:7,Agustus:8,September:9,Oktober:10,November:11,Desember:12,
  Januari:1,Februari:2,Maret:3,April:4,Mei:5,Juni:6,
}
const MONTH_PAD_MAP: Record<string, string> = {
  Juli:'07',Agustus:'08',September:'09',Oktober:'10',November:'11',Desember:'12',
  Januari:'01',Februari:'02',Maret:'03',April:'04',Mei:'05',Juni:'06',
}
const NAMA_BULAN_URUT = ['Juli','Agustus','September','Oktober','November','Desember','Januari','Februari','Maret','April','Mei','Juni']
const HARI_SINGKAT = ['Ahd','Sn','Sl','Rb','Km','Jm','Sb']

function isTahunKabisat(y: number) { return (y%4===0&&y%100!==0)||y%400===0 }
function getJumlahHariBulan(m: number, y: number) {
  const s:Record<number,number>={1:31,2:28,3:31,4:30,5:31,6:30,7:31,8:31,9:30,10:31,11:30,12:31}
  if(m===2&&isTahunKabisat(y)) return 29
  return s[m]
}
function getMulaiHariBulan(m: number, y: number) { return new Date(y,m-1,1).getDay() }
function parseTahunAjaran(ta: string) {
  const fb=new Date().getFullYear()
  if(!ta||!ta.includes('/')) return {tahunAwal:fb,tahunAkhir:fb+1}
  const [a,b]=ta.split('/'); const awal=parseInt(a,10),akhir=parseInt(b,10)
  if(isNaN(awal)||isNaN(akhir)) return {tahunAwal:fb,tahunAkhir:fb+1}
  return {tahunAwal:awal,tahunAkhir:akhir}
}
function hexToRgb(hex: string):[number,number,number] {
  const c=hex.replace('#',''); const n=parseInt(c,16)
  return [(n>>16)&255,(n>>8)&255,n&255]
}
function formatTanggalPendek(d: string) {
  if(!d) return ''; const [,m,dd]=d.split('-'); return `${parseInt(dd)} ${BULAN_PANJANG[m]||''}`
}
// ── Singkatan bulan untuk penulisan ringkas di kaldik (baik PDF maupun web) ──
const BULAN_SINGKAT: Record<string, string> = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'Mei','06':'Jun',
  '07':'Jul','08':'Agst','09':'Sept','10':'Okt','11':'Nov','12':'Des',
}
/** Format rentang tanggal singkat: "12 Jul" (1 hari), "8 - 15 Agst" (rentang
 *  bulan sama), "30 Jul - 2 Agst" (rentang beda bulan). Dipakai untuk kaldik
 *  cetak (PDF) maupun kolom keterangan di halaman web supaya konsisten & hemat
 *  tempat. */
function formatRentangSingkat(tglMulai: string, tglSelesai?: string): string {
  const ts = tglSelesai || tglMulai
  const [, ms, ds] = tglMulai.split('-')
  const [, me, de] = ts.split('-')
  if (tglMulai === ts) return `${parseInt(ds,10)} ${BULAN_SINGKAT[ms]||''}`
  if (ms === me) return `${parseInt(ds,10)} - ${parseInt(de,10)} ${BULAN_SINGKAT[ms]||''}`
  return `${parseInt(ds,10)} ${BULAN_SINGKAT[ms]||''} - ${parseInt(de,10)} ${BULAN_SINGKAT[me]||''}`
}
/** Bangun string tanggal (yyyy-mm-dd) dari nama bulan akademik (mis. "Juli 2026") + tanggal. */
function tanggalDariNamaBulan(namaBulan: string, day: number): string {
  const [bl, tl] = namaBulan.split(' ')
  const bs = MONTH_PAD_MAP[bl] || '01'
  return `${tl}-${bs}-${String(day).padStart(2,'0')}`
}
function rentangTanggalLabel(item: AgendaItem) {
  return formatRentangSingkat(item.tanggal, item.tanggalSelesai)
}
function titiMangsaHariIni(kota: string) {
  const n=new Date(),d=n.getDate(),m=String(n.getMonth()+1).padStart(2,'0')
  return `${kota||'Bandung'}, ${d} ${BULAN_PANJANG[m]} ${n.getFullYear()}`
}

function getAgendaBulanCetak(
  bulanNama: string, jumlahHari: number, unitId: string,
  daftarAgenda: AgendaItem[],
  klasifikasi: {id:string;label:string;hexColor:string}[],
) {
  const hasil:{tanggal:string;keterangan:string;warna:string}[]=[]
  const seen=new Set<string>()
  const [bl,tl]=bulanNama.split(' ')
  const bs=MONTH_PAD_MAP[bl]||'01'
  for(let day=1;day<=jumlahHari;day++) {
    const fd=`${tl}-${bs}-${String(day).padStart(2,'0')}`
    daftarAgenda.forEach(item => {
      const ts=item.tanggalSelesai||item.tanggal
      if(fd>=item.tanggal&&fd<=ts&&item.lembagaTerlibat?.includes(unitId)) {
        const key=`${item.tanggal}-${item.keterangan}`
        if(!seen.has(key)) {
          seen.add(key)
          const kla=klasifikasi.find(k=>k.id===item.kategoriKlasifikasi)
          hasil.push({tanggal:rentangTanggalLabel(item),keterangan:item.keterangan,warna:kla?.hexColor||'#4b5563'})
        }
      }
    })
  }
  return hasil
}

interface ParamsPDF {
  scope: CetakScope
  unitId: string
  namaInstitusi: string
  namaPenandatangan: string
  jabatanPenandatangan: string
  nipPenandatangan: string
  titiMangsa: string
  tahunAjaran: string
  filterSemester: 'semua'|'semester1'|'semester2'
  daftarAgenda: AgendaItem[]
  daftarKlasifikasiAgenda: {id:string;label:string;hexColor:string}[]
  bulanAkademik: {nama:string;jumlahHari:number;monthNumber:number;tahunBulanIni:number}[]
}

async function buatDokumenPDF(params: ParamsPDF) {
  const {default:jsPDF}=await import('jspdf')
  const {namaInstitusi,namaPenandatangan,jabatanPenandatangan,nipPenandatangan,
    titiMangsa,tahunAjaran,filterSemester,scope,unitId,
    daftarAgenda,daftarKlasifikasiAgenda,bulanAkademik}=params

  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'})
  const PW=210,PH=297,ML=7,MR=7
  const CW=PW-ML-MR
  const COL_GAP=2
  const COL_W=(CW-2*COL_GAP)/3
  const CELL_W=COL_W/7
  const NAVY:[number,number,number]=[106,25,125] // Ungu #6A197D
  const NAVY_LIGHT:[number,number,number]=[237,224,240] // Ungu muda (tint)
  const DARK:[number,number,number]=[35,18,42] // Hitam bernuansa ungu tua

  function getDateColor(dateStr:string, uid:string):[number,number,number]|null {
    for(const item of daftarAgenda) {
      const ts=item.tanggalSelesai||item.tanggal
      if(dateStr>=item.tanggal&&dateStr<=ts&&item.lembagaTerlibat?.includes(uid)) {
        const kla=daftarKlasifikasiAgenda.find(k=>k.id===item.kategoriKlasifikasi)
        return hexToRgb(kla?.hexColor||'#4b5563')
      }
    }
    // Hari Ahad (Minggu) otomatis merah kalau tanggal itu tidak punya agenda khusus.
    if(new Date(dateStr+'T00:00:00').getDay()===0) return [220,38,38]
    return null
  }

  function drawKop(y0:number):number {
    let y=y0
    doc.setLineWidth(1.1);doc.setDrawColor(...NAVY);doc.line(ML,y,PW-MR,y);y+=2
    doc.setFont('times','bold');doc.setFontSize(13);doc.setTextColor(...DARK)
    doc.text('KALENDER PENDIDIKAN',PW/2,y+4.5,{align:'center'})
    doc.setFontSize(10.5)
    doc.text(namaInstitusi.toUpperCase(),PW/2,y+10,{align:'center'})
    doc.setFont('times','normal');doc.setFontSize(8);doc.setTextColor(130,95,140)
    doc.text(`TAHUN AJARAN ${tahunAjaran}`,PW/2,y+15.5,{align:'center'})
    y+=19
    doc.setLineWidth(0.6);doc.setDrawColor(...NAVY);doc.line(ML,y,PW-MR,y)
    return y+4
  }

  // Kop ringkas untuk halaman lanjutan (kalau isi tidak muat 1 halaman) — sengaja
  // dibuat jauh lebih pendek dari kop halaman 1 supaya tidak boros ruang.
  function drawKopLanjutan(y0:number):number {
    let y=y0
    doc.setLineWidth(0.6);doc.setDrawColor(...NAVY);doc.line(ML,y,PW-MR,y);y+=3.5
    doc.setFont('times','bold');doc.setFontSize(8.5);doc.setTextColor(...DARK)
    doc.text(`KALENDER PENDIDIKAN — ${namaInstitusi.toUpperCase()} — TA ${tahunAjaran} (Lanjutan)`,PW/2,y,{align:'center'})
    y+=3.5
    doc.setLineWidth(0.4);doc.setDrawColor(...NAVY);doc.line(ML,y,PW-MR,y)
    return y+3.5
  }

  // Ukuran grid tanggal: dua mode — SEMESTER (6 bulan/2 baris, sel lebih besar)
  // dan TAHUNAN (12 bulan/4 baris pada 1 halaman, sel dipadatkan supaya tetap muat).
  type CellCfg = { monthHdrH:number; dayHdrH:number; rowH:number }
  const cellCfg: CellCfg = filterSemester==='semua'
    ? { monthHdrH:5, dayHdrH:3.1, rowH:3.55 }
    : { monthHdrH:6, dayHdrH:4.3, rowH:5 }
  const CAL_H = cellCfg.monthHdrH + cellCfg.dayHdrH + 6*cellCfg.rowH

  function drawMonthGrid(x:number,y:number,bulanNama:string,monthNum:number,year:number,uid:string) {
    const {monthHdrH,dayHdrH,rowH}=cellCfg
    const bulanPad=String(monthNum).padStart(2,'0')
    const jml=getJumlahHariBulan(monthNum,year)
    const mulai=getMulaiHariBulan(monthNum,year)
    const prevM=monthNum===1?12:monthNum-1
    const prevY=monthNum===1?year-1:year
    const prevTotal=getJumlahHariBulan(prevM,prevY)
    const nextM=monthNum===12?1:monthNum+1
    const nextY=monthNum===12?year+1:year

    // Header nama bulan
    doc.setFillColor(...NAVY)
    doc.rect(x,y,COL_W,monthHdrH,'F')
    doc.setFont('times','bold');doc.setFontSize(filterSemester==='semua'?6.3:7);doc.setTextColor(255,255,255)
    doc.text(bulanNama,x+COL_W/2,y+monthHdrH-1.4,{align:'center'})
    y+=monthHdrH

    // Header hari
    HARI_SINGKAT.forEach((h,i)=>{
      const cx=x+i*CELL_W
      doc.setFillColor(...NAVY_LIGHT)
      doc.rect(cx,y,CELL_W,dayHdrH,'F')
      doc.setDrawColor(205,180,210);doc.setLineWidth(0.1)
      doc.rect(cx,y,CELL_W,dayHdrH,'S')
      doc.setFont('times','bold');doc.setFontSize(filterSemester==='semua'?4.3:5.1);doc.setTextColor(...NAVY)
      doc.text(h,cx+CELL_W/2,y+dayHdrH-1,{align:'center'})
    })
    y+=dayHdrH

    // Sel tanggal
    type Cell={day:number;inMonth:boolean;dateStr:string}
    const cells:Cell[]=[]
    for(let p=prevTotal-mulai+1;p<=prevTotal;p++)
      cells.push({day:p,inMonth:false,dateStr:`${prevY}-${String(prevM).padStart(2,'0')}-${String(p).padStart(2,'0')}`})
    for(let d=1;d<=jml;d++)
      cells.push({day:d,inMonth:true,dateStr:`${year}-${bulanPad}-${String(d).padStart(2,'0')}`})
    let nd=1
    while(cells.length<42){cells.push({day:nd,inMonth:false,dateStr:`${nextY}-${String(nextM).padStart(2,'0')}-${String(nd).padStart(2,'0')}`});nd++}

    cells.forEach((cell,idx)=>{
      const row=Math.floor(idx/7),col=idx%7
      const cx=x+col*CELL_W,cy=y+row*rowH
      if(cell.inMonth) {
        const agColor=getDateColor(cell.dateStr,uid)
        if(agColor) {
          doc.setFillColor(...agColor);doc.rect(cx,cy,CELL_W,rowH,'F')
          doc.setTextColor(255,255,255);doc.setFont('times','bold')
        } else {
          doc.setFillColor(255,255,255);doc.rect(cx,cy,CELL_W,rowH,'F')
          doc.setTextColor(40,20,48);doc.setFont('times','normal')
        }
      } else {
        doc.setFillColor(250,246,251);doc.rect(cx,cy,CELL_W,rowH,'F')
        doc.setTextColor(180,160,185);doc.setFont('times','normal')
      }
      doc.setDrawColor(220,200,222);doc.setLineWidth(0.1)
      doc.rect(cx,cy,CELL_W,rowH,'S')
      doc.setFontSize(filterSemester==='semua'?4.4:5.3)
      doc.text(String(cell.day),cx+CELL_W/2,cy+rowH-1,{align:'center'})
    })

    // Bingkai luar kalender (menyatu dengan kotak keterangan di bawahnya)
    doc.setDrawColor(...NAVY);doc.setLineWidth(0.35)
    doc.rect(x,y-dayHdrH-monthHdrH,COL_W,monthHdrH+dayHdrH+6*rowH,'S')
  }

  // ── Ukuran teks kotak keterangan (agenda) ──────────────────────────────
  const AG_PAD=1.6
  const AG_LINE_H=filterSemester==='semua'?2.5:3.1
  const AG_FONT_SIZE=filterSemester==='semua'?5.0:5.8
  const AG_BUFFER=0.4 // sedikit ruang napas di bawah, konsisten dipakai di kedua fungsi di bawah

  function ukurBarisAgenda(text:string):string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (doc as any).splitTextToSize(text,COL_W-AG_PAD*2) as string[]
  }

  /** Hitung tinggi alami (mm) yang dibutuhkan kotak keterangan suatu bulan.
   *  Format per item: "❖ {tanggal singkat} : {keterangan}" sebagai SATU teks
   *  yang di-word-wrap otomatis — keterangan tetap di baris yang sama setelah
   *  ":" selama masih muat, dan HANYA pindah ke baris baru kalau sudah mentok
   *  batas lebar kolom (bukan dipaksa pindah baris setiap saat).
   *  PENTING: rumus ini harus PERSIS mencerminkan geometri di drawAgendaBox()
   *  di bawah — kalau tidak sinkron, box akan dianggap "kurang tinggi" walau
   *  sebenarnya cukup, dan keterangan jadi tidak tercetak.
   */
  function hitungTinggiAlamiAgenda(bulanNama:string,jumlahHari:number,uid:string) {
    const list=getAgendaBulanCetak(bulanNama,jumlahHari,uid,daftarAgenda,daftarKlasifikasiAgenda)
    if(list.length===0) return {natural:AG_PAD*2+AG_LINE_H, list}
    doc.setFont('times','normal');doc.setFontSize(AG_FONT_SIZE)
    let totalLines=0
    list.forEach(ag=>{
      const lines=ukurBarisAgenda(`\u2022 ${ag.tanggal} : ${ag.keterangan}`)
      totalLines+=lines.length
    })
    // Baris pertama butuh (AG_PAD+AG_LINE_H) sebelum teks pertama digambar (baseline),
    // lalu tiap baris berikutnya menambah AG_LINE_H, plus sedikit ruang napas di bawah.
    return {natural:AG_PAD+(totalLines+1)*AG_LINE_H+AG_BUFFER, list}
  }

  function drawAgendaBox(x:number,y:number,h:number,bulanNama:string,jumlahHari:number,uid:string) {
    // Kotak keterangan bulan — border tegas, menempel persis di bawah grid tanggal.
    doc.setFillColor(255,255,255)
    doc.rect(x,y,COL_W,h,'F')
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.35)
    doc.rect(x,y,COL_W,h,'S')
    const list=getAgendaBulanCetak(bulanNama,jumlahHari,uid,daftarAgenda,daftarKlasifikasiAgenda)
    let ay=y+AG_PAD+AG_LINE_H
    if(list.length===0) {
      doc.setTextColor(195,175,200);doc.setFont('times','italic');doc.setFontSize(AG_FONT_SIZE)
      doc.text('\u2014',x+COL_W/2,y+h/2,{align:'center'});return
    }
    let dilewati=0
    // PENTING: font & ukuran HARUS di-set sebelum mengukur lebar teks (splitTextToSize),
    // karena jsPDF bersifat stateful — kalau diukur pakai font/ukuran sisa dari elemen
    // lain sebelumnya (mis. font tebal grid tanggal), lebar hasil ukur jadi salah dan
    // teksnya bisa memotong/melewati garis tepi kolom saat digambar.
    doc.setFont('times','normal');doc.setFontSize(AG_FONT_SIZE)
    for(const ag of list) {
      const [r,g,b]=hexToRgb(ag.warna)
      const text=`\u2022 ${ag.tanggal} : ${ag.keterangan}`
      const lines=ukurBarisAgenda(text)
      // Batas bawah dihitung dengan buffer YANG SAMA seperti di hitungTinggiAlamiAgenda,
      // supaya kotak yang tingginya dari hasil hitungan itu benar-benar cukup memuat semuanya.
      if(ay+lines.length*AG_LINE_H>y+h-AG_BUFFER) { dilewati++; continue }
      doc.setTextColor(r,g,b);doc.setFont('times','normal');doc.setFontSize(AG_FONT_SIZE)
      lines.forEach((line:string)=>{ doc.text(line,x+AG_PAD,ay);ay+=AG_LINE_H })
    }
    if(dilewati>0) {
      doc.setTextColor(160,140,165);doc.setFont('times','italic');doc.setFontSize(AG_FONT_SIZE-0.6)
      doc.text(`+${dilewati} agenda lainnya`,x+AG_PAD,Math.min(ay,y+h-1))
    }
  }

  function drawFooter() {
    doc.setFont('times','italic');doc.setFontSize(6);doc.setTextColor(160,135,165)
    doc.text(`Kalender Pendidikan \u2014 ${namaInstitusi} \u2014 Tahun Ajaran ${tahunAjaran}`,PW/2,PH-3,{align:'center'})
  }

  function drawSignature(yTop:number) {
    const ttX=PW-MR-75; let sy=yTop+7
    doc.setFont('times','normal');doc.setFontSize(9);doc.setTextColor(...DARK)
    doc.text(titiMangsa||titiMangsaHariIni('Bandung'),ttX,sy);sy+=5.5
    doc.text(scope==='keseluruhan'?`Mudir ${namaInstitusi}`:`${jabatanPenandatangan}`,ttX,sy);sy+=16
    doc.setLineWidth(0.3);doc.setDrawColor(185,165,190);doc.line(ttX,sy,ttX+70,sy);sy+=5
    doc.setFont('times','bold');doc.setFontSize(9.5)
    doc.text(namaPenandatangan||`(${jabatanPenandatangan})`,ttX,sy)
    if(nipPenandatangan){sy+=5;doc.setFont('times','normal');doc.setFontSize(8.5);doc.text(`NIP. ${nipPenandatangan}`,ttX,sy)}
  }

  // ── Susun daftar bulan yang akan dicetak ────────────────────────────────
  type BlokSemester = {label:string; bulan:typeof bulanAkademik}
  const semList:BlokSemester[]=[]
  if(filterSemester==='semua'||filterSemester==='semester1')
    semList.push({label:'Semester 1 (Ganjil)',bulan:bulanAkademik.filter(b=>b.monthNumber>=7&&b.monthNumber<=12)})
  if(filterSemester==='semua'||filterSemester==='semester2')
    semList.push({label:'Semester 2 (Genap)',bulan:bulanAkademik.filter(b=>b.monthNumber>=1&&b.monthNumber<=6)})

  const semuaBulan = semList.flatMap(s=>s.bulan)
  const SIG_H = 30 // ruang tanda tangan di halaman terakhir
  const SUBHDR_H = semList.length>1 ? 5 : 0 // label "Semester 1/2" hanya perlu jika keduanya tampil
  const ROW_GAP = filterSemester==='semua'?1.4:1.8

  // Margin atas/bawah dipangkas supaya area kaldik lebih leluasa (dari 8mm → 5mm).
  const TOP_MARGIN = 5
  const BOTTOM_MARGIN = 5
  const BATAS_BAWAH_KONTEN = PH-BOTTOM_MARGIN // batas y maksimum sebelum harus ganti halaman

  // Tinggi kotak keterangan TIDAK dibatasi atas — sebanyak apapun keterangannya,
  // kotak akan memanjang ke bawah mengikuti isinya. MIN hanya untuk baris kosong
  // supaya tetap terlihat sebagai kotak (bukan garis tipis).
  const MIN_AGENDA_H = filterSemester==='semua'?5:7
  const tinggiAgendaPerBaris:number[]=[]
  for(let i=0;i<semuaBulan.length;i+=3) {
    const trio=semuaBulan.slice(i,i+3)
    const naturalTrio=trio.map(b=>hitungTinggiAlamiAgenda(b.nama,b.jumlahHari,unitId).natural)
    tinggiAgendaPerBaris.push(Math.max(MIN_AGENDA_H,...naturalTrio))
  }

  let curY=drawKop(TOP_MARGIN)

  // Pindah ke halaman baru (dengan kop ringkas "Lanjutan") HANYA kalau baris
  // berikutnya benar-benar tidak muat di halaman berjalan — bukan dipaksa 1
  // halaman dengan kompresi seperti sebelumnya.
  function pindahHalamanBaru() {
    drawFooter()
    doc.addPage()
    curY=drawKopLanjutan(TOP_MARGIN)
  }

  let baris=0
  semList.forEach(sem=>{
    const jmlBarisSem=Math.ceil(sem.bulan.length/3)
    if(SUBHDR_H>0) {
      // Cek subheader + baris pertama semester ini muat bersamaan (hindari subheader
      // sendirian nempel di ujung bawah halaman tanpa isi di bawahnya).
      const tinggiBarisPertama=tinggiAgendaPerBaris[baris]
      if(curY+SUBHDR_H+CAL_H+tinggiBarisPertama>BATAS_BAWAH_KONTEN) pindahHalamanBaru()
      doc.setFont('times','bold');doc.setFontSize(8.5);doc.setTextColor(74,20,89)
      doc.text(sem.label,ML,curY+3.3)
      curY+=SUBHDR_H
    }
    for(let r=0;r<jmlBarisSem;r++) {
      const agendaH=tinggiAgendaPerBaris[baris]
      if(curY+CAL_H+agendaH>BATAS_BAWAH_KONTEN) pindahHalamanBaru()
      ;[0,1,2].forEach(c=>{
        const idx=r*3+c
        const b=sem.bulan[idx];if(!b) return
        const x=ML+c*(COL_W+COL_GAP)
        drawMonthGrid(x,curY,b.nama,b.monthNumber,b.tahunBulanIni,unitId)
        drawAgendaBox(x,curY+CAL_H,agendaH,b.nama,b.jumlahHari,unitId)
      })
      curY+=CAL_H+agendaH+ROW_GAP
      baris++
    }
  })

  // Tanda tangan menyusul di halaman terakhir; kalau tidak cukup ruang, pindah dulu.
  if(curY+SIG_H+2>BATAS_BAWAH_KONTEN) pindahHalamanBaru()
  drawSignature(curY+2)
  drawFooter()

  return doc
}

// ─── Modal Cetak ────────────────────────────────────────────────────────────

function CetakKaldikModal({onClose,namaSekolah,tahunAjaran,daftarAgenda,daftarUnitLembaga,daftarKlasifikasiAgenda,bulanAkademik}:{
  onClose:()=>void; namaSekolah:string; tahunAjaran:string
  daftarAgenda:AgendaItem[]
  daftarUnitLembaga:{id:string;label:string}[]
  daftarKlasifikasiAgenda:{id:string;label:string;hexColor:string}[]
  bulanAkademik:{nama:string;jumlahHari:number;mulaiHari:number;tahunBulanIni:number;monthNumber:number;blnIndex:number}[]
}) {
  const unitNonPusat=daftarUnitLembaga.filter(u=>u.id!=='lembaga-induk')
  const [scope,setScope]=useState<CetakScope>('keseluruhan')
  const [selectedUnitId,setSelectedUnitId]=useState(unitNonPusat[0]?.id||'lembaga-induk')
  const [filterSemester,setFilterSemester]=useState<'semua'|'semester1'|'semester2'>('semua')
  const [loadingAksi,setLoadingAksi]=useState<'preview'|'unduh'|null>(null)
  const [editProfil,setEditProfil]=useState(false)
  const [previewUrl,setPreviewUrl]=useState<string|null>(null)
  const previewRef=useRef<string|null>(null)
  const [profil,setProfil]=useState<ProfilCetak>({namaSekolah:'',npsn:'',alamat:'',kota:'',namaMudir:'',nipMudir:'',namaKepala:'',nipKepala:'',titiMangsa:''})

  useEffect(()=>{
    const identitas = ambilIdentitasLembaga()
    // Untuk cakupan "unit", cari identitas kepala sekolah unit tsb dari daftar per-unit.
    const unitData = identitas?.unitList?.find(u=>u.id===selectedUnitId)

    setProfil({
      namaSekolah: (scope==='unit' ? unitData?.nama : identitas?.namaLembaga) || localStorage.getItem('nama_sekolah')||namaSekolah||'',
      npsn:        (scope==='unit' ? unitData?.npsn : identitas?.npsn) || localStorage.getItem('profil_npsn')||'',
      alamat:      (scope==='unit' ? unitData?.alamat : identitas?.alamat) || localStorage.getItem('profil_alamat')||'',
      kota:        identitas?.kota || localStorage.getItem('profil_kota')||'',
      namaMudir:   identitas?.namaMudir || localStorage.getItem('profil_mudir')||localStorage.getItem('nama_mudir')||'',
      nipMudir:    identitas?.nipMudir || localStorage.getItem('profil_nip_mudir')||localStorage.getItem('nip_mudir')||'',
      namaKepala:  unitData?.namaKepala || localStorage.getItem('profil_kepala')||localStorage.getItem('nama_kepala')||'',
      nipKepala:   unitData?.nipKepala || localStorage.getItem('profil_nip')||localStorage.getItem('nip_kepala')||'',
      titiMangsa:  localStorage.getItem('profil_titimangsa')||'',
    })
  },[namaSekolah,selectedUnitId,scope])

  useEffect(()=>{return()=>{if(previewRef.current) URL.revokeObjectURL(previewRef.current)}},[])

  function simpanProfil() {
    localStorage.setItem('nama_sekolah',profil.namaSekolah)
    localStorage.setItem('profil_npsn',profil.npsn)
    localStorage.setItem('profil_alamat',profil.alamat)
    localStorage.setItem('profil_kota',profil.kota)
    localStorage.setItem('profil_mudir',profil.namaMudir)
    localStorage.setItem('profil_nip_mudir',profil.nipMudir)
    localStorage.setItem('profil_kepala',profil.namaKepala)
    localStorage.setItem('profil_nip',profil.nipKepala)
    localStorage.setItem('profil_titimangsa',profil.titiMangsa)
    setEditProfil(false)
  }

  const unitTerpilih=scope==='keseluruhan'?{id:'lembaga-induk',label:profil.namaSekolah||namaSekolah}:(daftarUnitLembaga.find(u=>u.id===selectedUnitId)||{id:'lembaga-induk',label:namaSekolah})
  const namaInstitusiCetak=scope==='keseluruhan'?(profil.namaSekolah||namaSekolah):unitTerpilih.label
  const namaPenandatangan=scope==='keseluruhan'?profil.namaMudir:profil.namaKepala
  const nipPenandatangan=scope==='keseluruhan'?profil.nipMudir:profil.nipKepala
  const jabatanPenandatangan=scope==='keseluruhan'?'Mudir':'Kepala Sekolah / Pimpinan Unit'
  const titiMangsaFinal=profil.titiMangsa||titiMangsaHariIni(profil.kota)
  const profilOK=scope==='keseluruhan'?!!profil.namaMudir:!!profil.namaKepala

  async function siapkanDoc() {
    return buatDokumenPDF({scope,unitId:unitTerpilih.id,namaInstitusi:namaInstitusiCetak,namaPenandatangan,jabatanPenandatangan,nipPenandatangan,titiMangsa:titiMangsaFinal,tahunAjaran,filterSemester,daftarAgenda,daftarKlasifikasiAgenda,bulanAkademik})
  }
  async function handlePreview() {
    setLoadingAksi('preview')
    try { const d=await siapkanDoc(); const url=d.output('bloburl') as unknown as string; if(previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current=url; setPreviewUrl(url) }
    catch(e){console.error(e);alert('Gagal pratinjau. Pastikan: npm install jspdf jspdf-autotable')}
    finally{setLoadingAksi(null)}
  }
  async function handleUnduh() {
    setLoadingAksi('unduh')
    try { const d=await siapkanDoc(); const sfx=filterSemester==='semester1'?'_Sem1':filterSemester==='semester2'?'_Sem2':'_Full'; d.save(`Kaldik_${namaInstitusiCetak.replace(/\s+/g,'_')}_${tahunAjaran.replace('/','-')}${sfx}.pdf`) }
    catch(e){console.error(e);alert('Gagal unduh.')}
    finally{setLoadingAksi(null)}
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-3"><Printer className="w-5 h-5 text-[#6A197D]" /><div><h3 className="text-base font-bold text-gray-800">Cetak Kalender Pendidikan (PDF)</h3><p className="text-[11px] text-gray-500">A4 Potrait · Diusahakan 1 halaman · kotak agenda menyesuaikan panjang keterangan tanpa batas</p></div></div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-5">
            {/* Cakupan */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Cakupan Kaldik</label>
              <div className="grid grid-cols-2 gap-2">
                {([{v:'keseluruhan',l:'Kaldik Keseluruhan',s:'Lembaga Pusat — ttd Mudir'},{v:'unit',l:'Kaldik Lembaga / Unit',s:'Pilih unit — ttd Kepala Sekolah'}] as const).map(o=>(
                  <button key={o.v} type="button" onClick={()=>setScope(o.v)} className={`flex flex-col items-start gap-0.5 px-3 py-3 rounded-xl border-2 text-xs font-semibold transition ${scope===o.v?'border-[#6A197D] bg-[#F5EDF7] text-[#551566]':'border-gray-200 bg-white text-gray-600 hover:border-[#B478C4]'}`}>
                    <span>{o.l}</span><span className={`text-[9px] font-normal ${scope===o.v?'text-[#F5EDF7]0':'text-gray-400'}`}>{o.s}</span>
                  </button>
                ))}
              </div>
              {scope==='unit'&&(<div className="relative mt-2"><select value={selectedUnitId} onChange={e=>setSelectedUnitId(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0">{unitNonPusat.length===0?<option value="lembaga-induk">Belum ada unit lain</option>:unitNonPusat.map(u=><option key={u.id} value={u.id}>{u.label}</option>)}</select><ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" /></div>)}
            </div>
            {/* Periode */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Periode Cetak</label>
              <div className="grid grid-cols-3 gap-2">
                {([{v:'semua',l:'Satu Tahun',s:'Juli – Juni'},{v:'semester1',l:'Semester 1',s:'Juli – Des'},{v:'semester2',l:'Semester 2',s:'Jan – Juni'}] as const).map(o=>(
                  <button key={o.v} type="button" onClick={()=>setFilterSemester(o.v)} className={`flex flex-col items-center gap-0.5 px-3 py-3 rounded-xl border-2 text-xs font-semibold transition ${filterSemester===o.v?'border-[#6A197D] bg-[#F5EDF7] text-[#551566]':'border-gray-200 bg-white text-gray-600 hover:border-[#B478C4]'}`}>
                    <span>{o.l}</span><span className={`text-[9px] font-normal ${filterSemester===o.v?'text-[#F5EDF7]0':'text-gray-400'}`}>{o.s}</span>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 mt-2">Sistem mengusahakan hasil cetak tetap 1 halaman A4. Namun jika keterangan agenda sangat banyak dan benar-benar tidak muat, otomatis berlanjut ke halaman berikutnya (tanpa keterangan yang terpotong).</p>
            </div>
            {/* Identitas */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex justify-between items-center px-4 py-3 bg-gray-50 cursor-pointer" onClick={()=>setEditProfil(v=>!v)}>
                <div className="flex items-center gap-2"><Settings className="w-4 h-4 text-gray-500" /><span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Identitas &amp; Tanda Tangan</span>
                  {profilOK?<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-bold border border-green-200">Siap ✓</span>:<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FFF3C2] text-[#8A6D00] font-bold border border-[#FFE480]">Perlu dilengkapi</span>}
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${editProfil?'rotate-180':''}`} />
              </div>
              {!editProfil&&(
                <div className="px-4 py-3 border-t border-gray-100 text-[10px] text-gray-600 space-y-1">
                  <p><span className="font-bold text-gray-700">Institusi:</span> {profil.namaSekolah||namaSekolah||'—'}</p>
                  <p><span className="font-bold text-gray-700">Titi Mangsa:</span> {titiMangsaFinal}</p>
                  <p><span className="font-bold text-gray-700">{scope==='keseluruhan'?'Mudir':'Kepala Sekolah'}:</span> {namaPenandatangan||'— (belum diisi)'}{nipPenandatangan?` / NIP. ${nipPenandatangan}`:''}</p>
                </div>
              )}
              {editProfil&&(
                <div className="px-4 py-4 space-y-3 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400">Diambil otomatis dari modul Identitas Lembaga (mengikuti unit yang dipilih di atas). Ubah di sini jika perlu — perubahan hanya berlaku untuk sesi cetak ini.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Nama Lembaga / Yayasan</label><input type="text" value={profil.namaSekolah} onChange={e=>setProfil(p=>({...p,namaSekolah:e.target.value}))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /></div>
                    <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Kota</label><input type="text" value={profil.kota} onChange={e=>setProfil(p=>({...p,kota:e.target.value}))} placeholder="Bandung" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /></div>
                    <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Titi Mangsa (tanggal surat)</label><input type="text" value={profil.titiMangsa} onChange={e=>setProfil(p=>({...p,titiMangsa:e.target.value}))} placeholder={titiMangsaHariIni(profil.kota)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /><p className="text-[9px] text-gray-400 mt-0.5">Kosong = otomatis hari ini</p></div>
                    <div className="col-span-2 pt-2 border-t border-gray-100"><p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Untuk Kaldik Keseluruhan (Mudir)</p></div>
                    <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Nama Mudir</label><input type="text" value={profil.namaMudir} onChange={e=>setProfil(p=>({...p,namaMudir:e.target.value}))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /></div>
                    <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">NIP Mudir</label><input type="text" value={profil.nipMudir} onChange={e=>setProfil(p=>({...p,nipMudir:e.target.value}))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /></div>
                    <div className="col-span-2 pt-2 border-t border-gray-100"><p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Untuk Kaldik Lembaga / Unit</p></div>
                    <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Nama Kepala Sekolah</label><input type="text" value={profil.namaKepala} onChange={e=>setProfil(p=>({...p,namaKepala:e.target.value}))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /></div>
                    <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">NIP Kepala Sekolah</label><input type="text" value={profil.nipKepala} onChange={e=>setProfil(p=>({...p,nipKepala:e.target.value}))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0" /></div>
                  </div>
                  <button onClick={simpanProfil} className="w-full py-2 rounded-lg text-sm font-semibold bg-[#6A197D] hover:bg-[#551566] text-white transition">Simpan Identitas</button>
                </div>
              )}
            </div>
            {!profilOK&&<div className="flex items-start gap-2 bg-[#FFF9E0] border border-[#FFE480] rounded-lg p-3 text-[10px] text-[#8A6D00]"><span>⚠</span><span>Nama {scope==='keseluruhan'?'Mudir':'Kepala Sekolah'} belum diisi. Klik <strong>Identitas &amp; Tanda Tangan</strong> di atas.</span></div>}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handlePreview} disabled={loadingAksi!==null} className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition disabled:opacity-50"><Eye className="w-4 h-4" />{loadingAksi==='preview'?'Memuat…':'Pratinjau PDF'}</button>
              <button onClick={handleUnduh} disabled={loadingAksi!==null} className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50"><FileText className="w-4 h-4" />{loadingAksi==='unduh'?'Membuat…':'Unduh PDF'}</button>
            </div>
            <p className="text-[10px] text-gray-400 text-center">Butuh: <code className="bg-gray-100 px-1 rounded">npm install jspdf jspdf-autotable</code></p>
          </div>
          {/* Pratinjau */}
          <div className="border border-gray-200 rounded-xl overflow-hidden flex flex-col bg-gray-50 min-h-[480px]">
            <div className="px-4 py-2.5 bg-gray-100 border-b text-[11px] font-bold text-gray-600 uppercase tracking-wider">Pratinjau PDF</div>
            {previewUrl?<iframe src={previewUrl} className="flex-1 w-full" title="Pratinjau" />:(
              <div className="flex-1 flex items-center justify-center text-center px-6">
                <div><FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-xs text-gray-400">Klik <strong>Pratinjau PDF</strong> untuk melihat hasil sebelum diunduh.</p><p className="text-[10px] text-gray-400 mt-1">Layout: A4 potrait, diusahakan 1 halaman (bisa lanjut ke halaman berikutnya jika keterangan sangat banyak), tanggal berwarna, kotak agenda menyesuaikan panjang keterangan tiap bulan.</p></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ HALAMAN UTAMA ═══════════════

export default function KaldikPage() {
  const [userEmail,setUserEmail]=useState<string|null>(null)
  const [loading,setLoading]=useState(true)
  const [isMounted,setIsMounted]=useState(false)
  const [dataSiap,setDataSiap]=useState(false)
  const [namaSekolah,setNamaSekolah]=useState('')
  const [tahunAjaran,setTahunAjaran]=useState('')
  const [showCetakModal,setShowCetakModal]=useState(false)

  const presetColors=[
    {name:'Biru Navy',hex:'#1e3a8a'},{name:'Biru Royal',hex:'#1d4ed8'},{name:'Biru Standar',hex:'#2563eb'},{name:'Biru Terang',hex:'#3b82f6'},{name:'Biru Muda',hex:'#60a5fa'},
    {name:'Hijau Tua',hex:'#065f46'},{name:'Hijau Zamrud',hex:'#059669'},{name:'Hijau Segar',hex:'#10b981'},{name:'Hijau Muda',hex:'#34d399'},{name:'Hijau Pastel',hex:'#a7f3d0'},
    {name:'Ungu Gelap',hex:'#581c87'},{name:'Ungu Pekat',hex:'#6b21a8'},{name:'Ungu Standar',hex:'#7c3aed'},{name:'Ungu Terang',hex:'#8b5cf6'},{name:'Ungu Muda',hex:'#a78bfa'},
    {name:'Merah Marun',hex:'#991b1b'},{name:'Merah Cabai',hex:'#dc2626'},{name:'Oranye Tua',hex:'#c2410c'},{name:'Oranye Standar',hex:'#ea580c'},{name:'Oranye Muda',hex:'#f97316'},
    {name:'Emas Tua',hex:'#b45309'},{name:'Kuning Kunyit',hex:'#d97706'},{name:'Kuning Emas',hex:'#f59e0b'},{name:'Kuning Cerah',hex:'#fbbf24'},
    {name:'Pink Magenta',hex:'#be185d'},{name:'Pink Terang',hex:'#ec4899'},{name:'Tosca Tua',hex:'#115e59'},{name:'Tosca/Teal',hex:'#0d9488'},{name:'Tosca Muda',hex:'#14b8a6'},
    {name:'Abu Gelap',hex:'#4b5563'},{name:'Abu Sedang',hex:'#6b7280'},{name:'Abu Terang',hex:'#9ca3af'},
  ]

  const [daftarUnitLembaga,setDaftarUnitLembaga]=useState<{id:string;label:string}[]>([{id:'lembaga-induk',label:'Lembaga / Yayasan Pusat'}])
  const [unitMentahDasbor,setUnitMentahDasbor]=useState<{id:string;nama:string}[]>([])
  const [masterTingkatLokal,setMasterTingkatLokal]=useState<{id:string;nama:string}[]>([])
  const [masterRombelLokal,setMasterRombelLokal]=useState<{id:string;nama:string}[]>([])
  const [daftarKlasifikasiAgenda,setDaftarKlasifikasiAgenda]=useState([{id:'asesmen',label:'Asesmen / Evaluasi',hexColor:'#dc2626'},{id:'libur',label:'Tanggal Merah / Libur Khusus',hexColor:'#991b1b'},{id:'osis',label:'Kegiatan Siswa / OSIS',hexColor:'#2563eb'}])
  const [labelKlasifikasi,setLabelKlasifikasi]=useState('')
  const [warnaKlasifikasiHex,setWarnaKlasifikasiHex]=useState('#059669')
  const [idKlasifikasiSedangDiedit,setIdKlasifikasiSedangDiedit]=useState<string|null>(null)
  const [tanggal,setTanggal]=useState('')
  const [tanggalSelesai,setTanggalSelesai]=useState('')
  const [keterangan,setKeterangan]=useState('')
  const [statusHari,setStatusHari]=useState('libur')
  const [klasifikasiTerpilih,setKlasifikasiTerpilih]=useState('asesmen')
  const [lembagaTerlibat,setLembagaTerlibat]=useState<string[]>(['lembaga-induk'])
  const [tingkatTerlibat,setTingkatTerlibat]=useState<string[]>([])
  const [rombelTerlibat,setRombelTerlibat]=useState<string[]>([])
  const [daftarAgenda,setDaftarAgenda]=useState<AgendaItem[]>([])
  const [indexEdit,setIndexEdit]=useState<number|null>(null)
  const [pencarianAgenda,setPencarianAgenda]=useState('')
  const [kategoriAktifTampil,setKategoriAktifTampil]=useState('lembaga-induk')
  const [daftarNotifikasiAgenda,setDaftarNotifikasiAgenda]=useState<{id:string;date:string;desc:{keterangan:string;color:string}[]|string;label:string;status:string}[]>([])
  const [showSinkronModal,setShowSinkronModal]=useState(false)
  const [filterSinkronUnit,setFilterSinkronUnit]=useState('semua')
  const [filterSinkronKlasifikasi,setFilterSinkronKlasifikasi]=useState('semua')
  const [filterSinkronTglMulai,setFilterSinkronTglMulai]=useState('')
  const [filterSinkronTglSelesai,setFilterSinkronTglSelesai]=useState('')
  const [agendaTerpilihSinkron,setAgendaTerpilihSinkron]=useState<number[]>([])
  const [googleAccessToken,setGoogleAccessToken]=useState<string|null>(null)
  const [loadingHoliday,setLoadingHoliday]=useState(false)
  const [agendaImporGoogle,setAgendaImporGoogle]=useState<AgendaItem[]>([])
  const [showModalImport,setShowModalImport]=useState(false)
  const [agendaTerpilihImport,setAgendaTerpilihImport]=useState<number[]>([])
  const router=useRouter()

  const bulanAkademik=(()=>{
    const {tahunAwal,tahunAkhir}=parseTahunAjaran(tahunAjaran)
    return NAMA_BULAN_URUT.map((nb,idx)=>{
      const tbi=idx<=5?tahunAwal:tahunAkhir
      const mn=MONTH_NUMBER_MAP[nb]
      return {nama:`${nb} ${tbi}`,jumlahHari:getJumlahHariBulan(mn,tbi),mulaiHari:getMulaiHariBulan(mn,tbi),tahunBulanIni:tbi,monthNumber:mn,blnIndex:idx}
    })
  })()

  useEffect(()=>{
    setIsMounted(true)
    async function checkUser(){
      const {data:{session}}=await supabase.auth.getSession()
      if(!session){router.push('/');return}
      setUserEmail(session.user.email||'Admin')
      setNamaSekolah(localStorage.getItem('nama_sekolah')||'Lembaga / Yayasan Pusat')
      setTahunAjaran(localStorage.getItem('tahun_ajaran')||'2026/2027')
      const base=[{id:'lembaga-induk',label:'Lembaga / Yayasan Pusat'}]
      const sl=localStorage.getItem('daftar_lembaga')
      if(sl){const p=JSON.parse(sl);setUnitMentahDasbor(p);setDaftarUnitLembaga([...base,...p.map((u:{id:string;nama:string})=>({id:u.id,label:u.nama}))])}
      const st=localStorage.getItem('master_tingkat');if(st) setMasterTingkatLokal(JSON.parse(st))
      const sr=localStorage.getItem('master_rombel');if(sr) setMasterRombelLokal(JSON.parse(sr))
      const sk=localStorage.getItem('kaldik_klasifikasi_list');if(sk){try{setDaftarKlasifikasiAgenda(JSON.parse(sk))}catch{}}
      const sa=localStorage.getItem('kaldik_agenda_list');if(sa){try{setDaftarAgenda(JSON.parse(sa))}catch{}}
      setLoading(false);setDataSiap(true)
    }
    checkUser()
  },[router])

  useEffect(()=>{
    if(!dataSiap) return
    if(daftarAgenda.length>0) localStorage.setItem('kaldik_agenda_list',JSON.stringify(daftarAgenda))
    else localStorage.removeItem('kaldik_agenda_list')
  },[daftarAgenda,dataSiap])

  useEffect(()=>{
    if(!dataSiap) return
    localStorage.setItem('kaldik_klasifikasi_list',JSON.stringify(daftarKlasifikasiAgenda))
  },[daftarKlasifikasiAgenda,dataSiap])

  const loginGoogle=useGoogleLogin({
    client_id:process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
    scope:'https://www.googleapis.com/auth/calendar.readonly',
    onSuccess:async(t)=>{setGoogleAccessToken(t.access_token);await fetchHolidaysFromGoogle(t.access_token)},
    onError:()=>alert('Login Google gagal.'),
  })

  const fetchHolidaysFromGoogle=async(token:string)=>{
    setLoadingHoliday(true)
    try{
      const {tahunAwal,tahunAkhir}=parseTahunAjaran(tahunAjaran)
      const tmin=encodeURIComponent(`${tahunAwal}-07-01T00:00:00Z`),tmax=encodeURIComponent(`${tahunAkhir}-06-30T23:59:59Z`)
      const cid='id.indonesian%23holiday%40group.v.calendar.google.com'
      const res=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cid}/events?timeMin=${tmin}&timeMax=${tmax}&singleEvents=true&orderBy=startTime&maxResults=200`,{headers:{Authorization:`Bearer ${token}`}})
      const data=await res.json()
      if(data.error){alert('Gagal: '+data.error.message);return}
      const hasil=(data.items||[]).map((item:{summary:string;start:{date?:string;dateTime?:string};end:{date?:string;dateTime?:string}})=>{
        const tm=item.start.date||item.start.dateTime?.slice(0,10)
        const tr=item.end.date||item.end.dateTime?.slice(0,10)
        const ts=item.end.date?new Date(new Date(tr+'T00:00:00').getTime()-86400000).toISOString().slice(0,10):tr
        return {keterangan:item.summary,tanggal:tm,tanggalSelesai:ts,statusHari:'libur',kategoriKlasifikasi:'libur',lembagaTerlibat:['lembaga-induk'],tingkatTerlibat:[],rombelTerlibat:[],sumberGoogle:true}
      })
      setAgendaImporGoogle(hasil);setAgendaTerpilihImport(hasil.map((_:AgendaItem,i:number)=>i));setShowModalImport(true)
    }catch(e){alert('Kesalahan koneksi.');console.error(e)}
    finally{setLoadingHoliday(false)}
  }

  const handleImportAgendaGoogle=()=>{
    const dipilih=agendaImporGoogle.filter((_,i)=>agendaTerpilihImport.includes(i))
    const baru=dipilih.filter(item=>!daftarAgenda.some(e=>e.tanggal===item.tanggal&&e.keterangan===item.keterangan))
    setDaftarAgenda(prev=>{const next=[...prev,...baru];localStorage.setItem('kaldik_agenda_list',JSON.stringify(next));return next})
    setShowModalImport(false)
    const skip=dipilih.length-baru.length
    alert(skip>0?`${baru.length} diimpor, ${skip} dilewati.`:`${baru.length} agenda diimpor!`)
  }

  const handleTambahKlasifikasi=(e:React.FormEvent)=>{
    e.preventDefault();if(!labelKlasifikasi) return
    if(idKlasifikasiSedangDiedit){setDaftarKlasifikasiAgenda(p=>p.map(it=>it.id===idKlasifikasiSedangDiedit?{...it,label:labelKlasifikasi,hexColor:warnaKlasifikasiHex}:it));setIdKlasifikasiSedangDiedit(null);setLabelKlasifikasi('');alert('Klasifikasi diperbarui!');return}
    const id=labelKlasifikasi.toLowerCase().replace(/\s+/g,'-')
    setDaftarKlasifikasiAgenda(p=>[...p,{id,label:labelKlasifikasi,hexColor:warnaKlasifikasiHex}]);setLabelKlasifikasi('');setKlasifikasiTerpilih(id)
  }
  const handleEditKla=(it:{id:string;label:string;hexColor:string})=>{setIdKlasifikasiSedangDiedit(it.id);setLabelKlasifikasi(it.label);setWarnaKlasifikasiHex(it.hexColor)}
  const handleBatalEditKla=()=>{setIdKlasifikasiSedangDiedit(null);setLabelKlasifikasi('');setWarnaKlasifikasiHex('#059669')}
  const handleHapusKla=(id:string)=>{
    const jml=daftarAgenda.filter(it=>it.kategoriKlasifikasi===id).length
    const lbl=daftarKlasifikasiAgenda.find(it=>it.id===id)?.label||''
    if(jml>0&&!window.confirm(`"${lbl}" dipakai ${jml} agenda. Lanjutkan?`)) return
    const filtered=daftarKlasifikasiAgenda.filter(it=>it.id!==id)
    setDaftarKlasifikasiAgenda(filtered)
    if(klasifikasiTerpilih===id&&filtered.length>0) setKlasifikasiTerpilih(filtered[0].id)
    if(idKlasifikasiSedangDiedit===id) handleBatalEditKla()
  }
  const handleToggleLembaga=(id:string)=>{
    if(id==='lembaga-induk'){setLembagaTerlibat(lembagaTerlibat.includes('lembaga-induk')?[]:['lembaga-induk',...unitMentahDasbor.map(u=>u.id)]);return}
    setLembagaTerlibat(lembagaTerlibat.includes(id)?lembagaTerlibat.filter(x=>x!==id):[...lembagaTerlibat,id])
  }
  const toggleArr=(arr:string[],setArr:(v:string[])=>void,id:string)=>setArr(arr.includes(id)?arr.filter(x=>x!==id):[...arr,id])

  const handleSimpanAgenda=(e:React.FormEvent)=>{
    e.preventDefault()
    if(!lembagaTerlibat.length){alert('Pilih minimal satu lembaga.');return}
    if(!klasifikasiTerpilih){alert('Pilih klasifikasi.');return}
    let fl=[...lembagaTerlibat]
    if(fl.length===1&&fl[0]==='lembaga-induk') fl=Array.from(new Set(['lembaga-induk',...unitMentahDasbor.map(u=>u.id)]))
    const na:AgendaItem={tanggal,tanggalSelesai:tanggalSelesai||tanggal,keterangan,lembagaTerlibat:fl,tingkatTerlibat,rombelTerlibat,statusHari,kategoriKlasifikasi:klasifikasiTerpilih}
    let next:AgendaItem[]
    if(indexEdit!==null){next=[...daftarAgenda];next[indexEdit]=na;setDaftarAgenda(next);setIndexEdit(null);alert('Agenda diperbarui!')}
    else{next=[...daftarAgenda,na];setDaftarAgenda(next);alert('Agenda disimpan!')}
    localStorage.setItem('kaldik_agenda_list',JSON.stringify(next))
    setTanggal('');setTanggalSelesai('');setKeterangan('');setLembagaTerlibat(['lembaga-induk']);setTingkatTerlibat([]);setRombelTerlibat([])
  }
  const handleEditAgendaClick=(idx:number)=>{
    const it=daftarAgenda[idx]
    setTanggal(it.tanggal);setTanggalSelesai(it.tanggalSelesai||it.tanggal);setKeterangan(it.keterangan)
    setStatusHari(it.statusHari);setLembagaTerlibat(it.lembagaTerlibat||['lembaga-induk'])
    setTingkatTerlibat(it.tingkatTerlibat||[]);setRombelTerlibat(it.rombelTerlibat||[])
    setKlasifikasiTerpilih(it.kategoriKlasifikasi);setIndexEdit(idx)
    window.scrollTo({top:300,behavior:'smooth'})
  }
  const handleBatalEdit=()=>{setIndexEdit(null);setTanggal('');setTanggalSelesai('');setKeterangan('');setStatusHari('libur');setLembagaTerlibat(['lembaga-induk']);setTingkatTerlibat([]);setRombelTerlibat([])}
  const handleHapusAgenda=(idx:number)=>{const next=daftarAgenda.filter((_,i)=>i!==idx);setDaftarAgenda(next);localStorage.setItem('kaldik_agenda_list',JSON.stringify(next))}

  const getUnitLabel=(id:string)=>daftarUnitLembaga.find(u=>u.id===id)||{label:'Lainnya'}
  // Daftar agenda diurutkan berdasarkan TANGGAL (bukan urutan input) supaya mudah
  // dicari; index asli tetap disimpan agar tombol edit/hapus tetap merujuk ke
  // entri yang benar di daftarAgenda. Juga difilter oleh kotak pencarian.
  const daftarAgendaUrut = daftarAgenda
    .map((it,i)=>({it,i}))
    .sort((a,b)=> a.it.tanggal.localeCompare(b.it.tanggal) || (a.it.tanggalSelesai||a.it.tanggal).localeCompare(b.it.tanggalSelesai||b.it.tanggal))
    .filter(({it})=>{
      const q=pencarianAgenda.trim().toLowerCase()
      if(!q) return true
      return it.keterangan.toLowerCase().includes(q) || it.tanggal.includes(q) || (it.tanggalSelesai||'').includes(q)
    })
  const getKlaStyle=(id:string)=>daftarKlasifikasiAgenda.find(k=>k.id===id)||{hexColor:'#4b5563',label:'Agenda Umum'}
  const unitSedangTampil=daftarUnitLembaga.find(u=>u.id===kategoriAktifTampil)||daftarUnitLembaga[0]

  const cariAgendaTanggal=(day:number,monthName:string,unitId:string)=>{
    const [bl,yl]=monthName.split(' ');const bs=MONTH_PAD_MAP[bl]||'01'
    const fd=`${yl}-${bs}-${String(day).padStart(2,'0')}`
    return daftarAgenda.filter(item=>{const ts=item.tanggalSelesai||item.tanggal;return fd>=item.tanggal&&fd<=ts&&item.lembagaTerlibat?.includes(unitId)})
      .map(item=>{const kla=daftarKlasifikasiAgenda.find(k=>k.id===item.kategoriKlasifikasi);return{keterangan:item.keterangan,kegiatanColor:kla?.hexColor||'#2563eb',tglMulaiAsli:item.tanggal,tglSelesaiAsli:item.tanggalSelesai||item.tanggal}})
  }
  // (fmtDL/getRentang lama punya bug `.split('')` — memecah string jadi per-karakter,
  // bukan per bagian tanggal — sehingga rentang tanggal salah tampil. Diganti pakai
  // util bersama yang sudah benar & sekaligus singkat sesuai format cetak.)
  const getRentang=(it:{tglMulaiAsli:string;tglSelesaiAsli:string})=>`${formatRentangSingkat(it.tglMulaiAsli,it.tglSelesaiAsli)} :`
  const kumpulkanAgendaBulan=(mn:string,uid:string)=>{
    const list:{label:string;ket:string}[]=[]
    const b=bulanAkademik.find(b=>b.nama===mn);if(!b) return []
    for(let d=1;d<=b.jumlahHari;d++) cariAgendaTanggal(d,mn,uid).forEach(m=>{const lbl=getRentang(m);if(!list.some(x=>x.label===lbl&&x.ket===m.keterangan)) list.push({label:lbl,ket:m.keterangan})})
    return list
  }
  const handleClickDateLocal=(day:number,monthName:string,unitId:string)=>{
    const fd=tanggalDariNamaBulan(monthName,day)
    // Kalau tanggal ini sudah punya agenda untuk unit yang sedang ditampilkan,
    // langsung buka form dalam mode EDIT untuk agenda tsb. Kalau belum ada,
    // buka form kosong dengan tanggal sudah terisi, siap untuk agenda baru.
    const idxCocok=daftarAgenda.findIndex(it=>{
      const ts=it.tanggalSelesai||it.tanggal
      return fd>=it.tanggal&&fd<=ts&&it.lembagaTerlibat?.includes(unitId)
    })
    if(idxCocok>=0) {
      handleEditAgendaClick(idxCocok)
    } else {
      handleBatalEdit()
      setTanggal(fd);setTanggalSelesai(fd)
      window.scrollTo({top:300,behavior:'smooth'})
    }
    // Tetap catat di riwayat klik tanggal sebagai referensi cepat.
    const ag=cariAgendaTanggal(day,monthName,unitId)
    setDaftarNotifikasiAgenda(prev=>[{id:Date.now().toString(),date:`${day} ${monthName}`,label:getUnitLabel(unitId).label,status:ag.length>0?'event':'efektif',
      desc:ag.length>0?ag.map(a=>({keterangan:a.keterangan,color:a.kegiatanColor})):'Tidak ada agenda / KBM berjalan normal.'},...prev])
  }
  const renderKotakHariLokal=(jml:number,mulai:number,nb:string,uid:string,mn:number,tbi:number)=>{
    if(!isMounted) return Array.from({length:42}).map((_,i)=><div key={i} className="h-12 w-12 bg-gray-50/40 rounded-lg animate-pulse border border-gray-100"/>)
    const pm=mn===1?12:mn-1,py=mn===1?tbi-1:tbi,pt=getJumlahHariBulan(pm,py)
    const cells=[]
    for(let p=pt-mulai+1;p<=pt;p++) cells.push(<div key={`p${p}`} className="h-12 w-12 flex flex-col items-center justify-start border border-gray-100 rounded-lg text-[9px] pt-1.5 bg-gray-50/20 opacity-40 cursor-not-allowed"><span className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 font-bold">{p}</span></div>)
    for(let day=1;day<=jml;day++){
      const ag=cariAgendaTanggal(day,nb,uid);const ada=ag.length>0
      const isAhad=new Date(tbi,mn-1,day).getDay()===0
      cells.push(<div key={`d${day}`} onClick={()=>handleClickDateLocal(day,nb,uid)} title={ada?ag.map(a=>a.keterangan).join(', '):'KBM Normal'} className="h-12 w-12 flex flex-col items-center justify-start border border-gray-100 rounded-lg text-[9px] cursor-pointer relative pt-1.5 pb-0.5 bg-white hover:bg-[#F5EDF7]/40 transition-colors">
        <span className="w-5 h-5 flex items-center justify-center rounded-full shrink-0 shadow-sm font-bold" style={{backgroundColor:ada?ag[0].kegiatanColor:(isAhad?'#dc2626':'#f9fafb'),color:(ada||isAhad)?'#fff':'#1f2937',border:(ada||isAhad)?'none':'1px solid #e5e7eb'}}>{day}</span>
        {ada&&<div className="w-full flex items-end justify-center pb-0.5 gap-0.5 overflow-hidden flex-1">{ag.map((a,i)=><span key={i} className="w-4/12 h-2 rounded-[3px] text-[5px] font-extrabold text-white flex items-center justify-center" style={{backgroundColor:a.kegiatanColor}}>{i+1}</span>)}</div>}
      </div>)
    }
    let nd=1;while(cells.length<42){cells.push(<div key={`n${nd}`} className="h-12 w-12 flex flex-col items-center justify-start border border-gray-100 rounded-lg text-[9px] pt-1.5 bg-gray-50/20 opacity-40 cursor-not-allowed"><span className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 font-bold">{nd}</span></div>);nd++}
    return cells
  }

  const fmtGcal=(d:string)=>d.replace(/-/g,'')
  const addDay=(d:string)=>{const dt=new Date(d+'T00:00:00');dt.setDate(dt.getDate()+1);return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`}
  const buatLinkGcal=(item:AgendaItem)=>{
    const kla=getKlaStyle(item.kategoriKlasifikasi);const units=(item.lembagaTerlibat||[]).map(id=>getUnitLabel(id).label).join(', ')
    const detail=[`Klasifikasi: ${kla.label}`,`Status: ${item.statusHari==='libur'?'Libur':'Efektif'}`,`Unit: ${units}`,`TA: ${tahunAjaran}`].join('\n')
    const p=new URLSearchParams({action:'TEMPLATE',text:item.keterangan,dates:`${fmtGcal(item.tanggal)}/${addDay(item.tanggalSelesai||item.tanggal)}`,details:detail})
    return `https://calendar.google.com/calendar/render?${p.toString()}`
  }
  const agendaLolosFilter=(it:AgendaItem)=>{
    if(filterSinkronUnit!=='semua'&&!it.lembagaTerlibat?.includes(filterSinkronUnit)) return false
    if(filterSinkronKlasifikasi!=='semua'&&it.kategoriKlasifikasi!==filterSinkronKlasifikasi) return false
    if(filterSinkronTglMulai&&it.tanggal<filterSinkronTglMulai) return false
    if(filterSinkronTglSelesai&&(it.tanggalSelesai||it.tanggal)>filterSinkronTglSelesai) return false
    return true
  }
  const agendaFilterSinkron=daftarAgenda.map((item,i)=>({item,i})).filter(({item})=>agendaLolosFilter(item))
  const handleBukaModalSinkron=()=>{setAgendaTerpilihSinkron(agendaFilterSinkron.map(({i})=>i));setShowSinkronModal(true)}
  useEffect(()=>{if(showSinkronModal) setAgendaTerpilihSinkron(daftarAgenda.map((it,i)=>({it,i})).filter(({it})=>agendaLolosFilter(it)).map(({i})=>i))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[filterSinkronUnit,filterSinkronKlasifikasi,filterSinkronTglMulai,filterSinkronTglSelesai,showSinkronModal])
  const handleSinkron=()=>{
    if(!agendaTerpilihSinkron.length){alert('Pilih minimal satu agenda.');return}
    daftarAgenda.filter((_,i)=>agendaTerpilihSinkron.includes(i)).forEach((it,i)=>setTimeout(()=>window.open(buatLinkGcal(it),'_blank'),i*350))
    alert(`${agendaTerpilihSinkron.length} agenda dibuka di tab baru.`);setShowSinkronModal(false)
  }

  if(loading) return <main className="p-8 text-center text-gray-600">Memuat Kalender Pendidikan...</main>

  return (
    <div className="flex min-h-screen bg-gray-50" style={{fontFamily:"'Open Sans', sans-serif"}}>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Open+Sans:wght@400;500;600&display=swap');
        /* Font Tipis (reguler/label biasa) — Open Sans */
        body { font-family: 'Open Sans', sans-serif; }
        /* Font Tebal — Baloo 2, otomatis dipakai di elemen yang memakai kelas
           bold Tailwind (font-bold / font-extrabold / font-semibold) supaya
           tidak perlu mengubah setiap elemen satu per satu. */
        .font-bold, .font-extrabold, .font-semibold,
        h1, h2, h3, h4, h5, h6 { font-family: 'Baloo 2', sans-serif; }
      `}</style>
      <aside className="w-64 bg-white border-r border-gray-200 flex-col justify-between hidden md:flex">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-gray-200"><h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Navigasi Utama</h2></div>
          <nav className="p-4 space-y-1">
            <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-50"><Home className="w-4 h-4"/> Beranda Dasbor</a>
            <a href="/kaldik" className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg"><CalendarDays className="w-4 h-4"/> Kalender Pendidikan</a>
          </nav>
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-500 mb-1">Tahun Ajaran:</p><p className="text-sm font-extrabold text-[#3D0F49] mb-2">{tahunAjaran}</p>
          <p className="text-xs text-gray-500 mb-1">Masuk sebagai:</p><p className="text-sm font-semibold text-gray-800 truncate">{userEmail}</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="bg-white shadow-sm border-b p-4 flex justify-between items-center px-8">
          <div className="flex items-center gap-4">
            <button onClick={()=>router.push('/dashboard')} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5 text-gray-600"/></button>
            <h1 className="text-xl font-bold text-gray-800">Manajemen Kalender Pendidikan</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setShowCetakModal(true)} className="flex items-center gap-2 bg-[#F5EDF7] border border-[#D9BFE0] text-[#551566] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#EDE0F0]"><Printer className="w-4 h-4"/> Cetak Kaldik</button>
            <button onClick={()=>googleAccessToken?fetchHolidaysFromGoogle(googleAccessToken):loginGoogle()} disabled={loadingHoliday} className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-100 disabled:opacity-50">
              <Download className={`w-4 h-4 ${loadingHoliday?'animate-bounce':''}`}/>{loadingHoliday?'Mengambil…':googleAccessToken?'Refresh Hari Libur':'Impor Hari Libur Google'}
            </button>
            <button onClick={handleBukaModalSinkron} className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-100"><RefreshCw className="w-4 h-4"/> Ekspor ke Google Calendar</button>
          </div>
        </header>

        <section className="p-8 max-w-6xl mx-auto w-full space-y-8">
          {/* Klasifikasi */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="md:col-span-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3"><Tag className="w-5 h-5 text-[#6A197D]"/><h2 className="text-base font-bold text-gray-800">{idKlasifikasiSedangDiedit?'Ubah Klasifikasi':'Manajemen Klasifikasi Agenda'}</h2></div>
                {idKlasifikasiSedangDiedit&&<span className="bg-[#FFF9E0] border border-[#FFE480] text-[#8A6D00] text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">MODE EDIT <button onClick={handleBatalEditKla}><X className="w-3.5 h-3.5"/></button></span>}
              </div>
              <p className="text-xs text-gray-500 mb-4">Tipe kegiatan + warna badge. Warna ini juga dipakai untuk mewarnai tanggal di PDF.</p>
              <form onSubmit={handleTambahKlasifikasi} className="space-y-4">
                <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Label Tipe Agenda</label>
                  <input type="text" value={labelKlasifikasi} onChange={e=>setLabelKlasifikasi(e.target.value)} placeholder="Contoh: Ujian Akhir Semester" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0"/></div>
                <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Warna Badge &amp; Tanggal PDF</label>
                  <div className="grid grid-cols-10 gap-1 bg-gray-50 p-2.5 rounded-lg border border-gray-100 max-h-56 overflow-y-auto">
                    {presetColors.map((c,i)=><button type="button" key={i} onClick={()=>setWarnaKlasifikasiHex(c.hex)} title={c.name} className={`w-7 h-7 rounded-md flex items-center justify-center border-2 transition ${warnaKlasifikasiHex===c.hex?'border-[#6A197D] scale-110 shadow-md':'border-transparent hover:scale-105'}`} style={{backgroundColor:c.hex}}>{warnaKlasifikasiHex===c.hex&&<span className="text-white text-[8px] font-extrabold">✔</span>}</button>)}
                  </div>
                  <div className="flex items-center gap-2 mt-2 bg-[#F5EDF7]/50 border border-[#EDE0F0] p-2 rounded-lg text-[11px] text-[#551566]">
                    <span className="w-3 h-3 rounded-full" style={{backgroundColor:warnaKlasifikasiHex}}/>Terpilih: <span className="font-bold">{presetColors.find(c=>c.hex===warnaKlasifikasiHex)?.name||'Custom'}</span>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  {idKlasifikasiSedangDiedit&&<button type="button" onClick={handleBatalEditKla} className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50">Batal</button>}
                  <button type="submit" className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold ${idKlasifikasiSedangDiedit?'bg-[#FFDE59] hover:bg-[#F5C518] text-[#3D0F49]':'bg-[#6A197D] hover:bg-[#551566] text-white'}`}>
                    {idKlasifikasiSedangDiedit?<><Check className="w-4 h-4"/> Perbarui</>:<>+ Tambah Klasifikasi</>}
                  </button>
                </div>
              </form>
            </div>
            <div className="border-l pl-4 border-gray-100 col-span-2 space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Klasifikasi Tersedia</h3>
              <ul className="space-y-2 max-h-56 overflow-y-auto">
                {daftarKlasifikasiAgenda.map(it=>(
                  <li key={it.id} className={`flex justify-between items-center bg-gray-50 border p-2 rounded-lg text-xs ${idKlasifikasiSedangDiedit===it.id?'border-[#FFDE59] ring-1 ring-[#FFE480]':'border-gray-100'}`}>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{backgroundColor:it.hexColor}}/><span className="font-semibold text-gray-700">{it.label}</span></div>
                    <div className="flex items-center gap-1">
                      <button onClick={()=>handleEditKla(it)} className="p-1 text-[#6A197D] hover:bg-[#F5EDF7] rounded"><Edit2 className="w-3.5 h-3.5"/></button>
                      <button onClick={()=>handleHapusKla(it.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5"/></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Form Agenda + Daftar */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
            <div className="md:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative">
              {indexEdit!==null&&<div className="absolute top-4 right-4 bg-[#FFF9E0] border border-[#FFE480] text-[#8A6D00] text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">MODE EDIT <button onClick={handleBatalEdit}><X className="w-3.5 h-3.5"/></button></div>}
              <div className="flex items-center gap-3 mb-2"><Calendar className="w-5 h-5 text-[#6A197D]"/><h2 className="text-base font-bold text-gray-800">{indexEdit!==null?'Ubah Agenda':'Tambah Agenda / Kegiatan'}</h2></div>
              <p className="text-xs text-gray-500 mb-4">Input kegiatan dan pilih cakupan unit lembaga.</p>
              <form onSubmit={handleSimpanAgenda} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Tanggal Mulai</label><input type="date" value={tanggal} onChange={e=>setTanggal(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0"/></div>
                  <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Tanggal Selesai</label><input type="date" value={tanggalSelesai} onChange={e=>setTanggalSelesai(e.target.value)} min={tanggal} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0"/><p className="text-[8px] text-gray-400 mt-0.5">Kosong = 1 hari</p></div>
                </div>
                <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Keterangan</label><input type="text" value={keterangan} onChange={e=>setKeterangan(e.target.value)} placeholder="Contoh: Asesmen Tengah Semester" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0"/></div>
                <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Klasifikasi</label>
                  <select value={klasifikasiTerpilih} onChange={e=>setKlasifikasiTerpilih(e.target.value)} disabled={!daftarKlasifikasiAgenda.length} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0 disabled:bg-gray-100">
                    {!daftarKlasifikasiAgenda.length?<option>Belum ada</option>:daftarKlasifikasiAgenda.map(k=><option key={k.id} value={k.id}>{k.label}</option>)}
                  </select></div>
                <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Unit Cakupan</label>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2 max-h-36 overflow-y-auto">
                    {daftarUnitLembaga.map(u=><div key={u.id} className="flex items-center gap-2.5"><input type="checkbox" id={`cb-${u.id}`} checked={lembagaTerlibat.includes(u.id)} onChange={()=>handleToggleLembaga(u.id)} className="w-4 h-4 text-[#6A197D] rounded border-gray-300"/><label htmlFor={`cb-${u.id}`} className="text-xs font-semibold text-gray-700">{u.label}</label></div>)}
                  </div></div>
                {masterTingkatLokal.length>0&&<div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Tingkat (Opsional)</label><div className="p-3 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-2 gap-2 max-h-28 overflow-y-auto">{masterTingkatLokal.map(l=><div key={l.id} className="flex items-center gap-2"><input type="checkbox" checked={tingkatTerlibat.includes(l.id)} onChange={()=>toggleArr(tingkatTerlibat,setTingkatTerlibat,l.id)} className="w-3.5 h-3.5 text-[#6A197D] rounded border-gray-300"/><label className="text-[11px] font-bold text-gray-600">{l.nama}</label></div>)}</div></div>}
                {masterRombelLokal.length>0&&<div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Rombel (Opsional)</label><div className="p-3 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">{masterRombelLokal.map(r=><div key={r.id} className="flex items-center gap-1.5"><input type="checkbox" checked={rombelTerlibat.includes(r.id)} onChange={()=>toggleArr(rombelTerlibat,setRombelTerlibat,r.id)} className="w-3 h-3 text-[#6A197D] rounded border-gray-300"/><label className="text-[10px] font-bold text-gray-600">{r.nama}</label></div>)}</div></div>}
                <div><label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Status Hari</label>
                  <select value={statusHari} onChange={e=>setStatusHari(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0">
                    <option value="libur">Hari Libur Khusus</option><option value="efektif">Hari Efektif KBM</option>
                  </select></div>
                <div className="flex gap-2.5 mt-2">
                  {indexEdit!==null&&<button type="button" onClick={handleBatalEdit} className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50">Batal</button>}
                  <button type="submit" className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold ${indexEdit!==null?'bg-[#FFDE59] hover:bg-[#F5C518] text-[#3D0F49]':'bg-[#6A197D] hover:bg-[#551566] text-white'}`}>
                    {indexEdit!==null?<><Check className="w-4 h-4"/> Perbarui</>:<><Plus className="w-4 h-4"/> Simpan Agenda</>}
                  </button>
                </div>
              </form>
            </div>
            <div className="md:col-span-3 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-base font-bold text-gray-800">Daftar Agenda Tersimpan ({daftarAgenda.length})</h2>
                {pencarianAgenda&&<span className="text-[10px] font-semibold text-[#6A197D] shrink-0">{daftarAgendaUrut.length} hasil</span>}
              </div>
              <div className="relative mb-3">
                <input type="text" value={pencarianAgenda} onChange={e=>setPencarianAgenda(e.target.value)} placeholder="Cari agenda (keterangan atau tanggal yyyy-mm-dd)..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#F5EDF7]0"/>
              </div>
              <div className="overflow-y-auto max-h-[560px]">
                {daftarAgendaUrut.length===0?<p className="text-sm text-gray-400 text-center py-12">{pencarianAgenda?'Tidak ada agenda yang cocok dengan pencarian.':'Belum ada agenda.'}</p>:(
                  <ul className="divide-y divide-gray-100">
                    {daftarAgendaUrut.map(({it,i})=>(
                      <li key={i} className="py-3 flex justify-between items-center">
                        <div className="flex-1 pr-4">
                          <p className="text-sm font-bold text-gray-800 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor:getKlaStyle(it.kategoriKlasifikasi).hexColor}}/>{it.keterangan}{it.sumberGoogle&&<span className="text-[8px] px-1.5 py-0.5 rounded font-bold bg-blue-50 text-blue-600 border border-blue-100">Google</span>}</p>
                          <p className="text-[10px] font-semibold text-[#6A197D] mt-0.5 ml-4">{formatRentangSingkat(it.tanggal,it.tanggalSelesai)}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1 ml-4">
                            {it.lembagaTerlibat.map(id=><span key={id} className="text-[8px] px-1.5 py-0.5 rounded font-bold border border-gray-200 text-white" style={{backgroundColor:'#4b5563'}}>{getUnitLabel(id).label.toUpperCase()}</span>)}
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold border ${it.statusHari==='libur'?'bg-red-50 text-red-600 border-red-100':'bg-green-50 text-green-600 border-green-100'}`}>{it.statusHari.toUpperCase()}</span>
                            <span className="text-[8px] px-1.5 py-0.5 rounded font-bold text-white" style={{backgroundColor:getKlaStyle(it.kategoriKlasifikasi).hexColor}}>{getKlaStyle(it.kategoriKlasifikasi).label.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 border-l pl-2 border-gray-100">
                          <button onClick={()=>handleEditAgendaClick(i)} className="p-1.5 text-[#6A197D] hover:bg-[#F5EDF7] rounded-lg border border-[#EDE0F0]"><Edit2 className="w-4 h-4"/></button>
                          <button onClick={()=>handleHapusAgenda(i)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-gray-100 pt-4 mt-4"><p className="text-xs text-gray-400">Tersimpan otomatis di perangkat ini.</p></div>
            </div>
          </div>

          {/* Visualisasi Kalender */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6">
            <div><h2 className="text-base font-bold text-gray-800">Visualisasi Kalender Akademik</h2><p className="text-xs text-gray-500 mt-1">Klik unit untuk melihat kalender, klik tanggal untuk detail agenda.</p></div>
            <div className="flex flex-wrap gap-2.5 p-1 bg-gray-100 rounded-lg border border-gray-200">
              {daftarUnitLembaga.map(u=><button key={u.id} onClick={()=>setKategoriAktifTampil(u.id)} className={`px-4 py-2 rounded-md text-xs font-bold transition ${kategoriAktifTampil===u.id?'bg-white shadow-sm text-[#3D0F49] border border-gray-200/60':'text-gray-600 hover:bg-gray-50'}`}>{u.label}</button>)}
            </div>
            <div className="border border-gray-200 bg-white p-5 rounded-xl shadow-sm">
              <div className="flex justify-between items-center border-b pb-4 mb-5">
                <div><h3 className="text-sm font-extrabold text-gray-800">{unitSedangTampil.label}</h3><p className="text-[11px] text-gray-500 mt-1">Tahun Ajaran: <span className="font-bold text-[#6A197D]">{tahunAjaran}</span></p></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {bulanAkademik.map((b,idx)=>{
                  const ag=kumpulkanAgendaBulan(b.nama,unitSedangTampil.id)
                  return (
                    <div key={idx} className="border border-gray-100 p-4 rounded-lg bg-gray-50/30 flex flex-col min-h-[420px]">
                      <div>
                        <h4 className="text-xs font-bold text-[#3D0F49] text-center mb-3">{b.nama}</h4>
                        <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-gray-400 mb-2">{HARI_SINGKAT.map(h=><div key={h}>{h}</div>)}</div>
                        <div className="grid grid-cols-7 gap-1 justify-items-center mb-4">{renderKotakHariLokal(b.jumlahHari,b.mulaiHari,b.nama,unitSedangTampil.id,b.monthNumber,b.tahunBulanIni)}</div>
                      </div>
                      {ag.length>0&&<div className="border-t border-[#EDE0F0] pt-3 mt-2 space-y-1 max-h-[140px] overflow-y-auto pr-1 flex-1">
                        {ag.map((it,i)=><div key={i} className="text-[8px] leading-tight py-0.5"><span className="font-bold text-[#551566]">{it.label}</span> <span className="text-gray-600 font-medium break-words">{it.ket}</span></div>)}
                      </div>}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-8 border-t border-gray-100 pt-6">
              <h4 className="text-xs font-bold text-[#3D0F49] uppercase tracking-wider mb-4">Riwayat Klik Tanggal</h4>
              {daftarNotifikasiAgenda.length===0?<div className="p-6 text-center text-xs text-gray-400 border border-dashed rounded-lg bg-gray-50">Belum ada tanggal yang diklik.</div>:(
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {daftarNotifikasiAgenda.map(n=>(
                    <div key={n.id} className="flex items-center gap-4 p-4 border border-[#F5EDF7] bg-[#F5EDF7]/30 rounded-xl shadow-sm">
                      <div className="w-12 h-12 rounded-xl text-white font-extrabold text-xs flex items-center justify-center shrink-0 bg-[#3D0F49]">{n.date.split(' ')[0]}</div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between"><span className="text-[8px] px-2 py-0.5 rounded-full font-bold bg-[#F5EDF7] text-[#551566] border border-[#EDE0F0]">{n.label.toUpperCase()}</span><button onClick={()=>setDaftarNotifikasiAgenda(p=>p.filter(x=>x.id!==n.id))} className="text-gray-400 hover:text-red-600 text-[10px]">✕</button></div>
                        <p className="text-[11px] font-bold text-gray-800 mt-1">{n.date}</p>
                        <div className="mt-1.5 space-y-1">{Array.isArray(n.desc)?n.desc.map((k,i)=><div key={i} className="text-xs text-gray-600 p-1.5 rounded border flex items-center gap-2" style={{borderColor:k.color}}><span className="w-2 h-2 rounded-full" style={{backgroundColor:k.color}}/>{k.keterangan}</div>):<p className="text-xs text-gray-600">{n.desc}</p>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {showCetakModal&&<CetakKaldikModal onClose={()=>setShowCetakModal(false)} namaSekolah={namaSekolah} tahunAjaran={tahunAjaran} daftarAgenda={daftarAgenda} daftarUnitLembaga={daftarUnitLembaga} daftarKlasifikasiAgenda={daftarKlasifikasiAgenda} bulanAkademik={bulanAkademik}/>}

      {showModalImport&&(
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b"><div className="flex items-center gap-3"><Download className="w-5 h-5 text-green-600"/><div><h3 className="text-base font-bold text-gray-800">Impor Hari Libur Google</h3><p className="text-[11px] text-gray-500">{agendaImporGoogle.length} hari libur — TA {tahunAjaran}</p></div></div><button onClick={()=>setShowModalImport(false)} className="text-gray-400 hover:text-red-600"><X className="w-5 h-5"/></button></div>
            <div className="px-6 py-3 bg-green-50 border-b border-green-100"><p className="text-[11px] text-green-700">💡 Hari libur nasional & hari besar Indonesia. Data langsung tersimpan setelah diimpor.</p></div>
            <div className="px-6 py-3 bg-gray-50 border-b flex justify-between"><p className="text-xs font-semibold text-gray-500">{agendaTerpilihImport.length}/{agendaImporGoogle.length} terpilih</p><div className="flex gap-3"><button onClick={()=>setAgendaTerpilihImport(agendaImporGoogle.map((_,i)=>i))} className="text-xs font-bold text-green-600 hover:underline">Semua</button><span className="text-gray-300">|</span><button onClick={()=>setAgendaTerpilihImport([])} className="text-xs font-bold text-gray-500 hover:underline">Batal</button></div></div>
            <div className="flex-1 overflow-y-auto px-6 py-3"><ul className="divide-y divide-gray-100">{agendaImporGoogle.map((it,i)=><li key={i} className="py-3 flex items-center gap-3"><input type="checkbox" checked={agendaTerpilihImport.includes(i)} onChange={()=>setAgendaTerpilihImport(p=>p.includes(i)?p.filter(x=>x!==i):[...p,i])} className="w-4 h-4 text-green-600 rounded border-gray-300"/><div className="flex-1"><p className="text-sm font-bold text-gray-800">{it.keterangan}</p><p className="text-[10px] font-semibold text-green-600">{it.tanggal===it.tanggalSelesai?it.tanggal:`${it.tanggal} s/d ${it.tanggalSelesai}`}</p></div><span className="text-[8px] px-2 py-0.5 rounded-full font-bold bg-red-50 text-red-600 border border-red-100">LIBUR</span></li>)}</ul></div>
            <div className="px-6 py-4 border-t flex justify-end gap-2"><button onClick={()=>setShowModalImport(false)} className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50">Batal</button><button onClick={handleImportAgendaGoogle} disabled={!agendaTerpilihImport.length} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"><Download className="w-4 h-4"/> Impor {agendaTerpilihImport.length}</button></div>
          </div>
        </div>
      )}

      {showSinkronModal&&(
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b"><div className="flex items-center gap-3"><RefreshCw className="w-5 h-5 text-blue-600"/><h3 className="text-base font-bold text-gray-800">Ekspor ke Google Calendar</h3></div><button onClick={()=>setShowSinkronModal(false)} className="text-gray-400 hover:text-red-600"><X className="w-5 h-5"/></button></div>
            <div className="px-6 py-4 border-b bg-gray-50 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Unit</label><select value={filterSinkronUnit} onChange={e=>setFilterSinkronUnit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="semua">Semua</option>{daftarUnitLembaga.map(u=><option key={u.id} value={u.id}>{u.label}</option>)}</select></div>
                <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Klasifikasi</label><select value={filterSinkronKlasifikasi} onChange={e=>setFilterSinkronKlasifikasi(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="semua">Semua</option>{daftarKlasifikasiAgenda.map(k=><option key={k.id} value={k.id}>{k.label}</option>)}</select></div>
                <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Dari</label><input type="date" value={filterSinkronTglMulai} onChange={e=>setFilterSinkronTglMulai(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
                <div><label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Sampai</label><input type="date" value={filterSinkronTglSelesai} onChange={e=>setFilterSinkronTglSelesai(e.target.value)} min={filterSinkronTglMulai} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
              </div>
              <div className="flex justify-between items-center"><p className="text-[11px] text-gray-500">{agendaFilterSinkron.length} cocok · {agendaTerpilihSinkron.length} terpilih</p><div className="flex gap-2"><button onClick={()=>setAgendaTerpilihSinkron(agendaFilterSinkron.map(({i})=>i))} className="text-[11px] font-bold text-blue-600 hover:underline">Semua</button><span className="text-gray-300">|</span><button onClick={()=>setAgendaTerpilihSinkron([])} className="text-[11px] font-bold text-gray-500 hover:underline">Batal</button></div></div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3">{agendaFilterSinkron.length===0?<p className="text-sm text-gray-400 text-center py-12">Tidak ada agenda cocok.</p>:<ul className="divide-y divide-gray-100">{agendaFilterSinkron.map(({item,i})=><li key={i} className="py-3 flex items-start gap-3"><input type="checkbox" checked={agendaTerpilihSinkron.includes(i)} onChange={()=>setAgendaTerpilihSinkron(p=>p.includes(i)?p.filter(x=>x!==i):[...p,i])} className="w-4 h-4 mt-0.5 text-blue-600 rounded border-gray-300"/><div className="flex-1"><p className="text-sm font-bold text-gray-800 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:getKlaStyle(item.kategoriKlasifikasi).hexColor}}/>{item.keterangan}</p><p className="text-[10px] font-semibold text-blue-600 mt-0.5 ml-4">{item.tanggal===item.tanggalSelesai||!item.tanggalSelesai?item.tanggal:`${item.tanggal} s/d ${item.tanggalSelesai}`}</p></div></li>)}</ul>}</div>
            <div className="px-6 py-4 border-t flex justify-end gap-2.5"><button onClick={()=>setShowSinkronModal(false)} className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50">Batal</button><button onClick={handleSinkron} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"><RefreshCw className="w-4 h-4"/> Ekspor {agendaTerpilihSinkron.length>0?`(${agendaTerpilihSinkron.length})`:''}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}