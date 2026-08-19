import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// TSUNAGI ///M: Inter for chrome, JetBrains Mono for anything read from or
// written to a machine. The mono face is chosen for its tall x-height and
// slashed zero, which stay legible at the 8-10px sizes the readouts and the
// map/table cells render at. The theme's `@theme inline` block references these
// exact variable names -- font-sans / font-mono are inert without them.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CSL SIM ///M",
  description: "OpenWAM engine simulation and live DS2 telemetry for the E46 M3 CSL",
};

// Dark-only, twice on purpose: the CSS `color-scheme` property (in globals.css)
// is what cascades into native <select>, and mobile UAs ignore author styling on
// <option> entirely -- without it the driver gets a white sheet, at night,
// mid-session. `viewportFit: 'cover'` is deliberately NOT set: it only helps
// once every edge-touching container pads by env(safe-area-inset-*), and none
// do, so turning it on alone moves content under the notch.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
