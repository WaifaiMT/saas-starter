import { randomBytes } from "node:crypto";
import { createOrganization, getOrgContext, type OrgContext } from "@/lib/services/orgs";
import { createUser, type PublicUser } from "@/lib/services/users";

export async function makeUser(name = "Test User"): Promise<PublicUser> {
  const email = `user-${randomBytes(6).toString("hex")}@example.com`;
  return createUser({ name, email, password: "correct horse battery" });
}

export async function makeOrg(owner: PublicUser, name = `Org ${randomBytes(3).toString("hex")}`): Promise<OrgContext> {
  const org = await createOrganization(owner.id, name);
  return (await ctxFor(owner.id, org.slug))!;
}

export async function ctxFor(userId: string, slug: string): Promise<OrgContext | null> {
  return getOrgContext(userId, slug);
}
