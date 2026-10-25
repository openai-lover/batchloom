import type { Metadata } from "next";
import "./globals.css";
import "./studio.css";
import "./buyer.css";

export const metadata: Metadata = {
  title: "Batchloom — Good things come together",
  description: "An evidence-led production desk for small-batch makers. Turn scattered requests into a considered collection, with PayPal sandbox reservations.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
