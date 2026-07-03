// FILE: app/api/download-cp-tp-atp-pdf/route.ts
import { NextRequest, NextResponse } from 'next/server'

// pdfkit butuh akses filesystem Node.js (font AFM, dll) — WAJIB Node.js runtime,
// tidak bisa berjalan di Edge Runtime. Tanpa baris ini, di beberapa konfigurasi
// project route akan gagal saat pdfkit di-load dan Next.js akan mengembalikan
// halaman error HTML generik alih-alih respons dari blok try/catch di bawah.
export const runtime = 'nodejs'
// Pastikan route ini tidak di-cache statis (selalu generate PDF baru per request)
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { namaSekolah, namaMapel, namaGuru, tahunAjaran, kelas, semester, cp, tp, atp, daftarCp, daftarTp } = body

    const PDFDocument = (await import('pdfkit')).default
    const doc = new PDFDocument({ size: 'A4', margins: { top: 45, bottom: 45, left: 45, right: 45 }, bufferPages: true })

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))

    await new Promise<void>(resolve => {
      doc.on('end', resolve)

      const W = doc.page.width - 90
      const L = 45
      const DARK = '#0f172a'
      const PRIMARY = '#1e3a8a'
      const ACCENT = '#3b82f6'
      const GRAY = '#64748b'
      const LIGHT = '#f8fafc'
      const BORDER = '#e2e8f0'
      const GREEN = '#166534'
      const GREEN_BG = '#f0fdf4'
      const VIOLET = '#4c1d95'
      const VIOLET_BG = '#f5f3ff'

      let y = 45

      // ── helper: pageCheck ──
      const pageCheck = (needed = 60) => {
        if (y + needed > doc.page.height - 60) { doc.addPage(); y = 45 }
      }

      // ── helper: drawRect ──
      const rect = (x: number, yy: number, w: number, h: number, fill: string, stroke?: string) => {
        doc.rect(x, yy, w, h)
        if (stroke) doc.fillAndStroke(fill, stroke)
        else doc.fill(fill)
      }

      // ── helper: text shorthand ──
      const txt = (s: string, x: number, yy: number, opts: any = {}) => {
        doc.fillColor(opts.color || DARK)
           .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
           .fontSize(opts.size || 8)
           .text(s, x, yy, { width: opts.w, align: opts.align || 'left', lineBreak: opts.wrap !== false })
      }

      // ══════════════════════════════════════════
      // HALAMAN 1: CP + TP
      // ══════════════════════════════════════════

      // Header biru
      rect(L, y, W, 92, PRIMARY)
      txt('CAPAIAN PEMBELAJARAN, TUJUAN PEMBELAJARAN', L + 10, y + 8,
        { bold: true, size: 12, color: 'white', w: W - 20, align: 'center' })
      txt('& ALUR TUJUAN PEMBELAJARAN (ATP)', L + 10, y + 23,
        { bold: true, size: 10, color: '#bfdbfe', w: W - 20, align: 'center' })

      doc.moveTo(L + 10, y + 37).lineTo(L + W - 10, y + 37).strokeColor('#3b82f6').lineWidth(0.5).stroke()

      const metaY = y + 42
      txt(`Satuan Pendidikan : ${namaSekolah || '-'}`, L + 10, metaY, { size: 7.5, color: '#bfdbfe', w: (W - 20) / 2 })
      txt(`Guru Pengampu     : ${namaGuru || '-'}`, L + 10, metaY + 11, { size: 7.5, color: '#bfdbfe', w: (W - 20) / 2 })
      txt(`Mata Pelajaran    : ${namaMapel || '-'}`, L + 10, metaY + 22, { size: 7.5, color: '#bfdbfe', w: (W - 20) / 2 })
      txt(`Kelas             : ${kelas || '-'}`, L + W / 2, metaY, { size: 7.5, color: '#bfdbfe', w: (W - 20) / 2 })
      txt(`Semester          : ${semester === '1' ? 'Ganjil (1)' : 'Genap (2)'}`, L + W / 2, metaY + 11, { size: 7.5, color: '#bfdbfe', w: (W - 20) / 2 })
      txt(`Tahun Ajaran      : ${tahunAjaran || '-'}`, L + W / 2, metaY + 22, { size: 7.5, color: '#bfdbfe', w: (W - 20) / 2 })

      y += 104

      // ── BAGIAN A: CAPAIAN PEMBELAJARAN ──────────────────
      rect(L, y, W, 18, PRIMARY)
      txt('A. CAPAIAN PEMBELAJARAN (CP)', L + 8, y + 4, { bold: true, size: 8.5, color: 'white', w: W - 16 })
      y += 22

      if (!cp || cp.length === 0) {
        rect(L, y, W, 20, LIGHT, BORDER)
        txt('Belum ada data CP.', L + 8, y + 5, { size: 7.5, color: GRAY, w: W - 16 })
        y += 24
      } else {
        cp.forEach((c: any, i: number) => {
          pageCheck(80)
          const boxH = 16 + Math.ceil(c.deskripsi.length / 95) * 11 + (c.elemen ? 14 : 0) + 6

          // CP header strip
          rect(L, y, W, 16, '#dbeafe', BORDER)
          txt(`CP ${i + 1}`, L + 6, y + 3, { bold: true, size: 8, color: PRIMARY, w: 30 })
          txt(`Fase ${c.fase}  |  Kelas ${c.kelas}`, L + 40, y + 3, { size: 7.5, color: ACCENT, w: 120 })
          if (c.elemen) txt(`Elemen: ${c.elemen}`, L + 180, y + 3, { size: 7.5, color: VIOLET, w: W - 190 })
          y += 16

          // CP body
          rect(L, y, W, boxH - 16, '#f0f9ff', BORDER)
          let cy = y + 5
          txt(c.deskripsi, L + 8, cy, { size: 7.5, color: DARK, w: W - 16, wrap: true })
          cy += Math.ceil(c.deskripsi.length / 95) * 11 + 4
          y = cy + 4
        })
      }

      y += 6

      // ── BAGIAN B: TUJUAN PEMBELAJARAN ───────────────────
      pageCheck(30)
      rect(L, y, W, 18, '#1d4ed8')
      txt('B. TUJUAN PEMBELAJARAN (TP)', L + 8, y + 4, { bold: true, size: 8.5, color: 'white', w: W - 16 })
      y += 22

      if (!tp || tp.length === 0) {
        rect(L, y, W, 20, LIGHT, BORDER)
        txt('Belum ada data TP.', L + 8, y + 5, { size: 7.5, color: GRAY, w: W - 16 })
        y += 24
      } else {
        // Group TP by cpId
        const tpByCp: { [cpId: string]: any[] } = {}
        tp.forEach((t: any) => {
          if (!tpByCp[t.cpId]) tpByCp[t.cpId] = []
          tpByCp[t.cpId].push(t)
        })

        Object.entries(tpByCp).forEach(([cpId, tpList]) => {
          const cpRef = (cp || []).find((c: any) => c.id === cpId)
          if (!cpRef) return

          pageCheck(30)
          rect(L, y, W, 14, '#eff6ff', BORDER)
          txt(`CP Rujukan: ${cpRef.deskripsi.slice(0, 90)}${cpRef.deskripsi.length > 90 ? '...' : ''}`,
            L + 6, y + 3, { size: 7, color: PRIMARY, w: W - 12 })
          y += 14

          tpList.forEach((t: any, ti: number) => {
            pageCheck(60)
            const lines = Math.ceil(t.deskripsi.length / 92)
            const dimH = t.dimensiPancasila?.length > 0 ? 14 : 0
            const rowH = 14 + lines * 11 + dimH + 8

            const bg = ti % 2 === 0 ? '#f8fafc' : 'white'
            rect(L, y, W, rowH, bg, BORDER)

            // Nomor lingkaran
            rect(L + 6, y + 5, 16, 16, '#1d4ed8')
            txt(String(ti + 1), L + 6, y + 8, { bold: true, size: 7.5, color: 'white', w: 16, align: 'center' })

            txt(t.deskripsi, L + 28, y + 5, { size: 7.5, color: DARK, w: W - 36, wrap: true })

            let iy = y + 5 + lines * 11 + 4
            if (t.dimensiPancasila?.length > 0) {
              let dx = L + 28
              t.dimensiPancasila.forEach((d: string) => {
                const dw = d.length * 4.5 + 10
                rect(dx, iy, dw, 11, '#ede9fe', '#c4b5fd')
                txt(d, dx + 4, iy + 1.5, { size: 6.5, color: VIOLET, w: dw - 8 })
                dx += dw + 4
              })
            }
            y += rowH
          })
          y += 4
        })
      }

      // ══════════════════════════════════════════
      // HALAMAN BARU: ATP
      // ══════════════════════════════════════════
      doc.addPage()
      y = 45

      // Sub-header ATP
      rect(L, y, W, 70, '#1e1b4b')
      txt('C. ALUR TUJUAN PEMBELAJARAN (ATP)', L + 10, y + 8, { bold: true, size: 11, color: 'white', w: W - 20, align: 'center' })
      txt(`${namaMapel}  ·  Kelas ${kelas}  ·  Semester ${semester === '1' ? 'Ganjil' : 'Genap'}  ·  TA ${tahunAjaran || '-'}`,
        L + 10, y + 24, { size: 8, color: '#a5b4fc', w: W - 20, align: 'center' })
      txt(`Guru Pengampu: ${namaGuru || '-'}  ·  ${namaSekolah || '-'}`,
        L + 10, y + 36, { size: 7.5, color: '#c7d2fe', w: W - 20, align: 'center' })
      const totalJp = (atp || []).reduce((s: number, a: any) => s + (a.alokasiJp || 0), 0)
      txt(`Total JP: ${totalJp} JP  ·  Total Item: ${(atp || []).length}`,
        L + 10, y + 50, { bold: true, size: 8, color: '#c7d2fe', w: W - 20, align: 'center' })
      y += 80

      if (!atp || atp.length === 0) {
        rect(L, y, W, 24, LIGHT, BORDER)
        txt('Belum ada data ATP untuk filter ini.', L + 8, y + 7, { size: 8, color: GRAY, w: W - 16, align: 'center' })
        y += 28
      } else {
        // Tabel header
        const COL = {
          no: 22, materi: 120, sub: 85, tp: 100, jp: 28, ptm: 28, mgg: 28, metode: 45, asesmen: 45
        }
        const totalW = Object.values(COL).reduce((a, b) => a + b, 0)

        const drawTableHeader = () => {
          rect(L, y, W, 20, '#1e1b4b')
          let cx = L
          const headers = [
            ['No', COL.no, 'center'],
            ['Materi Pokok', COL.materi, 'left'],
            ['Sub Materi', COL.sub, 'left'],
            ['Tujuan Pembelajaran', COL.tp, 'left'],
            ['JP', COL.jp, 'center'],
            ['Ptm', COL.ptm, 'center'],
            ['Mgg', COL.mgg, 'center'],
            ['Metode', COL.metode, 'center'],
            ['Asesmen', COL.asesmen, 'center'],
          ]
          headers.forEach(([label, w, align]) => {
            txt(label as string, cx + 3, y + 5,
              { bold: true, size: 7, color: 'white', w: (w as number) - 6, align: align as any })
            cx += w as number
          })
          y += 20
        }
        drawTableHeader()

        let cumJp = 0
        atp.forEach((a: any, i: number) => {
          pageCheck(28)
          if (y === 45) drawTableHeader() // Setelah page break

          const tpRef = (daftarTp || []).find((t: any) => t.id === a.tpId)
          const descTP = tpRef ? tpRef.deskripsi.slice(0, 55) + (tpRef.deskripsi.length > 55 ? '…' : '') : '-'
          const bg = i % 2 === 0 ? '#f8fafc' : 'white'
          const rowH = 22

          rect(L, y, W, rowH, bg, BORDER)

          let cx = L
          // Kolom vertikal lines
          const drawCell = (text: string, w: number, opts: any = {}) => {
            txt(text, cx + 3, y + (rowH - 9) / 2, { size: 7, color: opts.color || DARK, w: w - 6, align: opts.align || 'left', bold: opts.bold })
            doc.moveTo(cx + w, y).lineTo(cx + w, y + rowH).strokeColor(BORDER).lineWidth(0.4).stroke()
            cx += w
          }

          cumJp += a.alokasiJp || 0
          drawCell(String(i + 1), COL.no, { align: 'center', bold: true, color: '#4338ca' })
          drawCell(a.materi || '-', COL.materi, { bold: true })
          drawCell(a.subMateri || '-', COL.sub, { color: GRAY })
          drawCell(descTP, COL.tp, { color: '#374151' })
          drawCell(String(a.alokasiJp || 0) + ' JP', COL.jp, { align: 'center', bold: true, color: '#1d4ed8' })
          drawCell(String(a.pertemuan || 1) + 'x', COL.ptm, { align: 'center' })
          drawCell(a.referensiMinggu > 0 ? `M${a.referensiMinggu}` : '-', COL.mgg, { align: 'center', color: GRAY })
          drawCell(a.metode || '-', COL.metode, { align: 'center', color: '#92400e' })
          drawCell(a.asesmen || '-', COL.asesmen, { align: 'center', color: '#065f46' })

          doc.rect(L, y, W, rowH).stroke(BORDER)
          y += rowH
        })

        // Footer baris total
        rect(L, y, W, 20, '#e0e7ff', BORDER)
        txt('TOTAL JP SEMESTER', L + 8, y + 5, { bold: true, size: 8, color: PRIMARY, w: W - 60 })
        txt(`${totalJp} JP`, L + W - 55, y + 5, { bold: true, size: 10, color: PRIMARY, w: 50, align: 'center' })
        y += 24
      }

      // ── TANDA TANGAN ──────────────────────────────────────
      pageCheck(80)
      y += 10
      const now = new Date()
      txt(`${namaSekolah || 'Bandung'}, ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        L, y, { size: 8, color: GRAY, w: W, align: 'right' })
      y += 20

      const col1X = L + 30
      const col2X = L + W - 160

      txt('Mengetahui,', col1X, y, { size: 8, color: DARK })
      txt('Guru Mata Pelajaran,', col2X, y, { size: 8, color: DARK })
      txt('Kepala Sekolah,', col1X, y + 10, { size: 8, color: DARK })
      y += 56
      doc.moveTo(col1X, y).lineTo(col1X + 130, y).strokeColor(BORDER).lineWidth(0.5).stroke()
      doc.moveTo(col2X, y).lineTo(col2X + 130, y).stroke()
      y += 4
      txt('_______________________________', col1X, y, { size: 7, color: GRAY })
      txt(namaGuru || '_______________________________', col2X, y, { size: 7.5, bold: !!namaGuru, color: namaGuru ? DARK : GRAY })

      // ── PAGE NUMBERS ──────────────────────────────────────
      const range = doc.bufferedPageRange()
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i)
        doc.fillColor(GRAY).font('Helvetica').fontSize(7)
          .text(`Halaman ${i + 1} dari ${range.count}  ·  ${namaMapel} · Kelas ${kelas} · Semester ${semester === '1' ? 'Ganjil' : 'Genap'}`,
            L, doc.page.height - 35, { width: W, align: 'center' })
        doc.moveTo(L, doc.page.height - 40).lineTo(L + W, doc.page.height - 40)
          .strokeColor('#e2e8f0').lineWidth(0.5).stroke()
      }

      doc.end()
    })

    const pdf = Buffer.concat(chunks)
    const semLabel = semester === '1' ? 'Ganjil' : 'Genap'
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="CP_TP_ATP_${namaMapel}_Kelas${kelas}_Sem${semLabel}.pdf"`,
        'Content-Length': String(pdf.length)
      }
    })
  } catch (err) {
    console.error(err)
    return new NextResponse('Gagal generate PDF: ' + String(err), { status: 500 })
  }
}