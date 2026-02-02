import debug from "../utils/debug.js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to, subject, message) {
  try {
    const fromEmail = process.env.EMAIL_FROM || "MNFLIX <onboarding@resend.dev>";

    await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html: message,
    });

    debug.log("Email sent to:", to);
    return true;
  } catch (err) {
    console.error("Email error:", err);
    return false;
  }
}
