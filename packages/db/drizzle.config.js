import { defineConfig } from 'drizzle-kit';
import { getDatabaseFilePath } from './src/config.js';
export default defineConfig({
    schema: './src/schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    dbCredentials: {
        url: getDatabaseFilePath(process.env.DATABASE_URL),
    },
});
