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
