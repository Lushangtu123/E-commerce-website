import { registerTranslations } from '@/lib/i18n';
import { adminTranslations } from '@/lib/admin-translations';

// Imported for its effect by every admin page and admin-only component, so the storefront
// bundle does not carry the admin dictionary.
registerTranslations(adminTranslations);
