'use client'

// lib/identitasOtomatis.ts
//
// Satu sumber kebenaran untuk mengambil identitas Mudir & Kepala Sekolah
// secara OTOMATIS dari data yang sudah ada di:
//   - identitas_induk  : {nama, npsn, logo_utama, logo, kop} — data yayasan pusat
//   - daftar_lembaga   : [{id, nama, npsn, logo, kop}, ...]  — data unit/cabang
//   - master_guru      : [{nama, nip, unitIds, peranIds, ...}, ...]
//   - master_peran     : [{id, nama}, ...]
//
// Nama Mudir & Kepala Sekolah TIDAK PERNAH diinput manual di halaman
// Kaldik/Jadwal/Prota-Promes/RPP — semuanya dideteksi di sini dengan mencari
// guru yang unit-nya cocok DAN memegang peran yang namanya mengandung
// "mudir"/"pimpinan yayasan" (untuk pusat) atau
// "kepala sekolah"/"pimpinan unit" (untuk cabang/unit).
//
// Satu-satunya field yang tetap manual di halaman-halaman itu adalah
// Titi Mangsa (tanggal surat), karena itu memang bukan bagian dari identitas
// struktural melainkan tanggal dokumen yang dicetak.

interface GuruRingkas {
  nama: string
  nip?: string
  unitIds?: string[]
  peranIds?: string[]
}
interface PeranRingkas { id: string; nama: string }
interface UnitLembaga { id: string; nama?: string; npsn?: string; alamat?: string; logo?: string; kop?: string; ttdKepala?: string; ttdWakakur?: string }

export interface IdentitasOtomatis {
  namaLembaga: string
  npsn: string
  alamat: string
  logo: string
  kop: string
  namaMudir: string
  nipMudir: string
  ttdMudir: string
  ttdWakakurPusat: string
  unitList: {
    id: string
    nama: string
    npsn: string
    alamat: string
    logo: string
    kop: string
    namaKepala: string
    nipKepala: string
    ttdKepala: string
    ttdWakakur: string
  }[]
}

function cariPeranId(daftarPeran: PeranRingkas[], kataKunci: string[]): string | null {
  const p = daftarPeran.find(pr => kataKunci.some(k => pr.nama?.toLowerCase().includes(k)))
  return p?.id || null
}

export function ambilNipGuru(g: GuruRingkas): string {
  return g.nip || ''
}

/** Ambil seluruh identitas (Mudir pusat + Kepala Sekolah tiap unit) secara otomatis. */
export function ambilIdentitasOtomatis(): IdentitasOtomatis | null {
  if (typeof window === 'undefined') return null
  try {
    const rawInduk = localStorage.getItem('identitas_induk')
    const rawLembaga = localStorage.getItem('daftar_lembaga')
    const rawGuru = localStorage.getItem('master_guru')
    const rawPeran = localStorage.getItem('master_peran')
    if (!rawInduk && !rawLembaga) return null

    const induk = rawInduk ? JSON.parse(rawInduk) : {}
    const daftarLembaga: UnitLembaga[] = rawLembaga ? JSON.parse(rawLembaga) : []
    const daftarGuru: GuruRingkas[] = rawGuru ? JSON.parse(rawGuru) : []
    const daftarPeran: PeranRingkas[] = rawPeran ? JSON.parse(rawPeran) : []

    const peranMudirId = cariPeranId(daftarPeran, ['mudir', 'pimpinan yayasan'])
    const peranKepsekId = cariPeranId(daftarPeran, ['kepala sekolah', 'pimpinan unit'])

    const mudir = peranMudirId
      ? daftarGuru.find(g => g.unitIds?.includes('lembaga-induk') && g.peranIds?.includes(peranMudirId))
      : undefined

    const unitList = daftarLembaga.map(u => {
      const kepsek = peranKepsekId
        ? daftarGuru.find(g => g.unitIds?.includes(u.id) && g.peranIds?.includes(peranKepsekId))
        : undefined
      return {
        id: u.id,
        nama: u.nama || '',
        npsn: u.npsn || '',
        alamat: u.alamat || induk.alamat || '',
        logo: u.logo || '',
        kop: u.kop || '',
        namaKepala: kepsek?.nama || '',
        nipKepala: kepsek ? ambilNipGuru(kepsek) : '',
        ttdKepala: u.ttdKepala || '',
        ttdWakakur: u.ttdWakakur || '',
      }
    })

    return {
      namaLembaga: induk.nama || '',
      npsn: induk.npsn || '',
      alamat: induk.alamat || '',
      logo: induk.logo_utama || induk.logo || '',
      kop: induk.kop || '',
      namaMudir: mudir?.nama || '',
      nipMudir: mudir ? ambilNipGuru(mudir) : '',
      ttdMudir: induk.ttdKepala || '',
      ttdWakakurPusat: induk.ttdWakakur || '',
      unitList,
    }
  } catch {
    return null
  }
}

/** Ambil Kepala Sekolah untuk SATU unit tertentu (dipakai kalau tidak butuh seluruh unitList). */
export function ambilKepalaSekolahUnit(unitId: string): { nama: string; nip: string; ttd: string } | null {
  const identitas = ambilIdentitasOtomatis()
  const unit = identitas?.unitList.find(u => u.id === unitId)
  if (!unit) return null
  return { nama: unit.namaKepala, nip: unit.nipKepala, ttd: unit.ttdKepala }
}
