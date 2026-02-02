import debug from "./utils/debug.js";
import { ImapFlow } from "imapflow";
import "dotenv/config";

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,       // your Gmail address
    pass: process.env.GMAIL_APP_PASS,   // your App Password
  },
});

async function test() {
  await client.connect();
  debug.log("✅ Connected to Gmail IMAP");

  // Open inbox
  await client.mailboxOpen("INBOX");

  // Get last 10 emails
  const messages = await client.fetch(
    { seq: `${Math.max(1, client.mailbox.exists - 10)}:*` },
    { envelope: true }
  );

  for await (const msg of messages) {
    const from = msg.envelope.from?.[0]?.address || "";
    const subject = msg.envelope.subject || "";

    if (from.includes("golomtbank.com")) {
      debug.log("🏦 Golomt email found:");
      debug.log("From:", from);
      debug.log("Subject:", subject);
      break;
    }
  }

  await client.logout();
  debug.log("✅ IMAP test finished");
}

test().catch(err => {
  console.error("❌ IMAP error:", err);
});
