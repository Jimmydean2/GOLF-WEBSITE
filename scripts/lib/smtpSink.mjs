// A tiny SMTP server that RECORDS mail instead of delivering it, with switches to make it
// misbehave on purpose. It exists so the email code can be tested against a real SMTP
// conversation (real nodemailer, real timeouts, real error codes) without Gmail and without
// anyone's inbox. Nothing here ever relays a message anywhere.
//
// Use from a test:   const sink = await startSmtpSink();  ...  sink.messages  ...  await sink.stop();
// Point the app at it: SMTP_HOST=127.0.0.1 SMTP_PORT=<sink.port> SMTP_INSECURE=true EMAIL_FROM=camp@example.test

import net from "node:net";

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function decodeBody(body, encoding) {
  const enc = (encoding ?? "7bit").toLowerCase();
  if (enc === "quoted-printable") return Buffer.from(decodeQuotedPrintable(body), "latin1").toString("utf8");
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return body;
}
function decodeHeaderWords(value) {
  // Whitespace between two adjacent encoded words is not part of the text (RFC 2047).
  return value
    .replace(/(\?=)\s+(=\?UTF-8\?)/gi, "$1$2")
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, kind, data) =>
      kind.toUpperCase() === "B"
        ? Buffer.from(data, "base64").toString("utf8")
        : Buffer.from(decodeQuotedPrintable(data.replace(/_/g, " ")), "latin1").toString("utf8")
    );
}
function splitHeaders(raw) {
  const at = raw.search(/\r?\n\r?\n/);
  const head = at === -1 ? raw : raw.slice(0, at);
  const body = at === -1 ? "" : raw.slice(at).replace(/^\r?\n\r?\n/, "");
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}
export function parseMessage(raw) {
  const { headers, body } = splitHeaders(raw);
  const contentType = headers["content-type"] ?? "text/plain";
  const result = { subject: decodeHeaderWords(headers.subject ?? ""), from: headers.from ?? "", headers, text: "", html: "" };
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  const parts = boundary ? body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--")) : [raw];
  const walk = (partRaw) => {
    const { headers: ph, body: pb } = splitHeaders(partRaw.replace(/^\r?\n/, ""));
    const type = ph["content-type"] ?? "text/plain";
    const nested = /boundary="?([^";]+)"?/i.exec(type)?.[1];
    if (/multipart\//i.test(type) && nested) {
      for (const sub of pb.split(`--${nested}`).slice(1).filter((p) => !p.startsWith("--"))) walk(sub);
      return;
    }
    const decoded = decodeBody(pb.replace(/\r?\n$/, ""), ph["content-transfer-encoding"]);
    if (/text\/html/i.test(type)) result.html += decoded;
    else if (/text\/plain/i.test(type)) result.text += decoded;
  };
  if (boundary) parts.forEach(walk);
  else {
    const decoded = decodeBody(body, headers["content-transfer-encoding"]);
    if (/text\/html/i.test(contentType)) result.html = decoded;
    else result.text = decoded;
  }
  return result;
}

/**
 * @param {{ port?: number, host?: string, onMessage?: (message: object) => void }} [options]
 */
export async function startSmtpSink(options = {}) {
  const messages = [];
  const rejected = [];
  const sockets = new Set();
  const state = {
    // How the sink behaves right now. Change at any time: sink.set({ ... }).
    dataReply: null, // e.g. "451 4.7.1 Temporarily busy": answer every message this way
    failEvery: 0, // fail every Nth message with a 451 (1 = all, 3 = every third)
    rejectRecipients: new Set(), // lower-case addresses answered with 550 5.1.1 User unknown
    delayMs: 0, // wait this long before each reply (a slow server)
    dropOnData: false, // close the connection in the middle of DATA
    greeting: "220 sink ESMTP ready",
  };
  let count = 0;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const reply = async (line) => {
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };
    let from = "";
    let to = [];
    let inData = false;
    let buffer = "";
    let dataBuffer = "";
    reply(state.greeting);

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("latin1");
      while (true) {
        if (inData) {
          dataBuffer += buffer;
          buffer = "";
          const end = dataBuffer.indexOf("\r\n.\r\n");
          if (state.dropOnData && dataBuffer.length > 200) {
            socket.destroy();
            return;
          }
          if (end === -1) return;
          const raw = dataBuffer.slice(0, end).replace(/\r\n\.\./g, "\r\n.");
          dataBuffer = "";
          inData = false;
          count++;
          const failing = state.dataReply || (state.failEvery && count % state.failEvery === 0 ? "451 4.7.1 Temporarily busy, try again later" : null);
          if (failing) {
            rejected.push({ to, reply: failing });
            await reply(failing);
          } else {
            const parsed = parseMessage(raw);
            const message = { envelopeFrom: from, to, ...parsed, raw, at: new Date() };
            messages.push(message);
            options.onMessage?.(message);
            await reply("250 2.0.0 OK queued");
          }
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") await reply("250-sink\r\n250 8BITMIME");
        else if (verb === "MAIL") { from = /<([^>]*)>/.exec(line)?.[1] ?? ""; to = []; await reply("250 2.1.0 OK"); }
        else if (verb === "RCPT") {
          const address = (/<([^>]*)>/.exec(line)?.[1] ?? "").toLowerCase();
          if (state.rejectRecipients.has(address)) {
            rejected.push({ to: [address], reply: "550 5.1.1 User unknown" });
            await reply(`550 5.1.1 <${address}>: Recipient address rejected: User unknown`);
          } else { to.push(address); await reply("250 2.1.5 OK"); }
        }
        else if (verb === "DATA") { inData = true; dataBuffer = ""; await reply("354 End data with <CR><LF>.<CR><LF>"); }
        else if (verb === "RSET") { to = []; await reply("250 OK"); }
        else if (verb === "NOOP") await reply("250 OK");
        else if (verb === "QUIT") { await reply("221 Bye"); socket.end(); return; }
        else await reply("502 5.5.2 Command not recognized");
      }
    });
  });

  const listen = (port) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, options.host ?? "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  await listen(options.port ?? 0);
  const boundPort = server.address().port;
  return {
    host: options.host ?? "127.0.0.1",
    port: boundPort,
    messages,
    rejected,
    set(patch) { Object.assign(state, patch); },
    reset() { messages.length = 0; rejected.length = 0; count = 0; Object.assign(state, { dataReply: null, failEvery: 0, delayMs: 0, dropOnData: false, rejectRecipients: new Set() }); },
    to(address) { return messages.filter((m) => m.to.includes(address.toLowerCase())); },
    async stop() {
      for (const s of sockets) s.destroy();
      if (server.listening) await new Promise((r) => server.close(r));
    },
    // A server that is down: connections are refused until resume().
    async pause() {
      for (const s of sockets) s.destroy();
      if (server.listening) await new Promise((r) => server.close(r));
    },
    async resume() { if (!server.listening) await listen(boundPort); },
  };
}
