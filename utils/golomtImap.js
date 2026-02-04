import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";

const USER = process.env.GMAIL_IMAP_USER;
const PASS = process.env.GMAIL_IMAP_PASS;

// ✅ M bank sender domain (you can override by env)
const FROM = process.env.GOLOMT_ALERT_FROM || "m-bank.mn";

function normalize(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

function parseGolomtText(text) {
  const t = normalize(text);

  // ✅ M bank: "Гүйлгээний дүн: 8,900.00"
  const amountMatch = t.match(/Гүйлгээний дүн:\s*([\d.,]+)/);

  // ✅ M bank: "Гүйлгээ хийсэн огноо: 2026-01-13"
  const dateMatch = t.match(/Гүйлгээ хийсэн огноо:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);

  // ✅ M bank: code in "Гүйлгээний утга"
  const codeMatch = t.match(/Гүйлгээний утга:\s*([A-Za-z0-9\-]{1,32})/);

  return {
    amount: amountMatch ? Number(amountMatch[1].replace(/[,\s]/g, "")) : null,
    date: dateMatch ? dateMatch[1] : null,
    code: codeMatch ? codeMatch[1].toUpperCase() : null,
  };
}

export async function findGolomtDepositByCode({ code, minAmount, lookback = 20 }) {
  if (!USER || !PASS) throw new Error("Missing GMAIL_IMAP_USER or GMAIL_IMAP_PASS");
  if (!code) throw new Error("Missing code");

  const upperCode = code.toUpperCase();

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASS },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    // ✅ FAST: Gmail searches for the code inside M-bank emails
    const uids = await client.search({
      gmailRaw: `from:(${FROM}) ${upperCode} newer_than:7d`,
    });

    if (!uids.length) return { found: false };

    const lastUids = uids.slice(-lookback);

    for (let i = lastUids.length - 1; i >= 0; i--) {
      const uid = lastUids[i];

      const msg = await client.fetchOne(uid, { source: true });
      const parsed = await simpleParser(msg.source);

      const plain =
        parsed.text?.trim()
          ? parsed.text
          : htmlToText(parsed.html || "", { wordwrap: false });

      const extracted = parseGolomtText(plain);

      const hasCode =
        (extracted.code && extracted.code === upperCode) ||
        plain.toUpperCase().includes(upperCode);

      if (!hasCode) continue;

      const amt = extracted.amount !== null ? extracted.amount : null;

      if (amt !== null && amt >= Number(minAmount)) {
        return {
          found: true,
          amount: amt,
          date: extracted.date,
          uid,
          subject: parsed.subject || "",
        };
      } else {
        return {
          found: false,
          reason: "Code found but amount too low or amount not parsed",
          amount: amt,
          date: extracted.date,
          uid,
        };
      }
    }

    return { found: false };
  } finally {
    lock.release();
    await client.logout();
  }
}
