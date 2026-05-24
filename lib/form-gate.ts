import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const TTL_SECONDS = 24 * 60 * 60;

function getSecret() {
  const raw = process.env.FORM_GATE_SECRET;
  if (!raw) throw new Error("FORM_GATE_SECRET not set");
  return new TextEncoder().encode(raw);
}

export function cookieName(formId: string) {
  return `form_gate_${formId}`;
}

export async function signGateToken(formId: string) {
  return new SignJWT({ form_id: formId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyGateToken(token: string, expectedFormId: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    if (payload.form_id !== expectedFormId) return false;
    return true;
  } catch {
    return false;
  }
}

export const GATE_COOKIE_TTL_SECONDS = TTL_SECONDS;
