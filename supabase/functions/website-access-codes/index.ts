// File purpose: Creates, lists, and checks admin-issued website access numbers.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = new Set(["https://chemar0.github.io"]);
const MAX_REQUEST_BYTES = 4_096;
const encoder = new TextEncoder();

type InviteRow = {
  id: string;
  email: string;
  code_digest: string;
  code_ciphertext: string;
  code_iv: string;
  created_at: string;
  failed_attempts: number;
};

// Request handling: allow the website to call this function, read JSON, and limit request size. CORS means which websites may connect.
function responseHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
}

function jsonResponse(origin: string, payload: Record<string, unknown>, status = 200): Response {
  const headers = responseHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers });
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new TypeError("A JSON request is required.");

  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("A request body is required.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RangeError("The request is too large.");
    }
    chunks.push(value);
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const body: unknown = JSON.parse(new TextDecoder().decode(payload));
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new TypeError("The JSON request must be an object.");
  }
  return body as Record<string, unknown>;
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Protect access numbers: hide or lock codes so they are not saved as readable text. Hash means a one-way code check; encrypt means lock it with a key.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function digestCode(email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${email}\u0000${code}`)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`DHL website access code encryption v1:${SERVICE_ROLE_KEY}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptCode(email: string, code: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(email) },
    await encryptionKey(),
    encoder.encode(code),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decryptCode(email: string, ciphertext: string, iv: string): Promise<string> {
  const cleartext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlToBytes(iv)),
      additionalData: encoder.encode(email),
    },
    await encryptionKey(),
    toArrayBuffer(base64UrlToBytes(ciphertext)),
  );
  return new TextDecoder().decode(cleartext);
}

// These helpers call the database and check admin rights using private server keys.
function serviceHeaders(): Headers {
  return new Headers({
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  });
}

async function rpcManageInvite(args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/manage_website_access_invites`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    console.error("Access invite database operation failed:", response.status);
    throw new Error("The access code could not be saved.");
  }
  return await response.json();
}

async function requireAdmin(request: Request): Promise<{ id: string } | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(5_000),
  });
  if (!authResponse.ok) return null;
  const user = await authResponse.json();
  if (typeof user?.id !== "string") return null;

  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_cart_admin_profile`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(5_000),
  });
  if (!profileResponse.ok) return null;
  const profile = await profileResponse.json();
  if (!Array.isArray(profile) || profile.length === 0) return null;
  return { id: user.id };
}

// Access number tools create, list, and check numbers entered by users.
async function createInvite(email: string, adminId: string): Promise<Record<string, unknown>> {
  const generatedResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ type: "magiclink", email }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!generatedResponse.ok) {
    console.error("Supabase could not generate an access number:", generatedResponse.status);
    throw new Error("Supabase could not generate an access number for that email.");
  }

  const generated = await generatedResponse.json();
  // The raw Auth REST response is flat (email_otp, id); supabase-js wraps
  // those values in properties and user when it normalizes the response.
  const code = generated?.email_otp ?? generated?.properties?.email_otp;
  const userId = generated?.id ?? generated?.user?.id;
  if (typeof code !== "string" || !/^\d{8}$/.test(code) || typeof userId !== "string") {
    console.error("Supabase returned an incomplete access code response.");
    throw new Error("Supabase returned an incomplete access code response.");
  }

  const codeDigest = await digestCode(email, code);
  const encrypted = await encryptCode(email, code);
  const saved = await rpcManageInvite({
    p_action: "issue",
    p_email: email,
    p_user_id: userId,
    p_actor_id: adminId,
    p_code_digest: codeDigest,
    p_code_ciphertext: encrypted.ciphertext,
    p_code_iv: encrypted.iv,
  }) as Record<string, unknown>;

  return {
    id: saved.id,
    email,
    code,
    created_at: new Date().toISOString(),
    failed_attempts: 0,
  };
}

async function listInvites(adminId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await rpcManageInvite({ p_action: "list", p_actor_id: adminId });
  if (!Array.isArray(rows)) return [];
  return await Promise.all((rows as InviteRow[]).map(async (row) => ({
    id: row.id,
    email: row.email,
    code: await decryptCode(row.email, row.code_ciphertext, row.code_iv),
    created_at: row.created_at,
    failed_attempts: row.failed_attempts,
  })));
}

async function redeemCode(email: string, code: string): Promise<Record<string, unknown>> {
  const codeDigest = await digestCode(email, code);
  const check = await rpcManageInvite({
    p_action: "check",
    p_email: email,
    p_code_digest: codeDigest,
  }) as Record<string, unknown>;
  if (check.valid !== true || typeof check.id !== "string" || typeof check.user_id !== "string") {
    throw new Error("That email and access number do not match an active invite.");
  }

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, token: code, type: "magiclink" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!authResponse.ok) {
    throw new Error("That access number has expired or was already used. Ask an administrator to issue a new one.");
  }
  const authResult = await authResponse.json();
  const userId = authResult?.user?.id;
  const verifiedEmail = normalizeEmail(authResult?.user?.email);
  if (userId !== check.user_id || verifiedEmail !== email || typeof authResult.access_token !== "string"
      || typeof authResult.refresh_token !== "string") {
    throw new Error("The access number could not be verified. Ask an administrator to issue a new one.");
  }

  const consumed = await rpcManageInvite({
    p_action: "consume",
    p_invite_id: check.id,
    p_user_id: userId,
    p_code_digest: codeDigest,
  }) as Record<string, unknown>;
  if (consumed.consumed !== true) {
    throw new Error("That access number has already been used. Ask an administrator to issue a new one.");
  }

  return {
    session: {
      access_token: authResult.access_token,
      refresh_token: authResult.refresh_token,
      expires_in: authResult.expires_in,
      token_type: authResult.token_type,
    },
    email,
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response("Forbidden origin.", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: responseHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse(origin, { error: "Method not allowed." }, 405);
  }
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse(origin, { error: "Access code service is not configured." }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonResponse(origin, { error: "Invalid request." }, 400);
  }

  try {
    if (body.action === "redeem") {
      const email = normalizeEmail(body.email);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!validEmail(email) || !/^\d{8}$/.test(code)) {
        return jsonResponse(origin, { error: "Enter the email and eight-digit number from your administrator." }, 400);
      }
      return jsonResponse(origin, await redeemCode(email, code));
    }

    const admin = await requireAdmin(request);
    if (!admin) return jsonResponse(origin, { error: "Cart administrator access required." }, 403);

    if (body.action === "issue") {
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return jsonResponse(origin, { error: "Enter a valid email address." }, 400);
      return jsonResponse(origin, { invite: await createInvite(email, admin.id) });
    }
    if (body.action === "list") {
      return jsonResponse(origin, { invites: await listInvites(admin.id) });
    }
    if (body.action === "revoke") {
      if (typeof body.invite_id !== "string") return jsonResponse(origin, { error: "Select an active access code." }, 400);
      const result = await rpcManageInvite({
        p_action: "revoke",
        p_actor_id: admin.id,
        p_invite_id: body.invite_id,
      }) as Record<string, unknown>;
      if (result.revoked !== true) return jsonResponse(origin, { error: "That access code is no longer active." }, 404);
      return jsonResponse(origin, { revoked: true });
    }
    return jsonResponse(origin, { error: "Unsupported action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Access code service failed.";
    const status = message.includes("administrator access") ? 403 : 400;
    return jsonResponse(origin, { error: message }, status);
  }
});
