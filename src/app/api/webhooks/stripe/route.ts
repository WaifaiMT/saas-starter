import { applyBillingEvent, getBillingProvider } from "@/lib/billing";

// Stripe calls this on subscription changes. The signature check uses the raw
// body, so read it as text before anything parses it.
export async function POST(request: Request) {
  const billing = getBillingProvider();
  if (!billing) return Response.json({ error: "Billing is not configured." }, { status: 404 });

  let event;
  try {
    event = await billing.parseWebhook(await request.text(), request.headers.get("stripe-signature"));
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event) await applyBillingEvent(event);
  return Response.json({ received: true });
}
