import debug from "./utils/debug.js";
import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";

const USER = process.env.GMAIL_IMAP_USER;
const PASS = process.env.GMAIL_IMAP_PASS;
const FROM = process.env.GOLOMT_ALERT_FROM || "alert@golomtbank.com";

if (!USER || !PASS) {
  debug.log("❌ Missing GMAIL_IMAP_USER or GMAIL_IMAP_PASS in .env");
  process.exit(1);
}

function normalize(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

function parseGolomtText(text) {
  const t = normalize(text);

  // amount: +10,000.00 MNT OR 10,000 MNT
  const amountMatch = t.match(/Гүйлгээний дүн:\s*\+?\s*([\d,]+(?:\.\d+)?)\s*MNT/i);

  // date: "Гүйлгээний огноо:2025-12-24" or with space
  const dateMatch = t.match(/Гүйлгээний огноо:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);

  // code: "Гүйлгээний утга: Q34S21M" OR "Гүйлгээний утга: SOCIALPAY ГҮЙЛГЭ"
  // We’ll capture until next label by stopping before "Үлдэгдэл" if it exists
  const codeMatch = t.match(/Гүйлгээний утга:\s*([A-F0-9]{8})/i);

  return {
    amount: amountMatch ? amountMatch[1].replace(/,/g, "") : null,
    date: dateMatch ? dateMatch[1] : null,
    code: codeMatch ? codeMatch[1].trim() : null,
  };
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
  debug.log("✅ Connected to Gmail IMAP");

  let lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search({ from: FROM, subject: "Easy Info" });
    if (!uids?.length) {
      debug.log("❌ No emails found from:", FROM);
      return;
    }

    const latestUid = uids[uids.length - 1];
    debug.log("✅ Latest UID:", latestUid);

    const msg = await client.fetchOne(latestUid, { source: true });
    const parsed = await simpleParser(msg.source);

    debug.log("\n📩 SUBJECT:", parsed.subject);
    debug.log("📩 FROM:", parsed.from?.text);

    // ✅ Convert HTML to plain text (THIS is the important fix)
    const plain =
      parsed.text?.trim()
        ? parsed.text
        : htmlToText(parsed.html || "", { wordwrap: false });

    const clean = normalize(plain);

    debug.log("\n--- PLAIN (preview) ---");
    debug.log(clean.slice(0, 250));

    const extracted = parseGolomtText(clean);
    debug.log("\n✅ EXTRACTED:", extracted);

    if (!extracted.amount || !extracted.code) {
      debug.log("⚠️ Still missing amount/code → send me the PLAIN preview line and I’ll adjust regex.");
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch((e) => {
  console.error("❌ Error:", e);
});
