import type { Role } from "@/db/schema";
import { AppError } from "./errors";

export const PERMISSIONS = {
  "projects:read": ["owner", "admin", "member"],
  "projects:write": ["owner", "admin", "member"],
  "projects:delete": ["owner", "admin"],
  "members:read": ["owner", "admin", "member"],
  "members:invite": ["owner", "admin"],
  "members:manage": ["owner", "admin"],
  "audit:read": ["owner", "admin"],
  "billing:manage": ["owner"],
  "org:update": ["owner", "admin"],
  "org:delete": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AppError("forbidden", "You don't have permission to do that.");
  }
}

/** Admins can manage members but can't create or modify owners. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "owner";
  return false;
}
