const nodemailer = require("nodemailer");

let cachedTransport = null;
let cachedConfigKey = "";

const getMailConfig = () => {
    const service = (process.env.SMTP_SERVICE || "").trim();
    const host = (process.env.SMTP_HOST || "").trim();
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = (process.env.SMTP_USER || "").trim();
    const pass = process.env.SMTP_PASS || "";
    const secure =
        String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
        port === 465;
    const from =
        (process.env.SMTP_FROM || "").trim() ||
        (user ? `Bubbles <${user}>` : "");

    return { service, host, port, user, pass, secure, from };
};

const isEmailConfigured = () => {
    const config = getMailConfig();

    if (!config.from) {
        return false;
    }

    if (config.service) {
        return Boolean(config.user && config.pass);
    }

    return Boolean(config.host && config.port);
};

const getTransport = () => {
    if (!isEmailConfigured()) {
        return null;
    }

    const config = getMailConfig();
    const key = [
        config.service,
        config.host,
        config.port,
        config.secure,
        config.user,
        config.pass,
        config.from,
    ].join("|");

    if (cachedTransport && cachedConfigKey === key) {
        return cachedTransport;
    }

    const options = {
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
    };

    if (config.service) {
        options.service = config.service;
    } else {
        options.host = config.host;
        options.port = config.port;
        options.secure = config.secure;
    }

    if (config.user) {
        options.auth = {
            user: config.user,
            pass: config.pass,
        };
    }

    cachedTransport = nodemailer.createTransport(options);
    cachedConfigKey = key;

    return cachedTransport;
};

const escapeHtml = (value) =>
    String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const buildPasswordResetEmail = ({ name, resetUrl }) => {
    const safeName = escapeHtml(name || "there");
    const safeUrl = escapeHtml(resetUrl);

    const text = [
        `Hi ${name || "there"},`,
        "",
        "We received a request to reset your Bubbles password.",
        "Open this link to choose a new password:",
        resetUrl,
        "",
        "This link expires in 30 minutes and can only be used once.",
        "If you did not ask for this, you can safely ignore this email.",
        "",
        "— Bubbles",
    ].join("\n");

    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f1ff;font-family:Arial,Helvetica,sans-serif;color:#2b2440;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1ff;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px -16px rgba(109,74,224,0.35);">
            <tr>
              <td style="height:8px;background:#6d4ae0;background-image:linear-gradient(90deg,#6d4ae0,#a855f7,#e8659b,#f5917a);"></td>
            </tr>
            <tr>
              <td style="padding:36px 36px 12px;text-align:center;">
                <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#6d4ae0;">Bubbles</div>
                <div style="font-size:13px;color:#7c7895;margin-top:6px;">Conversations that feel close.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 8px;">
                <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#2b2440;">Reset your password</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4a4560;">Hi ${safeName},</p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#4a4560;">
                  We received a request to reset the password on your Bubbles account. Tap the button below to choose a new one.
                </p>
                <div style="text-align:center;margin:0 0 24px;">
                  <a href="${safeUrl}" style="display:inline-block;padding:14px 30px;border-radius:14px;background:#6d4ae0;background-image:linear-gradient(135deg,#6d4ae0,#a855f7,#e8659b);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Reset password</a>
                </div>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#7c7895;">
                  This link expires in 30 minutes and can only be used once.
                </p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#7c7895;">
                  If you did not request this, you can safely ignore this email. Your password will stay the same.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px 30px;border-top:1px solid #ece2ff;">
                <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9a95ad;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;color:#6d4ae0;">${safeUrl}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    return {
        subject: "Reset your Bubbles password",
        text,
        html,
    };
};

const formatExpiry = (minutes) => {
    const value = Number(minutes) || 1440;

    if (value % 1440 === 0) {
        if (value === 1440) {
            return "24 hours";
        }

        const days = value / 1440;
        return `${days} ${days === 1 ? "day" : "days"}`;
    }

    if (value % 60 === 0) {
        const hours = value / 60;
        return `${hours} ${hours === 1 ? "hour" : "hours"}`;
    }

    return `${value} minutes`;
};

const buildEmailVerificationEmail = ({ name, verifyUrl, expiresMinutes }) => {
    const safeName = escapeHtml(name || "there");
    const safeUrl = escapeHtml(verifyUrl);
    const expiresText = formatExpiry(expiresMinutes);

    const text = [
        `Hi ${name || "there"},`,
        "",
        "Welcome to Bubbles! Confirm your email address to finish setting up your account.",
        "Open this link to verify your email:",
        verifyUrl,
        "",
        `This link expires in ${expiresText} and can only be used once.`,
        "If you did not create a Bubbles account, you can safely ignore this email.",
        "",
        "— Bubbles",
    ].join("\n");

    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f1ff;font-family:Arial,Helvetica,sans-serif;color:#2b2440;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1ff;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px -16px rgba(109,74,224,0.35);">
            <tr>
              <td style="height:8px;background:#6d4ae0;background-image:linear-gradient(90deg,#6d4ae0,#a855f7,#e8659b,#f5917a);"></td>
            </tr>
            <tr>
              <td style="padding:36px 36px 12px;text-align:center;">
                <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#6d4ae0;">Bubbles</div>
                <div style="font-size:13px;color:#7c7895;margin-top:6px;">Conversations that feel close.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 8px;">
                <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#2b2440;">Verify your email</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4a4560;">Hi ${safeName},</p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#4a4560;">
                  Welcome to Bubbles! Confirm this email address to finish setting up your account.
                </p>
                <div style="text-align:center;margin:0 0 24px;">
                  <a href="${safeUrl}" style="display:inline-block;padding:14px 30px;border-radius:14px;background:#6d4ae0;background-image:linear-gradient(135deg,#6d4ae0,#a855f7,#e8659b);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Verify email</a>
                </div>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#7c7895;">
                  This link expires in ${expiresText} and can only be used once.
                </p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#7c7895;">
                  If you did not create a Bubbles account, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px 30px;border-top:1px solid #ece2ff;">
                <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9a95ad;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;color:#6d4ae0;">${safeUrl}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    return {
        subject: "Verify your Bubbles email",
        text,
        html,
    };
};

const sendEmailVerificationEmail = async ({
    to,
    name,
    verifyUrl,
    expiresMinutes,
}) => {
    const transport = getTransport();

    if (!transport) {
        const error = new Error(
            "Email is not configured. Add the SMTP settings to the backend .env file."
        );
        error.code = "EMAIL_NOT_CONFIGURED";
        throw error;
    }

    const { subject, text, html } = buildEmailVerificationEmail({
        name,
        verifyUrl,
        expiresMinutes,
    });

    return transport.sendMail({
        from: getMailConfig().from,
        to,
        subject,
        text,
        html,
    });
};

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
    const transport = getTransport();

    if (!transport) {
        const error = new Error(
            "Email is not configured. Add the SMTP settings to the backend .env file."
        );
        error.code = "EMAIL_NOT_CONFIGURED";
        throw error;
    }

    const { subject, text, html } = buildPasswordResetEmail({ name, resetUrl });

    return transport.sendMail({
        from: getMailConfig().from,
        to,
        subject,
        text,
        html,
    });
};

module.exports = {
    isEmailConfigured,
    sendEmailVerificationEmail,
    sendPasswordResetEmail,
};
