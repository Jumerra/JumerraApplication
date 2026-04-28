import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
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
} from "../lib/auth";
import { requireAuth } from "../middleware/require-auth";

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
      res.status(409).json({ error: "An account with that email already exists" });
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
      userId: user.id,
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
