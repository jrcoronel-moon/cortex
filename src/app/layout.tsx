import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { Toaster } from 'react-hot-toast';

const outfit = Outfit({ subsets: ["latin"], display: 'swap' });

export const metadata: Metadata = {
  title: "Cortex | Context infrastructure for AI agents",
  description: "Context infrastructure for AI agents. Manage and organize knowledge with collaborative markdown editing and knowledge graphs.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${outfit.className} bg-background text-foreground h-screen w-full overflow-hidden`}>
        <Toaster position="bottom-right" toastOptions={{ style: { background: '#333', color: '#fff', borderRadius: '8px' } }} />
        {children}
      </body>
    </html>
  );
}
