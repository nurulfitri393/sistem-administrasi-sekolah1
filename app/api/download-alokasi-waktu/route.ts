// FILE: app/api/download-alokasi-waktu/route.ts
// API Route untuk generate dan download PDF Analisis Alokasi Waktu
// Layout mengikuti persis format "Aplikasi Buku Kerja Guru" yang dipakai sekolah.

import { NextRequest, NextResponse } from 'next/server'

type Sel = { text: string; width: number; align?: 'left' | 'center' | 'right'; bold?: boolean; color?: string }

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const {
      namaSekolah, titiMangsa, kota,
      semester, tahunAjaran,
      namaGuru, namaMapel, namaRombel, jpPerMinggu, nuptkGuru,
      hasil, hasilHari,
      namaPenandatangan, nipPenandatangan, labelPenandatangan,
      distribusiTp,
    } = data
    void hasilHari // (tidak dipakai di layout ini, disimpan untuk kompatibilitas payload lama)

    const PDFDocument = (await import('pdfkit')).default

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 45, bottom: 45, left: 55, right: 55 }
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))

    await new Promise<void>((resolve) => {
      doc.on('end', resolve)

      const W = doc.page.width - 110
      const L = 55
      const DARK = '#000000'
      const FONT_REG = 'Times-Roman'
      const FONT_BOLD = 'Times-Bold'
      const borderColor = '#000000'
      const HEADER_BG = '#EDE3F3' // ungu SOFT untuk header tabel (bukan ungu tua)
      const PAD = 4

      let y = 45

      /**
       * Menggambar satu baris tabel pada posisi (x, y) dengan garis pembatas
       * di SETIAP kolom (bukan cuma garis atas/bawah), dan tinggi baris
       * otomatis menyesuaikan teks terpanjang di baris itu -- supaya teks
       * tidak pernah terpotong/menumpuk dengan baris di bawahnya.
       */
      function drawRow(x: number, yPos: number, cells: Sel[], opts?: { header?: boolean; minHeight?: number }): number {
        const header = !!opts?.header
        doc.font(header || cells.some(c => c.bold) ? FONT_BOLD : FONT_REG)
        doc.fontSize(7.5)
        let tinggi = opts?.minHeight || (header ? 14 : 13)
        cells.forEach(c => {
          const h = doc.heightOfString(c.text || '', { width: c.width - PAD * 2 }) + PAD * 2
          if (h > tinggi) tinggi = h
        })

        // Latar header (ungu soft)
        if (header) {
          doc.rect(x, yPos, cells.reduce((s, c) => s + c.width, 0), tinggi).fill(HEADER_BG)
        }

        // Garis kolom (vertikal) + isi teks
        let cx = x
        cells.forEach(c => {
          doc.rect(cx, yPos, c.width, tinggi).stroke(borderColor)
          doc.fillColor(c.color || DARK)
            .font(header || c.bold ? FONT_BOLD : FONT_REG)
            .fontSize(7.5)
            .text(c.text || '', cx + PAD, yPos + PAD - 1, { width: c.width - PAD * 2, align: c.align || 'left' })
          cx += c.width
        })
        doc.fillColor(DARK)
        return yPos + tinggi
      }

      // ── JUDUL ──
      doc.fillColor(DARK).font(FONT_BOLD).fontSize(13)
        .text('ANALISIS ALOKASI WAKTU', L, y, { width: W, align: 'center' })
      y += 22

      // ── BARIS IDENTITAS (Label : Value) ──
      doc.font(FONT_REG).fontSize(9.5)
      const baris = (label: string, value: string) => {
        doc.text(`${label}`, L, y, { continued: false, width: 140 })
        doc.text(`: ${value || ''}`, L + 105, y, { width: W - 105 })
        y += 13.5
      }
      baris('Satuan Pendidikan', namaSekolah || '')
      if (namaMapel) baris('Mata Pelajaran', namaMapel)
      if (namaRombel) baris('Kelas', namaRombel)
      baris('Semester', semester || '')
      baris('Tahun Ajaran', tahunAjaran || '')
      baris('Jumlah Jam Pelajaran', `${jpPerMinggu || 0} JP/Minggu`)
      if (namaGuru) baris('Guru Mata Pelajaran', namaGuru)

      y += 4
      doc.moveTo(L, y).lineTo(L + W, y).strokeColor(borderColor).lineWidth(0.75).stroke()
      y += 12

      doc.font(FONT_BOLD).fontSize(10.5)
        .text('PERHITUNGAN MINGGU/JAM EFEKTIF', L, y, { width: W, align: 'center' })
      y += 18

      doc.font(FONT_BOLD).fontSize(9.5)
        .text('A. PERHITUNGAN JAM EFEKTIF', L, y)
      y += 14

      // ── I & II BERDAMPINGAN (2 kolom) ──
      const colGap = 10
      const colW = (W - colGap) / 2
      const col1X = L
      const col2X = L + colW + colGap

      doc.font(FONT_BOLD).fontSize(8.5).text('I. Jumlah Minggu :', col1X, y)
      doc.text('II. Jumlah Minggu Tidak Efektif :', col2X, y)
      y += 13
      const yTabelAwal = y

      // -- Kolom I: No | Bulan | Jml Minggu --
      const bulanMap: { [k: string]: { label: string; jml: number } } = {}
      if (hasil?.detail) {
        hasil.detail.forEach((d: any) => {
          const key = d.bulanKey
          if (!bulanMap[key]) bulanMap[key] = { label: d.bulanLabel, jml: 0 }
          bulanMap[key].jml++
        })
      }
      const bulanEntries = Object.entries(bulanMap).sort(([a], [b]) => a.localeCompare(b))
      const c1w = [22, colW - 22 - 42, 42]

      let yy = yTabelAwal
      yy = drawRow(col1X, yy, [
        { text: 'No', width: c1w[0], align: 'center' },
        { text: 'Bulan', width: c1w[1] },
        { text: 'Jml. Minggu', width: c1w[2], align: 'center' },
      ], { header: true })

      let totalMinggu = 0
      bulanEntries.forEach(([, v], i) => {
        yy = drawRow(col1X, yy, [
          { text: String(i + 1), width: c1w[0], align: 'center' },
          { text: v.label, width: c1w[1] },
          { text: String(v.jml), width: c1w[2], align: 'center' },
        ])
        totalMinggu += v.jml
      })
      yy = drawRow(col1X, yy, [
        { text: '', width: c1w[0] },
        { text: 'Jumlah', width: c1w[1], bold: true },
        { text: String(totalMinggu), width: c1w[2], align: 'center', bold: true },
      ])
      const yAkhirKol1 = yy

      // -- Kolom II: Bulan | Kegiatan | Jml Minggu --
      const tidakEfektifPerBulan: { [k: string]: { label: string; kegiatan: Set<string>, jml: number } } = {}
      if (hasil?.detail) {
        hasil.detail.filter((d: any) => !d.efektif).forEach((d: any) => {
          const key = d.bulanKey
          if (!tidakEfektifPerBulan[key]) tidakEfektifPerBulan[key] = { label: d.bulanLabel, kegiatan: new Set(), jml: 0 }
          tidakEfektifPerBulan[key].jml++
          ;(d.kegiatanDiMingguIni || []).forEach((k: string) => tidakEfektifPerBulan[key].kegiatan.add(k))
        })
      }
      const teEntries = Object.entries(tidakEfektifPerBulan).sort(([a], [b]) => a.localeCompare(b))
      const c2w = [45, colW - 45 - 40, 40]

      yy = yTabelAwal
      yy = drawRow(col2X, yy, [
        { text: 'Bulan', width: c2w[0] },
        { text: 'Kegiatan', width: c2w[1] },
        { text: 'Jml. Minggu', width: c2w[2], align: 'center' },
      ], { header: true })

      let totalTE = 0
      if (teEntries.length === 0) {
        yy = drawRow(col2X, yy, [{ text: 'Tidak ada minggu tidak efektif', width: colW, align: 'center', color: '#6b7280' }])
      } else {
        teEntries.forEach(([, v]) => {
          const kegiatanTxt = [...v.kegiatan].join(', ') || '-'
          yy = drawRow(col2X, yy, [
            { text: v.label, width: c2w[0] },
            { text: kegiatanTxt, width: c2w[1] },
            { text: String(v.jml), width: c2w[2], align: 'center' },
          ])
          totalTE += v.jml
        })
      }
      yy = drawRow(col2X, yy, [
        { text: '', width: c2w[0] },
        { text: 'Jumlah', width: c2w[1], bold: true },
        { text: String(totalTE), width: c2w[2], align: 'center', bold: true },
      ])
      const yAkhirKol2 = yy

      y = Math.max(yAkhirKol1, yAkhirKol2) + 14

      // ── III & IV (teks polos, tanpa kotak) ──
      const mingguEfektif = totalMinggu - totalTE
      doc.font(FONT_BOLD).fontSize(8.5).fillColor(DARK)
        .text('III. JUMLAH MINGGU EFEKTIF', L, y, { continued: true })
        .font(FONT_REG).text('= Jumlah Minggu - Jumlah Minggu Tidak Efektif', { continued: false })
      y += 12
      doc.font(FONT_REG).fontSize(8.5).text(`= ${totalMinggu} - ${totalTE} Minggu`, L + 15, y)
      y += 12
      doc.font(FONT_BOLD).fontSize(9).text(`= ${mingguEfektif} Minggu`, L + 15, y)
      y += 18

      const jpMgg = jpPerMinggu || 0
      const totalJp = mingguEfektif * jpMgg
      doc.font(FONT_BOLD).fontSize(8.5)
        .text('IV. JUMLAH JAM EFEKTIF', L, y, { continued: true })
        .font(FONT_REG).text('= Jumlah Minggu Efektif x Jumlah Jam Pelajaran', { continued: false })
      y += 12
      doc.font(FONT_REG).fontSize(8.5).text(`= ${mingguEfektif} x ${jpMgg} Jam Pelajaran/Minggu`, L + 15, y)
      y += 12
      doc.font(FONT_BOLD).fontSize(9).text(`= ${totalJp} Jam Pelajaran`, L + 15, y)
      y += 22

      // ── BAGIAN B: DISTRIBUSI ────────────────────────────────
      if (y > doc.page.height - 200) { doc.addPage(); y = 50 }

      doc.font(FONT_BOLD).fontSize(9.5).text('B. DISTRIBUSI ALOKASI WAKTU', L, y)
      y += 14
      doc.font(FONT_REG).fontSize(8.5).text('I. Alokasi Waktu/KD:', L, y)
      y += 13

      const dc = [25, W - 25 - 65, 65]
      y = drawRow(L, y, [
        { text: 'No', width: dc[0], align: 'center' },
        { text: 'Tujuan Pembelajaran', width: dc[1] },
        { text: 'Alokasi Waktu (JP)', width: dc[2], align: 'center' },
      ], { header: true })

      let totalAlokasi = 0
      const barisTp: { nomor: string; deskripsi: string; jp: number }[] = distribusiTp && distribusiTp.length > 0
        ? distribusiTp
        : Array.from({ length: 5 }, () => ({ nomor: '', deskripsi: '', jp: 0 }))

      barisTp.forEach((tp, i) => {
        if (y > doc.page.height - 90) { doc.addPage(); y = 50 }
        y = drawRow(L, y, [
          { text: String(i + 1), width: dc[0], align: 'center' },
          { text: tp.deskripsi || '', width: dc[1] },
          { text: tp.jp ? String(tp.jp) : '', width: dc[2], align: 'center' },
        ])
        totalAlokasi += (tp.jp || 0)
      })
      y = drawRow(L, y, [
        { text: '', width: dc[0] },
        { text: 'Jumlah', width: dc[1], bold: true },
        { text: String(totalAlokasi), width: dc[2], align: 'center', bold: true },
      ])
      y += 10

      if (y > doc.page.height - 120) { doc.addPage(); y = 50 }

      const jpCadangan = Math.max(0, totalJp - totalAlokasi)
      doc.font(FONT_REG).fontSize(8.5)
        .text('II. Banyaknya Jam Cadangan', L, y, { continued: true })
        .text(' = Jumlah jam efektif - Jumlah alokasi waktu/KD', { continued: false })
      y += 12
      doc.font(FONT_BOLD).fontSize(9).text(`= ${jpCadangan} Jam Pelajaran`, L + 15, y)
      y += 26

      // ── TANDA TANGAN ──────────────────────────────────────
      // Aturan penempatan (berlaku sama di SEMUA dokumen unduhan):
      // Kepala Sekolah/Mudir ("Mengetahui") SELALU di KIRI. Pihak lain
      // (Guru Mapel, Waka Kurikulum, dst) SELALU di KANAN -- dan titi
      // mangsa sejajar dengan pihak KANAN itu. Tidak ada garis TTD.
      if (y > doc.page.height - 160) { doc.addPage(); y = 50 }

      const kolomKiriX = L
      const kolomKiriW = W / 2 - 10
      const kolomKananX = L + W / 2
      const kolomKananW = W / 2

      const tanggalHariIni = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      const titiMangsaFinal = titiMangsa || `${kota || 'Bandung'}, ${tanggalHariIni}`
      doc.font(FONT_REG).fontSize(9).fillColor(DARK)
      if (namaGuru) {
        // Sejajar (rata kiri, titik X sama persis) dengan label "Guru Mata
        // Pelajaran," di bawahnya -- pihak KANAN blok tanda tangan.
        doc.text(titiMangsaFinal, kolomKananX, y, { width: kolomKananW })
      } else {
        doc.text(titiMangsaFinal, L, y, { width: W, align: 'right' })
      }
      y += 16

      doc.text('Mengetahui,', kolomKiriX, y)
      y += 12

      const ttdY = y
      doc.font(FONT_REG).fontSize(9)
      doc.text(`${labelPenandatangan || 'Kepala Sekolah'},`, kolomKiriX, ttdY)
      if (namaGuru) doc.text('Guru Mata Pelajaran,', kolomKananX, ttdY)

      // Tanpa garis TTD -- langsung nama, jarak vertikal cukup untuk "tanda tangan basah".
      const namaY = ttdY + 42

      doc.font(FONT_BOLD).fontSize(9)
        .text(namaPenandatangan || '', kolomKiriX, namaY, { width: kolomKiriW })
      // Mudir (Lembaga Pusat) TIDAK pakai NUPTK. Kepala Sekolah Unit tetap pakai.
      if (labelPenandatangan !== 'Mudir') {
        doc.font(FONT_REG).fontSize(8)
          .text(`NUPTK: ${nipPenandatangan || '-'}`, kolomKiriX, namaY + 12, { width: kolomKiriW })
      }

      if (namaGuru) {
        doc.font(FONT_BOLD).fontSize(9)
          .text(namaGuru, kolomKananX, namaY, { width: kolomKananW - 20 })
        doc.font(FONT_REG).fontSize(8)
          .text(`NUPTK: ${nuptkGuru || '-'}`, kolomKananX, namaY + 12, { width: kolomKananW - 20 })
      }

      doc.end()
    })

    const pdfBuffer = Buffer.concat(chunks)

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Alokasi_Waktu_${semester}_${String(tahunAjaran || '').replace('/', '-')}.pdf"`,
        'Content-Length': String(pdfBuffer.length)
      }
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return new NextResponse('Gagal membuat PDF: ' + String(err), { status: 500 })
  }
}
