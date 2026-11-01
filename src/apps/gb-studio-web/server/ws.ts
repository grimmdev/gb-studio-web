import { WebSocket, WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "http";
import { getSessionWithUser } from "./db";

export interface WsMessage {
  channel: string;
  args: unknown[];
}

let wss: WebSocketServer | null = null;
const allClients = new Set<WebSocket>();
const userSockets = new Map<string, Set<WebSocket>>();
const socketToUser = new Map<WebSocket, string>();

// Resolve authenticated user ID from handshake cookies or query parameters.
const resolveUserIdFromUpgrade = (req: IncomingMessage): string => {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const queryToken = url.searchParams.get("token");
    if (queryToken) {
      const data = getSessionWithUser(queryToken);
      if (data) return data.user.id;
    }

    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(";").map((c) => c.trim());
      for (const cookie of cookies) {
        if (cookie.startsWith("gbs_session=")) {
          const token = decodeURIComponent(cookie.slice("gbs_session=".length));
          const data = getSessionWithUser(token);
          if (data) return data.user.id;
        }
      }
    }
  } catch (err) {
    console.error("Error authenticating WebSocket upgrade:", err);
  }

  return "anonymous";
};

export const initWebSocketServer = (server: Server) => {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const userId = resolveUserIdFromUpgrade(req);
    allClients.add(ws);
    socketToUser.set(ws, userId);

    let userSet = userSockets.get(userId);
    if (!userSet) {
      userSet = new Set();
      userSockets.set(userId, userSet);
    }
    userSet.add(ws);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage;
        handleClientMessage(ws, userId, msg);
      } catch (e) {
        console.error("Invalid WebSocket message from client:", e);
      }
    });

    const cleanup = () => {
      allClients.delete(ws);
      socketToUser.delete(ws);
      const set = userSockets.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          userSockets.delete(userId);
        }
      }
    };

    ws.on("close", cleanup);
    ws.on("error", (err) => {
      console.error("WebSocket client error:", err);
      cleanup();
    });
  });

  return wss;
};

// Deliver scoped events to all active sockets belonging to a specific user.
export const emitToUser = (
  userId: string,
  channel: string,
  ...args: unknown[]
): void => {
  const sockets = userSockets.get(userId);
  if (!sockets) return;

  const payload = JSON.stringify({ channel, args });
  for (const client of sockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
};

// Broadcast system-wide messages across all connected clients.
export const broadcast = (channel: string, ...args: unknown[]) => {
  const payload = JSON.stringify({ channel, args });
  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
};

const handleClientMessage = (ws: WebSocket, userId: string, msg: WsMessage) => {
  // Route bidirectional debug and MIDI events strictly within the same user session.
  if (msg.channel.startsWith("debugger:") || msg.channel.startsWith("music:")) {
    const sockets = userSockets.get(userId);
    if (!sockets) return;

    for (const client of sockets) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(msg));
      }
    }
  }
};
