// File purpose: Admin-only Microsoft Graph authorization flow: requests a device code, polls consent, and stores mail-token state through protected database RPCs.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
const SETUP_KEY = Deno.env.get("MICROSOFT_MAIL_SETUP_KEY") ?? "";

// Credential and REST helpers access protected configuration through the Supabase backend.
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
  const headers = new Headers({ apikey: key, "Content-Type": "application/json" });
  if (!key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

// Admin authorization and state persistence keep Graph authorization tokens out of the browser.
async function manageState(
  action: "get" | "set_device" | "clear_device" | "set_refresh",
  options: { deviceCode?: string; expiresAt?: string; refreshToken?: string } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/manage_microsoft_graph_email_state`, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({
      p_action: action,
      p_refresh_token: options.refreshToken ?? null,
      p_device_code: options.deviceCode ?? null,
      p_device_code_expires_at: options.expiresAt ?? null,
    }),
    signal: AbortSignal.timeout(900),
  });
  if (!response.ok) throw new Error("Could not update Microsoft email setup state.");
  const value = await response.json();
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

// Device authorization starts consent and polls until Microsoft approves or denies it.
async function requestDeviceCode(): Promise<Response> {
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: "https://graph.microsoft.com/Mail.Send offline_access",
    }),
    signal: AbortSignal.timeout(1_400),
  });
  const result = await response.json();
  if (!response.ok || typeof result.device_code !== "string") {
    console.error("Microsoft device authorization could not start:", result.error ?? response.status);
    return Response.json({ error: { message: "Microsoft authorization could not be started." } }, { status: 502 });
  }
  const expiresAt = new Date(Date.now() + Number(result.expires_in ?? 900) * 1000).toISOString();
  await manageState("set_device", { deviceCode: result.device_code, expiresAt });
  return Response.json({
    verification_uri: result.verification_uri,
    user_code: result.user_code,
    expires_in: result.expires_in,
    interval: result.interval,
  });
}

async function pollForAuthorization(): Promise<Response> {
  const state = await manageState("get");
  const deviceCode = typeof state.device_code === "string" ? state.device_code : "";
  const expiresAt = typeof state.device_code_expires_at === "string" ? Date.parse(state.device_code_expires_at) : 0;
  if (!deviceCode || expiresAt <= Date.now()) {
    await manageState("clear_device");
    return Response.json({ error: { message: "No active Microsoft authorization is waiting." } }, { status: 404 });
  }

  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    }),
    signal: AbortSignal.timeout(1_400),
  });
  const result = await response.json();
  if (result.error === "authorization_pending" || result.error === "slow_down") {
    return Response.json({ status: "pending" }, { status: 202 });
  }
  if (!response.ok || typeof result.refresh_token !== "string") {
    await manageState("clear_device");
    console.error("Microsoft device authorization failed:", result.error ?? response.status);
    return Response.json({ error: { message: "Microsoft authorization did not complete." } }, { status: 400 });
  }

  await manageState("set_refresh", { refreshToken: result.refresh_token });
  await manageState("clear_device");
  return Response.json({ status: "authorized" });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: { message: "Method not allowed." } }, { status: 405 });
  }
  if (!SUPABASE_URL || !CLIENT_ID || !SETUP_KEY || !getSecretApiKey()) {
    return Response.json({ error: { message: "Microsoft email setup is not configured." } }, { status: 503 });
  }
  if (!constantTimeEqual(request.headers.get("x-setup-key") ?? "", SETUP_KEY)) {
    return Response.json({ error: { message: "Unauthorized." } }, { status: 401 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON request." } }, { status: 400 });
  }

  try {
    if (body.action === "start") return await requestDeviceCode();
    if (body.action === "poll") return await pollForAuthorization();
    return Response.json({ error: { message: "Action must be start or poll." } }, { status: 400 });
  } catch (error) {
    console.error("Microsoft email setup failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: { message: "Microsoft email setup could not be completed." } }, { status: 502 });
  }
});
