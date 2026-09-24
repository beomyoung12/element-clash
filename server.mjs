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
    try { handleMessage(client, JSON.parse(payload.toString("utf8"))); } catch { send(client, { type: "error", message: "잘못된 요청입니다." }); }
  }
}
function removeFromQueue(client) { const index = randomQueue.indexOf(client); if (index >= 0) randomQueue.splice(index, 1); }
function leaveRoom(client, notify = true) {
  removeFromQueue(client);
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (room) {
    const peer = room.host === client ? room.guest : room.host;
    if (notify && peer) { peer.room = null; send(peer, { type: "peer_left" }); }
    rooms.delete(client.room);
  }
  client.room = null;
}
function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = "";
  do { code = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join(""); } while (rooms.has(code));
  return code;
}
function match(hostClient, guestClient, code, kind) {
  removeFromQueue(hostClient); removeFromQueue(guestClient);
  rooms.set(code, { code, kind, host: hostClient, guest: guestClient }); hostClient.room = code; guestClient.room = code;
  const common = { type: "matched", roomCode: code, kind, hostClass: hostClient.classId, guestClass: guestClient.classId };
  send(hostClient, { ...common, role: "host" }); send(guestClient, { ...common, role: "guest" });
}
function validClass(classId) { return ["blade", "ranger", "mage"].includes(classId) ? classId : "blade"; }
function handleMessage(client, message) {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "cancel") { leaveRoom(client); send(client, { type: "cancelled" }); return; }
  if (message.type === "queue_random") {
    leaveRoom(client); client.classId = validClass(message.classId);
    const peer = randomQueue.find((candidate) => candidate !== client && candidate.socket.writable);
    if (peer) match(peer, client, makeRoomCode(), "random");
    else { randomQueue.push(client); send(client, { type: "waiting", kind: "random" }); }
    return;
  }
  if (message.type === "create_invite") {
    leaveRoom(client); client.classId = validClass(message.classId);
    const code = makeRoomCode(); rooms.set(code, { code, kind: "invite", host: client, guest: null }); client.room = code;
    send(client, { type: "invite_created", roomCode: code }); return;
  }
  if (message.type === "join_invite") {
    const code = String(message.roomCode || "").trim().toUpperCase(); const room = rooms.get(code);
    if (!room || room.guest || room.host === client) { send(client, { type: "error", message: "참가할 수 없는 초대 코드입니다." }); return; }
    client.classId = validClass(message.classId); match(room.host, client, code, "invite"); return;
  }
  if (["input", "action", "snapshot", "match_end", "rematch"].includes(message.type) && client.room) {
    const room = rooms.get(client.room); const peer = room && (room.host === client ? room.guest : room.host);
    if (peer) send(peer, message);
  }
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: true, connected: clients.size, rooms: rooms.size, waiting: randomQueue.length })); return;
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
  const client = { socket, buffer: Buffer.alloc(0), room: null, classId: "blade" };
  clients.add(client); send(client, { type: "connected", playersOnline: clients.size });
  socket.on("data", (chunk) => parseFrames(client, chunk));
  socket.on("close", () => { leaveRoom(client); clients.delete(client); });
  socket.on("error", () => { leaveRoom(client); clients.delete(client); });
});
server.listen(port, host, () => console.log(`Element Clash: http://127.0.0.1:${port} · 온라인 매칭 서버 준비`));
