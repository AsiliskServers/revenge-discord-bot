import "@/app/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Revenge Panel",
  description: "Gestion des features du bot Revenge",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
