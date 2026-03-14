/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'development' | 'test_e2e' | 'production';
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// SVG imports with ?react query — vite-plugin-svgr transforms these into React components
declare module '*.svg?react' {
  import type { ComponentType, SVGProps } from 'react';
  const component: ComponentType<SVGProps<SVGSVGElement>>;
  export default component;
}

// Absolute /node_modules/ paths used for USWDS icon imports
declare module '/node_modules/@uswds/uswds/dist/img/usa-icons/*.svg?react' {
  import type { ComponentType, SVGProps } from 'react';
  const component: ComponentType<SVGProps<SVGSVGElement>>;
  export default component;
}
