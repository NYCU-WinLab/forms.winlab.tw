export function getAdminAllowlist() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdmin(email: string | null | undefined) {
  if (!email) return false;
  return getAdminAllowlist().includes(email.toLowerCase());
}
