const nodemailer = require("nodemailer");

let cachedTransport = null;
let cachedConfigKey = "";

const parseAddress = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/<([^>]+)>/);

    return match ? match[1].trim() : text;
};

const parseSenderName = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/^(.*?)<[^>]+>$/);
    const name = match ? match[1].trim().replace(/^"|"$/g, "") : "";

    return name || "Bubbles";
};

// Google Apps Script relay: a tiny web app deployed from a Gmail account can
// send mail with MailApp over HTTPS. Render blocks SMTP ports, but this keeps
// working on the free plan and needs no domain or paid provider.
const getGasConfig = () => {
    const url = (process.env.GAS_MAIL_URL || "").trim();
    const secret = (process.env.GAS_MAIL_SECRET || "").trim();
    const rawFrom = (
        process.env.GAS_SENDER_EMAIL ||
        process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        ""
    ).trim();
    const fromEmail = parseAddress(rawFrom);
    const fromName =
        (process.env.GAS_SENDER_NAME || "").trim() || parseSenderName(rawFrom);

    return { url, secret, fromEmail, fromName };
};

const isGasConfigured = () => Boolean(getGasConfig().url);

// Brevo's HTTPS API is an alternative HTTPS path: free Render web services
// block outbound SMTP ports, but HTTPS keeps working. SMTP stays as a fallback
// so local development and paid hosts behave exactly as before.
const getBrevoConfig = () => {
    const apiKey = (process.env.BREVO_API_KEY || "").trim();
    const rawFrom = (
        process.env.BREVO_SENDER_EMAIL ||
        process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        ""
    ).trim();
    const fromEmail = parseAddress(rawFrom);
    const fromName =
        (process.env.BREVO_SENDER_NAME || "").trim() ||
        parseSenderName(rawFrom);

    return { apiKey, fromEmail, fromName };
};

const isBrevoConfigured = () => {
    const config = getBrevoConfig();

    return Boolean(config.apiKey && config.fromEmail);
};

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
    if (isGasConfigured() || isBrevoConfigured()) {
        return true;
    }

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

const sendViaGas = async ({ to, subject, text, html, replyTo }) => {
    const config = getGasConfig();

    const response = await fetch(config.url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json",
        },
        body: JSON.stringify({
            secret: config.secret,
            to,
            subject,
            text,
            html,
            fromEmail: config.fromEmail,
            fromName: config.fromName,
            replyTo: replyTo || "",
        }),
        redirect: "follow",
    });

    const raw = await response.text();

    if (!response.ok || !/"ok"\s*:\s*true/.test(raw)) {
        const sendError = new Error(
            `The Gmail relay rejected the email (${response.status}). ${raw.slice(0, 300)}`.trim()
        );
        sendError.code = "EMAIL_SEND_FAILED";
        throw sendError;
    }

    return { sent: true, provider: "gmail-apps-script" };
};

const sendViaBrevo = async ({ to, subject, text, html, replyTo }) => {
    const config = getBrevoConfig();

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "api-key": config.apiKey,
            "content-type": "application/json",
            accept: "application/json",
        },
        body: JSON.stringify({
            sender: {
                name: config.fromName,
                email: config.fromEmail,
            },
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text,
            ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        }),
    });

    if (!response.ok) {
        let detail = "";

        try {
            detail = JSON.stringify(await response.json());
        } catch (error) {
            detail = "";
        }

        const sendError = new Error(
            `Brevo rejected the email (${response.status}). ${detail}`.trim()
        );
        sendError.code = "EMAIL_SEND_FAILED";
        throw sendError;
    }

    return { sent: true, provider: "brevo" };
};

const deliverEmail = async ({ to, subject, text, html, replyTo }) => {
    if (isGasConfigured()) {
        return sendViaGas({ to, subject, text, html, replyTo });
    }

    if (isBrevoConfigured()) {
        return sendViaBrevo({ to, subject, text, html, replyTo });
    }

    const transport = getTransport();

    if (!transport) {
        const error = new Error(
            "Email is not configured. Add GAS_MAIL_URL (Gmail relay) or the SMTP settings to the backend .env file."
        );
        error.code = "EMAIL_NOT_CONFIGURED";
        throw error;
    }

    return transport.sendMail({
        from: getMailConfig().from,
        to,
        subject,
        text,
        html,
        replyTo: replyTo || undefined,
    });
};

const sendEmailVerificationEmail = async ({
    to,
    name,
    verifyUrl,
    expiresMinutes,
}) => {
    const { subject, text, html } = buildEmailVerificationEmail({
        name,
        verifyUrl,
        expiresMinutes,
    });

    return deliverEmail({ to, subject, text, html });
};

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
    const { subject, text, html } = buildPasswordResetEmail({ name, resetUrl });

    return deliverEmail({ to, subject, text, html });
};

const FEEDBACK_CATEGORY_LABELS = {
    suggestion: "Suggestion",
    bug: "Bug report",
    feature: "Feature idea",
    other: "Something else",
};

const FEEDBACK_SOURCE_LABELS = {
    web: "Web",
    android: "Android",
    windows: "Windows",
};

const buildFeedbackNotificationEmail = ({
    name,
    email,
    category,
    message,
    page,
    source,
    createdAt,
}) => {
    const categoryLabel = FEEDBACK_CATEGORY_LABELS[category] || "Feedback";
    const sourceLabel = FEEDBACK_SOURCE_LABELS[source] || "Web";
    const safeName = escapeHtml(name || "Anonymous");
    const safeEmail = escapeHtml(email || "Not provided");
    const safeMessage = escapeHtml(message);
    const safePage = escapeHtml(page || "Not provided");
    const received = createdAt
        ? new Date(createdAt).toISOString()
        : new Date().toISOString();

    const text = [
        "New Bubbles feedback",
        "",
        `Category: ${categoryLabel}`,
        `From: ${name || "Anonymous"}${email ? ` <${email}>` : ""}`,
        `Page: ${page || "Not provided"}`,
        `Source: ${sourceLabel}`,
        `Received: ${received}`,
        "",
        "Message:",
        message,
        "",
        email
            ? "Reply directly to this email to follow up with the sender."
            : "The sender did not leave an email address.",
        "",
        "— Bubbles",
    ].join("\n");

    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f1ff;font-family:Arial,Helvetica,sans-serif;color:#2b2440;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1ff;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px -16px rgba(109,74,224,0.35);">
            <tr>
              <td style="height:8px;background:#6d4ae0;background-image:linear-gradient(90deg,#6d4ae0,#a855f7,#e8659b,#f5917a);"></td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;">
                <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#6d4ae0;">Bubbles</div>
                <div style="font-size:13px;color:#7c7895;margin-top:4px;">New feedback from the website</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px;">
                <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#2b2440;">${escapeHtml(categoryLabel)}</h1>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4a4560;"><strong style="color:#2b2440;">From:</strong> ${safeName}${email ? ` &lt;${safeEmail}&gt;` : ""}</p>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4a4560;"><strong style="color:#2b2440;">Page:</strong> ${safePage}</p>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4a4560;"><strong style="color:#2b2440;">Source:</strong> ${escapeHtml(sourceLabel)}</p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#4a4560;"><strong style="color:#2b2440;">Received:</strong> ${escapeHtml(received)}</p>
                <div style="border:1px solid #ece2ff;border-radius:16px;background:#faf7ff;padding:16px 18px;font-size:15px;line-height:1.7;color:#2b2440;white-space:pre-wrap;">${safeMessage}</div>
                <p style="margin:18px 0 24px;font-size:13px;line-height:1.6;color:#7c7895;">
                  ${
                      email
                          ? "Reply directly to this email to follow up with the sender."
                          : "The sender did not leave an email address."
                  }
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px;border-top:1px solid #ece2ff;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9a95ad;">
                  Sent from the Bubbles feedback form.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    return {
        subject: `New Bubbles feedback: ${categoryLabel}`,
        text,
        html,
    };
};

const sendFeedbackNotificationEmail = async (feedback) => {
    const to = (
        process.env.FEEDBACK_EMAIL ||
        process.env.SMTP_USER ||
        ""
    ).trim();

    if (!isEmailConfigured() || !to) {
        return { sent: false };
    }

    const { subject, text, html } = buildFeedbackNotificationEmail(feedback);

    return deliverEmail({
        to,
        subject,
        text,
        html,
        replyTo: feedback.email || undefined,
    });
};

module.exports = {
    isEmailConfigured,
    sendEmailVerificationEmail,
    sendPasswordResetEmail,
    sendFeedbackNotificationEmail,
};
