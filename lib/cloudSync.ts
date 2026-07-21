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

import { supabase, supabaseUrl, supabaseAnonKey } from '@/app/supabase'

// Kunci localStorage tempat mencatat perubahan yang BELUM DIKONFIRMASI berhasil
// tersinkron ke cloud -- lihat AKAR MASALAH KETIGA di bawah tandaiBelumTerkirim().
const KUNCI_BELUM_TERKIRIM = '__cloudsync_belum_terkirim__'

function harusDikecualikan(key: string): boolean {
  if (key === 'sesi_guru_login') return true
  if (key.startsWith('sb-')) return true
  if (key === KUNCI_BELUM_TERKIRIM) return true
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

// AKAR MASALAH KETIGA: sebelum ini, "perubahan belum terkirim" cuma dilacak di
// memori (antrianKirim/nilaiPending) -- begitu perubahan itu SELESAI DICOBA kirim
// (baik berhasil ATAU GAGAL), catatannya langsung hilang dari memori, dan kalau
// halaman di-refresh, jejaknya hilang total. Akibatnya: kalau kirimnya gagal (mis.
// koneksi buruk, request ditolak server) TIDAK ADA CARA untuk tahu nanti bahwa
// perubahan itu belum benar-benar sampai ke cloud -- localStorage tetap
// menampilkan datanya (jadi pengguna MERASA sudah tersimpan), tapi begitu
// halaman di-refresh, tarikDataDariCloud() menarik data LAMA dari cloud (yang
// memang belum menerima perubahan yang gagal terkirim tadi) dan menimpanya --
// persis yang dikeluhkan: "sudah dicek datanya ada, tapi begitu refresh hilang".
//
// PERBAIKAN: catat setiap perubahan yang AKAN dikirim ke dalam localStorage
// SENDIRI (bukan cuma di memori) SAAT AKAN dikirim, dan baru hapus catatannya
// SETELAH benar-benar terkonfirmasi berhasil (bukan cuma "sudah dicoba"). Catatan
// ini BERTAHAN lintas refresh/tutup tab, sehingga tarikDataDariCloud() bisa
// mengecek: kalau suatu key masih tercatat "belum terkirim", JANGAN ditimpa
// dengan data lama dari cloud -- coba kirim ulang saja.
function bacaDaftarBelumTerkirim(): Record<string, string | null> {
  try {
    const raw = window.localStorage.getItem(KUNCI_BELUM_TERKIRIM)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function tulisDaftarBelumTerkirim(daftar: Record<string, string | null>) {
  // Pakai referensi setItem ASLI (kalau sudah terpasang) supaya penulisan catatan
  // pelacak ini sendiri tidak ikut memicu kirimKeCloud (lagipula sudah disaring
  // lewat harusDikecualikan, ini cuma jaga-jaga tambahan).
  const tulis = originalSetItem || window.localStorage.setItem.bind(window.localStorage)
  tulis(KUNCI_BELUM_TERKIRIM, JSON.stringify(daftar))
}

function tandaiBelumTerkirim(key: string, value: string | null) {
  const daftar = bacaDaftarBelumTerkirim()
  daftar[key] = value
  tulisDaftarBelumTerkirim(daftar)
}

function tandaiSudahTerkirim(key: string) {
  const daftar = bacaDaftarBelumTerkirim()
  if (Object.prototype.hasOwnProperty.call(daftar, key)) {
    delete daftar[key]
    tulisDaftarBelumTerkirim(daftar)
  }
}

/**
 * Berapa banyak perubahan yang masih belum terkonfirmasi tersinkron ke cloud --
 * dipakai UI (lihat components/CloudSyncProvider.tsx) untuk menampilkan status
 * JUJUR ke pengguna, supaya tidak salah kira semua sudah aman tersimpan padahal
 * sebenarnya masih menunggu/gagal terkirim karena koneksi.
 */
export function jumlahBelumTersinkron(): number {
  if (typeof window === 'undefined') return 0
  return Object.keys(bacaDaftarBelumTerkirim()).length
}

async function kirimSatuKeCloud(key: string, value: string | null) {
  catatSebagaiPerubahanSendiri(key, value)
  try {
    if (value === null) {
      const { error } = await supabase.from('app_storage').delete().eq('key', key)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('app_storage')
        .upsert({ key, value, updated_at: new Date().toISOString() })
      if (error) throw error
    }
    // Baru dianggap benar-benar terkirim SETELAH server mengonfirmasi tanpa error
    // (sebelumnya: respons error dari Supabase tidak pernah dicek sama sekali --
    // upsert/delete yang DITOLAK server pun dianggap "berhasil" begitu saja).
    tandaiSudahTerkirim(key)
  } catch (e) {
    console.warn('[cloudSync] Gagal mengirim perubahan ke cloud untuk key:', key, e)
    // SENGAJA TIDAK menghapus catatan "belum terkirim" -- biarkan tetap tercatat
    // supaya dicoba lagi & dilindungi dari tertimpa saat tarikDataDariCloud
    // berikutnya (lihat komentar di atas bacaDaftarBelumTerkirim).
  }
}

// Token sesi TERBARU, disimpan di memori (bukan diambil ulang lewat
// supabase.auth.getSession() yang async) supaya SIAP DIPAKAI SEKETIKA saat
// halaman ditinggalkan (lihat flushSatuKeCloudKeepalive) -- pada saat itu
// tidak ada waktu untuk menunggu proses async tambahan.
let tokenSesiTerbaru: string | null = null
function pasangPelacakTokenSesi() {
  supabase.auth.getSession().then(({ data }) => { tokenSesiTerbaru = data.session?.access_token || null })
  supabase.auth.onAuthStateChange((_event, session) => { tokenSesiTerbaru = session?.access_token || null })
}

// AKAR MASALAH kedua (setelah flushSemuaPending ditambahkan): kirimSatuKeCloud
// (lewat supabase-js, yang di baliknya cuma fetch() BIASA) TIDAK DIJAMIN selesai
// kalau dipanggil dari event 'pagehide' saat halaman BENAR-BENAR di-refresh/
// ditutup (beda dgn sekadar pindah tab) -- peramban boleh membatalkan request
// fetch biasa begitu halaman mulai dibongkar, sebelum request itu sempat sampai
// ke server. Request YANG DIJAMIN diselesaikan peramban walau halaman sudah
// dibongkar adalah request dengan flag `keepalive: true` (standar web modern
// utk kasus persis ini, mis. dipakai analytics). Makanya flush saat halaman
// ditinggalkan HARUS lewat jalur ini, bukan kirimSatuKeCloud yang biasa dipakai
// debounce normal (yang punya banyak waktu utk selesai secara wajar).
// CATATAN: fetch ber-keepalive dibatasi peramban maks ~64KB per body request --
// utk value yang kebetulan lebih besar dari itu, keepalive akan gagal (baris
// datanya TETAP coba dikirim lewat kirimSatuKeCloud biasa sbg upaya lain,
// meski tidak dijamin selesai kalau halamannya keburu tertutup).
function flushSatuKeCloudKeepalive(key: string, value: string | null) {
  catatSebagaiPerubahanSendiri(key, value)
  if (!tokenSesiTerbaru) { kirimSatuKeCloud(key, value); return }
  const headers: Record<string, string> = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${tokenSesiTerbaru}`,
    'Content-Type': 'application/json',
  }
  try {
    if (value === null) {
      fetch(`${supabaseUrl}/rest/v1/app_storage?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE', headers, keepalive: true,
      })
        // Catatan "belum terkirim" HANYA dihapus kalau callback ini sungguh sempat
        // jalan (mis. halaman cuma disembunyikan/pindah tab, BUKAN benar-benar
        // dibongkar) -- kalau halamannya benar-benar tertutup/di-refresh, callback
        // ini tidak akan pernah jalan walau request-nya sendiri tetap terkirim di
        // latar belakang berkat keepalive; tidak apa, tarikDataDariCloud di sesi
        // BERIKUTNYA akan mengonfirmasi & membersihkan catatannya sendiri.
        .then(res => { if (res.ok) tandaiSudahTerkirim(key) })
        .catch(() => kirimSatuKeCloud(key, value))
    } else {
      fetch(`${supabaseUrl}/rest/v1/app_storage`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
        keepalive: true,
      })
        .then(res => { if (res.ok) tandaiSudahTerkirim(key) })
        .catch(() => kirimSatuKeCloud(key, value))
    }
  } catch {
    // keepalive fetch bisa langsung melempar error (mis. body > ~64KB) --
    // coba jalur biasa sbg upaya terakhir, walau tidak dijamin selesai.
    kirimSatuKeCloud(key, value)
  }
}

function kirimKeCloud(key: string, value: string | null) {
  if (harusDikecualikan(key)) return

  // Catat SEKETIKA (sebelum menunggu jeda debounce, apalagi hasil kirimnya) --
  // supaya kalau halaman tertutup/refresh SEBELUM sempat terkonfirmasi terkirim
  // (dengan sebab apapun), catatan "belum terkirim" ini tetap ada di localStorage
  // & bisa dipakai sesi berikutnya utk melindungi & mengirim ulang.
  tandaiBelumTerkirim(key, value)

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
    flushSatuKeCloudKeepalive(key, nilaiPending.get(key) ?? null)
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
      // Lihat komentar di bacaDaftarBelumTerkirim: key yang masih tercatat "belum
      // terkirim" TIDAK BOLEH ditimpa dengan nilai dari cloud (yang berarti data
      // LAMA, dari sebelum perubahan lokal yang belum terkonfirmasi itu).
      const daftarBelumTerkirim = bacaDaftarBelumTerkirim()
      let adaPerubahan = false
      for (const row of data as { key: string; value: string | null }[]) {
        if (harusDikecualikan(row.key)) continue
        if (Object.prototype.hasOwnProperty.call(daftarBelumTerkirim, row.key)) continue
        const nilaiBaru = row.value ?? ''
        if (window.localStorage.getItem(row.key) !== nilaiBaru) adaPerubahan = true
        tulisLokalTanpaKirimUlang(row.key, nilaiBaru)
      }
      // Coba kirim ulang SEMUA perubahan yang masih tercatat belum terkonfirmasi --
      // baik yang barusan dilindungi dari tertimpa di atas, MAUPUN yang belum
      // pernah sampai ke cloud sama sekali (makanya tidak muncul di 'data' di atas).
      Object.entries(daftarBelumTerkirim).forEach(([k, v]) => kirimSatuKeCloud(k, v))
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

/**
 * AKAR MASALAH KEEMPAT (kemungkinan penyebab lain data "hilang" saat refresh):
 * lib/tahunAjaran.ts -> getTahunAjaranAktifId() membaca 'master_tahun_ajaran'
 * dari localStorage SECARA SINKRON, dan kalau key itu belum ada sama sekali di
 * localStorage, ia diam-diam jatuh ke fallback id 'default'. Setiap halaman
 * (CP/TP/ATP, Prota-Promes, Minggu Efektif, RPP, dst) memakai kunciTahun() --
 * yang menempelkan id tahun ajaran aktif ini ke SETIAP key localStorage yang
 * dipakainya. Kalau seorang guru mulai mengisi & menyimpan data SEBELUM baris
 * 'master_tahun_ajaran' sempat termuat dari cloud (mis. tarikDataDariCloud()
 * yang menarik SELURUH tabel app_storage -- yang bisa besar & lambat -- belum
 * selesai), data itu tersimpan di bawah key "...__default", BUKAN di bawah
 * key id tahun ajaran yang sesungguhnya aktif. Begitu 'master_tahun_ajaran'
 * akhirnya termuat (mis. saat halaman lain dibuka, atau reload berikutnya),
 * SELURUH halaman beralih memakai key id yang benar -- dan data yang sempat
 * tersimpan di bawah key "...__default" itu jadi seperti hilang begitu saja,
 * padahal sebenarnya cuma tersembunyi di key yang salah (persis pola yang
 * pernah ditangani lib/migrasiTahunAjaran.ts untuk kasus lama yang serupa).
 *
 * PERBAIKAN: tarik HANYA baris 'master_tahun_ajaran' ini secara terpisah &
 * SECEPAT mungkin (satu baris kecil, bukan `select *` ke seluruh tabel yang
 * bisa jauh lebih besar/lambat), supaya baris penentu-key ini nyaris selalu
 * sudah termuat ke localStorage jauh sebelum pengguna sempat mengisi & data
 * apapun tersimpan -- lihat pemanggilannya di components/CloudSyncProvider.tsx
 * (dijalankan BERSAMAAN, bukan menunggu, initCloudSync() yang menarik seluruh
 * tabel).
 */
export async function pastikanTahunAjaranTerbaru(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const { data, error } = await supabase
      .from('app_storage')
      .select('value')
      .eq('key', 'master_tahun_ajaran')
      .maybeSingle()
    if (!error && data && typeof data.value === 'string') {
      // Sama seperti proteksi di tarikDataDariCloud(): jangan timpa kalau ada
      // perubahan LOKAL untuk key ini yang masih menunggu terkirim ke cloud.
      const daftarBelumTerkirim = bacaDaftarBelumTerkirim()
      if (!Object.prototype.hasOwnProperty.call(daftarBelumTerkirim, 'master_tahun_ajaran')) {
        tulisLokalTanpaKirimUlang('master_tahun_ajaran', data.value)
      }
    }
  } catch (e) {
    console.warn('[cloudSync] Gagal menarik master_tahun_ajaran secara cepat, lanjut pakai data lokal dulu.', e)
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
  pasangPelacakTokenSesi()
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
  // AKAR MASALAH yang diperbaiki: penyadap localStorage SEBELUMNYA baru dipasang
  // SETELAH penarikan data dari cloud selesai (await tarikDataDariCloud() dulu, baru
  // pasangPenyadapLocalStorage()). Di koneksi lambat, CloudSyncProvider punya batas
  // waktu 10 detik yang membuka akses ke halaman LEBIH DULU sebelum initCloudSync()
  // ini benar-benar selesai (supaya pengguna tidak terjebak di layar loading
  // selamanya) -- tapi itu berarti ada JEDA WAKTU di mana halaman sudah bisa dipakai
  // (pengguna sudah bisa mengetik & menyimpan), TAPI penyadap localStorage BELUM
  // terpasang sama sekali. Perubahan yang terjadi di jeda itu TIDAK PERNAH tersadap
  // -> tidak pernah masuk antrian kirim ke cloud sama sekali (beda dari kasus
  // flushSemuaPending, yang menangani antrian yang SUDAH tersadap tapi belum
  // terkirim). Begitu tarikDataDariCloud() akhirnya selesai (membawa data LAMA dari
  // sebelum perubahan itu), ia menimpa localStorage dan MENGHAPUS perubahan yang
  // belum sempat tersadap tsb -- bahkan bisa memicu reload otomatis (lihat
  // CloudSyncProvider). Ini yang menyebabkan pengisian PERTAMA di suatu sesi hilang
  // (sebelum penyadap terpasang) tapi pengisian BERIKUTNYA tersimpan (setelah
  // terpasang) -- dan pada akun dengan koneksi yang KONSISTEN lambat, bisa berulang
  // terus setiap sesi karena jeda 10 detik itu nyaris selalu tercapai.
  //
  // PERBAIKAN: pasang penyadap localStorage SEKETIKA (sebelum menunggu penarikan
  // data dari cloud selesai), bukan sesudahnya -- supaya perubahan APAPUN yang
  // terjadi sejak halaman dibuka, termasuk saat penarikan masih berjalan di latar
  // belakang, tetap tersadap dan masuk antrian kirim ke cloud. Aman dilakukan lebih
  // dulu karena tulisLokalTanpaKirimUlang (dipakai penarikan utk menulis data cloud
  // ke localStorage) sudah sengaja memakai referensi setItem ASLI (bukan versi yang
  // disadap), jadi data yang ditarik dari cloud tidak akan salah terkirim balik.
  pasangPenyadapLocalStorage()
  const hasil = await tarikDataDariCloud()
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
