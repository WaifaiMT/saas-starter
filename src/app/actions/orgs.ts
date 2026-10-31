"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/actions";
import { requireOrg, requireUser } from "@/lib/auth/session";
import { ensureCustomer, getBillingProvider, getSubscription } from "@/lib/billing";
import { AppError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { acceptInvite, createInvite, revokeInvite } from "@/lib/services/invites";
import { changeRole, removeMember } from "@/lib/services/members";
import { createOrganization, deleteOrganization, renameOrganization } from "@/lib/services/orgs";
import { createProject, deleteProject } from "@/lib/services/projects";
import type { Role } from "@/db/schema";

// Every action re-reads the session and membership on the server; the slug
// is bound by the page, never trusted to grant access on its own.

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function createOrgAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let slug = "";
  const state = await runAction(async () => {
    const user = await requireUser();
    slug = (await createOrganization(user.id, field(form, "name"))).slug;
  });
  if (state.error) return state;
  redirect(`/o/${slug}`);
}

export async function createProjectAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await createProject(await requireOrg(slug), { name: field(form, "name"), description: field(form, "description") });
    refresh();
  });
}

export async function deleteProjectAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deleteProject(await requireOrg(slug), field(form, "projectId"));
    refresh();
  });
}

export async function inviteMemberAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { token } = await createInvite(await requireOrg(slug), { email: field(form, "email"), role: field(form, "role") });
    refresh();
    // No email service in the starter: show the link so it can be shared directly
    return `Invite created. Share this link: ${appUrl()}/invite/${token}`;
  });
}

export async function revokeInviteAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await revokeInvite(await requireOrg(slug), field(form, "inviteId"));
    refresh();
  });
}

export async function changeRoleAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await changeRole(await requireOrg(slug), field(form, "userId"), field(form, "role") as Role);
    refresh();
  });
}

export async function removeMemberAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  let left = false;
  const state = await runAction(async () => {
    const ctx = await requireOrg(slug);
    const userId = field(form, "userId");
    await removeMember(ctx, userId);
    left = userId === ctx.userId;
    if (!left) refresh();
  });
  if (left && !state.error) redirect("/orgs");
  return state;
}

export async function renameOrgAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await renameOrganization(await requireOrg(slug), field(form, "name"));
    refresh();
    return "Saved.";
  });
}

export async function deleteOrgAction(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async () => {
    const ctx = await requireOrg(slug);
    if (field(form, "confirmSlug") !== ctx.org.slug) {
      throw new AppError("validation", `Type "${ctx.org.slug}" to confirm.`);
    }
    await deleteOrganization(ctx);
  });
  if (state.error) return state;
  redirect("/orgs");
}

export async function acceptInviteAction(token: string): Promise<ActionState> {
  let slug = "";
  const state = await runAction(async () => {
    slug = (await acceptInvite(token, await requireUser())).orgSlug;
  });
  if (state.error) return state;
  redirect(`/o/${slug}`);
}

export async function startCheckoutAction(slug: string): Promise<ActionState> {
  let url = "";
  const state = await runAction(async () => {
    const ctx = await requireOrg(slug);
    assertCan(ctx.role, "billing:manage");
    const billing = getBillingProvider();
    if (!billing) throw new AppError("validation", "Billing isn't configured. Add the Stripe keys to .env.");
    const user = await requireUser();
    const customerId = await ensureCustomer(billing, ctx.org, user.email);
    url = await billing.createCheckout({
      customerId,
      successUrl: `${appUrl()}/o/${slug}/billing?upgraded=1`,
      cancelUrl: `${appUrl()}/o/${slug}/billing`,
    });
  });
  if (state.error) return state;
  redirect(url);
}

export async function openPortalAction(slug: string): Promise<ActionState> {
  let url = "";
  const state = await runAction(async () => {
    const ctx = await requireOrg(slug);
    assertCan(ctx.role, "billing:manage");
    const billing = getBillingProvider();
    const subscription = await getSubscription(ctx.org.id);
    if (!billing || !subscription) throw new AppError("not_found", "There's no subscription to manage yet.");
    url = await billing.createPortal({ customerId: subscription.providerCustomerId, returnUrl: `${appUrl()}/o/${slug}/billing` });
  });
  if (state.error) return state;
  redirect(url);
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
