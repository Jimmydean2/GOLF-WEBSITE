#!/usr/bin/env node
// Runs the test mail server by hand: every email the website sends to it is printed here
// and kept in memory, and nothing is delivered anywhere. Use it to look at the real emails
// (subject, text, link) during local QA or a rehearsal without sending any real mail.
//
//   node scripts/smtp-sink.mjs [--port 2525]
//
// then start the site with:
//   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_INSECURE=true EMAIL_FROM=camp@example.test npm run dev
import { startSmtpSink } from "./lib/smtpSink.mjs";

const portArg = process.argv.indexOf("--port");
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 2525;
const sink = await startSmtpSink({
  port,
  onMessage: (m) => {
    console.log(`\n--- ${m.at.toISOString()} ------------------------------------------------`);
    console.log(`To: ${m.to.join(", ")}\nSubject: ${m.subject}\n`);
    console.log(m.text.trim());
  },
});
console.log(`Test mail server listening on ${sink.host}:${sink.port}. Nothing sent to it is delivered.`);
console.log("Press Ctrl+C to stop.");
process.on("SIGINT", async () => { await sink.stop(); process.exit(0); });
