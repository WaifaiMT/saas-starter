import { and, asc, count, eq, isNull, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { invites, memberships, users, type Role } from "@/db/schema";
import { getPlan } from "../billing/plans";
import { AppError } from "../errors";
import { parseId } from "../ids";
import { assertCan, canAssignRole } from "../permissions";
import { recordAudit } from "./audit";
import type { OrgContext } from "./orgs";

export async function listMembers(ctx: OrgContext) {
  assertCan(ctx.role, "members:read");
  return getDb()
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, ctx.org.id))
    .orderBy(asc(memberships.createdAt));
}

async function countOwners(organizationId: string): Promise<number> {
  const [{ value }] = await getDb()
    .select({ value: count() })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")));
  return value;
}

async function getRole(organizationId: string, userId: string): Promise<Role> {
  const [row] = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  if (!row) throw new AppError("not_found", "That person isn't a member of this organization.");
  return row.role;
}

export async function changeRole(ctx: OrgContext, targetId: string, newRole: Role): Promise<void> {
  assertCan(ctx.role, "members:manage");
  const targetUserId = parseId(targetId);
  if (!["owner", "admin", "member"].includes(newRole)) throw new AppError("validation", "Pick a valid role.");
  const currentRole = await getRole(ctx.org.id, targetUserId);
  if (!canAssignRole(ctx.role, currentRole) || !canAssignRole(ctx.role, newRole)) {
    throw new AppError("forbidden", "Only owners can change an owner's role or make someone an owner.");
  }
  if (currentRole === "owner" && newRole !== "owner" && (await countOwners(ctx.org.id)) <= 1) {
    throw new AppError("conflict", "An organization needs at least one owner. Make someone else an owner first.");
  }

  await getDb().transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ role: newRole })
      .where(and(eq(memberships.organizationId, ctx.org.id), eq(memberships.userId, targetUserId)));
    await recordAudit(tx, {
      organizationId: ctx.org.id,
      actorId: ctx.userId,
      action: "member.role_changed",
      target: targetUserId,
      metadata: { from: currentRole, to: newRole },
    });
  });
}

/** Removes a member. Anyone can remove themselves (leave); managing others needs members:manage. */
export async function removeMember(ctx: OrgContext, targetId: string): Promise<void> {
  const targetUserId = parseId(targetId);
  const leaving = targetUserId === ctx.userId;
  if (!leaving) assertCan(ctx.role, "members:manage");

  const targetRole = await getRole(ctx.org.id, targetUserId);
  if (!leaving && !canAssignRole(ctx.role, targetRole)) {
    throw new AppError("forbidden", "Only owners can remove an owner.");
  }
  if (targetRole === "owner" && (await countOwners(ctx.org.id)) <= 1) {
    throw new AppError("conflict", "The last owner can't leave. Make someone else an owner, or delete the organization.");
  }

  await getDb().transaction(async (tx) => {
    await tx
      .delete(memberships)
      .where(and(eq(memberships.organizationId, ctx.org.id), eq(memberships.userId, targetUserId)));
    await recordAudit(tx, {
      organizationId: ctx.org.id,
      actorId: ctx.userId,
      action: leaving ? "member.left" : "member.removed",
      target: targetUserId,
    });
  });
}

/** Members plus pending invites, checked against the plan's member limit. */
export async function assertMemberCapacity(ctx: OrgContext): Promise<void> {
  const limit = getPlan(ctx.org.plan).limits.members;
  if (limit === Infinity) return;
  const db = getDb();
  const [{ members }] = await db
    .select({ members: count() })
    .from(memberships)
    .where(eq(memberships.organizationId, ctx.org.id));
  const [{ pending }] = await db
    .select({ pending: count() })
    .from(invites)
    .where(and(eq(invites.organizationId, ctx.org.id), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  if (members + pending >= limit) {
    throw new AppError("plan_limit", `The ${getPlan(ctx.org.plan).name} plan allows ${limit} members. Upgrade to add more.`);
  }
}
