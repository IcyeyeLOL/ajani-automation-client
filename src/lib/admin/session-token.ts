import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

type SessionPayload = {
  exp: number;
  iat: number;
  nonce: string;
  version: 1;
};

export function keysMatch(candidate: string, expected: string) {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function createAdminSessionToken(secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = {
    exp: nowSeconds + ADMIN_SESSION_SECONDS,
    iat: nowSeconds,
    nonce: randomBytes(16).toString("base64url"),
    version: 1,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyAdminSessionToken(token: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token) return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    return payload.version === 1
      && typeof payload.iat === "number"
      && typeof payload.exp === "number"
      && payload.iat <= nowSeconds + 60
      && payload.exp > nowSeconds
      && payload.exp - payload.iat === ADMIN_SESSION_SECONDS;
  } catch {
    return false;
  }
}

