'use client'

import { useEffect, useState } from 'react'
import { initCloudSync } from '@/lib/cloudSync'

/**
 * Membungkus seluruh aplikasi. Sebelum halaman apapun dirender, komponen ini
 * menarik data terbaru dari cloud (Supabase) ke localStorage perangkat ini,
 * supaya data selalu konsisten di perangkat & akun manapun aplikasi dibuka.
 *
 * CATATAN: lib/cloudSync.ts berlangganan perubahan cloud (Supabase Realtime)
 * dan memperbarui localStorage begitu ada perubahan dari perangkat/akun lain
 * -- TAPI SENGAJA tidak memicu notifikasi atau reload otomatis di sini.
 * Kalau ada pengguna lain (dengan peran tertentu) sedang mengubah data
 * sementara pengguna ini sedang aktif memakai aplikasi, reload/notifikasi
 * otomatis justru mengganggu (bisa memutus pekerjaan yang sedang berjalan).
 * Data yang sudah diperbarui akan otomatis terlihat begitu pengguna
 * berpindah halaman atau me-refresh sendiri.
 */
export default function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const [siap, setSiap] = useState(false)
  const [errorSinkron, setErrorSinkron] = useState<string | null>(null)

  useEffect(() => {
    let selesai = false
    initCloudSync()
      .then(hasil => {
        if (!hasil.ok) setErrorSinkron(hasil.error || 'Gagal terhubung ke cloud.')
      })
      .finally(() => {
        selesai = true
        setSiap(true)
      })
    // Jaga-jaga bila koneksi lambat/terputus, jangan biarkan pengguna
    // terjebak di layar loading selamanya.
    const batasWaktu = setTimeout(() => {
      if (!selesai) setSiap(true)
    }, 4000)
    return () => clearTimeout(batasWaktu)
  }, [])

  if (!siap) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white">
        <div className="w-10 h-10 border-4 border-[#F0DFF5] border-t-[#6A197D] rounded-full animate-spin" />
        <p className="text-sm font-opensans font-semibold text-[#6A197D]">
          Menyinkronkan data terbaru...
        </p>
      </div>
    )
  }

  return (
    <>
      {errorSinkron && (
        <div className="bg-red-600 text-white text-xs font-opensans font-semibold px-4 py-2 text-center">
          ⚠️ Sinkronisasi cloud gagal: {errorSinkron} — data mungkin tidak ter-update lintas perangkat.
          Buka menu &quot;Status Sinkronisasi&quot; untuk detail.
        </div>
      )}
      {children}
    </>
  )
}
