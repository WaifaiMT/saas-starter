// Billing is behind this interface so a second provider (Paystack, for
// African markets) can be added without touching the rest of the app.

/**
 * A provider event, normalised into the shapes the app acts on. Events are
 * matched to an organisation by the provider's customer id, which is stored
 * before checkout; `organizationIdHint` (from metadata) is only a fallback.
 */
export type BillingEvent =
  | {
      kind: "subscription";
      provider: string;
      customerId: string;
      subscriptionId: string;
      status: string;
      currentPeriodEnd: Date | null;
      organizationIdHint: string | null;
    }
  | {
      kind: "invoice";
      provider: string;
      customerId: string;
      outcome: "paid" | "payment_failed";
      amountDue: number;
      currency: string;
    };

export interface BillingProvider {
  readonly name: string;
  /** Creates the provider-side customer for an organisation and returns its id. */
  createCustomer(input: { organizationId: string; name: string; email: string }): Promise<string>;
  /** Returns a hosted checkout URL for upgrading the organisation to the paid plan. */
  createCheckout(input: { customerId: string; successUrl: string; cancelUrl: string }): Promise<string>;
  /** Returns a hosted page where the customer manages their subscription. */
  createPortal(input: { customerId: string; returnUrl: string }): Promise<string>;
  /**
   * Verifies a webhook's signature and converts it to a BillingEvent.
   * Returns null for events the app doesn't need. Throws if the signature is invalid.
   */
  parseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent | null>;
}
