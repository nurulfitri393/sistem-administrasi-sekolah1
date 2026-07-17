import { GoogleOAuthProvider } from "@react-oauth/google";

// Dipasang KHUSUS di sini (bukan di app/layout.tsx global) karena hanya halaman Kaldik
// yang memakai useGoogleLogin (fitur "Impor dari Google Calendar") -- lihat catatan di
// app/layout.tsx untuk alasan lengkap kenapa provider ini dipindah dari global.
export default function KaldikLayout({ children }: { children: React.ReactNode }) {
  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}>
      {children}
    </GoogleOAuthProvider>
  );
}
