// FILE: app/api/download-cp-tp-atp-excel/route.ts
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { namaSekolah, namaMapel, namaGuru, tahunAjaran, kelas, semester, cp, tp, atp, daftarTp } = body
    const semLabel = semester === '1' ? 'Ganjil' : 'Genap'

    const wb = XLSX.utils.book_new()

    // ════════════════════════════════════════════
    // SHEET 1: CP
    // ════════════════════════════════════════════
    const cpRows: any[][] = []
    cpRows.push([`CAPAIAN PEMBELAJARAN (CP)`])
    cpRows.push([`Satuan Pendidikan: ${namaSekolah || '-'}  |  Guru Pengampu: ${namaGuru || '-'}  |  Tahun Ajaran: ${tahunAjaran || '-'}`])
    cpRows.push([`Mata Pelajaran: ${namaMapel || '-'}  |  Kelas: ${kelas || '-'}  |  Semester: ${semLabel}`])
    cpRows.push([])
    cpRows.push(['No', 'Fase', 'Kelas', 'Elemen', 'Deskripsi Capaian Pembelajaran'])
    ;(cp || []).forEach((c: any, i: number) => {
      cpRows.push([i + 1, c.fase, c.kelas, c.elemen || '-', c.deskripsi])
    })
    if (!cp || cp.length === 0) cpRows.push(['-', '-', '-', '-', 'Belum ada data CP'])

    const wsCp = XLSX.utils.aoa_to_sheet(cpRows)
    wsCp['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 8 }, { wch: 20 }, { wch: 90 }]
    wsCp['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
    ]
    XLSX.utils.book_append_sheet(wb, wsCp, 'CP')

    // ════════════════════════════════════════════
    // SHEET 2: TP
    // ════════════════════════════════════════════
    const tpRows: any[][] = []
    tpRows.push([`TUJUAN PEMBELAJARAN (TP)`])
    tpRows.push([`Satuan Pendidikan: ${namaSekolah || '-'}  |  Guru Pengampu: ${namaGuru || '-'}  |  Tahun Ajaran: ${tahunAjaran || '-'}`])
    tpRows.push([`Mata Pelajaran: ${namaMapel || '-'}  |  Kelas: ${kelas || '-'}  |  Semester: ${semLabel}`])
    tpRows.push([])
    tpRows.push(['No', 'CP Rujukan', 'Deskripsi Tujuan Pembelajaran', 'Dimensi Profil Pelajar Pancasila'])

    const tpByCp: { [k: string]: any[] } = {}
    ;(tp || []).forEach((t: any) => {
      if (!tpByCp[t.cpId]) tpByCp[t.cpId] = []
      tpByCp[t.cpId].push(t)
    })

    let noTp = 1
    Object.entries(tpByCp).forEach(([cpId, list]) => {
      const cpRef = (cp || []).find((c: any) => c.id === cpId)
      const cpDesc = cpRef ? cpRef.deskripsi.slice(0, 70) + '...' : '-'
      list.forEach((t: any) => {
        tpRows.push([
          noTp++,
          cpDesc,
          t.deskripsi,
          (t.dimensiPancasila || []).join(', ') || '-'
        ])
      })
    })
    if (!tp || tp.length === 0) tpRows.push(['-', '-', 'Belum ada data TP', '-'])

    const wsTp = XLSX.utils.aoa_to_sheet(tpRows)
    wsTp['!cols'] = [{ wch: 5 }, { wch: 50 }, { wch: 70 }, { wch: 35 }]
    wsTp['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
    ]
    XLSX.utils.book_append_sheet(wb, wsTp, 'TP')

    // ════════════════════════════════════════════
    // SHEET 3: ATP (Utama, format Alur Tujuan Pembelajaran)
    // ════════════════════════════════════════════
    const atpRows: any[][] = []
    atpRows.push([`ALUR TUJUAN PEMBELAJARAN (ATP)`])
    atpRows.push([`Satuan Pendidikan: ${namaSekolah || '-'}  |  Guru Pengampu: ${namaGuru || '-'}  |  Tahun Ajaran: ${tahunAjaran || '-'}`])
    atpRows.push([`Mata Pelajaran: ${namaMapel || '-'}  |  Kelas: ${kelas || '-'}  |  Semester: ${semLabel}`])
    atpRows.push([])
    atpRows.push([
      'No', 'Tujuan Pembelajaran', 'Materi Pokok', 'Sub Materi',
      'Alokasi JP', 'Jml. Pertemuan', 'Minggu Ke-', 'Metode Pembelajaran', 'Asesmen'
    ])

    let totalJp = 0
    ;(atp || [])
      .sort((a: any, b: any) => a.urutanGlobal - b.urutanGlobal)
      .forEach((a: any, i: number) => {
        const tpRef = (daftarTp || []).find((t: any) => t.id === a.tpId)
        totalJp += a.alokasiJp || 0
        atpRows.push([
          i + 1,
          tpRef?.deskripsi || '-',
          a.materi,
          a.subMateri || '-',
          a.alokasiJp,
          a.pertemuan || 1,
          a.referensiMinggu > 0 ? a.referensiMinggu : '-',
          a.metode || '-',
          a.asesmen || '-'
        ])
      })

    if (!atp || atp.length === 0) {
      atpRows.push(['-', '-', 'Belum ada data ATP', '-', '-', '-', '-', '-', '-'])
    } else {
      atpRows.push([])
      atpRows.push(['', '', '', 'TOTAL ALOKASI JP', totalJp, '', '', '', ''])
    }

    const wsAtp = XLSX.utils.aoa_to_sheet(atpRows)
    wsAtp['!cols'] = [
      { wch: 5 }, { wch: 50 }, { wch: 30 }, { wch: 25 },
      { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 18 }
    ]
    wsAtp['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } },
    ]
    XLSX.utils.book_append_sheet(wb, wsAtp, 'ATP')

    // ════════════════════════════════════════════
    // SHEET 4: Rekap Distribusi per Bulan (opsional, sinkron minggu)
    // ════════════════════════════════════════════
    const rekapRows: any[][] = []
    rekapRows.push(['REKAP DISTRIBUSI ALOKASI WAKTU ATP'])
    rekapRows.push([`${namaMapel || '-'} | Kelas ${kelas || '-'} | Semester ${semLabel} | Guru: ${namaGuru || '-'} | TA: ${tahunAjaran || '-'}`])
    rekapRows.push([])
    rekapRows.push(['No', 'Materi', 'Alokasi JP', 'Minggu Ke-', 'Kumulatif JP'])

    let kumulatif = 0
    ;(atp || [])
      .sort((a: any, b: any) => a.urutanGlobal - b.urutanGlobal)
      .forEach((a: any, i: number) => {
        kumulatif += a.alokasiJp || 0
        rekapRows.push([i + 1, a.materi, a.alokasiJp, a.referensiMinggu > 0 ? a.referensiMinggu : '-', kumulatif])
      })

    if (!atp || atp.length === 0) rekapRows.push(['-', 'Belum ada data', '-', '-', '-'])

    const wsRekap = XLSX.utils.aoa_to_sheet(rekapRows)
    wsRekap['!cols'] = [{ wch: 5 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 15 }]
    wsRekap['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    ]
    XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Distribusi')

    // ════════════════════════════════════════════
    // EXPORT
    // ════════════════════════════════════════════
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="CP_TP_ATP_${namaMapel}_Kelas${kelas}_Sem${semLabel}.xlsx"`,
        'Content-Length': String(buf.length)
      }
    })
  } catch (err) {
    console.error(err)
    return new NextResponse('Gagal generate Excel: ' + String(err), { status: 500 })
  }
}