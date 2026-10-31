import Stripe from "stripe";
import type { BillingEvent, BillingProvider } from "./provider";

// Labels this integration's Checkout Sessions in the Stripe Dashboard
const INTEGRATION_IDENTIFIER = "saas_starter_checkout_qkvmrxtd";

const customerId = (customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null =>
  customer === null ? null : typeof customer === "string" ? customer : customer.id;

export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe";
  private readonly stripe: Stripe;

  constructor(
    apiKey: string,
    private readonly priceId: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(apiKey);
  }

  async createCustomer(input: { organizationId: string; name: string; email: string }): Promise<string> {
    const customer = await this.stripe.customers.create(
      { name: input.name, email: input.email, metadata: { organizationId: input.organizationId } },
      // Retrying for the same organisation returns the same customer instead of a duplicate
      { idempotencyKey: `customer:${input.organizationId}` },
    );
    return customer.id;
  }

  async createCheckout(input: { customerId: string; successUrl: string; cancelUrl: string }): Promise<string> {
    // No payment_method_types: Stripe picks eligible methods from Dashboard settings
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.customerId,
      line_items: [{ price: this.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      integration_identifier: INTEGRATION_IDENTIFIER,
    });
    if (!session.url) throw new Error("Stripe didn't return a checkout URL.");
    return session.url;
  }

  async createPortal(input: { customerId: string; returnUrl: string }): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return session.url;
  }

  async parseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent | null> {
    if (!signature) throw new Error("Missing Stripe signature.");
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return toSubscriptionEvent(event.data.object);
      case "invoice.paid":
      case "invoice.payment_failed":
        return toInvoiceEvent(event.data.object, event.type === "invoice.paid" ? "paid" : "payment_failed");
      default:
        return null;
    }
  }
}

export function toSubscriptionEvent(subscription: Stripe.Subscription): BillingEvent | null {
  const customer = customerId(subscription.customer);
  if (!customer) return null;
  // Billing periods live on subscription items in current Stripe API versions
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return {
    kind: "subscription",
    provider: "stripe",
    customerId: customer,
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    organizationIdHint: subscription.metadata?.organizationId ?? null,
  };
}

export function toInvoiceEvent(invoice: Stripe.Invoice, outcome: "paid" | "payment_failed"): BillingEvent | null {
  const customer = customerId(invoice.customer);
  if (!customer) return null;
  return {
    kind: "invoice",
    provider: "stripe",
    customerId: customer,
    outcome,
    amountDue: invoice.amount_due,
    currency: invoice.currency,
  };
}
