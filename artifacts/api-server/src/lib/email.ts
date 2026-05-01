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
  const rows = await db
    .select({ key: adminConfigTable.key, value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "smtp_host"));

  const [hostRow] = rows;
  if (!hostRow?.value) return null;

  const keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"];
  const allRows = await db
    .select({ key: adminConfigTable.key, value: adminConfigTable.value })
    .from(adminConfigTable);

  const cfg: Record<string, string> = {};
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

export async function sendUpgradePaymentSubmittedEmail(
  toEmail: string,
  username: string,
  upgradeName: string,
  usdtAmount: number,
  paymentTag: string,
): Promise<void> {
  const smtpCfg = await getSmtpConfig();
  if (!smtpCfg) return;

  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port,
    secure: smtpCfg.port === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
  });

  await transporter.sendMail({
    from: `"MineNova" <${smtpCfg.from}>`,
    to: toEmail,
    subject: "Upgrade Payment Received — Pending Verification",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0c1a;color:#f3f0ff;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#a855f7;margin:0 0 4px;">MineNova</h1>
          <p style="color:#9ca3af;font-size:14px;margin:0;">Earn Smarter. Grow Faster.</p>
        </div>
        <h2 style="font-size:20px;margin:0 0 8px;">Payment Submitted, ${username}!</h2>
        <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 16px;">
          We've received your payment notification for the <strong style="color:#f3f0ff;">${upgradeName}</strong> upgrade.
        </p>
        <div style="background:#1a1730;border:1px solid #2d2b3d;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">Payment details:</p>
          <p style="margin:0 0 4px;font-size:14px;">Amount: <strong style="color:#10b981;">${usdtAmount} USDT</strong></p>
          <p style="margin:0;font-size:14px;">Payment Tag: <strong style="color:#a855f7;">${paymentTag}</strong></p>
        </div>
        <div style="background:#1e1a38;border:1px solid #4f46e5;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0;font-size:13px;color:#a5b4fc;">
            ⏱ Our admin team will verify your payment and activate your upgrade within <strong>2–12 hours</strong>.
            You'll receive another email once your upgrade is confirmed.
          </p>
        </div>
        <p style="color:#6b7280;font-size:12px;margin:0;text-align:center;">
          If you have any issues, please contact support with your payment tag: <strong>${paymentTag}</strong>
        </p>
      </div>
    `,
    text: `Payment Submitted\n\nHi ${username},\n\nWe received your payment notification for ${upgradeName} (${usdtAmount} USDT, Tag: ${paymentTag}).\n\nOur team will verify and activate your upgrade within 2–12 hours.`,
  });
}

export async function sendUpgradeApprovedEmail(
  toEmail: string,
  username: string,
  upgradeName: string,
  note?: string | null,
): Promise<void> {
  const smtpCfg = await getSmtpConfig();
  if (!smtpCfg) return;

  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port,
    secure: smtpCfg.port === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
  });

  await transporter.sendMail({
    from: `"MineNova" <${smtpCfg.from}>`,
    to: toEmail,
    subject: `Your ${upgradeName} upgrade is now active! 🎉`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0c1a;color:#f3f0ff;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#a855f7;margin:0 0 4px;">MineNova</h1>
          <p style="color:#9ca3af;font-size:14px;margin:0;">Earn Smarter. Grow Faster.</p>
        </div>
        <div style="text-align:center;margin-bottom:20px;">
          <div style="width:60px;height:60px;border-radius:50%;background:#10b981/20;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:8px;">✅</div>
          <h2 style="font-size:20px;margin:0;">Upgrade Activated!</h2>
        </div>
        <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 16px;">
          Great news, <strong style="color:#f3f0ff;">${username}</strong>! Your payment has been verified and the
          <strong style="color:#f3f0ff;">${upgradeName}</strong> upgrade is now active on your account.
        </p>
        ${note ? `<div style="background:#1a1730;border:1px solid #2d2b3d;border-radius:12px;padding:16px;margin-bottom:20px;"><p style="margin:0;font-size:13px;color:#9ca3af;">Admin note:</p><p style="margin:4px 0 0;font-size:14px;">${note}</p></div>` : ""}
        <div style="text-align:center;margin:24px 0;">
          <p style="color:#10b981;font-size:15px;font-weight:bold;margin:0;">Start mining at full power now!</p>
        </div>
        <p style="color:#6b7280;font-size:12px;margin:0;text-align:center;">
          Log in to MineNova to see your enhanced mining stats.
        </p>
      </div>
    `,
    text: `Upgrade Activated!\n\nHi ${username},\n\nYour ${upgradeName} upgrade is now active. Start mining at full power!\n${note ? `\nAdmin note: ${note}` : ""}`,
  });
}

export async function sendUpgradeRejectedEmail(
  toEmail: string,
  username: string,
  upgradeName: string,
  reason?: string | null,
): Promise<void> {
  const smtpCfg = await getSmtpConfig();
  if (!smtpCfg) return;

  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port,
    secure: smtpCfg.port === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
  });

  await transporter.sendMail({
    from: `"MineNova" <${smtpCfg.from}>`,
    to: toEmail,
    subject: `Upgrade payment issue — ${upgradeName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0c1a;color:#f3f0ff;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#a855f7;margin:0 0 4px;">MineNova</h1>
          <p style="color:#9ca3af;font-size:14px;margin:0;">Earn Smarter. Grow Faster.</p>
        </div>
        <h2 style="font-size:20px;margin:0 0 8px;">Payment Not Verified</h2>
        <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 16px;">
          Hi <strong style="color:#f3f0ff;">${username}</strong>, unfortunately we were unable to verify your payment for the
          <strong style="color:#f3f0ff;">${upgradeName}</strong> upgrade.
        </p>
        ${reason ? `<div style="background:#2d1a1a;border:1px solid #7f1d1d;border-radius:12px;padding:16px;margin-bottom:20px;"><p style="margin:0;font-size:13px;color:#fca5a5;">Reason:</p><p style="margin:4px 0 0;font-size:14px;">${reason}</p></div>` : ""}
        <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 16px;">
          Please contact our support team if you believe this is an error, or try purchasing the upgrade again.
        </p>
        <p style="color:#6b7280;font-size:12px;margin:0;text-align:center;">
          We apologize for any inconvenience.
        </p>
      </div>
    `,
    text: `Payment Not Verified\n\nHi ${username},\n\nWe could not verify your payment for ${upgradeName}.\n${reason ? `\nReason: ${reason}` : ""}\n\nPlease contact support if you believe this is an error.`,
  });
}

export async function sendVerificationEmail(
  toEmail: string,
  username: string,
  verificationUrl: string
): Promise<void> {
  const smtpCfg = await getSmtpConfig();

  if (!smtpCfg) {
    console.info(
      `[MineNova] Email verification link for ${toEmail}: ${verificationUrl}`
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port,
    secure: smtpCfg.port === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
  });

  await transporter.sendMail({
    from: `"MineNova" <${smtpCfg.from}>`,
    to: toEmail,
    subject: "Verify your MineNova account",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0c1a;color:#f3f0ff;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#a855f7;margin:0 0 4px;">MineNova</h1>
          <p style="color:#9ca3af;font-size:14px;margin:0;">Earn Smarter. Grow Faster.</p>
        </div>
        <h2 style="font-size:20px;margin:0 0 8px;">Verify your email, ${username}</h2>
        <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Click the button below to verify your email address and unlock all MineNova features, including USDT withdrawals.
        </p>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${verificationUrl}"
             style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;border-radius:24px;font-weight:bold;font-size:15px;">
            Verify Email
          </a>
        </div>
        <p style="color:#6b7280;font-size:12px;margin:0;text-align:center;">
          This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
        <div style="border-top:1px solid #2d2b3d;margin-top:24px;padding-top:16px;text-align:center;">
          <p style="color:#6b7280;font-size:11px;margin:0;">
            Or copy this URL: <span style="color:#a855f7;">${verificationUrl}</span>
          </p>
        </div>
      </div>
    `,
    text: `Verify your MineNova account\n\nHi ${username},\n\nClick this link to verify your email:\n${verificationUrl}\n\nThis link expires in 24 hours.`,
  });
}
