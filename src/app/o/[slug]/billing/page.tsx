import { notFound } from "next/navigation";
import { Suspense } from "react";
import { openPortalAction, startCheckoutAction } from "@/app/actions/orgs";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Skeleton, formatDate } from "@/components/ui";
import { requireOrg } from "@/lib/auth/session";
import { getBillingProvider, getSubscription } from "@/lib/billing";
import { PLANS, getPlan } from "@/lib/billing/plans";
import { can } from "@/lib/permissions";

export const metadata = { title: "Billing" };

export default function BillingPage({ params, searchParams }: PageProps<"/o/[slug]/billing">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Billing params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Billing({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (!can(ctx.role, "billing:manage")) notFound();
  const plan = getPlan(ctx.org.plan);
  const subscription = await getSubscription(ctx.org.id);
  const billingEnabled = getBillingProvider() !== null;
  const justUpgraded = (await searchParams).upgraded === "1";

  return (
    <div className="space-y-6">
      {justUpgraded && plan.id === "free" && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Payment received. Your plan updates as soon as Stripe confirms it; refresh in a few seconds.
        </p>
      )}

      <Card title="Current plan">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-slate-900">{plan.name}</span>
          <Badge tone={plan.id === "pro" ? "indigo" : "slate"}>{plan.priceLabel}</Badge>
          {subscription && subscription.status !== "none" && <Badge tone="emerald">{subscription.status}</Badge>}
        </div>
        {subscription?.currentPeriodEnd && (
          <p className="mt-2 text-sm text-slate-500">Current period ends {formatDate(subscription.currentPeriodEnd)}.</p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.values(PLANS).map((p) => (
          <div key={p.id} className={`rounded-lg border bg-white p-5 shadow-sm ${p.id === plan.id ? "border-indigo-400" : "border-slate-200"}`}>
            <p className="font-semibold text-slate-900">{p.name}</p>
            <p className="text-sm text-slate-500">{p.priceLabel}</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-600">
              <li>{p.limits.projects === Infinity ? "Unlimited" : p.limits.projects} projects</li>
              <li>{p.limits.members === Infinity ? "Unlimited" : p.limits.members} members</li>
            </ul>
          </div>
        ))}
      </div>

      <Card>
        {!billingEnabled ? (
          <p className="text-sm text-slate-500">
            Billing isn’t configured. Add <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_PRICE_ID</code>, and{" "}
            <code>STRIPE_WEBHOOK_SECRET</code> to <code>.env</code> to enable upgrades.
          </p>
        ) : subscription && plan.id === "pro" ? (
          <ActionForm action={openPortalAction.bind(null, slug)} submitLabel="Manage subscription" pendingLabel="Opening…" variant="secondary">
            <p className="text-sm text-slate-600">Change payment method, download invoices, or cancel in the Stripe customer portal.</p>
          </ActionForm>
        ) : (
          <ActionForm action={startCheckoutAction.bind(null, slug)} submitLabel="Upgrade to Pro" pendingLabel="Redirecting…">
            <p className="text-sm text-slate-600">You’ll pay securely on Stripe and come back here.</p>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
