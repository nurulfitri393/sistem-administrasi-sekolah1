'use client'

import { useEffect, useState } from 'react'
import { initCloudSync, jumlahBelumTersinkron, pastikanTahunAjaranTerbaru } from '@/lib/cloudSync'
import { kuncikanTahunAjaranSesiIni } from '@/lib/tahunAjaran'

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
  // Jumlah perubahan yang masih belum terkonfirmasi tersinkron ke cloud (lihat
  // lib/cloudSync.ts) -- dicek berkala supaya pengguna dapat status JUJUR, tidak
  // salah kira semua sudah aman tersimpan padahal masih menunggu/gagal terkirim
  // karena koneksi. Sebelumnya localStorage langsung menampilkan data yang baru
  // diisi (jadi TERLIHAT tersimpan), padahal proses kirim ke cloud-nya sendiri
  // bisa gagal total tanpa pernah diberitahukan ke pengguna sama sekali.
  const [belumTersinkron, setBelumTersinkron] = useState(0)

  useEffect(() => {
    let selesai = false
    let batasWaktuTerlewati = false
    // pastikanTahunAjaranTerbaru() ditarik BERSAMAAN (bukan menunggu giliran
    // setelah) initCloudSync() -- lihat komentar lengkapnya di lib/cloudSync.ts.
    // Baris 'master_tahun_ajaran' menentukan key penyimpanan (kunciTahun()) yang
    // dipakai hampir semua halaman, jadi baris kecil ini ditarik lewat query
    // terpisah yang jauh lebih ringan & cepat daripada menunggu penarikan
    // SELURUH tabel app_storage selesai -- supaya nyaris selalu sudah termuat
    // sebelum pengguna sempat mengisi & menyimpan data apapun.
    Promise.all([pastikanTahunAjaranTerbaru(), initCloudSync()])
      .then(([, hasil]) => {
        if (!hasil.ok) setErrorSinkron(hasil.error || 'Gagal terhubung ke cloud.')
        // Penarikan data dari cloud ternyata baru selesai SETELAH batas waktu di bawah
        // sudah lebih dulu membuka akses ke halaman (koneksi lambat) -- kalau data yang
        // baru datang itu BERBEDA dari yang sudah ditampilkan, muat ulang SEKALI supaya
        // seluruh halaman otomatis memakai data terbaru itu, tanpa pengguna perlu
        // me-refresh manual berkali-kali sendiri (persis yang dikeluhkan: akun baru
        // login harus di-refresh beberapa kali dulu baru semua fitur/data muncul benar).
        // Hanya dilakukan kalau memang ada PERBEDAAN data -- supaya tidak memuat ulang
        // sia-sia kalau ternyata data yang sudah tampil sebelumnya sudah sama persis.
        if (batasWaktuTerlewati && hasil.ok && hasil.adaPerubahan) {
          window.location.reload()
        }
      })
      .finally(() => {
        selesai = true
        // Kunci ID tahun ajaran aktif SEKARANG (lihat lib/tahunAjaran.ts) --
        // sinkronisasi awal sudah selesai (atau setidaknya sudah dicoba wajar),
        // jadi nilai yang terbaca saat ini sudah bisa dipercaya untuk dipakai
        // konsisten sepanjang sisa sesi ini.
        kuncikanTahunAjaranSesiIni()
        setSiap(true)
      })
    // Jaga-jaga bila koneksi lambat/terputus, jangan biarkan pengguna terjebak di layar
    // loading selamanya -- tapi cukup lama supaya penarikan data pertama kali (akun baru
    // login, localStorage masih kosong sama sekali) punya waktu wajar untuk selesai
    // sebelum halaman "menyerah" dan ditampilkan dengan data yang mungkin belum lengkap.
    const batasWaktu = setTimeout(() => {
      if (!selesai) { batasWaktuTerlewati = true; kuncikanTahunAjaranSesiIni(); setSiap(true) }
    }, 10000)
    return () => clearTimeout(batasWaktu)
  }, [])

  // Cek berkala (bukan cuma sekali di awal) -- supaya begitu ada perubahan yang
  // gagal terkirim SELAMA pengguna aktif memakai halaman (mis. koneksi putus
  // di tengah jalan), status "belum tersinkron" tetap muncul TANPA pengguna
  // perlu refresh dulu untuk melihatnya.
  useEffect(() => {
    const cek = () => setBelumTersinkron(jumlahBelumTersinkron())
    cek()
    const interval = setInterval(cek, 3000)
    return () => clearInterval(interval)
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
      {belumTersinkron > 0 && (
        <div className="bg-amber-500 text-white text-xs font-opensans font-semibold px-4 py-2 text-center sticky top-0 z-50">
          ⏳ {belumTersinkron} perubahan belum tersimpan ke cloud (koneksi lambat/terputus) — jangan tutup atau refresh halaman ini dulu, tunggu sampai pesan ini hilang sendiri.
        </div>
      )}
      {children}
    </>
  )
}
