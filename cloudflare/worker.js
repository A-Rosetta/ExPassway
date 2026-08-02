import { handleAdminApiRequest } from "./admin-api.js";
import { handleAuthApiRequest } from "./auth-api.js";
import { handleCommunityApiRequest, handleCommunityImageRequest } from "./community-api.js";
import { handleContentRequest, handleQuestionHintRequest } from "./content-api.js";
import { handleLearningApiRequest } from "./learning-api.js";
import { handleReadApiRequest } from "./read-api.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/alevel" || url.pathname.startsWith("/alevel/")) {
      url.pathname = url.pathname.slice("/alevel".length) || "/";
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuthApiRequest(request, env);
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
  },
};
