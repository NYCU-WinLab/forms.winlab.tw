import type { Metadata } from "next";
import { Geist_Mono, Inter, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Noto Sans TC is the Google-distributed cut of Source Han Sans TC (思源黑體).
// CJK files are heavy — restrict to the weights the UI actually uses.
const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-sans-tc",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "forms.winlab.tw",
    template: "%s · forms.winlab.tw",
  },
  description:
    "AI consultant that pre-interviews department reps so WinLab consultants walk into the kickoff meeting already knowing where to look.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${inter.variable} ${notoSansTC.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
