import type { Metadata } from "next";
import { Baloo_2, Open_Sans } from "next/font/google";
import "./globals.css";
import CloudSyncProvider from "@/components/CloudSyncProvider";

// CATATAN: GoogleOAuthProvider (@react-oauth/google) SENGAJA TIDAK dipasang di sini lagi.
// Provider itu memasang <script> ke accounts.google.com/gsi/client di SETIAP halaman --
// padahal cuma halaman Kaldik yang benar-benar memakai fitur importnya (lihat
// app/kaldik/layout.tsx). Banyak ad-blocker/privacy extension (uBlock, Brave Shields, dst)
// memblokir domain Google itu secara default -- memasangnya secara GLOBAL di sini berarti
// SEMUA halaman ikut membawa dependensi ke skrip pihak ketiga yang rawan diblokir itu,
// walau tidak butuh sama sekali. Sekarang provider itu hanya membungkus halaman Kaldik saja,
// supaya blokir apapun pada skrip Google itu paling banter cuma mempengaruhi fitur import
// Kaldik, bukan seluruh sistem.

// Ini adalah kode sakti agar seluruh E-Rapor selalu update data seketika
export const dynamic = 'force-dynamic';

// Font Tebal / display untuk judul & elemen penting (dipakai lewat class "font-baloo")
const baloo = Baloo_2({
  variable: "--font-baloo",
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
});

// Font utama untuk seluruh isi halaman (dipakai lewat class "font-opensans",
// dan juga menjadi font default seluruh body)
const openSans = Open_Sans({
  variable: "--font-opensans",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sistem Administrasi Sekolah",
  description: "Sistem Administrasi Sekolah",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${baloo.variable} ${openSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-opensans">
        <CloudSyncProvider>
          {children}
        </CloudSyncProvider>
      </body>
    </html>
  );
}
