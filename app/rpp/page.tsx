'use client'

import Sidebar from '@/components/Sidebar'
import { useEffect, useState, useMemo } from 'react'
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

// Ubah teks jadi format nama file yang aman & konsisten: huruf kecil, spasi/simbol -> tanda hubung.
function slugifyNamaFile(...bagian: (string | undefined | null)[]): string {
  return bagian
    .filter(Boolean)
    .map(s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
}

const FASE_OPTIONS_RPPM = ['A', 'B', 'C', 'D', 'E', 'F']
function faseUntukUnitRppm(namaUnit: string): string[] {
  const n = (namaUnit || '').toUpperCase()
  if (/\bSD\b|\bMI\b/.test(n)) return ['A', 'B', 'C']
  if (/\bSMP\b|\bMTS\b/.test(n)) return ['D']
  if (/\bSMA\b|\bSMK\b|\bMA\b/.test(n)) return ['E', 'F']
  return FASE_OPTIONS_RPPM
}
// Data ATP menyimpan "kelas" sebagai angka romawi (I..XII), BUKAN nama fase
// langsung -- peta ini dipakai untuk mencocokkan Fase yang dipilih di RPPM
// dengan kelas-kelas romawi yang termasuk di dalamnya.
const KELAS_ROMAWI_PER_FASE: Record<string, string[]> = {
  A: ['I', 'II'], B: ['III', 'IV'], C: ['V', 'VI'],
  D: ['VII', 'VIII', 'IX'], E: ['X'], F: ['XI', 'XII'],
}

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
  // Unit-unit tempat Guru yang sedang login ditugaskan (bisa lebih dari satu, mis. guru
  // yang mengajar di SMP DAN SMA) -- dipakai supaya guru dengan penugasan LEBIH dari satu
  // unit tetap bisa BERPINDAH antar unitnya sendiri, bukan terkunci permanen ke unit
  // pertama saja seperti sebelumnya.
  const unitIdsGuruSendiri = useMemo(() => {
    if (!cakupanGuru?.guruId) return []
    return daftarGuru.find(g => g.id === cakupanGuru.guruId)?.unitIds || []
  }, [cakupanGuru, daftarGuru])

  // State Fitur Cari Guru & Rekap
  const [cariGuruId, setCariGuruId] = useState('')

  // ══════════ STATE FORM RPPM (Perencanaan Pembelajaran Mendalam) ══════════
  const [rppmUnitId, setRppmUnitId] = useState('')
  const [rppmGuruId, setRppmGuruId] = useState('')
  const [rppmMapelId, setRppmMapelId] = useState('')
  const [rppmFase, setRppmFase] = useState('')
  const [rppmNamaPenyusun, setRppmNamaPenyusun] = useState('')
  const [rppmTahunPelajaran, setRppmTahunPelajaran] = useState('')
  const [rppmJenjangSekolah, setRppmJenjangSekolah] = useState('')
  const [rppmFaseKelas, setRppmFaseKelas] = useState('')
  const [rppmAlokasiWaktu, setRppmAlokasiWaktu] = useState('')
  const [rppmA, setRppmA] = useState('')
  const [rppmB, setRppmB] = useState('')
  const [rppmDpl, setRppmDpl] = useState<Record<string, boolean>>({})
  const [rppmCpManual, setRppmCpManual] = useState('') // isi manual kalau mau override otomatis
  const [rppmE, setRppmE] = useState('')
  const [rppmTpTerpilih, setRppmTpTerpilih] = useState<string[]>([]) // id ATP yang dicentang dari CP,TP,ATP
  const [rppmG, setRppmG] = useState('')
  const [rppmH, setRppmH] = useState('')
  const [rppmI, setRppmI] = useState('')
  const [rppmJ, setRppmJ] = useState('')
  const [rppmK, setRppmK] = useState('')
  const [rppmL, setRppmL] = useState('')
  const [rppmAwal, setRppmAwal] = useState({ menit: '', pengalaman: '', kegiatan: '', solo: '' })
  const [rppmInti, setRppmInti] = useState({ menit: '', pengalaman: '', kegiatan: '', solo: '' })
  const [rppmAkhir, setRppmAkhir] = useState({ menit: '', pengalaman: '', kegiatan: '', solo: '' })
  const [rppmN, setRppmN] = useState('')
  const [rppmTitiMangsa, setRppmTitiMangsa] = useState('')
  const [rppmO, setRppmO] = useState('')
  const [rppmP, setRppmP] = useState('')
  const [rppmQ, setRppmQ] = useState('')
  const [rppmR, setRppmR] = useState('')
  const [rppmS, setRppmS] = useState('')
  const [rppmSedangUnduh, setRppmSedangUnduh] = useState<'' | 'pdf' | 'docx'>('')

  // Fase yang tersedia mengikuti jenjang Unit yang dipilih
  const rppmFaseTersedia = useMemo(() => {
    if (!rppmUnitId) {
      const gabungan = new Set<string>()
      daftarLembaga.forEach((u: any) => faseUntukUnitRppm(u.nama).forEach(f => gabungan.add(f)))
      return gabungan.size > 0 ? FASE_OPTIONS_RPPM.filter(f => gabungan.has(f)) : FASE_OPTIONS_RPPM
    }
    const unit = daftarLembaga.find((u: any) => u.id === rppmUnitId)
    return faseUntukUnitRppm(unit?.nama || '')
  }, [rppmUnitId, daftarLembaga])

  const rppmDaftarGuruSesuaiUnit = useMemo(() => {
    if (!rppmUnitId) return daftarGuru
    return daftarGuru.filter((g: any) => (g.unitIds || []).includes(rppmUnitId))
  }, [daftarGuru, rppmUnitId])

  const rppmDaftarMapelSesuaiGuru = useMemo(() => {
    if (!rppmGuruId) return daftarMapel
    const guru = daftarGuru.find((g: any) => g.id === rppmGuruId)
    if (!guru?.mapelIds?.length) return daftarMapel
    return daftarMapel.filter((m: any) => guru.mapelIds.includes(m.id))
  }, [daftarMapel, daftarGuru, rppmGuruId])

  // Reset berjenjang: Unit -> Fase/Guru, Guru -> Mapel
  useEffect(() => {
    if (rppmFase && !rppmFaseTersedia.includes(rppmFase)) setRppmFase('')
    if (rppmGuruId && !rppmDaftarGuruSesuaiUnit.some((g: any) => g.id === rppmGuruId)) setRppmGuruId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rppmUnitId])

  useEffect(() => {
    if (rppmMapelId && !rppmDaftarMapelSesuaiGuru.some((m: any) => m.id === rppmMapelId)) setRppmMapelId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rppmGuruId])

  // C. Capaian Pembelajaran Umum -- diambil OTOMATIS dari modul CP, TP & ATP
  // (data_cp_umum), sesuai Mapel + Fase yang dipilih.
  const rppmCapaianOtomatis = useMemo(() => {
    if (!rppmMapelId || !rppmFase) return ''
    try {
      const raw = localStorage.getItem(kunciTahun('data_cp_umum'))
      const daftar = raw ? JSON.parse(raw) : []
      const cocok = daftar.find((c: any) => c.mapelId === rppmMapelId && c.fase === rppmFase)
      return cocok?.deskripsi || ''
    } catch {
      return ''
    }
  }, [rppmMapelId, rppmFase])

  // F. Tujuan Pembelajaran -- daftar TP yang tersedia dari modul CP, TP & ATP
  // (data_tp + data_atp), guru tinggal MENCENTANG yang relevan untuk RPPM ini.
  const rppmDaftarTpTersedia = useMemo(() => {
    if (!rppmMapelId || !rppmFase) return []
    try {
      const daftarTpRaw = localStorage.getItem(kunciTahun('data_tp'))
      const daftarAtpRaw = localStorage.getItem(kunciTahun('data_atp'))
      const daftarTpX = daftarTpRaw ? JSON.parse(daftarTpRaw) : []
      const daftarAtpX = daftarAtpRaw ? JSON.parse(daftarAtpRaw) : []
      const daftarKelasRomawi = KELAS_ROMAWI_PER_FASE[rppmFase] || []
      return daftarAtpX
        .filter((a: any) => a.mapelId === rppmMapelId && daftarKelasRomawi.includes(a.kelas))
        .sort((x: any, y: any) => (x.urutanDiKelas || 0) - (y.urutanDiKelas || 0))
        .map((a: any) => {
          const tp = daftarTpX.find((t: any) => t.id === a.tpId)
          return { id: a.id, nomor: tp?.nomor || '', deskripsi: tp?.deskripsi || '(TP tidak ditemukan)' }
        })
    } catch {
      return []
    }
  }, [rppmMapelId, rppmFase])

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
        if (cakupan?.guruId) {
          setCariGuruId(cakupan.guruId)
          setRppmGuruId(cakupan.guruId)
          const guruSendiri = masterGuru.find((g: any) => g.id === cakupan.guruId)
          setRppmNamaPenyusun(guruSendiri?.nama || '')
          if (guruSendiri?.unitIds?.[0]) setRppmUnitId(guruSendiri.unitIds[0])
        }

        setLoading(false)
      }
    }
    checkAuth()
  }, [router])

  if (loading || diizinkanAkses === null) return <div className="p-8 text-center font-semibold text-[#6A197D]">Memuat Modul RPP...</div>
  if (diizinkanAkses === false) return null

  // ══════════ EKSPOR RPPM (PDF & WORD) ══════════
  const rppmSiapkanData = () => {
    const namaUnitTerpilih = rppmUnitId ? (daftarLembaga.find((u: any) => u.id === rppmUnitId)?.nama || '') : (namaInduk || '')
    const namaMapelTerpilih = daftarMapel.find((m: any) => m.id === rppmMapelId)?.nama || ''
    const cpFinal = rppmCpManual.trim() || rppmCapaianOtomatis || ''
    const tpFinal = rppmDaftarTpTersedia.filter((tp: any) => rppmTpTerpilih.includes(tp.id)).map((tp: any) => tp.deskripsi)
    const dplFinal = Object.entries(rppmDpl).filter(([, v]) => v).map(([k]) => k)
    const titiMangsaFinal = rppmTitiMangsa.trim() || `Bandung, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
    return { namaUnitTerpilih, namaMapelTerpilih, cpFinal, tpFinal, dplFinal, titiMangsaFinal }
  }

  const handleUnduhRppm = async (jenis: 'pdf' | 'docx') => {
    if (!rppmMapelId || !rppmFase) {
      alert('Pilih Mata Pelajaran dan Fase terlebih dahulu.')
      return
    }
    setRppmSedangUnduh(jenis)
    try {
      const d = rppmSiapkanData()
      if (jenis === 'pdf') await rppmUnduhPdf(d)
      else await rppmUnduhDocx(d)
    } catch (err) {
      console.error(err)
      alert('Gagal membuat file. Pastikan sudah install: npm install jspdf jspdf-autotable docx')
    } finally {
      setRppmSedangUnduh('')
    }
  }

  const rppmUnduhPdf = async (d: ReturnType<typeof rppmSiapkanData>) => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const L = 18, R = 18
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const W = pageW - L - R
    let y = 18

    doc.setFont('times', 'bold'); doc.setFontSize(13)
    doc.text('PERENCANAAN PEMBELAJARAN MENDALAM', pageW / 2, y, { align: 'center' })
    y += 10

    doc.setFont('times', 'normal'); doc.setFontSize(9.5)
    const labelW = 34
    const baris = (label: string, value: string) => {
      doc.text(label, L, y)
      const lines = doc.splitTextToSize(`: ${value || ''}`, W - labelW)
      doc.text(lines, L + labelW, y)
      y += Math.max(4.5, lines.length * 4.2)
    }
    baris('Nama Penyusun', rppmNamaPenyusun)
    baris('Nama Sekolah', d.namaUnitTerpilih)
    baris('Tahun Pelajaran', rppmTahunPelajaran)
    baris('Jenjang Sekolah', rppmJenjangSekolah)
    baris('Fase/Kelas', rppmFaseKelas || rppmFase)
    baris('Alokasi Waktu', rppmAlokasiWaktu)
    y += 3

    const pageCheck = (butuh: number) => { if (y + butuh > pageH - 15) { doc.addPage(); y = 18 } }

    const sectionBg = (judul: string) => {
      pageCheck(14)
      doc.setFillColor(237, 227, 243)
      doc.rect(L, y, W, 6.5, 'F')
      doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.setTextColor(20, 20, 20)
      doc.text(judul, L + 2, y + 4.5)
      y += 9
    }
    const sectionBody = (teks: string, opts?: { italic?: boolean }) => {
      doc.setFont('times', opts?.italic ? 'italic' : 'normal'); doc.setFontSize(9)
      const lines = doc.splitTextToSize(teks || '-', W - 4)
      lines.forEach((line: string) => {
        pageCheck(5)
        doc.text(line, L + 2, y)
        y += 4.3
      })
      y += 3
    }

    sectionBg('A. Identifikasi Peserta Didik'); sectionBody(rppmA)
    sectionBg('B. Identifikasi Materi Pelajaran'); sectionBody(rppmB)

    sectionBg('C. Dimensi Profil Lulusan (DPL)')
    doc.setFont('times', 'normal'); doc.setFontSize(9)
    const semuaDpl = ['Keimanan dan ketaqwaan terhadap Tuhan YME', 'Kewargaan', 'Penalaran kritis', 'Kreativitas', 'Kolaborasi', 'Kemandirian', 'Kesehatan', 'Komunikasi']
    semuaDpl.forEach((dpl, i) => {
      pageCheck(6)
      const dicentang = d.dplFinal.includes(dpl)
      doc.rect(L + 2, y - 3, 3, 3)
      if (dicentang) { doc.setFont('times', 'bold'); doc.text('X', L + 2.5, y - 0.6); doc.setFont('times', 'normal') }
      doc.text(dpl, L + 8, y)
      y += 5
    })
    y += 2

    sectionBg('D. Capaian Pembelajaran'); sectionBody(d.cpFinal)
    sectionBg('E. Lintas Disiplin Ilmu'); sectionBody(rppmE)

    sectionBg('F. Tujuan Pembelajaran')
    if (d.tpFinal.length > 0) {
      d.tpFinal.forEach((tp: any, i: number) => sectionBody(`${i + 1}. ${tp}`))
    } else {
      sectionBody('-')
    }

    sectionBg('G. Topik Pembelajaran'); sectionBody(rppmG)
    sectionBg('H. Praktik Pedagogis'); sectionBody(rppmH)
    sectionBg('I. Kemitraan Pembelajaran'); sectionBody(rppmI)
    sectionBg('J. Lingkungan Pembelajaran'); sectionBody(rppmJ)
    sectionBg('K. Pemanfaatan Digital'); sectionBody(rppmK)
    sectionBg('L. Nilai-Nilai Islam/Ayat Alquran/Hadits'); sectionBody(rppmL)

    sectionBg('M. Langkah-langkah Pembelajaran')
    const { default: autoTable } = await import('jspdf-autotable')
    const bodyLangkah: any[] = []
    ;[
      { label: 'Kegiatan Awal', v: rppmAwal },
      { label: 'Kegiatan Inti', v: rppmInti },
      { label: 'Kegiatan Akhir', v: rppmAkhir },
    ].forEach(k => {
      bodyLangkah.push([{ content: `${k.label} (${k.v.menit || '…'} menit)`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } }])
      bodyLangkah.push([k.v.pengalaman || '-', k.v.kegiatan || '-', k.v.solo || '-'])
    })
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: R },
      head: [['Pengalaman Belajar', 'Kegiatan Pembelajaran', 'SOLO Taxonomy']],
      body: bodyLangkah,
      theme: 'grid',
      styles: { font: 'times', fontSize: 8, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.15, valign: 'top' },
      headStyles: { fillColor: [237, 227, 243], textColor: [30, 10, 40], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: W * 0.28 }, 1: { cellWidth: W * 0.46 }, 2: { cellWidth: W * 0.26, fontStyle: 'italic' } },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6

    sectionBg('N. Asesmen Pembelajaran'); sectionBody(rppmN)

    // Tanda tangan -- blok KIRI (Kepala Sekolah) tetap di sisi KIRI, blok KANAN
    // (Guru Mapel) tetap di sisi KANAN, tapi teks di dalam masing-masing kolom
    // rata TENGAH terhadap lebar kolomnya sendiri, bukan rata kiri/kanan mentah.
    pageCheck(45)
    const ttdColWRpp = 55
    const ttdKiriTengahRpp = L + ttdColWRpp / 2
    const ttdKananTengahRpp = pageW - R - ttdColWRpp / 2
    doc.setFont('times', 'normal'); doc.setFontSize(9)
    doc.text(d.titiMangsaFinal, ttdKananTengahRpp, y, { align: 'center' })
    y += 10
    const ttdY = y
    doc.text('Mengetahui, Kepala Sekolah', ttdKiriTengahRpp, ttdY, { align: 'center' })
    doc.text(`Guru Mata Pelajaran`, ttdKananTengahRpp, ttdY, { align: 'center' })
    const namaY = ttdY + 22
    doc.setFont('times', 'bold')
    doc.text('__________________________', ttdKiriTengahRpp, namaY, { align: 'center' })
    doc.text('__________________________', ttdKananTengahRpp, namaY, { align: 'center' })
    doc.setFont('times', 'normal'); doc.setFontSize(8.5)
    doc.text('NBM. ……', ttdKiriTengahRpp, namaY + 5, { align: 'center' })
    doc.text('NBM. ……', ttdKananTengahRpp, namaY + 5, { align: 'center' })

    // Lampiran
    doc.addPage(); y = 18
    doc.setFillColor(237, 227, 243)
    doc.rect(L, y, W, 7, 'F')
    doc.setFont('times', 'bold'); doc.setFontSize(10.5)
    doc.text('LAMPIRAN', pageW / 2, y + 5, { align: 'center' })
    y += 12
    ;[
      ['O. Lembar Kegiatan Peserta Didik', rppmO],
      ['P. Instrumen Penilaian (Proses)', rppmP],
      ['Q. Bahan Bacaan Guru dan Peserta Didik', rppmQ],
      ['R. Glosarium', rppmR],
      ['S. Daftar Pustaka', rppmS],
    ].forEach(([judul, isi]) => {
      pageCheck(10)
      doc.setFont('times', 'bold'); doc.setFontSize(9.5)
      doc.text(judul, L, y); y += 5
      sectionBody(isi || '-')
    })

    doc.save(`${slugifyNamaFile('rppm', d.namaMapelTerpilih, `fase-${rppmFase}`)}.pdf`)
  }

  const rppmUnduhDocx = async (d: ReturnType<typeof rppmSiapkanData>) => {
    // @ts-ignore -- paket "docx" belum ada di sandbox pratinjau ini, tapi sudah
    // ditambahkan ke package.json dan akan otomatis tersedia setelah `npm install`.
    const docx = await import('docx')
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, ShadingType, AlignmentType, Packer } = docx as any

    const warnaHeader = 'EDE3F3'
    const sectionHeader = (judul: string) => new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: warnaHeader },
      children: [new TextRun({ text: judul, bold: true, size: 21 })],
      spacing: { before: 200, after: 100 },
    })
    const bodyPara = (teks: string) => new Paragraph({ children: [new TextRun({ text: teks || '-', size: 20 })], spacing: { after: 200 } })

    const dplList = ['Keimanan dan ketaqwaan terhadap Tuhan YME', 'Kewargaan', 'Penalaran kritis', 'Kreativitas', 'Kolaborasi', 'Kemandirian', 'Kesehatan', 'Komunikasi']

    const anak: any[] = [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'PERENCANAAN PEMBELAJARAN MENDALAM', bold: true, size: 28 })], spacing: { after: 300 } }),
      ...[
        ['Nama Penyusun', rppmNamaPenyusun],
        ['Nama Sekolah', d.namaUnitTerpilih],
        ['Tahun Pelajaran', rppmTahunPelajaran],
        ['Jenjang Sekolah', rppmJenjangSekolah],
        ['Fase/Kelas', rppmFaseKelas || rppmFase],
        ['Alokasi Waktu', rppmAlokasiWaktu],
      ].map(([label, value]) => new Paragraph({
        children: [
          new TextRun({ text: `${label}`.padEnd(18, ' '), size: 20 }),
          new TextRun({ text: `: ${value || ''}`, size: 20 }),
        ],
        spacing: { after: 60 },
      })),
      sectionHeader('A. Identifikasi Peserta Didik'), bodyPara(rppmA),
      sectionHeader('B. Identifikasi Materi Pelajaran'), bodyPara(rppmB),
      sectionHeader('C. Dimensi Profil Lulusan (DPL)'),
      ...dplList.map(dpl => new Paragraph({ children: [new TextRun({ text: `${d.dplFinal.includes(dpl) ? '☑' : '☐'}  ${dpl}`, size: 20 })], spacing: { after: 60 } })),
      new Paragraph({ children: [new TextRun({ text: '*) Pilihlah dimensi profil lulusan yang akan dicapai dalam pembelajaran', italics: true, size: 16 })], spacing: { before: 100, after: 200 } }),
      sectionHeader('D. Capaian Pembelajaran'), bodyPara(d.cpFinal),
      sectionHeader('E. Lintas Disiplin Ilmu'), bodyPara(rppmE),
      sectionHeader('F. Tujuan Pembelajaran'),
      ...(d.tpFinal.length > 0 ? d.tpFinal.map((tp: any, i: number) => bodyPara(`${i + 1}. ${tp}`)) : [bodyPara('-')]),
      sectionHeader('G. Topik Pembelajaran'), bodyPara(rppmG),
      sectionHeader('H. Praktik Pedagogis'), bodyPara(rppmH),
      sectionHeader('I. Kemitraan Pembelajaran'), bodyPara(rppmI),
      sectionHeader('J. Lingkungan Pembelajaran'), bodyPara(rppmJ),
      sectionHeader('K. Pemanfaatan Digital'), bodyPara(rppmK),
      sectionHeader('L. Nilai-Nilai Islam/Ayat Alquran/Hadits'), bodyPara(rppmL),
      sectionHeader('M. Langkah-langkah Pembelajaran'),
    ]

    const wCol = 3200
    const buatTabelLangkah = (label: string, v: { menit: string; pengalaman: string; kegiatan: string; solo: string }) => new Table({
      width: { size: 9600, type: WidthType.DXA },
      columnWidths: [wCol, wCol, wCol],
      rows: [
        new TableRow({ children: [new TableCell({ columnSpan: 3, width: { size: 9600, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' }, children: [new Paragraph({ children: [new TextRun({ text: `${label} (${v.menit || '…'} menit)`, bold: true, size: 18 })] })] })] }),
        new TableRow({
          children: [
            new TableCell({ width: { size: wCol, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: 'EDE3F3' }, children: [new Paragraph({ children: [new TextRun({ text: 'Pengalaman Belajar', bold: true, size: 16 })] })] }),
            new TableCell({ width: { size: wCol, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: 'EDE3F3' }, children: [new Paragraph({ children: [new TextRun({ text: 'Kegiatan Pembelajaran', bold: true, size: 16 })] })] }),
            new TableCell({ width: { size: wCol, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: 'EDE3F3' }, children: [new Paragraph({ children: [new TextRun({ text: 'SOLO Taxonomy', bold: true, italics: true, size: 16 })] })] }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ width: { size: wCol, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: v.pengalaman || '-', size: 18 })] })] }),
            new TableCell({ width: { size: wCol, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: v.kegiatan || '-', size: 18 })] })] }),
            new TableCell({ width: { size: wCol, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: v.solo || '-', italics: true, size: 18 })] })] }),
          ],
        }),
      ],
    })

    anak.push(buatTabelLangkah('Kegiatan Awal', rppmAwal))
    anak.push(new Paragraph({ text: '', spacing: { after: 150 } }))
    anak.push(buatTabelLangkah('Kegiatan Inti', rppmInti))
    anak.push(new Paragraph({ text: '', spacing: { after: 150 } }))
    anak.push(buatTabelLangkah('Kegiatan Akhir', rppmAkhir))
    anak.push(new Paragraph({ text: '', spacing: { after: 200 } }))

    anak.push(sectionHeader('N. Asesmen Pembelajaran'), bodyPara(rppmN))

    // Kolom KIRI (Kepala Sekolah) tetap di sisi KIRI, kolom KANAN (Guru Mapel,
    // termasuk titimangsa) tetap di sisi KANAN -- tapi tiap paragraf di dalam
    // sel rata TENGAH (AlignmentType.CENTER), bukan rata kiri/kanan mentah.
    anak.push(new Table({
      width: { size: 9600, type: WidthType.DXA },
      columnWidths: [4800, 4800],
      borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' }, insideHorizontal: { style: 'none' }, insideVertical: { style: 'none' } },
      rows: [
        new TableRow({
          children: [
            new TableCell({ width: { size: 4800, type: WidthType.DXA }, borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } }, children: [new Paragraph({ text: '' }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Mengetahui, Kepala Sekolah', size: 20 })] }), new Paragraph({ text: '' }), new Paragraph({ text: '' }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '____________________________________', size: 20 })] }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NBM. ……', size: 18 })] })] }),
            new TableCell({ width: { size: 4800, type: WidthType.DXA }, borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: d.titiMangsaFinal, size: 20 })] }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Guru Mata Pelajaran', size: 20 })] }), new Paragraph({ text: '' }), new Paragraph({ text: '' }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '____________________________________', size: 20 })] }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NBM. ……', size: 18 })] })] }),
          ],
        }),
      ],
    }))

    anak.push(new Paragraph({ pageBreakBefore: true, shading: { type: ShadingType.CLEAR, fill: warnaHeader }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'LAMPIRAN', bold: true, size: 24 })], spacing: { after: 300 } }))
    ;[
      ['O. Lembar Kegiatan Peserta Didik', rppmO],
      ['P. Instrumen Penilaian (Proses)', rppmP],
      ['Q. Bahan Bacaan Guru dan Peserta Didik', rppmQ],
      ['R. Glosarium', rppmR],
      ['S. Daftar Pustaka', rppmS],
    ].forEach(([judul, isi]) => {
      anak.push(new Paragraph({ children: [new TextRun({ text: judul, bold: true, size: 20 })], spacing: { before: 150, after: 60 } }))
      anak.push(bodyPara(isi as string))
    })

    const dokumen = new Document({ sections: [{ properties: {}, children: anak }] })
    const blob = await Packer.toBlob(dokumen)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugifyNamaFile('rppm', d.namaMapelTerpilih, `fase-${rppmFase}`)}.docx`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-800">
      
      {/* --- SIDEBAR --- */}
      <Sidebar />

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto space-y-8">
        <header className="space-y-1.5">
           <h1 className="text-2xl font-black text-slate-900">RPP / Modul Ajar — Perencanaan Pembelajaran Mendalam (RPPM)</h1>
           <p className="text-xs text-gray-500">Susun RPPM lengkap sesuai template resmi, dengan Capaian & Tujuan Pembelajaran yang otomatis terhubung ke modul CP, TP &amp; ATP.</p>
        </header>

        {true && (
          <section className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h2 className="text-sm font-black text-slate-800">Perencanaan Pembelajaran Mendalam (RPPM)</h2>
              <p className="text-xs text-slate-500 -mt-2">
                Formulir ini mengikuti template RPPM resmi. Bagian <strong>Capaian Pembelajaran</strong> dan{' '}
                <strong>Tujuan Pembelajaran</strong> otomatis mengambil data dari modul CP, TP &amp; ATP.
              </p>

              {/* IDENTITAS & CAKUPAN */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">1. Lembaga / Unit</label>
                  {cakupanGuru ? (
                    unitIdsGuruSendiri.length > 1 ? (
                      <select value={rppmUnitId} onChange={e => setRppmUnitId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                        {unitIdsGuruSendiri.map((uid: string) => {
                          const u = daftarLembaga.find(l => l.id === uid)
                          return u ? <option key={uid} value={uid}>{u.nama}</option> : null
                        })}
                      </select>
                    ) : (
                      <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-slate-600">
                        {daftarLembaga.find((u: any) => u.id === rppmUnitId)?.nama || 'Lembaga Pusat'} <span className="text-[9px] font-normal text-slate-400">(unit Anda)</span>
                      </div>
                    )
                  ) : (
                    <select value={rppmUnitId} onChange={e => setRppmUnitId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">Lembaga Pusat</option>
                      {daftarLembaga.map((u: any) => <option key={u.id} value={u.id}>{u.nama}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">2. Guru (Nama Penyusun)</label>
                  {cakupanGuru ? (
                    <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-slate-600">
                      {rppmNamaPenyusun || 'Anda'} <span className="text-[9px] font-normal text-slate-400">(akun Anda)</span>
                    </div>
                  ) : (
                    <select value={rppmGuruId} onChange={e => { setRppmGuruId(e.target.value); setRppmNamaPenyusun(daftarGuru.find((g: any) => g.id === e.target.value)?.nama || '') }}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                      <option value="">-- Pilih Guru --</option>
                      {rppmDaftarGuruSesuaiUnit.map((g: any) => <option key={g.id} value={g.id}>{g.nama}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">3. Mata Pelajaran</label>
                  <select value={rppmMapelId} onChange={e => setRppmMapelId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                    <option value="">-- Pilih Mapel --</option>
                    {rppmDaftarMapelSesuaiGuru.map((m: any) => <option key={m.id} value={m.id}>{m.nama}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">4. Fase</label>
                  <select value={rppmFase} onChange={e => setRppmFase(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D] bg-white">
                    <option value="">-- Pilih Fase --</option>
                    {rppmFaseTersedia.map(f => <option key={f} value={f}>Fase {f}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tahun Pelajaran</label>
                  <input value={rppmTahunPelajaran} onChange={e => setRppmTahunPelajaran(e.target.value)} placeholder="Cth: 2026/2027"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Jenjang Sekolah</label>
                  <input value={rppmJenjangSekolah} onChange={e => setRppmJenjangSekolah(e.target.value)} placeholder="Cth: SMP"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Fase/Kelas</label>
                  <input value={rppmFaseKelas} onChange={e => setRppmFaseKelas(e.target.value)} placeholder="Cth: D / VIII"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Alokasi Waktu</label>
                  <input value={rppmAlokasiWaktu} onChange={e => setRppmAlokasiWaktu(e.target.value)} placeholder="Cth: 2 x 40 menit"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
                </div>
              </div>
            </div>

            {/* Helper kecil untuk section beruraian teks A/B/E/G/H/I/J/K/L/N */}
            {[
              { kode: 'A', judul: 'Identifikasi Peserta Didik', val: rppmA, set: setRppmA, ph: 'Identifikasi kesiapan peserta didik sebelum belajar, seperti pengetahuan awal, minat, latar belakang, dan kebutuhan belajar, serta aspek lainnya.' },
              { kode: 'B', judul: 'Identifikasi Materi Pelajaran', val: rppmB, set: setRppmB, ph: 'Analisis materi pelajaran: jenis pengetahuan yang akan dicapai, relevansi dengan kehidupan nyata peserta didik, tingkat kesulitan, struktur materi, serta integrasi nilai dan karakter.' },
            ].map(s => (
              <div key={s.kode} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">{s.kode}. {s.judul}</h3></div>
                <div className="p-5">
                  <textarea value={s.val} onChange={e => s.set(e.target.value)} rows={3} placeholder={s.ph}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                </div>
              </div>
            ))}

            {/* C. DIMENSI PROFIL LULUSAN */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">C. Dimensi Profil Lulusan (DPL)</h3></div>
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                {['Keimanan dan ketaqwaan terhadap Tuhan YME', 'Kewargaan', 'Penalaran kritis', 'Kreativitas', 'Kolaborasi', 'Kemandirian', 'Kesehatan', 'Komunikasi'].map(dpl => (
                  <label key={dpl} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!rppmDpl[dpl]} onChange={e => setRppmDpl(prev => ({ ...prev, [dpl]: e.target.checked }))}
                      className="w-4 h-4 accent-[#6A197D]" />
                    {dpl}
                  </label>
                ))}
              </div>
              <p className="px-5 pb-4 text-[10px] text-slate-400">*) Pilihlah dimensi profil lulusan yang akan dicapai dalam pembelajaran.</p>
            </div>

            {/* D. CAPAIAN PEMBELAJARAN — OTOMATIS dari CP,TP,ATP */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5 flex items-center justify-between">
                <h3 className="font-black text-slate-800 text-sm">D. Capaian Pembelajaran</h3>
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Otomatis dari CP, TP &amp; ATP</span>
              </div>
              <div className="p-5 space-y-2">
                {rppmCapaianOtomatis ? (
                  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">{rppmCapaianOtomatis}</p>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    {rppmMapelId && rppmFase ? 'Belum ada Capaian Pembelajaran Umum untuk Mapel & Fase ini di modul CP, TP & ATP.' : 'Pilih Mata Pelajaran dan Fase dulu di atas.'}
                  </p>
                )}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Override manual (opsional)</label>
                  <textarea value={rppmCpManual} onChange={e => setRppmCpManual(e.target.value)} rows={2}
                    placeholder="Kosongkan untuk memakai Capaian Pembelajaran otomatis di atas apa adanya."
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">E. Lintas Disiplin Ilmu</h3></div>
              <div className="p-5">
                <textarea value={rppmE} onChange={e => setRppmE(e.target.value)} rows={2} placeholder="Tuliskan disiplin ilmu dan/atau mata pelajaran yang relevan."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
              </div>
            </div>

            {/* F. TUJUAN PEMBELAJARAN — OTOMATIS dari CP,TP,ATP, guru mencentang yang relevan */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5 flex items-center justify-between">
                <h3 className="font-black text-slate-800 text-sm">F. Tujuan Pembelajaran</h3>
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Otomatis dari CP, TP &amp; ATP</span>
              </div>
              <div className="p-5 space-y-2">
                {rppmDaftarTpTersedia.length > 0 ? (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto border border-slate-200 rounded-xl p-3">
                    {rppmDaftarTpTersedia.map((tp: any) => (
                      <label key={tp.id} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={rppmTpTerpilih.includes(tp.id)}
                          onChange={e => setRppmTpTerpilih(prev => e.target.checked ? [...prev, tp.id] : prev.filter(id => id !== tp.id))}
                          className="w-4 h-4 mt-0.5 accent-[#6A197D] shrink-0" />
                        <span>{tp.deskripsi}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    {rppmMapelId && rppmFase ? 'Belum ada Tujuan Pembelajaran (TP/ATP) untuk Mapel & Fase ini di modul CP, TP & ATP.' : 'Pilih Mata Pelajaran dan Fase dulu di atas.'}
                  </p>
                )}
                <p className="text-[10px] text-slate-400">Centang TP yang relevan untuk satu kali pertemuan/RPPM ini. Kalau lebih dari satu pertemuan, buat RPPM terpisah untuk tiap pertemuan.</p>
              </div>
            </div>

            {[
              { kode: 'G', judul: 'Topik Pembelajaran', val: rppmG, set: setRppmG, ph: 'Tuliskan topik pembelajaran yang relevan dengan capaian dan tujuan pembelajaran.' },
              { kode: 'H', judul: 'Praktik Pedagogis', val: rppmH, set: setRppmH, ph: 'Model/Strategi/Metode yang ditentukan guru. Contoh: pembelajaran berbasis masalah, berbasis proyek, inkuiri, kontekstual, dsb.' },
              { kode: 'I', judul: 'Kemitraan Pembelajaran', val: rppmI, set: setRppmI, ph: 'Mitra kerjasama untuk berkolaborasi dalam pembelajaran (guru bidang studi lain, orang tua, komunitas, dunia usaha, dsb).' },
              { kode: 'J', judul: 'Lingkungan Pembelajaran', val: rppmJ, set: setRppmJ, ph: 'Lingkungan pembelajaran yang mengintegrasikan ruang fisik, ruang virtual, dan budaya belajar. Contoh: LMS, lingkungan sekolah.' },
              { kode: 'K', judul: 'Pemanfaatan Digital', val: rppmK, set: setRppmK, ph: 'Pemanfaatan teknologi digital. Contoh: perpustakaan digital, forum diskusi daring, penilaian daring.' },
              { kode: 'L', judul: 'Nilai-Nilai Islam/Ayat Alquran/Hadits', val: rppmL, set: setRppmL, ph: 'Uraikan nilai-nilai Islam yang diajarkan, bisa berupa ayat Alquran atau hadits.' },
            ].map(s => (
              <div key={s.kode} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">{s.kode}. {s.judul}</h3></div>
                <div className="p-5">
                  <textarea value={s.val} onChange={e => s.set(e.target.value)} rows={2} placeholder={s.ph}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                </div>
              </div>
            ))}

            {/* M. LANGKAH-LANGKAH PEMBELAJARAN */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">M. Langkah-langkah Pembelajaran</h3></div>
              <div className="p-5 space-y-4">
                {[
                  { label: 'Kegiatan Awal', v: rppmAwal, set: setRppmAwal },
                  { label: 'Kegiatan Inti', v: rppmInti, set: setRppmInti },
                  { label: 'Kegiatan Akhir', v: rppmAkhir, set: setRppmAkhir },
                ].map(langkah => (
                  <div key={langkah.label} className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-xs text-slate-700">{langkah.label}</p>
                      <input value={langkah.v.menit} onChange={e => langkah.set({ ...langkah.v, menit: e.target.value })} placeholder="… menit"
                        className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#6A197D]" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Pengalaman Belajar</label>
                        <textarea value={langkah.v.pengalaman} onChange={e => langkah.set({ ...langkah.v, pengalaman: e.target.value })} rows={4}
                          placeholder="memahami / mengaplikasi / merefleksi"
                          className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Kegiatan Pembelajaran</label>
                        <textarea value={langkah.v.kegiatan} onChange={e => langkah.set({ ...langkah.v, kegiatan: e.target.value })} rows={4}
                          placeholder="Uraikan detail kegiatan sesuai sintaks model pembelajaran yang dipilih."
                          className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 block italic">SOLO Taxonomy</label>
                        <textarea value={langkah.v.solo} onChange={e => langkah.set({ ...langkah.v, solo: e.target.value })} rows={4}
                          placeholder="prastructural / unistructural / multistructural / relasional / extended abstract"
                          className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">N. Asesmen Pembelajaran</h3></div>
              <div className="p-5">
                <textarea value={rppmN} onChange={e => setRppmN(e.target.value)} rows={3}
                  placeholder="Teknik dan instrumen penilaian pada awal, proses, dan akhir pembelajaran. Contoh: Penilaian Sejawat, Penilaian Diri, Penilaian Proyek, Observasi, Portofolio, Tes tertulis, dsb."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Titi Mangsa (Kota, Tanggal)</label>
              <input value={rppmTitiMangsa} onChange={e => setRppmTitiMangsa(e.target.value)}
                placeholder={`Cth: Bandung, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                className="w-full md:w-1/2 px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#6A197D]" />
              <p className="text-[9px] text-slate-400 mt-1">Kosongkan untuk memakai tanggal hari ini otomatis.</p>
            </div>

            {/* LAMPIRAN O-S */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-[#EDE3F3] px-5 py-2.5"><h3 className="font-black text-slate-800 text-sm">LAMPIRAN</h3></div>
              <div className="p-5 space-y-3">
                {[
                  { kode: 'O', judul: 'Lembar Kegiatan Peserta Didik', val: rppmO, set: setRppmO },
                  { kode: 'P', judul: 'Instrumen Penilaian (Proses)', val: rppmP, set: setRppmP },
                  { kode: 'Q', judul: 'Bahan Bacaan Guru dan Peserta Didik', val: rppmQ, set: setRppmQ },
                  { kode: 'R', judul: 'Glosarium', val: rppmR, set: setRppmR },
                  { kode: 'S', judul: 'Daftar Pustaka', val: rppmS, set: setRppmS },
                ].map(s => (
                  <div key={s.kode}>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">{s.kode}. {s.judul}</label>
                    <textarea value={s.val} onChange={e => s.set(e.target.value)} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#6A197D] resize-y" />
                  </div>
                ))}
              </div>
            </div>

            {/* TOMBOL UNDUH */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-3 justify-end sticky bottom-4">
              <button onClick={() => handleUnduhRppm('pdf')} disabled={!!rppmSedangUnduh}
                className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition">
                <FileText className="w-4 h-4" /> {rppmSedangUnduh === 'pdf' ? 'Menyiapkan...' : 'Unduh PDF'}
              </button>
              <button onClick={() => handleUnduhRppm('docx')} disabled={!!rppmSedangUnduh}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition">
                <FileSpreadsheet className="w-4 h-4" /> {rppmSedangUnduh === 'docx' ? 'Menyiapkan...' : 'Unduh Word (bisa diedit manual)'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}