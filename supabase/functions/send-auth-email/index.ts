// File purpose: Sends account sign-in and verification emails through Microsoft; builds the message and keeps private values out of the browser.

import { Webhook } from "standardwebhooks";

type AuthEvent = {
  user?: {
    email?: string;
    new_email?: string;
  };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
    old_email?: string;
  };
};

type MicrosoftTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
// Private settings and the sender address come from the server settings.
const SENDER_EMAIL = (Deno.env.get("MICROSOFT_SENDER_EMAIL") ?? "").toLowerCase();
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";

let cachedRefreshToken: string | null = null;
let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

// These helpers get and renew the Microsoft email sign-in token. Token means a temporary access key.
function getSecretApiKey(): string {
  const secretsJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretsJson) {
    try {
      const secrets = JSON.parse(secretsJson) as Record<string, string>;
      if (secrets.default) return secrets.default;
    } catch {
      // Fall through to the legacy key if the JSON env var is unavailable.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function supabaseHeaders(): Headers {
  const key = getSecretApiKey();
  const headers = new Headers({
    apikey: key,
    "Content-Type": "application/json",
  });
  if (!key.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${key}`);
  }
  return headers;
}

async function manageStoredToken(
  action: "get" | "set_refresh",
  refreshToken?: string,
): Promise<{ refresh_token?: string | null }> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/manage_microsoft_graph_email_state`;
  const response = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({
      p_action: action,
      p_refresh_token: refreshToken ?? null,
      p_device_code: null,
      p_device_code_expires_at: null,
    }),
    signal: AbortSignal.timeout(650),
  });
  if (!response.ok) throw new Error("Could not access the email authorization state.");
  const value = await response.json();
  return typeof value === "object" && value !== null ? value : {};
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  if (!cachedRefreshToken) {
    const state = await manageStoredToken("get");
    if (typeof state.refresh_token === "string" && state.refresh_token) {
      cachedRefreshToken = state.refresh_token;
    }
  }
  if (!cachedRefreshToken) throw new Error("Microsoft email authorization is not configured.");

  const form = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: cachedRefreshToken,
    scope: "https://graph.microsoft.com/Mail.Send offline_access",
  });
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(1_200),
  });
  const tokenResult = await response.json() as MicrosoftTokenResponse;
  if (!response.ok || !tokenResult.access_token) {
    console.error("Microsoft token refresh failed:", tokenResult.error ?? response.status);
    throw new Error("Microsoft email authorization needs to be renewed.");
  }

  cachedAccessToken = tokenResult.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, tokenResult.expires_in ?? 3600) * 1000;

  if (tokenResult.refresh_token && tokenResult.refresh_token !== cachedRefreshToken) {
    cachedRefreshToken = tokenResult.refresh_token;
    try {
      await manageStoredToken("set_refresh", cachedRefreshToken);
    } catch {
      // Keep this message send successful; Microsoft does not revoke the old token on refresh.
      console.error("Could not persist the rotated Microsoft refresh token.");
    }
  }

  return cachedAccessToken;
}

// Clean user-provided text before adding it to an email so it cannot change the message layout.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    signup: "Confirm your email address",
    magiclink: "Your sign-in link",
    invite: "Your website invitation",
    recovery: "Reset your password",
    email_change: "Confirm your email change",
    reauthentication: "Your verification code",
    password_changed_notification: "Password changed",
    email_changed_notification: "Email address changed",
    phone_changed_notification: "Phone number changed",
    identity_linked_notification: "Sign-in method linked",
    identity_unlinked_notification: "Sign-in method removed",
    mfa_factor_enrolled_notification: "Multi-factor authentication enabled",
    mfa_factor_unenrolled_notification: "Multi-factor authentication changed",
  };
  return labels[action] ?? "Your DHL Parts website account";
}

function verificationUrl(tokenHash: string, action: string, redirectTo: string): string {
  const url = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", action);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function messageHtml(subject: string, link?: string, token?: string): string {
  const safeSubject = escapeHtml(subject);
  const code = token ? `<p><strong>Verification code: ${escapeHtml(token)}</strong></p>` : "";
  const button = link
    ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px">${safeSubject}</a></p><p>If the button does not work, copy and paste this link into your browser:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#222"><h2>${safeSubject}</h2>${button}${code}<p>If you did not request this, you can ignore this email.</p></div>`;
}

// Send the finished sign-in email through Microsoft.
async function sendGraphMessage(
  accessToken: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        replyTo: [{ emailAddress: { address: SENDER_EMAIL } }],
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(1_700),
  });
  if (response.status !== 202) {
    console.error("Microsoft Graph sendMail failed:", response.status);
    throw new Error("Microsoft could not send the authentication email.");
  }
}

// Choose the right email and check link for each account action.
function createMessages(event: AuthEvent): Array<{ to: string; subject: string; html: string }> {
  const user = event.user;
  const data = event.email_data;
  const action = data?.email_action_type ?? "";
  const redirectTo = data?.redirect_to ?? data?.site_url ?? "https://chemar0.github.io/DHL/";
  const subject = actionLabel(action);
  if (!user) throw new Error("The authentication email payload has no user.");

  if (action === "email_change" && user.new_email && data?.token_hash_new && data?.token_new) {
    const messages = [];
    if (user.email && data.token) {
      messages.push({
        to: user.email,
        subject: "Confirm this email address change",
        html: messageHtml("Confirm this email address change", verificationUrl(data.token_hash_new, action, redirectTo), data.token),
      });
    }
    messages.push({
      to: user.new_email,
      subject,
      html: messageHtml(subject, verificationUrl(data.token_hash, action, redirectTo), data.token_new),
    });
    return messages;
  }

  const to = action === "email_change" && user.new_email ? user.new_email : user.email;
  if (!to) throw new Error("The authentication email payload has no recipient.");
  const link = data?.token_hash
    ? verificationUrl(data.token_hash, action || "magiclink", redirectTo)
    : undefined;
  return [{ to, subject, html: messageHtml(subject, link, data?.token) }];
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: { message: "Method not allowed." } }, { status: 405 });
  }
  if (!HOOK_SECRET || !SUPABASE_URL || !CLIENT_ID || !SENDER_EMAIL || !getSecretApiKey()) {
    return Response.json({ error: { message: "Email delivery is not configured yet." } }, { status: 503 });
  }

  const payload = await request.text();
  if (payload.length > 20_000) {
    return Response.json({ error: { message: "The email request is too large." } }, { status: 413 });
  }

  let event: AuthEvent;
  try {
    const normalizedSecret = HOOK_SECRET.replace(/^v1,whsec_/, "");
    const webhook = new Webhook(normalizedSecret);
    event = webhook.verify(payload, Object.fromEntries(request.headers)) as AuthEvent;
  } catch {
    return Response.json({ error: { message: "The authentication hook signature is invalid." } }, { status: 401 });
  }

  try {
    const messages = createMessages(event);
    const accessToken = await getAccessToken();
    for (const message of messages) {
      await sendGraphMessage(accessToken, message.to, message.subject, message.html);
    }
    return Response.json({});
  } catch (error) {
    console.error("Authentication email send failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: { message: "The authentication email could not be sent." } }, { status: 502 });
  }
});
