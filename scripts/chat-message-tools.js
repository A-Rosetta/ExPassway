(function () {
  function content(plaintext) {
    let parsed;
    try { parsed = JSON.parse(plaintext); } catch (_error) { }
    if (parsed && ["text", "image"].includes(parsed.kind)) return {
      ...parsed,
      text: parsed.kind === "image" ? String(parsed.name || "") : String(parsed.text || ""),
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions.filter((entry) => entry && typeof entry.userId === "string" && typeof entry.alias === "string") : [],
      reply: parsed.reply && typeof parsed.reply.clientMessageId === "string" ? parsed.reply : null,
    };
    return { kind: "text", text: String(plaintext || ""), mentions: [], reply: null };
  }
  function preview(plaintext, imageLabel = "Image") {
    const value = content(plaintext);
    return (value.kind === "image" ? `${imageLabel}${value.name ? ` · ${value.name}` : ""}` : value.text).slice(0, 180);
  }
  function search(messages, { query = "", type = "all", from = "", to = "" } = {}) {
    const needle = query.trim().toLocaleLowerCase();
    return messages.filter((message) => {
      if (message.deleted || message.plaintext == null || message.localOnly) return false;
      const value = content(message.plaintext);
      const date = new Date(message.createdAt);
      if (!Number.isFinite(date.getTime())) return false;
      const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (type !== "all" && value.kind !== type) return false;
      if ((from && localDate < from) || (to && localDate > to)) return false;
      return !needle || `${value.text} ${value.mime || ""} ${message.senderAlias || ""}`.toLocaleLowerCase().includes(needle);
    }).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }
  window.ExpChatMessageTools = { content, preview, search };
})();
