import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { projects } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getPlan } from "../billing/plans";
import { AppError } from "../errors";
import { parseId } from "../ids";
import { assertCan } from "../permissions";
import { recordAudit } from "./audit";
import type { OrgContext } from "./orgs";

// Example tenant-scoped resource. Everything here runs through withTenant(),
// so it can only ever see the current organisation's projects.

const ProjectInput = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(80),
  description: z.string().trim().max(500).default(""),
});

export async function listProjects(ctx: OrgContext) {
  assertCan(ctx.role, "projects:read");
  return withTenant(ctx.org.schemaName, (db) => db.select().from(projects).orderBy(desc(projects.createdAt)));
}

export async function createProject(ctx: OrgContext, input: { name: string; description?: string }) {
  assertCan(ctx.role, "projects:write");
  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0].message);

  const plan = getPlan(ctx.org.plan);
  const project = await withTenant(ctx.org.schemaName, async (db) => {
    const [{ value }] = await db.select({ value: count() }).from(projects);
    if (value >= plan.limits.projects) {
      throw new AppError("plan_limit", `The ${plan.name} plan allows ${plan.limits.projects} projects. Upgrade to add more.`);
    }
    const [created] = await db.insert(projects).values({ ...parsed.data, createdBy: ctx.userId }).returning();
    // audit_log resolves to public through the search_path, so this commits atomically with the project
    await recordAudit(db, { organizationId: ctx.org.id, actorId: ctx.userId, action: "project.created", target: created.name });
    return created;
  });
  return project;
}

export async function deleteProject(ctx: OrgContext, projectId: string): Promise<void> {
  assertCan(ctx.role, "projects:delete");
  const id = parseId(projectId);
  await withTenant(ctx.org.schemaName, async (db) => {
    const [row] = await db.delete(projects).where(eq(projects.id, id)).returning({ name: projects.name });
    if (!row) throw new AppError("not_found", "That project doesn't exist.");
    await recordAudit(db, { organizationId: ctx.org.id, actorId: ctx.userId, action: "project.deleted", target: row.name });
  });
}
