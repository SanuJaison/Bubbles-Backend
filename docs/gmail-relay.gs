/**
 * Bubbles Gmail relay (Google Apps Script)
 * ----------------------------------------
 * Free alternative to Brevo/SMTP on Render's free plan. Render blocks outbound
 * SMTP ports (25/465/587), but it can call this HTTPS endpoint, which sends the
 * mail through the Gmail account that owns the script.
 *
 * SETUP (about 3 minutes, no domain, no card)
 * 1. Open https://script.google.com -> New project.
 * 2. Replace the contents of Code.gs with this file and save.
 * 3. Edit the SECRET value below to any long random string.
 * 4. Deploy -> New deployment -> type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the /exec URL it gives you.
 * 5. On Render (backend service -> Environment) add:
 *      GAS_MAIL_URL     = the /exec URL
 *      GAS_MAIL_SECRET  = the same secret you put in SECRET
 *      GAS_SENDER_EMAIL = your Gmail address (optional; defaults to SMTP_USER)
 *    Save, which redeploys the backend.
 *
 * Free Gmail accounts can send to 100 recipients per day through MailApp,
 * which is plenty for verification and password-reset mail.
 *
 * If you change SECRET later, redeploy a new version (Deploy -> Manage
 * deployments -> Edit -> New version).
 */

var SECRET = "change-me-to-a-long-random-string";

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (!SECRET || body.secret !== SECRET) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: "unauthorized" }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var to = String(body.to || "").trim();
    var subject = String(body.subject || "").trim();

    if (!to || !subject) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: "missing to/subject" }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var options = {
      htmlBody: String(body.html || body.text || ""),
      name: String(body.fromName || "Bubbles"),
    };

    // Replies go to the person who triggered the email (feedback form).
    if (body.replyTo) {
      options.replyTo = String(body.replyTo);
    }

    MailApp.sendEmail(to, subject, String(body.text || ""), options);

    return ContentService.createTextOutput(
      JSON.stringify({ ok: true }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(error) }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
