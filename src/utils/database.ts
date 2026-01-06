import postgres from 'postgres'
import fs from 'fs'
import path from 'path'
import { config } from './config.ts';

async function runMigrations(sql: postgres.Sql<any>) {
    const migration = fs.readFileSync(path.join('sql', 'schema.sql'));
    await sql.unsafe(migration.toString());
}


const sql = postgres({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    onnotice: () => void 0,
    max: 75,
    types: {
        date: {
            to: 1184,
            from: [1082, 1114, 1184],
            serialize: (x: string | Date) => (x instanceof Date ? x : new Date(x)).toISOString(),
            parse: (x: string) => new Date(x + (x.includes('+') ? '' : 'Z'))
        }
    }
});

// Run schema
await runMigrations(sql);

export default sql