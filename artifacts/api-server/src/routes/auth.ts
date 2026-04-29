import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import {
  usersTable,
  pendingRegistrationsTable,
  passwordSetupTokensTable,
  candidatesTable,
} from "@workspace/db";
import {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  findUserById,
  toPublicUser,
  createSetupToken,
} from "../lib/auth";
import { requireAuth } from "../middleware/require-auth";
import { sendAuthLinkEmail, originFromReq } from "../lib/email";

const router: Router = Router();

// Auth endpoints must never be HTTP-cached.  iOS NSURLSession (which
// React Native fetch uses inside Expo Go on iPhone) and browser HTTP
// caches both store GET responses by URL together with their ETag and
// will then add `If-None-Match` to subsequent requests.  In practice
// this means the first `/auth/me` after app launch (when there is no
// session yet) gets cached as `{user: null}` with ETag-A, and the very
// next `/auth/me` after sign-in re-uses the same `If-None-Match: ETag-A`.
// If for any reason the server still computes `{user: null}` for that
// follow-up request (cookie not attached, cross-site SameSite block,
// etc.), Express's freshness check matches the new ETag against
// ETag-A and replies `304 Not Modified` with no body.  Our shared
// `customFetch` returns `null` for any 304, so `useAuth` then sees no
// user and `AuthGate` bounces the candidate straight back to sign-in
// — they perceive this as "wrong credentials" even though their login
// actually succeeded.
//
// We defend in two layers:
//   1. Strip `If-None-Match`/`If-Modified-Since` from incoming auth
//      requests so Express's freshness check can never short-circuit
//      to 304, even when a stale client cache (from before this fix
//      was deployed) keeps echoing an old validator.
//   2. Tell every well-behaved future client not to cache at all via
//      `Cache-Control: no-store` (+ legacy `Pragma`/`Expires` for
//      ancient HTTP/1.0 intermediaries).
router.use((req, res, next) => {
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

/**
 * POST /api/auth/register
 * Public sign-up. Creates a pending user + a registration record
 * holding the data the applicant submitted. Admin must approve.
 */
router.post("/auth/register", async (req, res) => {
  try {
    const { email, password, role, fullName, submittedData } = req.body ?? {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof role !== "string" ||
      typeof fullName !== "string"
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const normalizedRole = role.toLowerCase();
    if (!["candidate", "employer", "institution"].includes(normalizedRole)) {
      res.status(400).json({ error: "Invalid role for self sign-up" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const isCandidate = normalizedRole === "candidate";
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      // Candidate sign-up auto-logs the new user in, which means a duplicate
      // address is already observable to the caller via the failed
      // post-signup login.  Returning a clear 409 here avoids the broken UX
      // where the app pretends signup succeeded and then bounces the user
      // back to sign-in with no explanation.  Employer/institution sign-up
      // does not auto-login (admin approval is required) so we keep the
      // silenced anti-enumeration response for those roles.
      if (isCandidate) {
        req.log.info(
          { email: normalizedEmail },
          "register: duplicate candidate email",
        );
        res.status(409).json({
          error:
            "An account with this email already exists. Please sign in instead.",
        });
        return;
      }
      req.log.info({ email: normalizedEmail }, "register: duplicate email silenced");
      res.status(201).json({
        message:
          "Registration received. An administrator will review your application shortly.",
      });
      return;
    }
    const passwordHash = await hashPassword(password);
    // Candidates self-onboard: account is active immediately and no
    // pending_registrations row is created. Their attendance claims
    // are validated later by the institution(s) they listed. Employers
    // and institutions still go through admin review.
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(usersTable)
        .values({
          email: normalizedEmail,
          passwordHash,
          role: normalizedRole,
          status: isCandidate ? "active" : "pending",
          approvedAt: isCandidate ? new Date() : null,
          fullName,
        })
        .returning();

      if (isCandidate) {
        // Create the linked candidate row so the new user can immediately
        // see their profile in the mobile app and apply to jobs. Defaults
        // mirror the admin onboarding flow.
        const [candidate] = await tx
          .insert(candidatesTable)
          .values({
            fullName: user.fullName,
            headline: "New candidate",
            bio: "",
            location: "",
            email: user.email,
            phone: "",
            avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
              user.fullName,
            )}`,
          })
          .returning();
        await tx
          .update(usersTable)
          .set({ candidateId: candidate.id })
          .where(eq(usersTable.id, user.id));
      } else {
        await tx.insert(pendingRegistrationsTable).values({
          userId: user.id,
          submittedData: submittedData ?? {},
        });
      }
    });
    res.status(201).json({
      message: isCandidate
        ? "Welcome! You can sign in now. Your institution will verify your attendance separately."
        : "Registration received. An administrator will review your application shortly.",
    });
  } catch (err) {
    // Postgres unique_violation (23505) from a race past the pre-check.
    // Map it back to the same role-aware response as the explicit duplicate
    // path so concurrent registrations don't surface as a generic 500.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      const role =
        typeof req.body?.role === "string"
          ? req.body.role.toLowerCase()
          : null;
      if (role === "candidate") {
        req.log.info({ err }, "register: duplicate candidate email (race)");
        res.status(409).json({
          error:
            "An account with this email already exists. Please sign in instead.",
        });
        return;
      }
      req.log.info({ err }, "register: duplicate email silenced (race)");
      res.status(201).json({
        message:
          "Registration received. An administrator will review your application shortly.",
      });
      return;
    }
    req.log.error({ err }, "register failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * POST /api/auth/login
 */
router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (user.status === "pending") {
      res.status(403).json({ error: "Your account is pending admin approval" });
      return;
    }
    if (user.status === "rejected") {
      res.status(403).json({ error: "Your registration was not approved" });
      return;
    }
    if (user.status === "invited") {
      res.status(403).json({ error: "Please complete your password setup first" });
      return;
    }
    if (user.status === "disabled") {
      res
        .status(403)
        .json({ error: "Your account has been deactivated. Please contact an administrator." });
      return;
    }
    req.session.userId = user.id;
    res.json({ user: await toPublicUser(user) });
  } catch (err) {
    req.log.error({ err }, "login failed");
    res.status(500).json({ error: "Login failed" });
  }
});

/** POST /api/auth/logout */
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("talentlink.sid");
    res.json({ ok: true });
  });
});

/**
 * PATCH /api/auth/me/profile
 * Update the current user's universal profile fields.
 * Optional fields: only fields supplied are written. Pass null on
 * nullable fields (phone, title, bio, avatarUrl) to clear them.
 */
router.patch("/auth/me/profile", requireAuth, async (req, res) => {
  try {
    const user = req.currentUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const updates: Record<string, string | null> = {};

    if ("fullName" in body) {
      const v = body.fullName;
      if (typeof v !== "string" || v.trim().length === 0 || v.length > 200) {
        res.status(400).json({ error: "fullName must be 1–200 characters" });
        return;
      }
      updates.fullName = v.trim();
    }
    const nullableStringFields: Array<{ key: "phone" | "title" | "bio"; max: number }> = [
      { key: "phone", max: 50 },
      { key: "title", max: 200 },
      { key: "bio", max: 2000 },
    ];
    for (const { key, max } of nullableStringFields) {
      if (!(key in body)) continue;
      const v = body[key];
      if (v === null) {
        updates[key] = null;
        continue;
      }
      if (typeof v !== "string" || v.length > max) {
        res.status(400).json({ error: `${key} must be a string up to ${max} characters or null` });
        return;
      }
      // Trim phone/title; preserve bio whitespace; collapse empty to null.
      const cleaned = key === "bio" ? v : v.trim();
      updates[key] = cleaned.length === 0 ? null : cleaned;
    }

    // avatarUrl must be either null (clear) or a normalized object path
    // produced by our own upload flow ("/objects/uploads/<id>"). This
    // refuses arbitrary external URLs which would weaken storage
    // ownership guarantees and could be used as tracking pixels.
    if ("avatarUrl" in body) {
      const v = body.avatarUrl;
      if (v === null) {
        updates.avatarUrl = null;
      } else if (
        typeof v === "string" &&
        v.length <= 1000 &&
        /^\/objects\/[A-Za-z0-9._/-]+$/.test(v)
      ) {
        updates.avatarUrl = v;
      } else {
        res.status(400).json({
          error: "avatarUrl must be a normalized object path (e.g. /objects/uploads/<id>) or null",
        });
        return;
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
    const refreshed = await findUserById(user.id);
    if (!refreshed) {
      res.status(500).json({ error: "Profile reload failed" });
      return;
    }
    res.json({ user: await toPublicUser(refreshed) });
  } catch (err) {
    req.log.error({ err }, "update-profile failed");
    res.status(500).json({ error: "Could not update profile" });
  }
});

/** GET /api/auth/me */
router.get("/auth/me", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(200).json({ user: null });
    return;
  }
  const user = await findUserById(userId);
  if (!user || user.status !== "active") {
    req.session.userId = undefined;
    res.status(200).json({ user: null });
    return;
  }
  res.json({ user: await toPublicUser(user) });
});

/**
 * POST /api/auth/setup-password
 * Used by admin-onboarded users to set their first password using
 * a one-time token. On success the user is activated and logged in.
 */
router.post("/auth/setup-password", async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Token and password required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    const now = new Date();
    // Hash before opening the transaction (CPU-bound, doesn't need a tx).
    const passwordHash = await hashPassword(password);

    const refreshed = await db.transaction(async (tx) => {
      // Atomically consume the token: mark usedAt only if it is currently
      // unused and not expired. RETURNING tells us whether we won the race.
      const consumed = await tx
        .update(passwordSetupTokensTable)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordSetupTokensTable.token, token),
            isNull(passwordSetupTokensTable.usedAt),
            gt(passwordSetupTokensTable.expiresAt, now),
          ),
        )
        .returning({
          id: passwordSetupTokensTable.id,
          userId: passwordSetupTokensTable.userId,
        });
      const tokenRow = consumed[0];
      if (!tokenRow) return null;

      // Invalidate any other still-active tokens for this user so a
      // single password setup/reset always retires every outstanding link.
      await tx
        .update(passwordSetupTokensTable)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordSetupTokensTable.userId, tokenRow.userId),
            isNull(passwordSetupTokensTable.usedAt),
          ),
        );

      const userRows = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, tokenRow.userId))
        .limit(1);
      const user = userRows[0];
      if (!user) {
        // Roll back token consumption — token references a missing user.
        throw new Error("ROLLBACK_USER_MISSING");
      }

      await tx
        .update(usersTable)
        .set({
          passwordHash,
          status: "active",
          approvedAt: user.approvedAt ?? now,
        })
        .where(eq(usersTable.id, user.id));

      const updated = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .limit(1);
      return updated[0] ?? null;
    });

    if (!refreshed) {
      res.status(400).json({ error: "Invalid or expired token" });
      return;
    }
    req.session.userId = refreshed.id;
    res.json({ user: await toPublicUser(refreshed) });
  } catch (err) {
    if (err instanceof Error && err.message === "ROLLBACK_USER_MISSING") {
      res.status(400).json({ error: "Invalid token" });
      return;
    }
    req.log.error({ err }, "setup-password failed");
    res.status(500).json({ error: "Password setup failed" });
  }
});

/**
 * POST /api/auth/forgot-password
 * Always returns 200 with the same body to avoid leaking whether an email
 * is registered. If the email matches an active or invited user, a fresh
 * setup token is issued and an email send is attempted (today the link is
 * also logged for admin recovery while email is not configured).
 */
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || email.trim().length === 0) {
      res.status(400).json({ error: "Email required" });
      return;
    }
    const user = await findUserByEmail(email);
    // We only issue tokens for users who can actually sign in. "rejected"
    // and "pending" sign-ups deliberately do not get a reset link.
    if (user && (user.status === "active" || user.status === "invited")) {
      const { setupUrl } = await createSetupToken(user.id);
      await sendAuthLinkEmail({
        to: user.email,
        fullName: user.fullName,
        linkPath: setupUrl,
        kind: "reset",
        origin: originFromReq(req),
        logger: req.log,
      });
    } else {
      // Log a benign trace so support can confirm the request was received.
      req.log.info({ email: email.toLowerCase().trim() }, "forgot-password: no match");
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "forgot-password failed");
    // Still return ok=true so callers cannot use errors to enumerate emails.
    res.json({ ok: true });
  }
});

/**
 * POST /api/auth/change-password
 * Authenticated user changes their own password by re-supplying the current one.
 */
router.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string"
    ) {
      res.status(400).json({ error: "Current and new password required" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }
    if (newPassword === currentPassword) {
      res.status(400).json({ error: "New password must differ from current" });
      return;
    }
    const user = req.currentUser!;
    if (!user.passwordHash) {
      res.status(400).json({ error: "Account has no password set yet" });
      return;
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, user.id));

    // Rotate the session id to prevent fixation, and revoke any other
    // active sessions for this user by removing their rows from the
    // session store. The current session is regenerated *after* the
    // delete so the user stays signed in here but is logged out
    // everywhere else.
    const currentSid = req.sessionID;
    try {
      await db.execute(sql`
        delete from "session"
        where sid <> ${currentSid}
        and (sess->>'userId')::int = ${user.id}
      `);
    } catch (cleanupErr) {
      req.log.warn(
        { err: cleanupErr, userId: user.id },
        "could not revoke other sessions after password change",
      );
    }
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "change-password failed");
    res.status(500).json({ error: "Could not update password" });
  }
});

/**
 * GET /api/auth/setup-token/:token
 * Lightweight info endpoint used by the setup page to display whom
 * the invitation belongs to before a password is entered.
 */
router.get("/auth/setup-token/:token", async (req, res) => {
  const now = new Date();
  const rows = await db
    .select({
      tokenId: passwordSetupTokensTable.id,
      expiresAt: passwordSetupTokensTable.expiresAt,
      usedAt: passwordSetupTokensTable.usedAt,
      userId: passwordSetupTokensTable.userId,
    })
    .from(passwordSetupTokensTable)
    .where(eq(passwordSetupTokensTable.token, req.params.token))
    .limit(1);
  const row = rows[0];
  if (!row || row.usedAt || row.expiresAt < now) {
    res.status(404).json({ error: "Invalid or expired token" });
    return;
  }
  const user = await findUserById(row.userId);
  if (!user) {
    res.status(404).json({ error: "Invalid token" });
    return;
  }
  res.json({
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  });
});

export default router;
export { requireAuth };
