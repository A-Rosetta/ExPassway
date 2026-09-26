import { handleAdminApiRequest } from "./admin-api.js";
import { handleAuthApiRequest } from "./auth-api.js";
import { handleCommunityApiRequest, handleCommunityImageRequest } from "./community-api.js";
import { handleContentRequest, handleQuestionHintRequest } from "./content-api.js";
import { cleanupChatData, handleChatApiRequest, handleChatWebSocketRequest } from "./chat-api.js";
import { ChatRoom } from "./chat-room.js";
import { handleLearningApiRequest } from "./learning-api.js";
import { handleReadApiRequest } from "./read-api.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-elem 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' wss:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

function defaultCacheControl(request, response) {
  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/api/community-images/")
    || url.pathname.startsWith("/api/content/")
    || /^\/api\/catalog\/papers\/[^/]+\/download\/[^/]+$/.test(url.pathname)
  ) {
    return response.headers.get("Cache-Control") || "public, max-age=86400";
  }
  if (
    url.pathname.startsWith("/api/")
    || response.headers.get("Content-Type")?.includes("text/html")
    || response.status >= 300 && response.status < 400
  ) {
    return "no-store";
  }
  if (url.searchParams.has("v") && /\.(?:css|js)$/i.test(url.pathname)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600, must-revalidate";
}

function addSecurityHeaders(request, response) {
  const secured = new Response(response.body, response);
  const cacheControl = defaultCacheControl(request, secured);
  if (cacheControl) secured.headers.set("Cache-Control", cacheControl);
  secured.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  secured.headers.set("Origin-Agent-Cluster", "?1");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  secured.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  return secured;
}

async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/alevel" || url.pathname.startsWith("/alevel/")) {
    url.pathname = url.pathname.slice("/alevel".length) || "/";
    return Response.redirect(url.toString(), 308);
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return handleAuthApiRequest(request, env);
  }

  if (url.pathname.startsWith("/api/chat/ws/")) {
    return handleChatWebSocketRequest(request, env);
  }

  if (url.pathname.startsWith("/api/chat/")) {
    return handleChatApiRequest(request, env);
  }

  if (url.pathname.startsWith("/api/admin/")) {
    return handleAdminApiRequest(request, env);
  }

  if (url.pathname.startsWith("/api/community-images/")) {
    return handleCommunityImageRequest(request, env);
  }

  if (
    url.pathname.startsWith("/api/content/")
    || /^\/api\/catalog\/papers\/[^/]+\/download\/[^/]+$/.test(url.pathname)
  ) {
    return handleContentRequest(request, env);
  }

  if (url.pathname.startsWith("/api/question-hints/")) {
    return handleQuestionHintRequest(request, env);
  }

  if (url.pathname.startsWith("/api/discussions")) {
    return handleCommunityApiRequest(request, env);
  }

  if (
    url.pathname.startsWith("/api/papers/")
    || url.pathname === "/api/analysis"
    || url.pathname.startsWith("/api/users/")
    || url.pathname.startsWith("/api/curriculum/")
    || url.pathname.startsWith("/api/chapter-practice/")
    || url.pathname === "/api/paper-builder/generate"
  ) {
    return handleLearningApiRequest(request, env);
  }

  if (url.pathname.startsWith("/api/")) {
    return handleReadApiRequest(request, env);
  }

  if (url.pathname === "/") {
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    return addSecurityHeaders(request, await routeRequest(request, env));
  },
  async scheduled(_controller, env, _ctx) {
    await cleanupChatData(env);
  },
};

export { ChatRoom };
