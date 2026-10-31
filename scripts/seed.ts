import "dotenv/config";
import { closePool } from "../src/db/client";
import { acceptInvite, createInvite } from "../src/lib/services/invites";
import { createOrganization, getOrgContext, listUserOrganizations } from "../src/lib/services/orgs";
import { createProject } from "../src/lib/services/projects";
import { authenticate, createUser, type PublicUser } from "../src/lib/services/users";

// Demo data: two users and two organisations, to see tenant isolation in the UI.
// Safe to run more than once.
const PASSWORD = "password1234";

async function user(name: string, email: string): Promise<PublicUser> {
  try {
    return await createUser({ name, email, password: PASSWORD });
  } catch {
    return authenticate(email, PASSWORD); // already seeded
  }
}

async function org(owner: PublicUser, name: string, projects: string[]) {
  const existing = (await listUserOrganizations(owner.id)).find((o) => o.name === name);
  if (existing) return (await getOrgContext(owner.id, existing.slug))!;

  const created = await createOrganization(owner.id, name);
  const ctx = (await getOrgContext(owner.id, created.slug))!;
  for (const p of projects) await createProject(ctx, { name: p });
  return ctx;
}

async function main() {
  const ada = await user("Ada Owner", "ada@example.com");
  const ben = await user("Ben Admin", "ben@example.com");

  const acme = await org(ada, "Acme", ["Website relaunch", "Mobile app"]);
  const globex = await org(ben, "Globex", ["Q3 roadmap"]);

  // Ben also joins Acme as an admin, so he can switch between both organisations
  if (!(await getOrgContext(ben.id, acme.org.slug))) {
    const { token } = await createInvite(acme, { email: ben.email, role: "admin" });
    await acceptInvite(token, ben);
  }

  console.log(`Acme:   /o/${acme.org.slug}`);
  console.log(`Globex: /o/${globex.org.slug}`);
  console.log(`\nSign in as ada@example.com or ben@example.com, password: ${PASSWORD}`);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
