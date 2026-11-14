import { existsSync } from 'node:fs';
// Imported before modules derive configuration. Existing process environment takes precedence.
if (existsSync('.env')) process.loadEnvFile('.env');
