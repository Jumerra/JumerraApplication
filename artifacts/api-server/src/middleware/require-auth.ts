import type { Request, Response, NextFunction } from "express";
import { findUserById } from "../lib/auth";
import type { User } from "@workspace/db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Reuse a user already resolved earlier in the same request (e.g. by
  // the ministry lockdown gate) so we don't issue a second identical
  // PK lookup on every authenticated request.
  const user = req.currentUser ?? (await findUserById(userId));
  if (!user || user.status !== "active") {
    req.session.userId = undefined;
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.currentUser = user;
  next();
}

/**
 * Best-effort `currentUser` populator for routes that are accessible to
 * anonymous viewers but want to behave differently when an admin is
 * logged in (e.g. surface admin-only fields). Never rejects the request.
 */
export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    next();
    return;
  }
  const user = await findUserById(userId);
  if (user && user.status === "active") {
    req.currentUser = user;
  }
  next();
}

/**
 * Path prefixes a logged-in `ministry` account is allowed to touch.
 * Ministry oversight accounts are aggregate-only: they must never reach
 * any PII/detail surface (candidates, applications, dashboards, etc.).
 * Everything outside this allowlist returns 403 for them.
 */
const MINISTRY_ALLOWED_PREFIXES = ["/ministry", "/auth"];

/**
 * Global lockdown for `ministry` accounts. Mounted at the very top of the
 * API router so it runs before every business route. Anonymous requests
 * and non-ministry users pass straight through (the user is cached on
 * `req.currentUser` so the downstream `requireAuth` reuses it instead of
 * re-querying). A logged-in ministry user may only reach `/ministry/*`
 * and `/auth/*`; any other path is rejected with 403 so a ministry can
 * never enumerate individual candidate/application PII through the
 * existing authenticated endpoints.
 */
export async function ministryLockdown(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    next();
    return;
  }
  const user = await findUserById(userId);
  if (!user || user.status !== "active") {
    next();
    return;
  }
  req.currentUser = user;
  if (user.role !== "ministry") {
    next();
    return;
  }
  const p = req.path;
  const allowed = MINISTRY_ALLOWED_PREFIXES.some(
    (pre) => p === pre || p.startsWith(`${pre}/`),
  );
  if (allowed) {
    next();
    return;
  }
  res.status(403).json({
    error: "Ministry accounts can only access ministry dashboards.",
  });
}

/**
 * Paths a logged-in user with `mustChangePassword === true` may still
 * reach. They must be able to read their own auth state, perform the
 * password change that clears the flag, and log out — nothing else.
 */
const FORCED_PASSWORD_ALLOWED_PATHS = new Set([
  "/auth/me",
  "/auth/change-password",
  "/auth/logout",
]);

/**
 * Server-side enforcement of the forced first-login password change.
 * Mounted at the top of the API router (after `ministryLockdown`) so it
 * runs before every business route. A user flagged `mustChangePassword`
 * has a valid session but must not be able to use the app — via the web
 * UI or a direct API client — until they change their password. The web
 * `ForcedPasswordGate` is only a UX layer; this is the real control.
 *
 * Anonymous + non-flagged traffic passes straight through. The resolved
 * user is cached on `req.currentUser` so downstream `requireAuth` reuses
 * it instead of re-querying.
 */
export async function forcedPasswordChangeGate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    next();
    return;
  }
  const user = req.currentUser ?? (await findUserById(userId));
  if (!user || user.status !== "active") {
    next();
    return;
  }
  req.currentUser = user;
  if (!user.mustChangePassword) {
    next();
    return;
  }
  if (FORCED_PASSWORD_ALLOWED_PATHS.has(req.path)) {
    next();
    return;
  }
  res.status(403).json({
    error: "You must change your password before continuing.",
    mustChangePassword: true,
  });
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.currentUser?.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

/**
 * True if the user has owner-level write privileges on their org
 * (employer/institution owner, or platform super_admin).
 */
export function isOrgOwner(user: User | undefined | null): boolean {
  if (!user) return false;
  // Legacy admin accounts (created before the org_role column existed)
  // are treated as super_admin so they retain owner-level privileges.
  // This mirrors `isSuperAdmin` in routes/admin.ts.
  if (user.role === "admin") {
    return user.orgRole === "super_admin" || user.orgRole === null;
  }
  return user.orgRole === "owner";
}

/**
 * True if the user has owner-equivalent privileges on an institution
 * (institution owner, institution registrar, or platform super_admin).
 * Registrars are operational owners for university workflows: they can
 * manage faculties, departments, staff invites, and the full student
 * roster across the whole institution.
 */
export function isOrgOwnerOrRegistrar(
  user: User | undefined | null,
): boolean {
  if (!user) return false;
  if (isOrgOwner(user)) return true;
  return user.role === "institution" && user.orgRole === "registrar";
}

/**
 * Allow access only to org owners (or platform super admins). Used for
 * staff invite/remove and other write actions on team membership.
 */
export async function requireOrgOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, () => {
    if (!isOrgOwner(req.currentUser)) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    next();
  });
}

/**
 * Allow institution owners or registrars (and platform super admins).
 * Use for institution-wide writes that registrars must perform too.
 */
export async function requireOrgOwnerOrRegistrar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, () => {
    if (!isOrgOwnerOrRegistrar(req.currentUser)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    next();
  });
}

/**
 * Allow access to any user that is part of an organization (has an
 * orgRole). Candidates have no orgRole and are denied.
 */
export async function requireOrgMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, () => {
    const u = req.currentUser;
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Admins are always considered org members (super_admin by default).
    if (u.role === "admin") {
      next();
      return;
    }
    if (!u.orgRole) {
      res.status(403).json({ error: "Organization member access required" });
      return;
    }
    next();
  });
}
