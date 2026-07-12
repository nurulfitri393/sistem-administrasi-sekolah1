'use client'

// lib/muatGambarBase64.ts
//
// Muat gambar dari URL (mis. Supabase Storage) dan ubah jadi base64 data-URL
// supaya bisa langsung dipakai jsPDF (doc.addImage) -- jsPDF tidak bisa
// memuat gambar dari URL eksternal secara langsung. Dipakai bersama di semua
// halaman yang menyematkan tanda tangan digital (Prota-Promes, Kaldik,
// Jadwal, CP-TP-ATP, RPPM, dst).
export async function muatGambarBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (e) {
    console.warn('Gagal memuat gambar tanda tangan:', e)
    return null
  }
}
