/** Test unitari: nessuna rete, nessun database. Gli adapter girano contro le fixture in tests/fixtures. */

// Dipendenze transitive di sanitize-html pubblicate solo come ES module: Node le carica da sé,
// Jest ha bisogno che vengano trasformate in CommonJS.
const ESM_PACKAGES = ['htmlparser2', 'domhandler', 'domutils', 'dom-serializer', 'domelementtype', 'entities'];

module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    '^.+\\.m?js$': [
      'ts-jest',
      {
        tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022', esModuleInterop: true },
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: [`node_modules/(?!\\.pnpm|${ESM_PACKAGES.join('|')})`],
  moduleNameMapper: {
    '^@jobagg/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
};
