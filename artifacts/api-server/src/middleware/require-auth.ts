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
  const user = await findUserById(userId);
  if (!user || user.status !== "active") {
    req.session.userId = undefined;
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.currentUser = user;
  next();
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
