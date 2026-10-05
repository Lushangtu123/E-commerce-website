// Single source for the published contact details (placeholders until real ones exist).
export const SUPPORT_PHONE = '400-123-4567';
export const SUPPORT_EMAIL = 'service@example.com';
export const supportPhoneHref = `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`;
export const supportEmailHref = `mailto:${SUPPORT_EMAIL}`;
