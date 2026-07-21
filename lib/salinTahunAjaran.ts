'use client'

// lib/salinTahunAjaran.ts
//
// Alat untuk MENYALIN (bukan memindahkan) data dari satu Tahun Ajaran ke
// Tahun Ajaran lain -- dipakai kalau admin ingin memakai ulang struktur/isi
// data tahun ajaran sebelumnya (mis. CP/TP/ATP, jadwal, kaldik) di tahun
// ajaran yang baru, tanpa perlu mengetik ulang semuanya dari nol.
//
// SEPENUHNYA OPT-IN & manual -- TIDAK PERNAH berjalan otomatis, dan TIDAK
// PERNAH menimpa data yang sudah ada di tahun ajaran tujuan. Ini sengaja,
// supaya data tiap tahun ajaran tetap "diam di kamarnya masing-masing" --
// menyalin hanya boleh terjadi kalau admin sendiri secara sadar memintanya,
// dan hanya mengisi kunci yang memang masih kosong di tujuan.
//
// CARA KERJA: alih-alih bergantung pada daftar kunci dasar yang di-hardcode
// (gampang basi kalau ada modul baru nanti -- lihat lib/migrasiTahunAjaran.ts
// yang punya masalah ini), fungsi ini mencari SEMUA kunci di localStorage yang
// polanya "<apapun>__<idSumber>" -- itulah seluruh data milik tahun ajaran
// sumber -- lalu menyalin isinya ke kunci "<apapun>__<idTujuan>".

export interface HasilSalinTahun {
  disalin: string[]                              // kunci dasar yang berhasil disalin
  dilewatiSudahAdaData: string[]                  // tujuan sudah ada data sungguhan, dilewati (tidak ditimpa)
  sumberKosong: string[]                          // sumber ternyata kosong untuk kunci ini (jaga-jaga)
}

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

/** Cari semua kunci DASAR (tanpa akhiran __id) yang punya data untuk suatu tahun ajaran. */
export function daftarKunciDasarUntukTahun(idTahun: string): string[] {
  const akhiran = `__${idTahun}`
  const hasil: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.endsWith(akhiran)) continue
    // Lewati catatan sistem sementara (bukan data administrasi sungguhan)
    if (key.startsWith('_undo_')) continue
    hasil.push(key.slice(0, -akhiran.length))
  }
  return hasil
}

/**
 * Salin UTUH satu kunci dasar dari idSumber ke idTujuan. HANYA mengisi kalau
 * kunci tujuan MASIH BENAR-BENAR KOSONG -- tidak pernah menimpa data yang
 * sudah ada.
 */
function salinSatuKunciUtuh(kunciDasar: string, idSumber: string, idTujuan: string): 'disalin' | 'dilewati' | 'sumberKosong' {
  const kunciSumber = `${kunciDasar}__${idSumber}`
  const kunciTujuan = `${kunciDasar}__${idTujuan}`
  const dataSumber = localStorage.getItem(kunciSumber)
  if (nilaiBenarBenarKosong(dataSumber)) return 'sumberKosong'
  const dataTujuanSaatIni = localStorage.getItem(kunciTujuan)
  if (!nilaiBenarBenarKosong(dataTujuanSaatIni)) return 'dilewati'
  localStorage.setItem(kunciTujuan, dataSumber as string)
  return 'disalin'
}

/**
 * Salin data dari idSumber ke idTujuan. HANYA mengisi kunci yang di tujuan
 * MASIH BENAR-BENAR KOSONG (belum pernah diisi apapun) -- tidak akan pernah
 * menimpa data yang sudah mulai dikerjakan di tahun ajaran tujuan.
 *
 * Dipakai oleh alat salin-semua-data di Dasbor (lihat app/dashboard/page.tsx)
 * -- mencari SENDIRI seluruh kunci dasar milik tahun ajaran sumber, tanpa
 * perlu daftar kunci yang di-hardcode.
 */
export function salinDataTahunAjaran(idSumber: string, idTujuan: string): HasilSalinTahun {
  const hasil: HasilSalinTahun = { disalin: [], dilewatiSudahAdaData: [], sumberKosong: [] }
  if (!idSumber || !idTujuan || idSumber === idTujuan) return hasil

  for (const kunciDasar of daftarKunciDasarUntukTahun(idSumber)) {
    const status = salinSatuKunciUtuh(kunciDasar, idSumber, idTujuan)
    if (status === 'disalin') hasil.disalin.push(kunciDasar)
    else if (status === 'dilewati') hasil.dilewatiSudahAdaData.push(kunciDasar)
    else hasil.sumberKosong.push(kunciDasar)
  }
  return hasil
}

/**
 * Salin UTUH satu daftar kunci dasar TERTENTU (bukan otomatis mencari semua)
 * dari idSumber ke idTujuan -- dipakai untuk modul yang datanya SATU kesatuan
 * milik bersama (bukan dipecah per guru/mapel), seperti Kaldik & Jadwal.
 * Kewenangan menyalin modul ini diatur lewat peran/akses modul terkait (lihat
 * bisaMengeditModul di lib/aksesPeran.ts), BUKAN lewat fungsi ini -- fungsi
 * ini murni mengeksekusi penyalinannya. HANYA mengisi kunci yang di tujuan
 * masih benar-benar kosong.
 */
export function salinKunciUtuh(kunciDasarList: string[], idSumber: string, idTujuan: string): HasilSalinTahun {
  const hasil: HasilSalinTahun = { disalin: [], dilewatiSudahAdaData: [], sumberKosong: [] }
  if (!idSumber || !idTujuan || idSumber === idTujuan) return hasil

  for (const kunciDasar of kunciDasarList) {
    const status = salinSatuKunciUtuh(kunciDasar, idSumber, idTujuan)
    if (status === 'disalin') hasil.disalin.push(kunciDasar)
    else if (status === 'dilewati') hasil.dilewatiSudahAdaData.push(kunciDasar)
    else hasil.sumberKosong.push(kunciDasar)
  }
  return hasil
}

/**
 * Salin entri PER MAPEL dari satu daftar kunci dasar berisi larik data yang
 * bercampur banyak mapel dalam SATU kunci bersama (mis. data_cp, data_tp,
 * data_atp, data_materi di CP/TP/ATP) -- supaya Guru A bisa menyalin datanya
 * sendiri dari tahun ajaran lalu TANPA memengaruhi data Guru B (yang belum
 * tentu ingin menyalin), walau keduanya berbagi kunci localStorage yang sama.
 *
 * Untuk SETIAP mapelId di mapelIds: kalau tujuan BELUM punya entri apapun
 * untuk mapel itu di kunci tsb, seluruh entri milik mapel itu dari sumber
 * ditambahkan (bukan menimpa entri mapel LAIN yang sudah ada di array yang
 * sama). Kalau tujuan SUDAH punya entri untuk mapel itu, dilewati sepenuhnya
 * -- tidak pernah menimpa/menggandakan data yang sudah mulai dikerjakan.
 */
export function salinKunciPerMapel(kunciDasarList: string[], idSumber: string, idTujuan: string, mapelIds: string[]): HasilSalinTahun {
  const hasil: HasilSalinTahun = { disalin: [], dilewatiSudahAdaData: [], sumberKosong: [] }
  if (!idSumber || !idTujuan || idSumber === idTujuan || mapelIds.length === 0) return hasil

  for (const kunciDasar of kunciDasarList) {
    const kunciSumber = `${kunciDasar}__${idSumber}`
    const kunciTujuan = `${kunciDasar}__${idTujuan}`
    let arrSumber: any[] = []
    let arrTujuan: any[] = []
    try { arrSumber = JSON.parse(localStorage.getItem(kunciSumber) || '[]') } catch { arrSumber = [] }
    try { arrTujuan = JSON.parse(localStorage.getItem(kunciTujuan) || '[]') } catch { arrTujuan = [] }
    if (!Array.isArray(arrSumber) || !Array.isArray(arrTujuan)) continue

    let arrTujuanBaru = arrTujuan
    let adaPerubahan = false
    for (const mapelId of mapelIds) {
      const label = `${kunciDasar}:${mapelId}`
      const entriSumberMapel = arrSumber.filter(item => item && item.mapelId === mapelId)
      if (entriSumberMapel.length === 0) { hasil.sumberKosong.push(label); continue }
      const sudahAdaDiTujuan = arrTujuan.some(item => item && item.mapelId === mapelId)
      if (sudahAdaDiTujuan) { hasil.dilewatiSudahAdaData.push(label); continue }
      arrTujuanBaru = [...arrTujuanBaru, ...entriSumberMapel]
      adaPerubahan = true
      hasil.disalin.push(label)
    }
    if (adaPerubahan) localStorage.setItem(kunciTujuan, JSON.stringify(arrTujuanBaru))
  }
  return hasil
}

/** Apakah SUMBER punya data untuk mapel tertentu di salah satu kunci dasar yang diberikan -- dipakai UI untuk menampilkan/menyembunyikan tombol salin. */
export function adaDataMapelUntukDisalin(kunciDasarList: string[], idSumber: string, mapelIds: string[]): boolean {
  if (!idSumber || mapelIds.length === 0) return false
  for (const kunciDasar of kunciDasarList) {
    let arrSumber: any[] = []
    try { arrSumber = JSON.parse(localStorage.getItem(`${kunciDasar}__${idSumber}`) || '[]') } catch { arrSumber = [] }
    if (Array.isArray(arrSumber) && arrSumber.some(item => item && mapelIds.includes(item.mapelId))) return true
  }
  return false
}
