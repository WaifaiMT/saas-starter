export type PlanId = "free" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  priceLabel: string;
  limits: { projects: number; members: number };
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", priceLabel: "$0", limits: { projects: 3, members: 3 } },
  pro: { id: "pro", name: "Pro", priceLabel: "$19 / month", limits: { projects: Infinity, members: Infinity } },
};

export function getPlan(id: string): Plan {
  return PLANS[id as PlanId] ?? PLANS.free;
}

/** Subscription statuses that keep an organisation on its paid plan. */
export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
