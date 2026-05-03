import nodemailer from "nodemailer";
import { db, adminConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const allRows = await db
    .select({ key: adminConfigTable.key, value: adminConfigTable.value })
    .from(adminConfigTable);

  const cfg: Record<string, string> = {};
  const keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"];
  for (const row of allRows) {
    if (keys.includes(row.key)) cfg[row.key] = row.value;
  }

  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) return null;

  return {
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port || "587", 10),
    user: cfg.smtp_user,
    pass: cfg.smtp_pass,
    from: cfg.smtp_from || cfg.smtp_user,
  };
}

async function createTransport() {
  const cfg = await getSmtpConfig();
  if (!cfg) return null;
  return {
    transport: nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    }),
    from: `"MineNova" <${cfg.from}>`,
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

interface BuildEmailOpts {
  title: string;
  bodyHtml: string;
  ctaUrl?: string;
  ctaText?: string;
}

function buildEmailHtml({ title, bodyHtml, ctaUrl, ctaText }: BuildEmailOpts): string {
  const ctaHtml = ctaUrl && ctaText
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
        <tr>
          <td align="center">
            <a href="${ctaUrl}"
               style="display:inline-block;padding:14px 36px;background-color:#7c3aed;background-image:linear-gradient(135deg,#7c3aed,#ec4899);color:#ffffff;text-decoration:none;border-radius:28px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              ${ctaText}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#080611;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#080611;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background-color:#0f0c1a;border-radius:16px;border:1px solid #1e1b2e;">

              <!-- Top accent bar -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:4px;background-color:#7c3aed;background-image:linear-gradient(90deg,#7c3aed,#a855f7,#ec4899);border-radius:16px 16px 0 0;"></td>
                </tr>
              </table>

              <!-- Header / Logo -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:32px 32px 20px;text-align:center;border-bottom:1px solid #1e1b2e;">
                    <div style="font-size:32px;line-height:1;margin-bottom:8px;">⛏</div>
                    <div style="font-size:26px;font-weight:900;color:#a855f7;letter-spacing:-0.5px;line-height:1;">MineNova</div>
                    <div style="color:#6b7280;font-size:13px;margin-top:6px;">Earn Smarter. Grow Faster.</div>
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:32px;">
                    <h1 style="font-size:22px;font-weight:700;color:#f3f0ff;margin:0 0 20px;line-height:1.35;">${escapeHtml(title)}</h1>
                    ${bodyHtml}
                    ${ctaHtml}
                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:20px 32px 24px;text-align:center;border-top:1px solid #1e1b2e;background-color:#080611;border-radius:0 0 16px 16px;">
                    <p style="color:#4b5563;font-size:12px;margin:0 0 4px;">© 2025 MineNova. All rights reserved.</p>
                    <p style="color:#374151;font-size:11px;margin:0;">Earn Crypto. Cash Out Real.</p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function p(html: string): string {
  return `<p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0 0 16px;">${html}</p>`;
}

function strong(html: string): string {
  return `<strong style="color:#f3f0ff;">${html}</strong>`;
}

function card(icon: string, title: string, body: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
      <tr>
        <td style="background-color:#1a1730;border:1px solid #2d2b3d;border-radius:12px;padding:16px;">
          <div style="font-size:20px;margin-bottom:6px;">${icon} <span style="font-size:15px;font-weight:700;color:#f3f0ff;">${escapeHtml(title)}</span></div>
          <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0;">${body}</p>
        </td>
      </tr>
    </table>`;
}

function infoBox(html: string, color = "#4f46e5", bg = "#1e1a38"): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td style="background-color:${bg};border:1px solid ${color};border-radius:12px;padding:14px 16px;">
          <p style="color:#a5b4fc;font-size:13px;line-height:1.6;margin:0;">${html}</p>
        </td>
      </tr>
    </table>`;
}

function detailRow(label: string, value: string, valueColor = "#f3f0ff"): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
      <tr>
        <td style="font-size:13px;color:#9ca3af;width:45%;">${escapeHtml(label)}</td>
        <td style="font-size:14px;color:${valueColor};font-weight:600;">${value}</td>
      </tr>
    </table>`;
}

// ─── Welcome Email ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(toEmail: string, username: string): Promise<void> {
  const t = await createTransport();
  if (!t) return;

  const bodyHtml = `
    ${p(`Hi ${strong(escapeHtml(username))}, welcome to MineNova! We're thrilled to have you here. Here's everything you can do on the platform:`)}

    ${card("⛏", "Mining", "Start a mining session and earn NovaCoin automatically over 12 hours. Claim your coins when the session ends and keep them growing in your wallet.")}
    ${card("🎮", "Games", "Play Ludo, WHOT card game, and Mines to win extra coins — challenge other players in PvP or test your luck against the house.")}
    ${card("⚡", "Upgrades", "Unlock permanent mining speed boosts (up to 3×) with coins or USDT. Each upgrade tier increases how much you earn every session.")}
    ${card("🚀", "Boosts", "Activate temporary speed multipliers mid-session to earn even more coins in the same timeframe. Watch a short ad to unlock each boost.")}
    ${card("💸", "Withdrawals", "Convert your NovaCoin to USDT and withdraw directly to your crypto wallet. No lock-ins — just real earnings you can cash out anytime.")}

    ${p("Your first mining session is just one tap away. Let's go!")}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: "Welcome to MineNova — start earning today",
    html: buildEmailHtml({
      title: `Welcome aboard, ${escapeHtml(username)}! 🎉`,
      bodyHtml,
      ctaUrl: "https://minenova.app",
      ctaText: "Start Mining Now",
    }),
    text: `Welcome to MineNova, ${username}!\n\nHere's what you can do:\n\n⛏ Mining — Earn NovaCoin over 12-hour sessions\n🎮 Games — Ludo, WHOT, Mines for extra coins\n⚡ Upgrades — Permanent speed boosts up to 3×\n🚀 Boosts — Temporary multipliers mid-session\n💸 Withdrawals — Convert coins to USDT anytime\n\nStart mining now!`,
  });
}

// ─── Email Verification ────────────────────────────────────────────────────────

export async function sendVerificationEmail(
  toEmail: string,
  username: string,
  verificationUrl: string,
): Promise<void> {
  const t = await createTransport();

  if (!t) {
    console.info(`[MineNova] Email verification link for ${toEmail}: ${verificationUrl}`);
    return;
  }

  const bodyHtml = `
    ${p(`Hi ${strong(escapeHtml(username))}, thanks for joining MineNova! Click the button below to verify your email address and unlock all platform features, including USDT withdrawals.`)}
    ${infoBox("⏱ This verification link expires in <strong>24 hours</strong>. If you didn't create an account, you can safely ignore this email.")}
    ${p(`<span style="color:#6b7280;font-size:12px;">Or copy this link: <span style="color:#a855f7;">${escapeHtml(verificationUrl)}</span></span>`)}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: "Verify your MineNova account",
    html: buildEmailHtml({
      title: "Verify your email address",
      bodyHtml,
      ctaUrl: verificationUrl,
      ctaText: "Verify Email",
    }),
    text: `Verify your MineNova account\n\nHi ${username},\n\nClick this link to verify your email:\n${verificationUrl}\n\nThis link expires in 24 hours.`,
  });
}

// ─── Password Reset ────────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  toEmail: string,
  username: string,
  resetUrl: string,
): Promise<void> {
  const t = await createTransport();
  if (!t) {
    console.info(`[MineNova] Password reset link for ${toEmail}: ${resetUrl}`);
    return;
  }

  const bodyHtml = `
    ${p(`Hi ${strong(escapeHtml(username))}, we received a request to reset your MineNova password. Click the button below to choose a new one.`)}
    ${infoBox("⏱ This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your account is secure.")}
    ${p(`<span style="color:#6b7280;font-size:12px;">Or copy this link: <span style="color:#a855f7;">${escapeHtml(resetUrl)}</span></span>`)}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: "Reset your MineNova password",
    html: buildEmailHtml({
      title: "Reset your password",
      bodyHtml,
      ctaUrl: resetUrl,
      ctaText: "Reset Password",
    }),
    text: `Reset your MineNova password\n\nHi ${username},\n\nClick this link to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
  });
}

// ─── Upgrade: Payment Submitted ───────────────────────────────────────────────

export async function sendUpgradePaymentSubmittedEmail(
  toEmail: string,
  username: string,
  upgradeName: string,
  usdtAmount: number,
  paymentTag: string,
): Promise<void> {
  const t = await createTransport();
  if (!t) return;

  const bodyHtml = `
    ${p(`Hi ${strong(escapeHtml(username))}, we've received your payment notification for the ${strong(escapeHtml(upgradeName))} upgrade.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td style="background-color:#1a1730;border:1px solid #2d2b3d;border-radius:12px;padding:16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Payment details</p>
          ${detailRow("Amount", `<span style="color:#10b981;">${usdtAmount} USDT</span>`)}
          ${detailRow("Payment Tag", `<span style="color:#a855f7;font-family:monospace;">${escapeHtml(paymentTag)}</span>`)}
          ${detailRow("Upgrade", escapeHtml(upgradeName))}
          ${detailRow("Status", '<span style="color:#f59e0b;">Pending verification</span>')}
        </td>
      </tr>
    </table>
    ${infoBox(`⏱ Our admin team will verify your payment and activate your upgrade within <strong>2–12 hours</strong>. You'll receive another email once confirmed.`)}
    ${p(`<span style="color:#6b7280;font-size:12px;">If you have any questions, contact support with your payment tag: <strong style="color:#a855f7;">${escapeHtml(paymentTag)}</strong></span>`)}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: "Upgrade payment received — pending verification",
    html: buildEmailHtml({
      title: "Payment submitted!",
      bodyHtml,
    }),
    text: `Payment Submitted\n\nHi ${username},\n\nWe received your payment for ${upgradeName} (${usdtAmount} USDT, Tag: ${paymentTag}).\n\nOur team will verify and activate your upgrade within 2–12 hours.`,
  });
}

// ─── Upgrade: Approved ────────────────────────────────────────────────────────

export async function sendUpgradeApprovedEmail(
  toEmail: string,
  username: string,
  upgradeName: string,
  note?: string | null,
): Promise<void> {
  const t = await createTransport();
  if (!t) return;

  const noteHtml = note
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
        <tr>
          <td style="background-color:#1a1730;border:1px solid #2d2b3d;border-radius:12px;padding:16px;">
            <p style="color:#9ca3af;font-size:12px;margin:0 0 6px;">Admin note:</p>
            <p style="color:#f3f0ff;font-size:14px;margin:0;">${escapeHtml(note)}</p>
          </td>
        </tr>
      </table>`
    : "";

  const bodyHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="text-align:center;padding:16px 0 8px;">
          <div style="font-size:48px;line-height:1;">✅</div>
        </td>
      </tr>
    </table>
    ${p(`Great news, ${strong(escapeHtml(username))}! Your payment has been verified and the ${strong(escapeHtml(upgradeName))} upgrade is now active on your account.`)}
    ${noteHtml}
    ${infoBox(`🚀 Your mining speed has been upgraded. Start a new session to see your enhanced earnings!`, "#10b981", "#0d2218")}
    ${p(`<span style="color:#6b7280;font-size:12px;">Log in to MineNova to see your new mining stats.</span>`)}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: `Your ${upgradeName} upgrade is now active! 🎉`,
    html: buildEmailHtml({
      title: "Upgrade activated!",
      bodyHtml,
      ctaUrl: "https://minenova.app/dashboard",
      ctaText: "Mine at Full Power",
    }),
    text: `Upgrade Activated!\n\nHi ${username},\n\nYour ${upgradeName} upgrade is now active. Start mining at full power!\n${note ? `\nAdmin note: ${note}` : ""}`,
  });
}

// ─── Upgrade: Rejected ────────────────────────────────────────────────────────

export async function sendUpgradeRejectedEmail(
  toEmail: string,
  username: string,
  upgradeName: string,
  reason?: string | null,
): Promise<void> {
  const t = await createTransport();
  if (!t) return;

  const reasonHtml = reason
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
        <tr>
          <td style="background-color:#2d1a1a;border:1px solid #7f1d1d;border-radius:12px;padding:16px;">
            <p style="color:#fca5a5;font-size:12px;margin:0 0 6px;">Reason:</p>
            <p style="color:#f3f0ff;font-size:14px;margin:0;">${escapeHtml(reason)}</p>
          </td>
        </tr>
      </table>`
    : "";

  const bodyHtml = `
    ${p(`Hi ${strong(escapeHtml(username))}, unfortunately we were unable to verify your payment for the ${strong(escapeHtml(upgradeName))} upgrade.`)}
    ${reasonHtml}
    ${p("Please contact our support team if you believe this is an error, or try submitting the upgrade payment again from the app.")}
    ${p(`<span style="color:#6b7280;font-size:12px;">We apologize for any inconvenience.</span>`)}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: `Payment issue — ${upgradeName} upgrade`,
    html: buildEmailHtml({
      title: "Payment could not be verified",
      bodyHtml,
    }),
    text: `Payment Not Verified\n\nHi ${username},\n\nWe could not verify your payment for ${upgradeName}.\n${reason ? `\nReason: ${reason}` : ""}\n\nPlease contact support if you believe this is an error.`,
  });
}

// ─── Admin → User message ──────────────────────────────────────────────────────

export async function sendAdminMessageEmail(
  toEmail: string,
  username: string,
  subject: string,
  body: string,
): Promise<void> {
  const t = await createTransport();
  if (!t) throw new Error("SMTP is not configured. Set SMTP settings in Admin → Settings before sending emails.");

  const paragraphs = body
    .split(/\n+/)
    .filter(l => l.trim())
    .map(l => p(escapeHtml(l)))
    .join("\n");

  const bodyHtml = `
    ${p(`Hi ${strong(escapeHtml(username))},`)}
    ${paragraphs}
    ${p(`<span style="color:#6b7280;font-size:12px;">— The MineNova Team</span>`)}
  `;

  await t.transport.sendMail({
    from: t.from,
    to: toEmail,
    subject: escapeHtml(subject),
    html: buildEmailHtml({
      title: escapeHtml(subject),
      bodyHtml,
    }),
    text: `${subject}\n\nHi ${username},\n\n${body}\n\n— The MineNova Team`,
  });
}
