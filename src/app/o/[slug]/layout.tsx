import { Suspense } from "react";
import { OrgNav } from "@/components/org-nav";
import { TopBar } from "@/components/top-bar";
import { Badge } from "@/components/ui";
import { requireOrg } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export default function OrgLayout({ children, params }: LayoutProps<"/o/[slug]">) {
  return (
    <>
      <TopBar />
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-6">
          {/* The slug and membership are request data; the rest of the layout prerenders */}
          <Suspense fallback={<div className="mb-6 h-7 w-48 animate-pulse rounded bg-slate-100" />}>
            <OrgHeader params={params} />
          </Suspense>
        </div>
      </div>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}

async function OrgHeader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, role } = await requireOrg(slug);
  const base = `/o/${org.slug}`;
  const links = [
    { href: base, label: "Projects" },
    { href: `${base}/members`, label: "Members" },
    ...(can(role, "audit:read") ? [{ href: `${base}/audit`, label: "Audit log" }] : []),
    ...(can(role, "billing:manage") ? [{ href: `${base}/billing`, label: "Billing" }] : []),
    ...(can(role, "org:update") ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{org.name}</h1>
        <Badge tone={org.plan === "pro" ? "indigo" : "slate"}>{org.plan === "pro" ? "Pro" : "Free"}</Badge>
        <Badge>{role}</Badge>
      </div>
      <OrgNav links={links} />
    </>
  );
}
