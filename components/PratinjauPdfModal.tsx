'use client'

import { X, Download } from 'lucide-react'

/**
 * Modal pratinjau PDF sederhana — dipakai di semua modul yang punya
 * unduhan (Kaldik, Jadwal, Prota-Promes, CP/TP/ATP, Minggu Efektif),
 * supaya pengguna bisa lihat dulu isi dokumennya sebelum benar-benar
 * mengunduh/menyimpan filenya.
 */
export default function PratinjauPdfModal({
  url,
  onClose,
  judul = 'Pratinjau Dokumen',
}: {
  url: string | null
  onClose: () => void
  judul?: string
}) {
  if (!url) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <p className="font-bold text-sm text-slate-700">{judul}</p>
          <div className="flex items-center gap-2">
            <a
              href={url}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#6A197D] hover:bg-[#571466] text-white transition"
            >
              <Download className="w-3.5 h-3.5" /> Unduh
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 transition"
              aria-label="Tutup pratinjau"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <iframe src={url} className="flex-1 w-full" title={judul} />
      </div>
    </div>
  )
}
