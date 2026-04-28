import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import {
  usersTable,
  pendingRegistrationsTable,
  passwordSetupTokensTable,
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
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      // Return the same response as a successful registration to avoid
      // leaking whether this email address is already in the system.
      req.log.info({ email: normalizedEmail }, "register: duplicate email silenced");
      res.status(201).json({
        message:
          "Registration received. An administrator will review your application shortly.",
      });
      return;
    }
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: normalizedEmail,
        passwordHash,
        role: normalizedRole,
        status: "pending",
        fullName,
      })
      .returning();
    await db.insert(pendingRegistrationsTable).values({
      userId: user.id,
      submittedData: submittedData ?? {},
    });
    res.status(201).json({
      message:
        "Registration received. An administrator will review your application shortly.",
    });
  } catch (err) {
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
    res.json({ user: toPublicUser(user) });
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
  res.json({ user: toPublicUser(user) });
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
    res.json({ user: toPublicUser(refreshed) });
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
