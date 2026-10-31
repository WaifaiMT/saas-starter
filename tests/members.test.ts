import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { can, canAssignRole } from "@/lib/permissions";
import { acceptInvite, createInvite, getInvite, listPendingInvites, revokeInvite } from "@/lib/services/invites";
import { changeRole, listMembers, removeMember } from "@/lib/services/members";
import { listAudit } from "@/lib/services/audit";
import { ctxFor, makeOrg, makeUser } from "./helpers";

describe("permissions", () => {
  it("matches the role matrix", () => {
    expect(can("member", "projects:write")).toBe(true);
    expect(can("member", "projects:delete")).toBe(false);
    expect(can("admin", "members:invite")).toBe(true);
    expect(can("admin", "billing:manage")).toBe(false);
    expect(can("owner", "org:delete")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("owner", "owner")).toBe(true);
  });
});

describe("invites", () => {
  it("adds the invited user with the invited role, once", async () => {
    const owner = await makeUser();
    const ctx = await makeOrg(owner);
    const invitee = await makeUser("Invitee");

    const { token } = await createInvite(ctx, { email: invitee.email, role: "admin" });
    expect(await getInvite(token)).toMatchObject({ orgSlug: ctx.org.slug, role: "admin" });

    await acceptInvite(token, invitee);
    expect((await ctxFor(invitee.id, ctx.org.slug))?.role).toBe("admin");

    // Single use
    await expect(acceptInvite(token, invitee)).rejects.toMatchObject({ code: "not_found" });
    expect(await getInvite(token)).toBeNull();
  });

  it("can't be accepted by a different account", async () => {
    const ctx = await makeOrg(await makeUser());
    const invitee = await makeUser();
    const stranger = await makeUser();
    const { token } = await createInvite(ctx, { email: invitee.email, role: "member" });

    await expect(acceptInvite(token, stranger)).rejects.toMatchObject({ code: "forbidden" });
    expect(await ctxFor(stranger.id, ctx.org.slug)).toBeNull();
  });

  it("stops working once revoked", async () => {
    const ctx = await makeOrg(await makeUser());
    const invitee = await makeUser();
    const { token } = await createInvite(ctx, { email: invitee.email, role: "member" });
    const [pending] = await listPendingInvites(ctx);
    await revokeInvite(ctx, pending.id);
    await expect(acceptInvite(token, invitee)).rejects.toMatchObject({ code: "not_found" });
  });

  it("enforces the free plan's member limit (members + pending invites)", async () => {
    const ctx = await makeOrg(await makeUser()); // free plan: 3 members
    await createInvite(ctx, { email: "a@example.com", role: "member" });
    await createInvite(ctx, { email: "b@example.com", role: "member" });
    await expect(createInvite(ctx, { email: "c@example.com", role: "member" })).rejects.toMatchObject({
      code: "plan_limit",
    });

    await getDb().update(organizations).set({ plan: "pro" }).where(eq(organizations.id, ctx.org.id));
    const proCtx = (await ctxFor(ctx.userId, ctx.org.slug))!;
    await expect(createInvite(proCtx, { email: "c@example.com", role: "member" })).resolves.toHaveProperty("token");
  });

  it("doesn't let members invite people", async () => {
    const ctx = await makeOrg(await makeUser());
    const member = await makeUser();
    const { token } = await createInvite(ctx, { email: member.email, role: "member" });
    await acceptInvite(token, member);
    const memberCtx = (await ctxFor(member.id, ctx.org.slug))!;
    await expect(createInvite(memberCtx, { email: "x@example.com", role: "member" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("member management", () => {
  async function orgWithAdmin() {
    const owner = await makeUser("Owner");
    const ctx = await makeOrg(owner);
    const admin = await makeUser("Admin");
    const { token } = await createInvite(ctx, { email: admin.email, role: "admin" });
    await acceptInvite(token, admin);
    return { ownerCtx: ctx, adminCtx: (await ctxFor(admin.id, ctx.org.slug))!, owner, admin };
  }

  it("keeps at least one owner", async () => {
    const { ownerCtx, owner } = await orgWithAdmin();
    await expect(changeRole(ownerCtx, owner.id, "admin")).rejects.toMatchObject({ code: "conflict" });
    await expect(removeMember(ownerCtx, owner.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("doesn't let admins touch owners or promote to owner", async () => {
    const { adminCtx, owner, admin } = await orgWithAdmin();
    await expect(removeMember(adminCtx, owner.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(changeRole(adminCtx, admin.id, "owner")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets an owner hand over ownership, then step down", async () => {
    const { ownerCtx, owner, admin } = await orgWithAdmin();
    await changeRole(ownerCtx, admin.id, "owner");
    await changeRole(ownerCtx, owner.id, "member");
    const roles = Object.fromEntries((await listMembers(ownerCtx)).map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [owner.id]: "member", [admin.id]: "owner" });
  });

  it("lets members leave and records it in the audit log", async () => {
    const { ownerCtx, adminCtx, admin } = await orgWithAdmin();
    await removeMember(adminCtx, admin.id);
    expect(await ctxFor(admin.id, ownerCtx.org.slug)).toBeNull();
    const actions = (await listAudit(ownerCtx)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["org.created", "invite.created", "invite.accepted", "member.left"]));
  });
});
