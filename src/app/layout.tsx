import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SaaS Starter", template: "%s · SaaS Starter" },
  description: "Open-source multi-tenant SaaS starter: a PostgreSQL schema per organisation, roles, invites, audit log, and Stripe billing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">{children}</body>
    </html>
  );
}
