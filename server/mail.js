// Sends the OTP emails. Pick ONE provider with env vars (first match wins):
//   BREVO_API_KEY + MAIL_FROM      Brevo HTTP API (free 300 mails/day, works on Render free)
//   MAIL_RELAY_URL + MAIL_RELAY_SECRET   Google Apps Script relay: mails go out from YOUR Gmail (see mail-relay.gs)
//   SMTP_HOST (+SMTP_PORT/USER/PASS)     Gmail SMTP with an app password. Works locally and on paid hosts,
//                                        but Render's FREE plan blocks outgoing SMTP ports.

export const mailProvider = (env = process.env) =>
  env.BREVO_API_KEY ? "brevo" : env.MAIL_RELAY_URL ? "relay" : env.SMTP_HOST ? "smtp" : null;

let smtp;

export async function sendMail({ to, subject, text, html }, env = process.env) {
  const p = mailProvider(env);

  if (p === "brevo") {
    if (!env.MAIL_FROM) throw new Error("MAIL_FROM is not set (the sender address you verified in Brevo)");
    const r = await fetch(env.BREVO_URL || "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "HiMusic", email: env.MAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!r.ok) throw new Error(`Brevo HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return;
  }

  if (p === "relay") {
    // Apps Script answers a POST with a redirect; fetch follows it, the mail is already sent by then.
    const r = await fetch(env.MAIL_RELAY_URL, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ secret: env.MAIL_RELAY_SECRET || "", to, subject, text, html }),
    });
    const body = (await r.text()).trim();
    if (!r.ok || body !== "ok") throw new Error(`Mail relay failed: HTTP ${r.status} ${body.slice(0, 120)}`);
    return;
  }

  if (p === "smtp") {
    if (!smtp) {
      const nodemailer = (await import("nodemailer")).default;
      const port = Number(env.SMTP_PORT) || 465;
      smtp = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
    }
    await smtp.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to, subject, text, html });
    return;
  }

  throw new Error("No mail provider configured");
}

export function otpMail(code, purpose) {
  const what = purpose === "reset" ? "password reset" : "verification";
  return {
    subject: purpose === "reset" ? "HiMusic password reset code" : "Your HiMusic verification code",
    text: `Your HiMusic ${what} code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;background:#121212;color:#fff;border-radius:12px">` +
      `<h2 style="margin:0 0 8px;color:#1DB954">HiMusic</h2><p>Your ${what} code:</p>` +
      `<p style="font-size:34px;letter-spacing:8px;font-weight:800;margin:12px 0">${code}</p>` +
      `<p style="color:#b3b3b3;font-size:13px">It expires in 10 minutes. If you did not ask for it, you can ignore this email.</p></div>`,
  };
}
