/** Test di integrazione: richiedono PostgreSQL e Gotenberg (vedi docker-compose.test.yml). */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  testTimeout: 120000,
};
