import { handleAuthApiRequest } from "./auth-api.js";
import { handleLearningApiRequest } from "./learning-api.js";
import { handleReadApiRequest } from "./read-api.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuthApiRequest(request, env);
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
