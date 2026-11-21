/**
 * Sends email through Brevo's HTTPS API (free plan: 300 emails a day).
 * Needs:
 *   BREVO_API_KEY   an API key from the Brevo dashboard
 *   MAIL_FROM       a sender address verified in Brevo
 *   MAIL_FROM_NAME  optional display name (default "PalsChat")
 * If they are missing, mail is simply not sent and the caller is told.
 */
const logger = require("./logger");

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

const isMailConfigured = (env = process.env) => Boolean(env.BREVO_API_KEY && env.MAIL_FROM);

/** Returns true when the provider accepted the message, false when mail is not set up. */
const sendMail = async ({ to, subject, text, html }, env = process.env, fetchImpl = fetch) => {
  if (!isMailConfigured(env)) {
    logger.warn("Email is not configured (BREVO_API_KEY / MAIL_FROM); message not sent.");
    return false;
  }
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "PalsChat" },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Email provider answered ${res.status}`);
  }
  return true;
};

module.exports = { sendMail, isMailConfigured };
