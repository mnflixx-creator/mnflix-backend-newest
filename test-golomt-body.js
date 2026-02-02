import debug from "./utils/debug.js";
import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const GMAIL_USER = process.env.GMAIL_IMAP_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_IMAP_PASS;

debug.log("ENV CHECK:", {
  user: GMAIL_USER,
  passLoaded: !!GMAIL_APP_PASSWORD,
});

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  debug.log("❌ Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env");
  process.exit(1);
}

const FROM = "alert@golomtbank.com"; // sender email
const SUBJECT_CONTAINS = "Easy Info"; // your subject contains this

async function main() {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
    logger: false, // keep clean output
  });

  await client.connect();
  debug.log("✅ Connected to Gmail IMAP");

  let lock = await client.getMailboxLock("INBOX");
  try {
    // find latest message from Golomt + subject contains "Easy Info"
    const uids = await client.search({
      from: FROM,
      subject: SUBJECT_CONTAINS,
    });

    if (!uids || uids.length === 0) {
      debug.log("❌ No matching Golomt emails found");
      return;
    }

    const latestUid = uids[uids.length - 1];
    debug.log("✅ Latest UID:", latestUid);

    // fetch raw source
    const msg = await client.fetchOne(latestUid, { source: true });
    const parsed = await simpleParser(msg.source);

    debug.log("\n📩 SUBJECT:", parsed.subject);
    debug.log("📩 FROM:", parsed.from?.text || "");
    debug.log("\n====== BODY HTML START ======\n");

    if (parsed.html) {
    // Remove HTML tags so we can see readable text
    const plain = parsed.html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    debug.log(plain);
    } else {
    debug.log("❌ No HTML body found");
    }

    debug.log("\n====== BODY HTML END ======\n");
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch((e) => {
  console.error("❌ Error:", e);
});
