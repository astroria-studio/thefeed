/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly EDITION: 'global' | 'vn';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
