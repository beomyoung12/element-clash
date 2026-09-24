import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "0.0.0.0";
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
};
const clients = new Set();
const rooms = new Map();
const randomQueue = [];

function wsFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}
function send(client, message) {
  if (!client?.socket?.writable) return;
  try { client.socket.write(wsFrame(JSON.stringify(message))); } catch { /* disconnected */ }
}
function onlinePlayerCount() {
  return new Set([...clients].map((client) => client.clientId).filter(Boolean)).size;
}
function broadcastPresence() {
  const message = { type: "presence", playersOnline: onlinePlayerCount() };
  for (const client of clients) send(client, message);
}
function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const opcode = client.buffer[0] & 0x0f; const masked = Boolean(client.buffer[1] & 0x80);
    let length = client.buffer[1] & 0x7f; let offset = 2;
    if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (client.buffer.length < 10) return; length = Number(client.buffer.readBigUInt64BE(2)); offset = 10; }
    if (!Number.isSafeInteger(length) || length > 1_000_000) { client.socket.destroy(); return; }
    const maskBytes = masked ? 4 : 0;
    if (client.buffer.length < offset + maskBytes + length) return;
    const mask = masked ? client.buffer.subarray(offset, offset + 4) : null; offset += maskBytes;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    client.buffer = client.buffer.subarray(offset + length);
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 0x8) { client.socket.end(); return; }
    if (opcode === 0x9) { client.socket.write(Buffer.from([0x8a, 0x00])); continue; }
    if (opcode !== 0x1) continue;
    client.lastSeen = Date.now();
    try { handleMessage(client, JSON.parse(payload.toString("utf8"))); } catch { send(client, { type: "error", message: "잘못된 요청입니다." }); }
  }
}
function removeFromQueue(client) { const index = randomQueue.indexOf(client); if (index >= 0) randomQueue.splice(index, 1); }
function sendInviteRoomState(room, promoted = false) {
  const common = {
    type: "room_state", roomCode: room.code, kind: "invite",
    peerConnected: Boolean(room.host && room.guest), hostName: room.host?.nickname ?? "",
    guestName: room.guest?.nickname ?? "",
  };
  if (room.host) send(room.host, { ...common, lobbyRole: "host", promoted });
  if (room.guest) send(room.guest, { ...common, lobbyRole: "guest", promoted: false });
}
function leaveRoom(client, notify = true) {
  removeFromQueue(client);
  if (!client.room) return;
  const code = client.room;
  const room = rooms.get(code);
  client.room = null;
  if (room) {
    const wasHost = room.host === client;
    const peer = room.host === client ? room.guest : room.host;
    if (room.host === client) room.host = null;
    if (room.guest === client) room.guest = null;
    if (room.kind === "invite" && peer) {
      // 방장이 나가면 남은 참가자를 새 방장으로 승격한다. 초대방은 한 명이라도
      // 남아 있는 동안 같은 코드로 유지된다.
      if (wasHost) { room.host = peer; room.guest = null; }
      room.rematchReady = undefined;
      if (notify) sendInviteRoomState(room, wasHost);
      return;
    }
    if (notify && peer) { peer.room = null; send(peer, { type: "peer_left", roomCode: code, roomPreserved: false }); }
    rooms.delete(code);
  }
}
function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = "";
  do { code = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join(""); } while (rooms.has(code));
  return code;
}
function match(hostClient, guestClient, code, kind) {
  removeFromQueue(hostClient); removeFromQueue(guestClient);
  rooms.set(code, { code, kind, host: hostClient, guest: guestClient }); hostClient.room = code; guestClient.room = code;
  const common = {
    type: "matched", roomCode: code, kind,
    hostClass: hostClient.classId, guestClass: guestClient.classId,
    hostName: hostClient.nickname, guestName: guestClient.nickname,
  };
  send(hostClient, { ...common, role: "host" }); send(guestClient, { ...common, role: "guest" });
}
function validClass(classId) { return ["blade", "ranger", "mage"].includes(classId) ? classId : "blade"; }
function validNickname(value) {
  const nickname = String(value || "전사").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
  return nickname || "전사";
}
function handleMessage(client, message) {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "hello") {
    client.clientId = String(message.clientId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || `guest-${randomBytes(8).toString("hex")}`;
    send(client, { type: "connected", playersOnline: onlinePlayerCount() }); broadcastPresence(); return;
  }
  if (message.type === "ping") { send(client, { type: "pong", sentAt: message.sentAt }); return; }
  if (message.type === "update_profile") {
    client.classId = validClass(message.classId); client.nickname = validNickname(message.nickname);
    const room = client.room && rooms.get(client.room);
    if (room?.kind === "invite") sendInviteRoomState(room);
    return;
  }
  if (message.type === "cancel") { leaveRoom(client); send(client, { type: "cancelled" }); return; }
  if (message.type === "queue_random") {
    leaveRoom(client); client.classId = validClass(message.classId); client.nickname = validNickname(message.nickname);
    const peer = randomQueue.find((candidate) => candidate !== client && candidate.socket.writable);
    if (peer) match(peer, client, makeRoomCode(), "random");
    else { randomQueue.push(client); send(client, { type: "waiting", kind: "random" }); }
    return;
  }
  if (message.type === "create_invite") {
    leaveRoom(client); client.classId = validClass(message.classId); client.nickname = validNickname(message.nickname);
    const code = makeRoomCode(); rooms.set(code, { code, kind: "invite", host: client, guest: null }); client.room = code;
    sendInviteRoomState(rooms.get(code)); return;
  }
  if (message.type === "join_invite") {
    const code = String(message.roomCode || "").trim().toUpperCase(); const room = rooms.get(code);
    if (!room || room.kind !== "invite" || (room.host && room.guest) || room.host === client || room.guest === client) {
      send(client, { type: "error", message: "참가할 수 없는 초대 코드입니다." }); return;
    }
    leaveRoom(client); client.classId = validClass(message.classId); client.nickname = validNickname(message.nickname);
    if (!room.host) room.host = client; else room.guest = client;
    client.room = code;
    sendInviteRoomState(room);
    return;
  }
  if (message.type === "start_invite" && client.room) {
    const room = rooms.get(client.room);
    if (!room || room.kind !== "invite" || room.host !== client) { send(client, { type: "error", message: "방장만 전투를 시작할 수 있습니다." }); return; }
    if (!room.guest) { send(client, { type: "error", message: "상대가 들어온 뒤 시작할 수 있습니다." }); return; }
    match(room.host, room.guest, room.code, "invite");
    return;
  }
  if (message.type === "rematch" && client.room) {
    const room = rooms.get(client.room);
    if (!room?.host || !room?.guest) { send(client, { type: "error", message: "상대가 아직 방에 없습니다." }); return; }
    room.rematchReady ??= new Set(); room.rematchReady.add(client);
    send(client, { type: "rematch_waiting" });
    if (room.rematchReady.size === 2) match(room.host, room.guest, room.code, room.kind);
    return;
  }
  if (["input", "action", "snapshot", "match_end"].includes(message.type) && client.room) {
    const room = rooms.get(client.room); const peer = room && (room.host === client ? room.guest : room.host);
    if (peer) send(peer, message);
  }
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: true, connected: clients.size, playersOnline: onlinePlayerCount(), rooms: rooms.size, waiting: randomQueue.length })); return;
    }
    const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
    if (relative.startsWith("..")) throw new Error("invalid path");
    const body = await readFile(join(root, relative));
    response.writeHead(200, { "Content-Type": mime[extname(relative)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found");
  }
});
server.on("upgrade", (request, socket) => {
  if (new URL(request.url, "http://127.0.0.1").pathname !== "/ws" || !request.headers["sec-websocket-key"]) { socket.destroy(); return; }
  if (request.headers.origin) {
    try { if (new URL(request.headers.origin).host !== request.headers.host) { socket.destroy(); return; } } catch { socket.destroy(); return; }
  }
  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setKeepAlive(true, 30_000);
  const client = { socket, buffer: Buffer.alloc(0), room: null, classId: "blade", nickname: "전사", clientId: null, lastSeen: Date.now(), closed: false };
  clients.add(client);
  socket.on("data", (chunk) => parseFrames(client, chunk));
  const disconnect = () => {
    if (client.closed) return;
    client.closed = true; leaveRoom(client); clients.delete(client); broadcastPresence();
  };
  socket.on("close", disconnect);
  socket.on("error", disconnect);
});
setInterval(() => {
  const staleBefore = Date.now() - 180_000;
  for (const client of clients) if (client.lastSeen < staleBefore) client.socket.destroy();
}, 30_000).unref();
server.listen(port, host, () => console.log(`Element Clash: http://127.0.0.1:${port} · 온라인 매칭 서버 준비`));
