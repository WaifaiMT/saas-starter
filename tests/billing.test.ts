import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { applyBillingEvent, ensureCustomer, getSubscription } from "@/lib/billing";
import type { BillingProvider } from "@/lib/billing/provider";
import { StripeBillingProvider } from "@/lib/billing/stripe";
import { listAudit } from "@/lib/services/audit";
import { createProject } from "@/lib/services/projects";
import { ctxFor, makeOrg, makeUser } from "./helpers";

/** A provider that hands out predictable customer ids, so tests never call Stripe. */
function fakeProvider(): BillingProvider & { created: number } {
  return {
    name: "stripe",
    created: 0,
    async createCustomer({ organizationId }) {
      this.created++;
      return `cus_${organizationId.slice(0, 8)}`;
    },
    async createCheckout() {
      return "https://checkout.example";
    },
    async createPortal() {
      return "https://portal.example";
    },
    async parseWebhook() {
      return null;
    },
  };
}

async function orgWithCustomer() {
  const ctx = await makeOrg(await makeUser());
  const customerId = await ensureCustomer(fakeProvider(), ctx.org, "owner@example.com");
  return { ctx, customerId };
}

function subscriptionEvent(customerId: string, status: string) {
  return {
    kind: "subscription" as const,
    provider: "stripe",
    customerId,
    subscriptionId: "sub_test",
    status,
    currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
    organizationIdHint: null,
  };
}

describe("plans", () => {
  it("caps free organisations at 3 projects", async () => {
    const ctx = await makeOrg(await makeUser());
    for (const name of ["One", "Two", "Three"]) await createProject(ctx, { name });
    await expect(createProject(ctx, { name: "Four" })).rejects.toMatchObject({ code: "plan_limit" });
  });

  it("creates the provider customer once and reuses it", async () => {
    const ctx = await makeOrg(await makeUser());
    const provider = fakeProvider();
    const first = await ensureCustomer(provider, ctx.org, "a@example.com");
    const second = await ensureCustomer(provider, ctx.org, "a@example.com");
    expect(second).toBe(first);
    expect(provider.created).toBe(1);
  });

  it("finds the organisation by customer id, upgrades it, and downgrades when the subscription ends", async () => {
    const { ctx, customerId } = await orgWithCustomer();

    await applyBillingEvent(subscriptionEvent(customerId, "active"));
    let current = (await ctxFor(ctx.userId, ctx.org.slug))!;
    expect(current.org.plan).toBe("pro");
    for (const name of ["1", "2", "3", "4"]) await createProject(current, { name });

    await applyBillingEvent(subscriptionEvent(customerId, "canceled"));
    current = (await ctxFor(ctx.userId, ctx.org.slug))!;
    expect(current.org.plan).toBe("free");
    expect(await getSubscription(ctx.org.id)).toMatchObject({ status: "canceled", providerSubscriptionId: "sub_test" });
  });

  it("is idempotent when the same event arrives twice", async () => {
    const { ctx, customerId } = await orgWithCustomer();
    await applyBillingEvent(subscriptionEvent(customerId, "active"));
    await applyBillingEvent(subscriptionEvent(customerId, "active"));
    expect((await ctxFor(ctx.userId, ctx.org.slug))!.org.plan).toBe("pro");
    const planChanges = (await listAudit(ctx)).filter((e) => e.action === "billing.plan_changed");
    expect(planChanges).toHaveLength(1);
  });

  it("ignores events for unknown customers", async () => {
    await expect(applyBillingEvent(subscriptionEvent("cus_unknown", "active"))).resolves.toBeUndefined();
  });

  it("records failed payments in the audit log", async () => {
    const { ctx, customerId } = await orgWithCustomer();
    await applyBillingEvent({
      kind: "invoice",
      provider: "stripe",
      customerId,
      outcome: "payment_failed",
      amountDue: 1900,
      currency: "usd",
    });
    const [entry] = await listAudit(ctx);
    expect(entry).toMatchObject({ action: "billing.payment_failed", metadata: { amount: 1900, currency: "usd" } });
  });
});

describe("Stripe webhooks", () => {
  const secret = "whsec_test_secret";
  const provider = new StripeBillingProvider("sk_test_dummy", "price_dummy", secret);
  const stripe = new Stripe("sk_test_dummy");

  const subscriptionPayload = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_123",
        object: "subscription",
        customer: "cus_123",
        status: "active",
        metadata: {},
        items: { object: "list", data: [{ current_period_end: 1_800_000_000 }] },
      },
    },
  });

  it("accepts a correctly signed subscription event and normalises it", async () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload: subscriptionPayload, secret });
    await expect(provider.parseWebhook(subscriptionPayload, signature)).resolves.toEqual({
      kind: "subscription",
      provider: "stripe",
      customerId: "cus_123",
      subscriptionId: "sub_123",
      status: "active",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
      organizationIdHint: null,
    });
  });

  it("normalises failed invoice payments", async () => {
    const payload = JSON.stringify({
      id: "evt_2",
      object: "event",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", object: "invoice", customer: "cus_123", amount_due: 1900, currency: "usd" } },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    await expect(provider.parseWebhook(payload, signature)).resolves.toMatchObject({
      kind: "invoice",
      outcome: "payment_failed",
      customerId: "cus_123",
    });
  });

  it("ignores event types the app doesn't use", async () => {
    const payload = JSON.stringify({ id: "evt_3", object: "event", type: "product.created", data: { object: {} } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    await expect(provider.parseWebhook(payload, signature)).resolves.toBeNull();
  });

  it("rejects a forged or missing signature", async () => {
    const forged = stripe.webhooks.generateTestHeaderString({ payload: subscriptionPayload, secret: "whsec_wrong" });
    await expect(provider.parseWebhook(subscriptionPayload, forged)).rejects.toThrow();
    await expect(provider.parseWebhook(subscriptionPayload, null)).rejects.toThrow();
  });
});
