import { Router } from "express";
import { ApiError } from "../utils/http.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { toClampedInteger } from "../utils/validate.js";
import { isDbEnabled } from "../db/client.js";
import { listUsers } from "../db/repositories/users.repository.js";
import { getPracticeSummaryCounts, listRecentPracticeSessions } from "../db/repositories/practice.repository.js";
import { readAuthToken, verifyToken } from "../services/auth.service.js";

const router = Router();

function assertAdminApiEnabled() {
  if (!isDbEnabled()) {
    throw new ApiError(
      503,
      "Admin records API requires PostgreSQL. Set DATABASE_URL and run DB schema first.",
      "DB_DISABLED"
    );
  }
}

function assertAdminRole(req) {
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  if (payload?.role !== "admin") {
    throw new ApiError(403, "Admin access required.", "FORBIDDEN");
  }
}

router.get("/records", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  assertAdminRole(req);

  const usersLimit = toClampedInteger(req.query.usersLimit, 20, 1, 100);
  const practicesLimit = toClampedInteger(req.query.practicesLimit, 20, 1, 100);
  const summary = await getPracticeSummaryCounts();
  const latestUsers = await listUsers(usersLimit);
  const latestPractices = await listRecentPracticeSessions(practicesLimit);

  res.json({
    ok: true,
    data: {
      summary,
      latestUsers,
      latestPractices,
    },
  });
}));

export default router;
