// lib/aksesPeran.ts
'use client'

export interface AksesModul {
  read: boolean
  write: boolean
}

export interface AksesInfo {
  isGuru: boolean
  namaGuru?: string
  guruId?: string
  // 'all' = akses penuh ke seluruh modul (dipakai untuk akun Admin/Supabase auth)
  aksesMap: Record<string, AksesModul> | 'all'
}

/**
 * Menentukan info akses pengguna yang SEDANG LOGIN, berdasarkan data di localStorage.
 *
 * - Kalau tidak ada sesi guru (key 'sesi_guru_login'), pengguna dianggap ADMIN
 *   (login via Supabase Auth) -> akses penuh ke semua modul ('all').
 * - Kalau ada sesi guru, sistem mencari data guru yang cocok di 'master_guru'
 *   (dicocokkan berurutan lewat id -> email -> nama), lalu mengambil peranIds
 *   guru tsb dan MENGGABUNGKAN (union) hak akses read/write dari SEMUA peran
 *   yang dimiliki guru tsb (kalau guru punya >1 peran, dan salah satu peran
 *   memberi akses ke modul X, guru tsb tetap dapat akses ke modul X).
 *
 * CATATAN: sesuaikan pencocokan guruSesi (id/email/nama) dengan struktur data
 * yang benar-benar disimpan oleh halaman login guru Anda.
 */
export function getAksesInfo(): AksesInfo {
  if (typeof window === 'undefined') return { isGuru: false, aksesMap: 'all' }

  const sesiGuruRaw = localStorage.getItem('sesi_guru_login')
  if (!sesiGuruRaw) return { isGuru: false, aksesMap: 'all' }

  let guruSesi: any = {}
  try {
    guruSesi = JSON.parse(sesiGuruRaw)
  } catch {
    return { isGuru: true, aksesMap: {} }
  }

  let daftarGuru: any[] = []
  let daftarPeran: any[] = []
  try { daftarGuru = JSON.parse(localStorage.getItem('master_guru') || '[]') } catch {}
  try { daftarPeran = JSON.parse(localStorage.getItem('master_peran') || '[]') } catch {}

  const guruData =
    daftarGuru.find(g => g.id && guruSesi.id && g.id === guruSesi.id) ||
    daftarGuru.find(g => g.email && guruSesi.email && g.email === guruSesi.email) ||
    daftarGuru.find(g => g.nama && guruSesi.nama && g.nama === guruSesi.nama)

  const peranIds: string[] = guruData?.peranIds || (guruData?.peranId ? [guruData.peranId] : [])
  const aksesMap: Record<string, AksesModul> = {}

  peranIds.forEach(pid => {
    const peran = daftarPeran.find(p => p.id === pid)
    if (!peran?.akses) return
    Object.keys(peran.akses).forEach(modId => {
      const cur = aksesMap[modId] || { read: false, write: false }
      const tambahan = peran.akses[modId] || {}
      aksesMap[modId] = {
        read: cur.read || !!tambahan.read,
        write: cur.write || !!tambahan.write,
      }
    })
  })

  return {
    isGuru: true,
    namaGuru: guruData?.nama || guruSesi.nama || 'Guru',
    guruId: guruData?.id,
    aksesMap,
  }
}

/** Apakah pengguna saat ini boleh MELIHAT (read) modul tertentu. Admin selalu true. */
export function bisaMelihatModul(moduleId: string): boolean {
  const info = getAksesInfo()
  if (!info.isGuru) return true
  if (info.aksesMap === 'all') return true
  return !!info.aksesMap[moduleId]?.read
}

/** Apakah pengguna saat ini boleh MENGEDIT (write) modul tertentu. Admin selalu true. */
export function bisaMengeditModul(moduleId: string): boolean {
  const info = getAksesInfo()
  if (!info.isGuru) return true
  if (info.aksesMap === 'all') return true
  return !!info.aksesMap[moduleId]?.write
}
