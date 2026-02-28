import en from '../i18n/en.json';
import vi from '../i18n/vi.json';

type Translations = typeof en;

const translations: Record<string, Translations> = { en, vi };

export function getEdition(): 'global' | 'vn' {
  return (import.meta.env.EDITION || 'global') as 'global' | 'vn';
}

export function getLang(): 'en' | 'vi' {
  return getEdition() === 'vn' ? 'vi' : 'en';
}

export function t(key: string): string {
  const lang = getLang();
  const keys = key.split('.');
  let value: unknown = translations[lang];

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }

  return typeof value === 'string' ? value : key;
}

export function getTranslations(): Translations {
  return translations[getLang()];
}
