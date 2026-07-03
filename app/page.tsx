"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation"; 
import { supabase } from "./supabase";
import { Landmark, User, Lock, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [identity, setIdentity] = useState(""); 
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [npsnSekolah, setNpsnSekolah] = useState("12345678"); 
  
  const router = useRouter();

  useEffect(() => {
    // Ambil NPSN sekolah tersimpan otomatis untuk validasi sandi guru
    const storedInduk = localStorage.getItem("identitas_induk");
    if (storedInduk) {
      try {
        const parsed = JSON.parse(storedInduk);
        const npsnVal = parsed.npsn || parsed.nomor_statistik || parsed.NPSN || parsed.nomorStatistik;
        if (npsnVal) setNpsnSekolah(String(npsnVal).trim());
      } catch (e) {
        // Abaikan jika format penyimpanan belum ada
      }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    // Deteksi apakah input berupa Email (mengandung '@') atau Nama Guru (teks biasa)
    const isEmail = identity.includes("@");

    if (isEmail) {
      // Alur Akses Admin / Kurikulum (Menggunakan Auth Supabase)
      const { error } = await supabase.auth.signInWithPassword({
        email: identity,
        password,
      });

      if (error) {
        setMessage(`Gagal masuk Admin: ${error.message}`);
      } else {
        setMessage("Login Admin Berhasil! Menghubungkan ke sistem...");
        router.push('/dashboard'); 
      }
    } else {
      // Alur Akses Guru / Kontributor (Validasi lokal Nama + NPSN)
      if (password !== npsnSekolah) {
        setMessage("Kata sandi tidak sesuai dengan NPSN sekolah.");
        setLoading(false);
        return;
      }

      // Ambil daftar master guru yang didaftarkan pada menu Master Data Guru
      const daftarGuru = JSON.parse(localStorage.getItem('master_guru') || '[]');
      
      // Formula pembersihan gelar, spasi, dan titik yang seragam
      const bersihkanNama = (str: string) => {
        return str
          .split(',')[0]
          .replace(/\./g, '')
          .replace(/\s+/g, '')
          .toLowerCase();
      };

      const inputNamaBersih = bersihkanNama(identity);
      const guruKetemu = daftarGuru.find((g: any) => bersihkanNama(g.nama) === inputNamaBersih);

      if (guruKetemu) {
        // Simpan sesi login guru di browser
        localStorage.setItem('sesi_guru_login', JSON.stringify(guruKetemu));
        setMessage("Login Guru Berhasil! Mengarahkan ke dasbor...");
        
        // PERBAIKAN: Arahkan ke rute /dashboard (karena dasbor sudah disatukan)
        router.push('/dashboard'); 
      } else {
        setMessage("Nama tidak terdaftar sebagai guru/kontributor di sistem sekolah.");
      }
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-100">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl border border-slate-200">
        <div className="text-center space-y-2">
           <Landmark className="w-10 h-10 mx-auto text-indigo-600" />
           <h1 className="text-xl font-black text-gray-900 tracking-wide">
             Sistem Administrasi Sekolah
           </h1>
           <p className="text-xs font-medium text-slate-500">Portal Akses Admin Kurikulum & Pendidik</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Email (Admin) atau Nama Lengkap (Guru)</label>
            <div className="relative">
               <User className="w-5 h-5 absolute left-3 top-3.5 text-slate-400" />
               <input 
                 type="text" 
                 value={identity}
                 onChange={(e) => setIdentity(e.target.value)}
                 className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700" 
                 placeholder="admin@sekolah.sch.id ATAU nurulfitri" 
                 required
               />
            </div>
            <p className="text-[9px] text-slate-400 mt-1 pl-1 leading-relaxed">
               * Guru: Ketik nama murni tanpa gelar/spasi (misal: <i>nurulfitri</i>) sesuai data master.
            </p>
          </div>
          
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Kata Sandi</label>
            <div className="relative">
               <Lock className="w-5 h-5 absolute left-3 top-3.5 text-slate-400" />
               <input 
                 type="password" 
                 value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700" 
                 placeholder="Kata sandi / NPSN sekolah"
                 required
               />
            </div>
          </div>

          {message && (
            <p className={`text-xs text-center font-bold p-2 rounded-lg ${message.startsWith('Gagal') || message.includes('tidak sesuai') || message.includes('tidak terdaftar') ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
              {message}
            </p>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full px-4 py-3.5 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 font-black shadow-md transition flex items-center justify-center gap-2"
          >
            {loading ? 'Memvalidasi Akses...' : 'Masuk Sistem'} <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </main>
  );
}