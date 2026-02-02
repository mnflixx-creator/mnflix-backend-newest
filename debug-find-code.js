import debug from "./utils/debug.js";
import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";

const USER = process.env.GMAIL_IMAP_USER;
const PASS = process.env.GMAIL_IMAP_PASS;
const FROM = process.env.GOLOMT_ALERT_FROM || "alert@golomtbank.com";

const CODE = process.argv[2]; // run: node debug-find-code.js 1C469843

if (!USER || !PASS) throw new Error("Missing GMAIL_IMAP_USER or GMAIL_IMAP_PASS");
if (!CODE) throw new Error("Usage: node debug-find-code.js YOURCODE");

function normalize(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

async function main() {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASS },
    logger: false,
  });

  await client.connect();
  debug.log("✅ Connected");

  const lock = await client.getMailboxLock("INBOX");
  try {
    // Get last 50 emails from Golomt (more reliable than "latest only")
    const uids = await client.search({ from: FROM });
    const last = uids.slice(-50);

    debug.log("📩 Checking last", last.length, "Golomt emails for code:", CODE);

    for (let i = last.length - 1; i >= 0; i--) {
      const uid = last[i];
      const msg = await client.fetchOne(uid, { source: true });
      const parsed = await simpleParser(msg.source);

      const plain =
        parsed.text?.trim()
          ? parsed.text
          : htmlToText(parsed.html || "", { wordwrap: false });

      const clean = normalize(plain);

      // Must be deposit email + must contain code
      if (clean.includes("ОРЛОГЫН") && clean.includes(CODE)) {
        debug.log("\n✅ FOUND MATCH!");
        debug.log("UID:", uid);
        debug.log("Subject:", parsed.subject);
        debug.log("Preview:", clean.slice(0, 300));
        return;
      }
    }

    debug.log("\n❌ Not found in last 50 Golomt emails.");
    debug.log("Tip: maybe email not arrived yet, or sender is different.");
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch((e) => console.error("❌ Error:", e.message));
