import { describe, expect, it } from "vitest";
import { projects } from "@/db/schema";
import { getPool } from "@/db/client";
import { migrateAll } from "@/db/migrate";
import { withTenant } from "@/db/tenant";
import { tenantSchemaName } from "@/db/tenant-schema";
import { deleteOrganization } from "@/lib/services/orgs";
import { createProject, deleteProject, listProjects } from "@/lib/services/projects";
import { makeOrg, makeUser } from "./helpers";

async function schemaExists(schema: string): Promise<boolean> {
  const { rowCount } = await getPool().query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [schema]);
  return rowCount === 1;
}

describe("tenant isolation", () => {
  it("gives each organisation its own schema", async () => {
    const ctx = await makeOrg(await makeUser());
    expect(ctx.org.schemaName).toBe(tenantSchemaName(ctx.org.id));
    expect(await schemaExists(ctx.org.schemaName)).toBe(true);
  });

  it("never shows one organisation's projects to another", async () => {
    const acme = await makeOrg(await makeUser(), "Acme");
    const globex = await makeOrg(await makeUser(), "Globex");

    await createProject(acme, { name: "Acme secret roadmap" });
    await createProject(globex, { name: "Globex launch" });

    expect((await listProjects(acme)).map((p) => p.name)).toEqual(["Acme secret roadmap"]);
    expect((await listProjects(globex)).map((p) => p.name)).toEqual(["Globex launch"]);
  });

  it("can't delete another organisation's project by id", async () => {
    const acme = await makeOrg(await makeUser());
    const globex = await makeOrg(await makeUser());
    const project = await createProject(acme, { name: "Keep me" });

    await expect(deleteProject(globex, project.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await listProjects(acme)).toHaveLength(1);
  });

  it("refuses schema names that aren't generated tenant schemas", async () => {
    for (const bad of ["public", "org_x; DROP TABLE users", "org_ABC", `"org_${"0".repeat(32)}"`]) {
      await expect(withTenant(bad, async () => null)).rejects.toThrow(/Invalid tenant schema/);
    }
  });

  it("doesn't leak a tenant's search_path into the next query on a pooled connection", async () => {
    const acme = await makeOrg(await makeUser());
    await withTenant(acme.org.schemaName, (db) => db.select().from(projects));
    // Fill the pool so the connection that just served Acme is reused
    const results = await Promise.all(
      Array.from({ length: 10 }, () => getPool().query<{ search_path: string }>("SHOW search_path")),
    );
    for (const { rows } of results) {
      expect(rows[0].search_path).not.toContain(acme.org.schemaName);
    }
  });

  it("drops the schema and all its data when the organisation is deleted", async () => {
    const ctx = await makeOrg(await makeUser());
    await createProject(ctx, { name: "Doomed" });
    await deleteOrganization(ctx);
    expect(await schemaExists(ctx.org.schemaName)).toBe(false);
  });

  it("migrates every tenant schema, and re-running is a no-op", async () => {
    const ctx = await makeOrg(await makeUser());
    const first = await migrateAll(getPool());
    expect(first.public).toEqual([]);
    expect(first.tenants[ctx.org.schemaName]).toEqual([]);

    const { rows } = await getPool().query(`SELECT name FROM ${ctx.org.schemaName}._migrations`);
    expect(rows.map((r) => r.name)).toContain("0001_projects.sql");
  });
});
