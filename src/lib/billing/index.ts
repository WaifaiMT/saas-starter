import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDb } from "@/db/client";
import { organizations, subscriptions } from "@/db/schema";
import { recordAudit } from "../services/audit";
import { ACTIVE_STATUSES } from "./plans";
import type { BillingEvent, BillingProvider } from "./provider";
import { StripeBillingProvider } from "./stripe";

/** The configured billing provider, or null when billing isn't set up (the app still works on the free plan). */
export function getBillingProvider(): BillingProvider | null {
  const { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET } = process.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !STRIPE_WEBHOOK_SECRET) return null;
  return new StripeBillingProvider(STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET);
}

export async function getSubscription(organizationId: string) {
  const [row] = await getDb().select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId));
  return row ?? null;
}

/**
 * Returns the organisation's provider customer id, creating the customer on
 * first use. Storing it before checkout is what lets webhooks find the
 * organisation by customer id instead of trusting metadata.
 */
export async function ensureCustomer(
  provider: BillingProvider,
  org: { id: string; name: string },
  email: string,
): Promise<string> {
  const existing = await getSubscription(org.id);
  if (existing) return existing.providerCustomerId;

  const customerId = await provider.createCustomer({ organizationId: org.id, name: org.name, email });
  await getDb()
    .insert(subscriptions)
    .values({ organizationId: org.id, provider: provider.name, providerCustomerId: customerId, status: "none" })
    .onConflictDoNothing();
  return (await getSubscription(org.id))!.providerCustomerId;
}

async function findOrgByCustomer(db: NodePgDatabase, provider: string, customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: subscriptions.organizationId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerCustomerId, customerId)));
  return row?.organizationId ?? null;
}

/**
 * Applies a billing event: subscription changes move the organisation between
 * plans; invoice outcomes are recorded in the audit log. Idempotent, so a
 * replayed webhook leaves the same state.
 */
export async function applyBillingEvent(event: BillingEvent): Promise<void> {
  await getDb().transaction(async (tx) => {
    let organizationId = await findOrgByCustomer(tx, event.provider, event.customerId);
    if (!organizationId && event.kind === "subscription") organizationId = event.organizationIdHint;
    if (!organizationId) return; // Not one of ours, or the organisation was deleted

    const [org] = await tx
      .select({ id: organizations.id, plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    if (!org) return;

    if (event.kind === "invoice") {
      await recordAudit(tx, {
        organizationId: org.id,
        actorId: null,
        action: event.outcome === "paid" ? "billing.invoice_paid" : "billing.payment_failed",
        metadata: { amount: event.amountDue, currency: event.currency },
      });
      return;
    }

    const values = {
      provider: event.provider,
      providerCustomerId: event.customerId,
      providerSubscriptionId: event.subscriptionId,
      status: event.status,
      currentPeriodEnd: event.currentPeriodEnd,
      updatedAt: new Date(),
    };
    await tx
      .insert(subscriptions)
      .values({ organizationId: org.id, ...values })
      .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });

    const plan = ACTIVE_STATUSES.has(event.status) ? "pro" : "free";
    if (org.plan !== plan) {
      await tx.update(organizations).set({ plan }).where(eq(organizations.id, org.id));
      await recordAudit(tx, {
        organizationId: org.id,
        actorId: null,
        action: "billing.plan_changed",
        metadata: { from: org.plan, to: plan, status: event.status },
      });
    }
  });
}
