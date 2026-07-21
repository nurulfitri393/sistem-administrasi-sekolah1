'use client'

import { useState } from 'react'
import { Copy } from 'lucide-react'
import type { HasilSalinTahun } from '@/lib/salinTahunAjaran'

// Widget kecil yang dipakai berulang di beberapa halaman (Kaldik, Jadwal,
// CP/TP/ATP, Prota-Promes) untuk fitur "Salin dari Tahun Ajaran Lalu" --
// pemilik keputusan menyalin atau tidak SELALU akun yang membuka tombol ini
// (dikendalikan lewat kapan komponen ini ditampilkan/disembunyikan di setiap
// halaman, lihat pemakaiannya), BUKAN otomatis oleh sistem.
//
// Komponen ini murni tampilan + alur konfirmasi -- logika APA yang disalin
// (utuh per kunci, atau per mapel) diserahkan ke fungsi `onSalin` yang
// dioper dari halaman pemanggil (lihat lib/salinTahunAjaran.ts).

interface Props {
  daftarSumber: { id: string; nama: string }[]   // tahun ajaran lain yang bisa jadi sumber (bukan periode aktif)
  onSalin: (idSumber: string) => HasilSalinTahun
  label: string
}

export default function SalinDariTahunLalu({ daftarSumber, onSalin, label }: Props) {
  const [sumberId, setSumberId] = useState('')
  if (daftarSumber.length === 0) return null

  const handleSalin = () => {
    if (!sumberId) return
    const namaSumber = daftarSumber.find(s => s.id === sumberId)?.nama || ''
    if (!confirm(`Salin data dari "${namaSumber}"?\n\nHanya bagian yang masih kosong yang akan diisi -- data yang sudah ada TIDAK akan ditimpa.`)) return
    const hasil = onSalin(sumberId)
    if (hasil.disalin.length === 0) {
      alert(hasil.dilewatiSudahAdaData.length > 0
        ? `Tidak ada yang disalin -- sudah ada data sendiri untuk semua bagian yang tersedia di "${namaSumber}".`
        : `Tidak ada data untuk disalin dari "${namaSumber}".`)
      return
    }
    alert(`Berhasil menyalin ${hasil.disalin.length} bagian data dari "${namaSumber}". Halaman akan dimuat ulang supaya perubahan terlihat.`)
    window.location.reload()
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-[#F7ECFA]/60 border border-[#EFD9F5] rounded-xl px-3 py-2">
      <Copy className="w-3.5 h-3.5 text-[#6A197D] shrink-0" />
      <span className="text-[10px] font-semibold text-[#57146A]">{label}</span>
      <select value={sumberId} onChange={e => setSumberId(e.target.value)} className="px-2 py-1.5 border border-[#EFD9F5] rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#8A3499] bg-white">
        <option value="">-- Pilih tahun ajaran sumber --</option>
        {daftarSumber.map(s => <option key={s.id} value={s.id}>{s.nama}</option>)}
      </select>
      <button type="button" disabled={!sumberId} onClick={handleSalin} className="text-[11px] font-baloo font-bold px-3 py-1.5 bg-[#6A197D] text-white rounded-lg hover:bg-[#57146A] disabled:opacity-40 disabled:cursor-not-allowed transition">
        Salin dari Tahun Lalu
      </button>
    </div>
  )
}
