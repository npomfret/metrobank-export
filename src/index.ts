import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCurl, MetroBankApi } from './api';
import { Account, SyncConfig } from './types';

function resolvePath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
}

const RATE_LIMIT_MS = 1000;
const DEFAULT_MAX_HISTORY_YEARS = 5;

// --- Date helpers ---

function formatYYYYMM(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatYYYYMMDD(date: Date): string {
  return `${formatYYYYMM(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

function endOfMonth(date: Date): Date {
  // Day 0 of next month = last day of this month
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function parseMonthYear(monthYear: string): Date {
  // API returns e.g. "Sep 2024"
  const date = new Date(`02 ${monthYear}`);
  if (isNaN(date.getTime())) throw new Error(`Cannot parse monthYear: "${monthYear}"`);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Sync logic ---

async function syncPdfs(api: MetroBankApi, accounts: Account[], outputDir: string, cutoff: Date, force: boolean) {
  const currentMonth = formatYYYYMM(new Date());
  const cutoffMonth = formatYYYYMM(cutoff);

  for (const { entityId, accountId, accountName, currencyCode } of accounts) {
    const dir = path.join(outputDir, 'statements', currencyCode);
    fs.mkdirSync(dir, { recursive: true });

    console.log(`Syncing PDF statements for ${accountName} (${currencyCode})...`);
    const { documentsList } = await api.listDocuments(entityId, accountId);

    for (const item of documentsList) {
      if (item.documentType !== 'monthlyStatement') continue;

      const date = parseMonthYear(item.monthYear);
      const month = formatYYYYMM(date);

      if (month === currentMonth) continue;
      if (month < cutoffMonth) break;

      const filePath = path.join(dir, `${formatYYYYMMDD(date)}-${currencyCode}-statement.pdf`);

      if (!force && fs.existsSync(filePath)) {
        console.log(`  ${item.monthYear} already exists, done`);
        break;
      }

      console.log(`  ${item.monthYear}`);
      const { pdfContent } = await api.downloadDocument(entityId, accountId, item.docId);
      const pdfBuffer = Buffer.from(pdfContent, 'base64');

      fs.writeFileSync(filePath, pdfBuffer);
      const mtime = endOfMonth(date);
      fs.utimesSync(filePath, mtime, mtime);
    }
  }
}

async function syncCsvs(api: MetroBankApi, accounts: Account[], outputDir: string, cutoff: Date, startMonth: Date, force: boolean) {
  for (const { entityId, accountId, accountName, currencyCode } of accounts) {
    const dir = path.join(outputDir, 'transactions', currencyCode);
    fs.mkdirSync(dir, { recursive: true });

    console.log(`Syncing CSV transactions for ${accountName} (${currencyCode})...`);

    let current = new Date(startMonth);
    while (current >= cutoff) {
      const startDate = formatYYYYMMDD(current);
      const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const endDate = formatYYYYMMDD(lastDay);
      const filePath = path.join(dir, `${startDate}-${currencyCode}-transactions.csv`);

      if (!force && fs.existsSync(filePath)) {
        console.log(`  ${startDate} already exists, done`);
        break;
      }

      await sleep(RATE_LIMIT_MS);
      console.log(`  ${startDate} to ${endDate}`);

      try {
        const data = await api.downloadTransactions({
          accountId,
          currencyCode,
          transactionStartDate: startDate,
          transactionEndDate: endDate,
          entityId,
        });

        if (data.exp) throw new Error(`Session expired: ${JSON.stringify(data)}`);

        if (data.fileContent) {
          const csvData = Buffer.from(data.fileContent, 'base64').toString('utf8').trim();
          fs.writeFileSync(filePath, csvData, 'utf8');
          const mtime = endOfMonth(current);
          fs.utimesSync(filePath, mtime, mtime);
        } else {
          console.log(`    No data`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('HTTP 500')) {
          console.log(`    Server error — likely reached history limit, stopping CSV sync for ${accountName}`);
          break;
        }
        throw err;
      }

      // Move to previous month
      current = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    }
  }
}

// --- Main ---

function parseCliArgs(): { configPath: string; month?: string; force: boolean } {
  const args = process.argv.slice(2);
  let configPath = 'config.json';
  let month: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--month') {
      month = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    } else {
      configPath = args[i];
    }
  }

  return { configPath: resolvePath(configPath), month, force };
}

function loadConfig(configPath: string): SyncConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}\nCopy config.example.json to config.json and fill in your details.`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

async function main() {
  const { configPath, month: monthArg, force } = parseCliArgs();
  const config = loadConfig(configPath);

  const curlFile = resolvePath(config.curlFile);
  const outputDir = resolvePath(config.outputDir);

  const curlText = fs.readFileSync(curlFile, 'utf8');
  const auth = parseCurl(curlText);
  const api = new MetroBankApi(auth);

  console.log('Discovering accounts...');
  const accounts = await api.discoverAccounts(config.accounts);

  console.log(`Output: ${path.resolve(outputDir)}`);
  console.log(`Accounts:`);
  for (const a of accounts) {
    console.log(`  - ${a.accountName} (${a.currencyCode}, ${a.accountId})`);
  }

  const now = new Date();
  let cutoff: Date;
  let startMonth: Date;

  if (monthArg) {
    cutoff = new Date(monthArg + '-01');
    startMonth = new Date(cutoff);
    console.log(`Month: ${formatYYYYMM(cutoff)}\n`);
  } else {
    cutoff = config.cutoffDate
      ? new Date(config.cutoffDate + '-01')
      : new Date(now.getFullYear() - DEFAULT_MAX_HISTORY_YEARS, now.getMonth(), 1);
    startMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    console.log(`Cutoff: ${formatYYYYMM(cutoff)}\n`);
  }

  await syncCsvs(api, accounts, outputDir, cutoff, startMonth, force);
  await syncPdfs(api, accounts, outputDir, cutoff, force);

  console.log('\nDone.');
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
