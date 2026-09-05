import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../../recoverflow.db');
const db = new Database(dbPath);
export function setupDatabase() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    const policyPath = path.join(__dirname, '../../policy.config.json');
    const policyJson = fs.readFileSync(policyPath, 'utf-8');
    const insertPolicy = db.prepare(`
    INSERT INTO policy_config (id, config_json)
    VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json
  `);
    insertPolicy.run(policyJson);
    console.log('Database schema applied and policy loaded.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    setupDatabase();
}
//# sourceMappingURL=setup.js.map