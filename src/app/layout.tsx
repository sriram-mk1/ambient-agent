import type { Metadata } from "next";
import { Inter, Merriweather } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});

const merriweather = Merriweather({
  subsets: ["latin"],
  variable: "--font-merriweather",
  weight: ["300", "400", "700"],
  display: "swap",
  fallback: ["serif"],
});

export const metadata: Metadata = {
  title: "AI Agent",
  description: "Your Proactive AI Assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${merriweather.variable} antialiased`}
        style={
          {
            "--font-heading": "var(--font-merriweather), serif",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
