import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextCoreWebVitals,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'warn',
      'import/no-anonymous-default-export': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn'
    }
  },
  {
    files: ['src/**/*.example.tsx', 'src/pages/dev-config.tsx'],
    rules: {
      'react-hooks/purity': 'off'
    }
  },
  {
    files: [
      'src/components/ErrorDisplay.tsx',
      'src/components/OfflineIndicator.tsx',
      'src/components/QRDisplay.tsx',
      'src/hooks/useOnlineStatus.ts'
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off'
    }
  }
];
