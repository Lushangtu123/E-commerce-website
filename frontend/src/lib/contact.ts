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
    emailHref: email ? `mailto:${encodeURIComponent(email).replace('%40', '@')}` : undefined,
  };
}
