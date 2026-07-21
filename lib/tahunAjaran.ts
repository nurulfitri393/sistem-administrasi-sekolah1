'use client'

// lib/tahunAjaran.ts
//
// Fondasi sistem "arsip per tahun ajaran". Setiap modul (Kaldik, Jadwal,
// Minggu Efektif, CP/TP/ATP, Prota-Promes, RPP) menyimpan datanya dengan
// KUNCI localStorage yang otomatis "dilabeli" ID tahun ajaran yang sedang
// aktif. Jadi:
//
// - Saat Anda pindah ke tahun ajaran baru di Dasbor, modul-modul itu
//   otomatis menampilkan data KOSONG (siap diisi ulang) -- karena kuncinya
//   berbeda dari tahun ajaran sebelumnya.
// - Data tahun ajaran LAMA tidak hilang -- tetap tersimpan di kuncinya
//   sendiri, dan akan muncul lagi kalau Anda mengaktifkan kembali tahun
//   ajaran tsb di Dasbor ("Arsip Periode Tahun Ajaran").
//
// PENTING: helper ini HANYA membungkus nama kunci localStorage. Karena
// localStorage.setItem/getItem sudah "disadap" oleh lib/cloudSync.ts, data
// yang sudah dilabeli per tahun ajaran ini otomatis ikut tersinkron ke cloud
// juga, tanpa perlu perubahan apapun di cloudSync.ts.

function bacaIdTahunAjaranAktifDariLocalStorage(): string {
  try {
    const stored = localStorage.getItem('master_tahun_ajaran')
    if (!stored) return 'default'
    const daftar = JSON.parse(stored)
    const aktif = Array.isArray(daftar) ? daftar.find((ta: any) => ta.aktif) : null
    return aktif?.id || 'default'
  } catch {
    return 'default'
  }
}

// AKAR MASALAH "data tahun ajaran bisa bercampur": getTahunAjaranAktifId()
// SEBELUMNYA membaca ulang 'master_tahun_ajaran' dari localStorage SETIAP KALI
// dipanggil -- kalau tahun ajaran aktif berubah di LATAR BELAKANG selagi
// seseorang sedang aktif mengisi data di suatu halaman (mis. admin lain
// mengganti periode aktif lewat Dasbor di perangkat lain, lalu tersinkron
// real-time ke tab ini TANPA reload -- lihat components/CloudSyncProvider.tsx),
// setiap penyimpanan SETELAH itu diam-diam pindah memakai kunci tahun ajaran
// YANG BARU -- bercampur dengan data tahun ajaran lain di tengah sesi kerja
// yang sama.
//
// PERBAIKAN: kunci ID tahun ajaran SEKALI SAJA per sesi/tab (lihat
// kuncikanTahunAjaranSesiIni(), dipanggil dari CloudSyncProvider begitu
// pemuatan awal selesai) -- supaya data yang diisi/disimpan pengguna dalam
// SATU sesi kerja selalu konsisten memakai SATU tahun ajaran yang sama dari
// awal sampai akhir ("diam di kamarnya masing-masing"), walau tahun ajaran
// aktif berubah di latar belakang. Perubahan tahun ajaran aktif baru berlaku
// setelah halaman dimuat ulang (lihat app/dashboard/page.tsx yang sengaja
// me-reload halaman sendiri setelah admin mengganti/menambah tahun ajaran).
let idTahunAjaranTerkunciSesiIni: string | null = null

/** ID tahun ajaran yang SEDANG AKTIF saat ini (lihat menu Dasbor > Manajemen Tahun Ajaran). */
export function getTahunAjaranAktifId(): string {
  if (typeof window === 'undefined') return 'default'
  if (idTahunAjaranTerkunciSesiIni !== null) return idTahunAjaranTerkunciSesiIni
  return bacaIdTahunAjaranAktifDariLocalStorage()
}

/**
 * Kunci ID tahun ajaran aktif SAAT INI supaya dipakai konsisten sepanjang sisa
 * sesi/tab ini -- panggil SEKALI, setelah proses sinkronisasi awal selesai
 * (lihat components/CloudSyncProvider.tsx). Aman dipanggil ulang (mis. kalau
 * ingin membaca ulang nilai TERBARU secara sengaja), tapi normalnya cukup
 * dipanggil sekali per pemuatan halaman.
 */
export function kuncikanTahunAjaranSesiIni(): void {
  if (typeof window === 'undefined') return
  idTahunAjaranTerkunciSesiIni = bacaIdTahunAjaranAktifDariLocalStorage()
}

/** Label nama tahun ajaran yang sedang aktif (mis. "2026/2027"), untuk ditampilkan di UI. */
export function getTahunAjaranAktifNama(): string {
  if (typeof window === 'undefined') return ''
  try {
    const stored = localStorage.getItem('master_tahun_ajaran')
    if (!stored) return ''
    const daftar = JSON.parse(stored)
    const aktif = Array.isArray(daftar) ? daftar.find((ta: any) => ta.aktif) : null
    return aktif?.nama || ''
  } catch {
    return ''
  }
}

/**
 * Bungkus nama kunci dasar (mis. 'data_kaldik_events') menjadi kunci yang
 * sudah dilabeli tahun ajaran aktif (mis. 'data_kaldik_events__ta-1234').
 * Pakai ini menggantikan localStorage.getItem/setItem(kunciDasar) di setiap
 * modul yang datanya HARUS diarsipkan per tahun ajaran.
 */
export function kunciTahun(kunciDasar: string): string {
  return `${kunciDasar}__${getTahunAjaranAktifId()}`
}
