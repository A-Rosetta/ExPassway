function jsonHeaders() {
  return { "Content-Type": "application/json; charset=utf-8" };
}

export class ChatRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const payload = await request.json();
      this.broadcast(JSON.stringify(payload));
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const userId = request.headers.get("X-Chat-User");
    const deviceId = request.headers.get("X-Chat-Device");
    const conversationId = request.headers.get("X-Chat-Conversation");
    const protocol = request.headers.get("X-Chat-Protocol") || "expassway-chat-v1";
    if (!userId || !conversationId || !["expassway-chat-v1", "expassway-chat-v2"].includes(protocol) || (protocol === "expassway-chat-v1" && !deviceId)) {
      return new Response("Missing chat connection context", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server, [protocol]);
    server.serializeAttachment({ userId, deviceId, conversationId, protocol });
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": protocol },
    });
  }

  broadcast(message) {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch (_error) {
        // Closed sockets are removed by the Durable Object runtime.
      }
    }
  }

  webSocketMessage(socket, message) {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose() {}

  webSocketError() {}
}
