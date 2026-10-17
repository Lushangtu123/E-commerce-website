/** Encodes the mailbox and domain separately so the single @ stays a literal separator. */
function mailtoHref(email: string): string {
  const at = email.lastIndexOf('@');
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
}

/** Public merchant contacts are configured at build time; no sample contact is published. */
export function supportContacts() {
  const configuredPhone = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || '';
  const configuredEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || '';
  const digitCount = configuredPhone.replace(/\D/g, '').length;
  const phone = /^\+?[\d ()-]+$/.test(configuredPhone) && digitCount >= 7 && digitCount <= 15 ? configuredPhone : undefined;
  const email = /^[^\s@?&#/]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(configuredEmail) ? configuredEmail : undefined;
  return {
    phone,
    email,
    phoneHref: phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined,
    emailHref: email ? mailtoHref(email) : undefined,
  };
}
