export interface AdminAuditMetadata {
  ip?: string;
  userAgent?: string;
}

/** VARCHAR limits count database characters, so keep Unicode code points intact. */
export function normalizeAdminAuditMetadata({ ip, userAgent }: AdminAuditMetadata) {
  const bounded = (value: string | undefined, maximum: number) =>
    value ? Array.from(value).slice(0, maximum).join('') : null;
  return { ip: bounded(ip, 50), userAgent: bounded(userAgent, 500) };
}
