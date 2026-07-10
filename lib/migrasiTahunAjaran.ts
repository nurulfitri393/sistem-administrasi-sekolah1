'use client'

import { kunciTahun } from './tahunAjaran'

// Daftar SEMUA kunci dasar yang sejak fitur "Arsip per Tahun Ajaran" dibungkus
// kunciTahun(). Kalau aplikasi ini sudah dipakai SEBELUM fitur itu ada, data
// lama tersimpan di kunci POLOS (mis. "data_kaldik_events"), sedangkan kode
// yang baru mencari kunci berlabel tahun ajaran (mis.
// "data_kaldik_events__ta-1234") -- sehingga TERLIHAT seperti data hilang,
// padahal cuma "tersembunyi" di kunci lama. Migrasi ini menyalin data lama
// itu ke kunci baru (mengikuti tahun ajaran yang sedang aktif SAAT migrasi
// dijalankan), TANPA menghapus kunci lamanya (aman diulang / tidak merusak apa-apa).
export const DAFTAR_KUNCI_TERDAMPAK_ARSIP_TAHUN = [
  'data_atp',
  'data_cp',
  'data_cp_umum',
  'data_materi',
  'data_tp',
  'data_jadwal_pelajaran',
  'master_pemetaan_waktu',
  'master_kelas_gabungan',
  'master_jadwal_tetap',
  'master_jadwal_giliran',
  'master_larangan_beriringan',
  'master_piket_guru',
  'matriks_alokasi_rinci_samping',
  'request_hari_jp_guru',
  'jadwal_semester_aktif',
  'jadwal_titimangsa_ttd',
  'jadwal_keterangan_unit',
  'master_maks_jp_guru_per_hari',
  'data_kaldik_events',
  'kaldik_agenda_list',
  'setting_semester_ganjil',
  'setting_semester_genap',
]

export interface HasilMigrasiTahun {
  disalin: string[]      // kunci lama yang berhasil disalin ke kunci baru
  dilewati: { kunci: string; jumlahLama: number; jumlahBaru: number }[] // kunci baru sudah ada ISI SUNGGUHAN
  tidakAdaData: string[] // kunci lama memang kosong/tidak ada
}

/**
 * Hitung "jumlah item" dari sebuah nilai localStorage untuk ditampilkan ke
 * pengguna (array -> panjang array, objek -> jumlah key, lainnya -> 1/0).
 */
function jumlahItem(raw: string | null): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.length
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length
    return raw.trim() ? 1 : 0
  } catch {
    return raw.trim() ? 1 : 0
  }
}

/**
 * Cek apakah sebuah nilai localStorage "sebenarnya kosong" (null, string
 * kosong, array [], atau objek {}) -- supaya tidak dianggap "sudah ada
 * datanya" hanya karena pernah diinisialisasi kosong (mis. cloud sync
 * sempat menyinkronkan array kosong sebelum migrasi sempat dijalankan).
 */
function nilaiBenarBenarKosong(raw: string | null): boolean {
  if (!raw) return true
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '[]' || trimmed === '{}' || trimmed === 'null') return true
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.length === 0
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length === 0
    return false
  } catch {
    return false
  }
}

/**
 * Jalankan migrasi SATU KALI. Aman dipanggil berkali-kali (idempotent) --
 * kalau kunci baru sudah pernah terisi data SUNGGUHAN (bukan cuma array/objek
 * kosong), tidak akan ditimpa lagi.
 */
export function jalankanMigrasiArsipTahun(): HasilMigrasiTahun {
  const hasil: HasilMigrasiTahun = { disalin: [], dilewati: [], tidakAdaData: [] }

  for (const kunciDasar of DAFTAR_KUNCI_TERDAMPAK_ARSIP_TAHUN) {
    const dataLama = localStorage.getItem(kunciDasar)
    if (nilaiBenarBenarKosong(dataLama)) {
      hasil.tidakAdaData.push(kunciDasar)
      continue
    }
    const kunciBaru = kunciTahun(kunciDasar)
    const dataBaru = localStorage.getItem(kunciBaru)
    if (!nilaiBenarBenarKosong(dataBaru)) {
      hasil.dilewati.push({ kunci: kunciDasar, jumlahLama: jumlahItem(dataLama), jumlahBaru: jumlahItem(dataBaru) })
      continue
    }
    localStorage.setItem(kunciBaru, dataLama as string)
    hasil.disalin.push(kunciDasar)
  }

  return hasil
}

/**
 * TIMPA PAKSA satu kunci tertentu -- dipakai kalau pengguna sudah membandingkan
 * jumlah item lama vs baru dan yakin data baru (yang lebih sedikit/kosong-ish)
 * boleh ditimpa oleh data lama yang lebih lengkap. TIDAK bisa dibatalkan.
 */
export function timpaPaksaSatuKunci(kunciDasar: string): boolean {
  const dataLama = localStorage.getItem(kunciDasar)
  if (nilaiBenarBenarKosong(dataLama)) return false
  localStorage.setItem(kunciTahun(kunciDasar), dataLama as string)
  return true
}

/** Cek cepat: apakah ada indikasi data lama yang belum bermigrasi? (untuk tampilkan peringatan) */
export function adaDataLamaBelumBermigrasi(): boolean {
  for (const kunciDasar of DAFTAR_KUNCI_TERDAMPAK_ARSIP_TAHUN) {
    const dataLama = localStorage.getItem(kunciDasar)
    if (!nilaiBenarBenarKosong(dataLama) && nilaiBenarBenarKosong(localStorage.getItem(kunciTahun(kunciDasar)))) return true
  }
  return false
}
