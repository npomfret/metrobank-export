import fs from 'node:fs';
import { MetroBankApi, parseCurl } from './api';

// Dumps API responses for entitlements and accounts.
// Usage: npm run discover

const curlFile = process.argv[2] ?? 'curl.txt';
const curlText = fs.readFileSync(curlFile, 'utf8');
const auth = parseCurl(curlText);
const api = new MetroBankApi(auth);

async function main() {
    console.log('--- /customer/entitlements ---');
    const { entities } = await api.getEntitlements();
    console.log(JSON.stringify(entities, null, 2));

    for (const entity of entities) {
        console.log(`\n--- /accounts (${entity.entityName}, entityId: ${entity.entityId}) ---`);
        const { accounts } = await api.getAccounts(entity.entityId);
        for (const acct of accounts) {
            console.log(`  ${acct.accountName} — ${acct.currencyCode} — accountId: ${acct.accountId}`);
        }
    }
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
