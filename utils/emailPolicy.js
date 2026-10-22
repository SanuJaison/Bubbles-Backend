const { normalizeEmail } = require("./validation");

// Reserved/test domains that should never be accepted for a real account.
const TEST_DOMAINS = new Set([
    "example.com",
    "example.net",
    "example.org",
    "example.edu",
    "test.com",
    "test.net",
    "test.org",
    "invalid",
    "localhost",
    "local",
]);

// Common temporary-mail providers. The list intentionally focuses on the
// services people use for throwaway accounts; email verification remains the
// real gate because a domain list can never be exhaustive.
const DISPOSABLE_DOMAINS = new Set([
    "10minutemail.com",
    "10minutemail.net",
    "20minutemail.com",
    "33mail.com",
    "anonbox.net",
    "burnermail.io",
    "cock.li",
    "discard.email",
    "dispostable.com",
    "dropmail.me",
    "emailfake.com",
    "emailnator.com",
    "emailondeck.com",
    "fakeinbox.com",
    "generator.email",
    "getairmail.com",
    "getnada.com",
    "guerrillamail.biz",
    "guerrillamail.com",
    "guerrillamail.de",
    "guerrillamail.info",
    "guerrillamail.net",
    "guerrillamail.org",
    "guerrillamailblock.com",
    "harakirimail.com",
    "inboxkitten.com",
    "jetable.org",
    "mailcatch.com",
    "maildrop.cc",
    "mailforspam.com",
    "mailinator.com",
    "mailinator.net",
    "mailnesia.com",
    "mailsac.com",
    "mailslurp.com",
    "mail.tm",
    "mail.gw",
    "mintemail.com",
    "moakt.com",
    "mohmal.com",
    "mohmal.im",
    "mytemp.email",
    "nada.email",
    "sharklasers.com",
    "spam4.me",
    "spamgourmet.com",
    "tempail.com",
    "tempinbox.com",
    "temp-mail.io",
    "temp-mail.org",
    "tempmail.com",
    "tempmail.net",
    "tempmail.plus",
    "tempmailo.com",
    "tempr.email",
    "throwawaymail.com",
    "trashmail.com",
    "trashmail.de",
    "trashymail.com",
    "wegwerfmail.de",
    "willselfdestruct.com",
    "yopmail.com",
    "yopmail.fr",
    "yopmail.net",
    "zehnminuten.de",
    "zippymail.info",
    "zoemail.org",
]);

const BLOCKED_TLDS = new Set(["test", "invalid", "example", "localhost", "local"]);

const DISALLOWED_EMAIL_MESSAGE =
    "Use a permanent email address. Disposable or temporary email addresses aren't allowed.";

const getExtraDomains = () =>
    new Set(
        String(process.env.BLOCKED_EMAIL_DOMAINS || "")
            .split(",")
            .map((domain) =>
                domain.trim().toLowerCase().replace(/^@/, "").replace(/\.+$/, "")
            )
            .filter(Boolean)
    );

const getEmailDomain = (email) => {
    const normalized = normalizeEmail(email);
    const atIndex = normalized.lastIndexOf("@");

    if (atIndex === -1) {
        return "";
    }

    return normalized.slice(atIndex + 1).replace(/\.+$/, "");
};

// Checking every parent domain catches subdomains such as
// anything.mailinator.com while still allowing lookalikes like
// mailinator.com.example.org.
const matchesDomainSet = (domain, domains) => {
    const labels = domain.split(".");

    for (let index = 0; index < labels.length; index += 1) {
        if (domains.has(labels.slice(index).join("."))) {
            return true;
        }
    }

    return false;
};

const isDisallowedEmail = (email) => {
    const domain = getEmailDomain(email);

    if (!domain || !domain.includes(".")) {
        return true;
    }

    const tld = domain.split(".").pop();

    if (BLOCKED_TLDS.has(tld)) {
        return true;
    }

    if (matchesDomainSet(domain, TEST_DOMAINS)) {
        return true;
    }

    if (matchesDomainSet(domain, DISPOSABLE_DOMAINS)) {
        return true;
    }

    return matchesDomainSet(domain, getExtraDomains());
};

module.exports = {
    DISALLOWED_EMAIL_MESSAGE,
    isDisallowedEmail,
};
