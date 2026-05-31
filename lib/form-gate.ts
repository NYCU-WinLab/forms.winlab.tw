import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
// 2 hours: short enough that lost cookies expire fast, long enough not to
// interrupt an in-progress interview. Per-form access_code rotation invalidates
// any outstanding tokens immediately via the version check.
const TTL_SECONDS = 2 * 60 * 60;

function getSecret() {
  const raw = process.env.FORM_GATE_SECRET;
  if (!raw) throw new Error("FORM_GATE_SECRET not set");
  // HS256 security rests entirely on this secret's entropy; a short or
  // guessable value lets an attacker forge a gate token for any form. Require
  // >= 32 chars (the documented `openssl rand -base64 32` yields 44).
  if (raw.length < 32) {
    throw new Error("FORM_GATE_SECRET too weak — require >= 32 chars");
  }
  return new TextEncoder().encode(raw);
}

export function cookieName(formId: string) {
  return `form_gate_${formId}`;
}

export async function signGateToken(formId: string, accessCodeVersion: number) {
  return new SignJWT({ form_id: formId, v: accessCodeVersion })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

export interface GatePayload {
  form_id: string;
  v: number;
}

export async function verifyGateToken(
  token: string,
  expectedFormId: string,
  expectedVersion: number,
): Promise<GatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    if (payload.form_id !== expectedFormId) return null;
    if (typeof payload.v !== "number" || payload.v !== expectedVersion) return null;
    return { form_id: payload.form_id, v: payload.v };
  } catch {
    return null;
  }
}

export const GATE_COOKIE_TTL_SECONDS = TTL_SECONDS;
