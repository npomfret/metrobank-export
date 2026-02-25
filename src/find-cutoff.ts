import fs from 'node:fs';
import os from 'node:os';
import { parseCurl, MetroBankApi } from './api';
import { SyncConfig } from './types';

// Finds the earliest month available for both transactions and PDF statements.
// Usage: npm run find-cutoff

function resolvePath(p: string): string {
  if (p.startsWith('~/')) return os.homedir() + p.slice(1);
  if (p === '~') return os.homedir();
  return p;
}

const configPath = resolvePath(process.argv[2] ?? 'config.json');
const config: SyncConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const curlText = fs.readFileSync(resolvePath(config.curlFile), 'utf8');
const auth = parseCurl(curlText);
const api = new MetroBankApi(auth);

function formatYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(d: Date): string {
  return `${formatYYYYMM(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthToDate(m: number): Date {
  return new Date(Math.floor(m / 12), m % 12, 1);
}

async function testTransactionMonth(entityId: string, accountId: string, currencyCode: string, date: Date): Promise<boolean> {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  try {
    await api.downloadTransactions({
      accountId,
      currencyCode,
      transactionStartDate: formatDate(start),
      transactionEndDate: formatDate(end),
      entityId,
    });
    return true;
  } catch {
    return false;
  }
}

async function findTransactionCutoff(entityId: string, accountId: string, currencyCode: string, lo: number, hi: number): Promise<Date> {
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const date = monthToDate(mid);

    process.stdout.write(`  Testing ${formatYYYYMM(date)}... `);
    const ok = await testTransactionMonth(entityId, accountId, currencyCode, date);
    console.log(ok ? 'OK' : 'FAILED');

    if (ok) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return monthToDate(lo);
}

async function findStatementCutoff(entityId: string, accountId: string): Promise<Date | null> {
  console.log('  Fetching document list...');
  try {
    const { documentsList } = await api.listDocuments(entityId, accountId);
    const statements = documentsList.filter(d => d.documentType === 'monthlyStatement');
    if (statements.length === 0) return null;

    const earliest = statements[statements.length - 1];
    const date = new Date(`02 ${earliest.monthYear}`);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  } catch (err) {
    console.log(`  Failed: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  console.log('Discovering accounts...');
  const accountNames = config.accounts.map(a => a.name);
  const accounts = await api.discoverAccounts(accountNames);

  const now = new Date();
  const lo = (now.getFullYear() - 10) * 12 + now.getMonth();
  const hi = now.getFullYear() * 12 + (now.getMonth() - 1);

  for (const { entityId, accountId, accountName, currencyCode } of accounts) {
    console.log(`\n=== ${accountName} (${currencyCode}, ${accountId}) ===\n`);

    console.log('Transactions:');
    const txCutoff = await findTransactionCutoff(entityId, accountId, currencyCode, lo, hi);
    console.log(`  Earliest: ${formatYYYYMM(txCutoff)}\n`);

    console.log('PDF Statements:');
    const pdfCutoff = await findStatementCutoff(entityId, accountId);
    if (pdfCutoff) {
      console.log(`  Earliest: ${formatYYYYMM(pdfCutoff)}\n`);
    } else {
      console.log('  Could not determine\n');
    }

    const overall = pdfCutoff && pdfCutoff < txCutoff ? pdfCutoff : txCutoff;
    console.log(`Suggested cutoffDate: "${formatYYYYMM(overall)}"`);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
