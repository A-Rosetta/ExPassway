import metaRoutes from "./meta.routes.js";
import papersRoutes from "./papers.routes.js";
import analysisRoutes from "./analysis.routes.js";
import usersRoutes from "./users.routes.js";
import adminRoutes from "./admin.routes.js";
import authRoutes from "./auth.routes.js";
import discussionsRoutes from "./discussions.routes.js";
import questionsRoutes from "./questions.routes.js";
import catalogRoutes from "./catalog.routes.js";

export function registerRoutes(app) {
  app.use("/api/meta", metaRoutes);
  app.use("/api/papers", papersRoutes);
  app.use("/api/analysis", analysisRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/discussions", discussionsRoutes);
  app.use("/api/questions", questionsRoutes);
  app.use("/api/catalog", catalogRoutes);
}
