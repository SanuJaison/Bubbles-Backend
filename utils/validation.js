const USERNAME_PATTERN = /^[a-z0-9._]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/g;

const asTrimmedString = (value) =>
    typeof value === "string" ? value.trim() : "";

const stripControlChars = (value) =>
    asTrimmedString(value).replace(CONTROL_CHARS_PATTERN, "");

const normalizeUsername = (value) =>
    asTrimmedString(value).toLowerCase();

const normalizeEmail = (value) =>
    asTrimmedString(value).toLowerCase();

const isValidUsername = (value) =>
    USERNAME_PATTERN.test(normalizeUsername(value));

const isValidEmail = (value) =>
    EMAIL_PATTERN.test(normalizeEmail(value)) &&
    normalizeEmail(value).length <= 254;

const getPasswordProblem = (value) => {
    const password = typeof value === "string" ? value : "";

    if (password.length < 8) {
        return "Password must be at least 8 characters";
    }

    if (password.length > 128) {
        return "Password must be 128 characters or fewer";
    }

    if (!/[a-z]/i.test(password) || !/[0-9]/.test(password)) {
        return "Password must include at least one letter and one number";
    }

    return "";
};

const isValidHttpUrl = (value) => {
    if (typeof value !== "string" || value.length > 2048) {
        return false;
    }

    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
};

module.exports = {
    asTrimmedString,
    stripControlChars,
    normalizeUsername,
    normalizeEmail,
    isValidUsername,
    isValidEmail,
    getPasswordProblem,
    isValidHttpUrl,
};
