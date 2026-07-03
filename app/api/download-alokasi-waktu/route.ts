// FILE: app/api/download-alokasi-waktu/route.ts
// API Route untuk generate dan download PDF Analisis Alokasi Waktu

import { NextRequest, NextResponse } from 'next/server'

const NAMA_BULAN = ['Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dataStr = searchParams.get('data')
    if (!dataStr) return new NextResponse('Data tidak ditemukan', { status: 400 })

    const data = JSON.parse(decodeURIComponent(dataStr))
    const {
      namaSekolah, semester, tahunAjaran, tanggalMulai, tanggalSelesai,
      cakupan, namaGuru, namaMapel, namaRombel, jpPerMinggu,
      hasil, bulanDistribusi, hasilHari
    } = data

    // Dynamic import PDFKit (server-side)
    const PDFDocument = (await import('pdfkit')).default

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))

    await new Promise<void>((resolve) => {
      doc.on('end', resolve)

      const W = doc.page.width - 100 // usable width
      const primaryColor = '#6A197D'   // Ungu — warna utama
      const accentColor = '#FFDE59'    // Kuning — warna aksen
      const grayColor = '#6b7280'
      const lightGray = '#f1f5f9'
      const borderColor = '#cbd5e1'
      const FONT_REG = 'Times-Roman'
      const FONT_BOLD = 'Times-Bold'

      // ── HEADER ──────────────────────────────────────────────
      doc.rect(50, 40, W, 90).fill(primaryColor)

      doc.fillColor('white').font(FONT_BOLD).fontSize(13)
        .text('ANALISIS ALOKASI WAKTU', 60, 55, { width: W - 20, align: 'center' })

      doc.font(FONT_REG).fontSize(9).fillColor('#f3e6f7')
        .text('Satuan Pendidikan : ' + (namaSekolah || 'SMP Aisyiyah Boarding School'), 60, 76, { width: W - 20 })
        .text('Cakupan           : ' + (cakupan || 'Lembaga (Keseluruhan/Pusat)'), 60, 89)
        .text('Mata Pelajaran    : ' + (namaMapel || '-') + '   |   Kelas : ' + (namaRombel || '-'), 60, 102)
        .text('Semester          : ' + semester + '   |   Tahun Ajaran : ' + tahunAjaran, 60, 115)

      let y = 145

      // ── SECTION TITLE HELPER ────────────────────────────────
      const sectionTitle = (title: string) => {
        doc.rect(50, y, W, 20).fill(primaryColor)
        doc.fillColor('white').font(FONT_BOLD).fontSize(9)
          .text(title, 55, y + 5, { width: W - 10 })
        y += 28
      }

      const tableHeader = (cols: { label: string; width: number; align?: string }[]) => {
        doc.rect(50, y, W, 18).fill('#334155')
        let x = 50
        cols.forEach(col => {
          doc.fillColor('white').font(FONT_BOLD).fontSize(7.5)
            .text(col.label, x + 3, y + 4, { width: col.width - 6, align: (col.align as any) || 'left' })
          x += col.width
        })
        y += 18
      }

      const tableRow = (
        cols: { text: string; width: number; align?: string; bold?: boolean; color?: string }[],
        bg?: string
      ) => {
        if (bg) doc.rect(50, y, W, 16).fill(bg)
        else doc.rect(50, y, W, 16).stroke(borderColor)
        let x = 50
        cols.forEach(col => {
          doc.fillColor(col.color || '#1e293b')
            .font(col.bold ? FONT_BOLD : FONT_REG)
            .fontSize(7.5)
            .text(col.text, x + 3, y + 3, { width: col.width - 6, align: (col.align as any) || 'left' })
          x += col.width
        })
        // Draw column lines
        let lx = 50
        cols.forEach(col => {
          lx += col.width
          doc.moveTo(lx, y).lineTo(lx, y + 16).strokeColor(borderColor).lineWidth(0.5).stroke()
        })
        doc.rect(50, y, W, 16).stroke(borderColor)
        y += 16
      }

      // ── BAGIAN A: PERHITUNGAN JAM EFEKTIF ───────────────────
      sectionTitle('A. PERHITUNGAN MINGGU / JAM EFEKTIF')

      // Sub I dan II berdampingan
      const colW = (W - 10) / 2

      // Kiri: Jumlah Minggu
      doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(8)
        .text('I. Jumlah Minggu', 50, y)
      y += 14

      const colsI = [{ label: 'No', width: 25 }, { label: 'Bulan', width: colW - 60 }, { label: 'Jml. Minggu', width: 35, align: 'center' }]
      tableHeader(colsI)

      // Pengelompokan per bulan mengikuti bulanKey/bulanLabel yang sudah dihitung di sisi klien
      // (bulan "pemilik" minggu ditentukan dari hari Rabu, bukan hari Senin, supaya minggu yang
      // terpotong lintas-bulan tidak terhitung dobel — lihat catatan pada modul Minggu Efektif).
      const bulanMap: { [k: string]: { label: string; jml: number } } = {}
      if (hasil?.detail) {
        hasil.detail.forEach((d: any) => {
          const key = d.bulanKey || (() => {
            const tgl = new Date(d.tanggalMulai)
            return `${tgl.getFullYear()}-${String(tgl.getMonth() + 1).padStart(2, '0')}`
          })()
          const label = d.bulanLabel || (() => {
            const [yr, mo] = key.split('-')
            return `${NAMA_BULAN[Number(mo) - 1]} ${yr}`
          })()
          if (!bulanMap[key]) bulanMap[key] = { label, jml: 0 }
          bulanMap[key].jml++
        })
      }

      let totalMinggu = 0
      const bulanEntries = Object.entries(bulanMap).sort(([a], [b]) => a.localeCompare(b))
      bulanEntries.forEach(([, v], i) => {
        tableRow([
          { text: String(i + 1), width: 25, align: 'center' },
          { text: v.label, width: colW - 60 },
          { text: String(v.jml), width: 35, align: 'center', bold: true, color: primaryColor }
        ], i % 2 === 0 ? '#f8fafc' : 'white')
        totalMinggu += v.jml
      })
      tableRow([
        { text: '', width: 25 },
        { text: 'Jumlah', width: colW - 60, bold: true },
        { text: String(totalMinggu), width: 35, align: 'center', bold: true, color: primaryColor }
      ], '#f3e6f7')

      const yAfterI = y
      y = 200 // reset y untuk kolom kanan (berjalan paralel)
      // sebenarnya kita buat sekuensial karena PDFKit single-column
      // Lanjut II di bawah I
      y = yAfterI + 10

      doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(8)
        .text('II. Jumlah Minggu Tidak Efektif', 50, y)
      y += 14

      tableHeader([
        { label: 'Bulan', width: 100 },
        { label: 'Kegiatan', width: W - 150 },
        { label: 'Jml. Minggu', width: 50, align: 'center' }
      ])

      const tidakEfektifPerBulan: { [k: string]: { label: string; kegiatan: Set<string>, jml: number } } = {}
      if (hasil?.detail) {
        hasil.detail.filter((d: any) => !d.efektif).forEach((d: any) => {
          const key = d.bulanKey || (() => {
            const tgl = new Date(d.tanggalMulai)
            return `${tgl.getFullYear()}-${String(tgl.getMonth() + 1).padStart(2, '0')}`
          })()
          const label = d.bulanLabel || (() => {
            const [yr, mo] = key.split('-')
            return `${NAMA_BULAN[Number(mo) - 1]} ${yr}`
          })()
          if (!tidakEfektifPerBulan[key]) tidakEfektifPerBulan[key] = { label, kegiatan: new Set(), jml: 0 }
          tidakEfektifPerBulan[key].jml++
          ;(d.kegiatanDiMingguIni || []).forEach((k: string) => tidakEfektifPerBulan[key].kegiatan.add(k))
        })
      }

      let totalTE = 0
      const teEntries = Object.entries(tidakEfektifPerBulan).sort(([a], [b]) => a.localeCompare(b))
      teEntries.forEach(([, data], i) => {
        tableRow([
          { text: data.label, width: 100 },
          { text: [...data.kegiatan].join(', ') || '-', width: W - 150 },
          { text: String(data.jml), width: 50, align: 'center', bold: true, color: '#dc2626' }
        ], i % 2 === 0 ? '#fff7ed' : 'white')
        totalTE += data.jml
      })

      if (Object.keys(tidakEfektifPerBulan).length === 0) {
        tableRow([{ text: 'Tidak ada minggu tidak efektif', width: W, align: 'center', color: grayColor }])
      }

      tableRow([
        { text: 'Jumlah', width: W - 50, bold: true, align: 'right' },
        { text: String(totalTE), width: 50, align: 'center', bold: true, color: '#dc2626' }
      ], '#fee2e2')

      y += 8

      // III & IV
      const mingguEfektif = totalMinggu - totalTE
      doc.rect(50, y, W, 50).fill('#f3e6f7').stroke('#d9b8e3')
      doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(8.5)
        .text('III. JUMLAH MINGGU EFEKTIF', 58, y + 6)
      doc.font(FONT_REG).fontSize(8).fillColor('#334155')
        .text(`= Jumlah Minggu − Jumlah Minggu Tidak Efektif = ${totalMinggu} − ${totalTE} Minggu`, 58, y + 18)
      doc.font(FONT_BOLD).fontSize(11).fillColor(primaryColor)
        .text(`= ${mingguEfektif} Minggu`, 58, y + 30)
      y += 60

      doc.rect(50, y, W, 50).fill('#fff7d6').stroke(accentColor)
      doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(8.5)
        .text('IV. JUMLAH JAM EFEKTIF', 58, y + 6)
      const jpMgg = jpPerMinggu || 0
      const totalJp = mingguEfektif * jpMgg
      doc.font(FONT_REG).fontSize(8).fillColor('#334155')
        .text(`= Jumlah Minggu Efektif × Jumlah JP/Minggu = ${mingguEfektif} × ${jpMgg} JP/Minggu`, 58, y + 18)
      doc.font(FONT_BOLD).fontSize(11).fillColor(primaryColor)
        .text(`= ${totalJp} Jam Pelajaran`, 58, y + 30)
      y += 62

      // ── BAGIAN B: DISTRIBUSI ────────────────────────────────
      if (y > doc.page.height - 150) { doc.addPage(); y = 50 }

      sectionTitle('B. DISTRIBUSI ALOKASI WAKTU')

      doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(8)
        .text('I. Alokasi Waktu / Kompetensi Dasar / Materi Pokok:', 50, y)
      y += 12

      tableHeader([
        { label: 'No', width: 25 },
        { label: 'Materi Pokok / Kompetensi Dasar', width: W - 85 },
        { label: 'Alokasi (JP)', width: 60, align: 'center' }
      ])

      // Baris kosong untuk diisi manual (5 baris)
      for (let i = 0; i < 5; i++) {
        tableRow([
          { text: String(i + 1), width: 25, align: 'center', color: grayColor },
          { text: '', width: W - 85 },
          { text: '', width: 60, align: 'center' }
        ], i % 2 === 0 ? '#f8fafc' : 'white')
      }
      tableRow([
        { text: '', width: 25 },
        { text: 'Jumlah', width: W - 85, bold: true, align: 'right' },
        { text: '-', width: 60, align: 'center', bold: true }
      ], '#f3e6f7')

      y += 8
      doc.fillColor('#334155').font(FONT_REG).fontSize(8)
        .text(`II. Banyaknya Jam Cadangan = Jumlah Jam Efektif − Jumlah Alokasi Waktu/KD`, 50, y)
      y += 12
      doc.font(FONT_BOLD).fontSize(9).fillColor(primaryColor)
        .text(`= ${totalJp} Jam Pelajaran (diisi setelah distribusi KD dilengkapi)`, 60, y)

      y += 30

      // ── HARI EFEKTIF GURU (jika ada) ────────────────────────
      if (hasilHari && namaGuru) {
        if (y > doc.page.height - 100) { doc.addPage(); y = 50 }
        sectionTitle('C. HARI EFEKTIF GURU')

        doc.fillColor('#334155').font(FONT_REG).fontSize(8)
          .text(`Guru: ${namaGuru}   |   Mapel: ${namaMapel}   |   Kelas: ${namaRombel}`, 50, y)
        y += 14

        doc.rect(50, y, W, 44).fill('#fff7d6').stroke(accentColor)
        doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(8)
          .text(`Total Hari Mengajar Efektif : ${hasilHari.totalHariMengajar} hari`, 58, y + 6)
          .text(`Total JP Efektif             : ${hasilHari.totalJpEfektif} JP`, 58, y + 18)
          .text(`Distribusi Hari             : ${(hasilHari.perHari || []).map((h: any) => `${h.hari} (${h.jumlah}x)`).join(', ') || '-'}`, 58, y + 30)
        y += 54

        doc.fillColor(primaryColor).font(FONT_BOLD).fontSize(7.5)
          .text('* Catatan: Hari efektif mengajar dihitung dari hari mengajar aktual yang tidak bertepatan dengan hari libur,', 50, y)
        y += 10
        doc.text('  terlepas dari status efektif/tidak-efektif minggu tersebut secara keseluruhan.', 50, y)
        y += 16
      }

      // ── TANDA TANGAN ────────────────────────────────────────
      if (y > doc.page.height - 120) { doc.addPage(); y = 50 }
      y += 10
      doc.fillColor('#334155').font(FONT_REG).fontSize(8)
        .text(`Bandung, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50, y, { align: 'right' })
      y += 20

      const ttdY = y
      doc.font(FONT_REG).fontSize(8).fillColor('#334155')
        .text('Mengetahui,', 60, ttdY)
        .text('Kepala Sekolah,', 60, ttdY + 10)

      doc.text('Guru Mata Pelajaran,', 350, ttdY)

      doc.moveTo(60, ttdY + 55).lineTo(220, ttdY + 55).strokeColor(borderColor).lineWidth(0.5).stroke()
      doc.moveTo(350, ttdY + 55).lineTo(510, ttdY + 55).stroke()

      doc.font(FONT_BOLD).fontSize(8).fillColor(primaryColor)
        .text('__________________________', 60, ttdY + 57)
      doc.font(FONT_BOLD).fontSize(8).fillColor(primaryColor)
        .text(namaGuru || '__________________________', 350, ttdY + 57)

      doc.end()
    })

    const pdfBuffer = Buffer.concat(chunks)

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Alokasi_Waktu_${semester}_${tahunAjaran.replace('/', '-')}.pdf"`,
        'Content-Length': String(pdfBuffer.length)
      }
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return new NextResponse('Gagal membuat PDF: ' + String(err), { status: 500 })
  }
}