'use client'

// lib/cloudSync.ts
//
// Lapisan sinkronisasi lintas-perangkat & lintas-akun.
//
// MASALAH YANG DIPERBAIKI:
// Sebelumnya seluruh data aplikasi (identitas lembaga, data guru, jadwal,
// kaldik, RPP, dst) hanya disimpan di localStorage — artinya data itu
// TERKUNCI di satu browser/perangkat saja. Mengisi data di laptop dengan
// akun A tidak akan pernah terlihat di HP dengan akun B.
//
// SOLUSI:
// Modul ini membuat localStorage.setItem/removeItem juga otomatis mengirim
// perubahan ke tabel `app_storage` di Supabase (cloud), dan menarik data
// terbaru dari cloud setiap kali (1) aplikasi pertama dibuka, dan (2) setiap
// kali ada orang login (lihat refreshSetelahLogin() yang dipanggil dari
// app/page.tsx) — supaya ganti akun di tab yang sama pun langsung dapat data
// terbaru, tidak perlu reload browser.
//
// CATATAN PENTING soal token sesi login (lihat harusDikecualikan di bawah):
// Token sesi Supabase Auth milik browser (key berawalan "sb-") SENGAJA TIDAK
// PERNAH disinkronkan. Kalau token ini ikut disinkronkan, sesi satu
// perangkat/akun bisa tertimpa sesi perangkat/akun lain (last-write-wins),
// yang menyebabkan pengguna terus dilempar balik ke halaman login walau
// baru saja berhasil masuk. Setiap perangkat WAJIB mengelola sesi loginnya
// sendiri-sendiri, persis seperti perilaku browser pada umumnya.
//
// CATATAN KEAMANAN:
// Tabel `app_storage` boleh DIBACA siapapun (termasuk yang belum login) —
// ini sengaja, karena halaman login Guru perlu mencari data guru SEBELUM
// guru itu berhasil login. Tapi TULIS/UBAH/HAPUS data hanya boleh dilakukan
// pengguna yang sudah login (Admin atau Guru — keduanya sekarang akun
// Supabase Auth asli). Lihat supabase/migrations/001_app_storage.sql.

import { supabase } from '@/app/supabase'

function harusDikecualikan(key: string): boolean {
  if (key === 'sesi_guru_login') return true
  if (key.startsWith('sb-')) return true
  return false
}

let sudahDipasang = false
let originalSetItem: (key: string, value: string) => void
let originalRemoveItem: (key: string) => void

function tulisLokalTanpaKirimUlang(key: string, value: string) {
  // Dipakai saat MENARIK data dari cloud -> tulis ke localStorage lewat
  // fungsi asli (bukan versi yang sudah "disadap"), supaya tidak langsung
  // dikirim balik ke cloud (percuma, datanya memang baru saja dari sana).
  if (originalSetItem) originalSetItem(key, value)
  else window.localStorage.setItem(key, value)
}

function hapusLokalTanpaKirimUlang(key: string) {
  if (originalRemoveItem) originalRemoveItem(key)
  else window.localStorage.removeItem(key)
}

const antrianKirim = new Map<string, ReturnType<typeof setTimeout>>()
// Nilai TERBARU yang masih menunggu jeda debounce sebelum benar-benar terkirim ke cloud --
// disimpan TERPISAH dari timer-nya supaya bisa dikirim SEKARANG JUGA (lihat flushSemuaPending)
// tanpa harus menunggu setTimeout-nya berjalan.
const nilaiPending = new Map<string, string | null>()

// Lacak perubahan yang BARU SAJA dikirim oleh perangkat/tab INI sendiri --
// supaya saat notifikasi realtime "memantul" balik (echo) dari perubahan kita
// sendiri, itu tidak dianggap "perubahan dari pengguna lain" yang memicu
// reload. PENTING: banyak form di aplikasi ini menyimpan otomatis di setiap
// perubahan (bukan cuma saat klik tombol Simpan) -- kalau ini tidak
// disaring, halaman akan reload berulang-ulang setiap kali pengguna sendiri
// mengetik/mengubah sesuatu, membuat aplikasi nyaris tidak bisa dipakai.
const perubahanSendiri = new Map<string, { value: string | null; sampai: number }>()
const MASA_BERLAKU_ECHO_MS = 6000

function catatSebagaiPerubahanSendiri(key: string, value: string | null) {
  perubahanSendiri.set(key, { value, sampai: Date.now() + MASA_BERLAKU_ECHO_MS })
}

function apakahEchoPerubahanSendiri(key: string, value: string | null): boolean {
  const catatan = perubahanSendiri.get(key)
  if (!catatan) return false
  if (Date.now() > catatan.sampai) { perubahanSendiri.delete(key); return false }
  return catatan.value === value
}

async function kirimSatuKeCloud(key: string, value: string | null) {
  catatSebagaiPerubahanSendiri(key, value)
  try {
    if (value === null) {
      await supabase.from('app_storage').delete().eq('key', key)
    } else {
      await supabase
        .from('app_storage')
        .upsert({ key, value, updated_at: new Date().toISOString() })
    }
  } catch (e) {
    console.warn('[cloudSync] Gagal mengirim perubahan ke cloud untuk key:', key, e)
  }
}

function kirimKeCloud(key: string, value: string | null) {
  if (harusDikecualikan(key)) return

  const timerLama = antrianKirim.get(key)
  if (timerLama) clearTimeout(timerLama)
  nilaiPending.set(key, value)

  // Debounce singkat supaya ketikan cepat tidak membanjiri request ke cloud.
  const timer = setTimeout(() => {
    antrianKirim.delete(key)
    nilaiPending.delete(key)
    kirimSatuKeCloud(key, value)
  }, 400)

  antrianKirim.set(key, timer)
}

/**
 * Kirim SEKARANG JUGA semua perubahan yang masih menunggu jeda debounce -- dipanggil saat
 * halaman akan ditinggalkan (lihat pasangFlushSaatHalamanDitinggalkan di bawah).
 *
 * AKAR MASALAH yang diperbaiki: sebelum ini, perubahan localStorage baru benar-benar
 * dikirim ke cloud 400ms KEMUDIAN (lewat setTimeout). Kalau pengguna langsung me-refresh
 * atau menutup tab dalam jeda 400ms itu (sangat mungkin terjadi -- mis. simpan data lalu
 * langsung refresh untuk mengecek), timer itu IKUT HANGUS bersama halaman sebelum sempat
 * jalan -- perubahannya TIDAK PERNAH terkirim ke cloud sama sekali. Begitu halaman dimuat
 * ulang, lib ini menarik data TERBARU dari cloud (yang masih data LAMA, sebelum perubahan
 * tsb) dan menimpa localStorage dengan itu -- membuat data yang BARU SAJA disimpan terlihat
 * "hilang otomatis". Ini paling terasa di akun yang BARU LOGIN karena localStorage-nya
 * masih relatif kosong, jadi penarikan ulang itu terasa seperti "menghapus" data yang baru
 * diisi, bukan sekadar tidak menambahkannya.
 */
function flushSemuaPending() {
  if (antrianKirim.size === 0) return
  antrianKirim.forEach((timer, key) => {
    clearTimeout(timer)
    kirimSatuKeCloud(key, nilaiPending.get(key) ?? null)
    nilaiPending.delete(key)
  })
  antrianKirim.clear()
}

let flushListenerTerpasang = false
function pasangFlushSaatHalamanDitinggalkan() {
  if (flushListenerTerpasang || typeof window === 'undefined') return
  flushListenerTerpasang = true
  // 'pagehide' menutupi refresh, navigasi keluar, DAN menutup tab -- lebih konsisten
  // didukung browser modern untuk kasus "halaman akan hilang" dibanding 'beforeunload'.
  window.addEventListener('pagehide', flushSemuaPending)
  // Jaga-jaga tambahan: kalau tab disembunyikan (pindah tab/aplikasi) tanpa benar-benar
  // ditutup, tetap segera kirim -- tidak menunggu debounce yang mungkin baru jalan setelah
  // pengguna balik lagi (atau malah tidak pernah balik).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSemuaPending()
  })
}

/**
 * Menarik seluruh data terbaru dari cloud ke localStorage perangkat ini.
 * Bisa dipanggil berkali-kali (dipanggil ulang setiap ada yang login).
 * Mengembalikan status supaya bisa ditampilkan ke pengguna kalau gagal
 * (sebelumnya kegagalan ini cuma console.warn, tidak pernah terlihat), DAN
 * `adaPerubahan` (apakah ada key yang nilainya benar-benar berbeda dari yang
 * sudah ada di localStorage sebelum penarikan ini) -- dipakai CloudSyncProvider
 * untuk tahu apakah perlu memberi tahu pengguna/memuat ulang setelah penarikan
 * yang tadinya lambat akhirnya selesai di latar belakang.
 */
export async function tarikDataDariCloud(): Promise<{ ok: boolean; error?: string; adaPerubahan?: boolean }> {
  if (typeof window === 'undefined') return { ok: false, error: 'Bukan lingkungan browser.' }
  try {
    const { data, error } = await supabase.from('app_storage').select('key, value')
    if (!error && data) {
      let adaPerubahan = false
      for (const row of data as { key: string; value: string | null }[]) {
        if (harusDikecualikan(row.key)) continue
        const nilaiBaru = row.value ?? ''
        if (window.localStorage.getItem(row.key) !== nilaiBaru) adaPerubahan = true
        tulisLokalTanpaKirimUlang(row.key, nilaiBaru)
      }
      return { ok: true, adaPerubahan }
    } else if (error) {
      console.warn('[cloudSync] Tabel app_storage belum siap / gagal diakses:', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e: any) {
    console.warn('[cloudSync] Gagal menghubungi cloud, memakai data lokal dulu.', e)
    return { ok: false, error: String(e?.message || e) }
  }
}

function pasangPenyadapLocalStorage() {
  if (sudahDipasang || typeof window === 'undefined') return
  originalSetItem = window.localStorage.setItem.bind(window.localStorage)
  originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage)

  window.localStorage.setItem = function (key: string, value: string) {
    originalSetItem(key, value)
    kirimKeCloud(key, value)
  }
  window.localStorage.removeItem = function (key: string) {
    originalRemoveItem(key)
    kirimKeCloud(key, null)
  }
  pasangFlushSaatHalamanDitinggalkan()
  sudahDipasang = true
}

function pasangRealtimeSubscription() {
  try {
    supabase
      .channel('app_storage_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_storage' },
        (payload: any) => {
          const row = payload.new || payload.old
          if (!row?.key || harusDikecualikan(row.key)) return
          const nilaiBaru = payload.eventType === 'DELETE' ? null : (row.value ?? '')

          // Kalau ini cuma "pantulan" dari perubahan yang BARU SAJA kita
          // kirim sendiri (dari tab/perangkat ini), tulis ke localStorage
          // seperti biasa (aman & tidak berbahaya, cuma menimpa dengan nilai
          // yang sama), TAPI JANGAN beritahu UI untuk reload -- pengguna
          // sudah lihat perubahannya sendiri secara langsung lewat state
          // React, tidak perlu reload lagi.
          const echoDiriSendiri = apakahEchoPerubahanSendiri(row.key, nilaiBaru)

          if (payload.eventType === 'DELETE') {
            hapusLokalTanpaKirimUlang(row.key)
          } else {
            tulisLokalTanpaKirimUlang(row.key, nilaiBaru)
          }
          if (!echoDiriSendiri) {
            // Beritahu bagian UI yang mau bereaksi -- dipakai oleh
            // CloudSyncProvider untuk memuat ulang halaman otomatis begitu
            // ada perubahan SUNGGUHAN dari pengguna/perangkat lain.
            window.dispatchEvent(new CustomEvent('cloud-sync-update', { detail: { key: row.key } }))
          }
        }
      )
      .subscribe()
  } catch (e) {
    console.warn('[cloudSync] Realtime tidak tersedia, sinkronisasi tetap jalan saat reload halaman.', e)
  }
}

/**
 * Panggil SEKALI saat aplikasi pertama dibuka (lihat
 * components/CloudSyncProvider.tsx):
 * 1) Menarik seluruh data terbaru dari cloud ke localStorage perangkat ini.
 * 2) Memasang penyadap agar setiap localStorage.setItem/removeItem
 *    selanjutnya otomatis terkirim ke cloud.
 * 3) Berlangganan perubahan real-time dari perangkat/akun lain.
 */
export async function initCloudSync(): Promise<{ ok: boolean; error?: string; adaPerubahan?: boolean }> {
  if (typeof window === 'undefined') return { ok: false, error: 'Bukan lingkungan browser.' }
  const hasil = await tarikDataDariCloud()
  pasangPenyadapLocalStorage()
  pasangRealtimeSubscription()
  return hasil
}

/**
 * Panggil setiap kali seseorang BERHASIL LOGIN (baik ganti akun di tab yang
 * sama maupun login pertama kali) — lihat app/page.tsx. Ini memastikan data
 * yang ditampilkan selalu yang TERBARU dari cloud, walau tidak ada reload
 * browser sama sekali (navigasi Next.js bersifat SPA / tidak reload penuh).
 */
export async function refreshSetelahLogin(): Promise<{ ok: boolean; error?: string }> {
  return tarikDataDariCloud()
}
