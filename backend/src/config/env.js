import "dotenv/config";

export const env = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  dbSsl: process.env.DB_SSL === "true",
  dbRequired: process.env.DB_REQUIRED === "true",
  authSecret: process.env.AUTH_SECRET || "change-me-in-production",
  supabaseUrl: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseAuthRedirectUrl: process.env.SUPABASE_AUTH_REDIRECT_URL || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiHintModel: process.env.OPENAI_HINT_MODEL || "",
  openaiBaseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  aiHintMode: ["disabled", "review", "live"].includes(process.env.AI_HINT_MODE)
    ? process.env.AI_HINT_MODE
    : "disabled",
};

env.dbEnabled = Boolean(env.databaseUrl);
