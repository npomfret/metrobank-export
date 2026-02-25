# metrobank-export

Downloads monthly PDF statements and CSV transaction data from Metro Bank's online banking portal.

Metro Bank doesn't offer a public API for individual customers to export their data programmatically. This tool works by replaying authenticated API requests using session cookies extracted from your browser.

## Setup

```
npm install
cp config.example.json config.json
```

Edit `config.json` with your account details:

```json
{
  "curlFile": "curl.txt",
  "accounts": [
    {
      "name": "YOUR EXACT ACCOUNT NAME",
      "outputDir": "./data",
      "cutoffDate": "2021-01"
    }
  ]
}
```

| Field | Description |
|---|---|
| `curlFile` | Path to a file containing a copied cURL command (see below) |
| `accounts` | Array of account configs. Each entry has `name` (required), `outputDir` (required), and `cutoffDate` (optional). Run `npm run discover` to see available account names |
| `accounts[].name` | Account name as it appears in Metro Bank's system |
| `accounts[].outputDir` | Where to save downloaded files for this account. Supports `~` for home directory |
| `accounts[].cutoffDate` | Optional. Earliest month to sync, in YYYY-MM format. Defaults to 5 years back. See [Data cutoff limits](#data-cutoff-limits) below |

Each account can have its own output directory and cutoff date, allowing you to funnel data from different accounts to different locations. Account IDs, currency codes, and entity IDs are all auto-discovered from the API.

## Getting the cURL command

Each time you run a sync, you need a fresh session cookie:

1. Log into [Metro Bank online banking](https://personal.metrobankonline.co.uk)
2. Open browser DevTools (F12) and go to the **Network** tab
3. Click on any API request (e.g. to `/onlinebanking/api/...`)
4. Right-click the request and select **Copy as cURL**
5. Paste into `curl.txt`

The tool extracts the `Cookie` and `X-CSRF-Token` headers from this.

**Important:** The session cookie expires quickly — typically if the browser tab sits idle or is closed. A full sync of many months can take a while, and if the cookie expires mid-run the tool will start getting errors. To avoid this, keep the Metro Bank tab open in your browser while the sync is running. You'll need to copy a fresh curl command every time you come back to run this tool.

## Usage

Sync all data:

```
npm run sync
```

Sync a single month (useful for testing):

```
npm run test-month -- 2025-01
```

Re-download even if files already exist:

```
npm run test-month -- 2025-01 --force
```

## Utility scripts

**Discover account info** — calls the API and lists all your entities and accounts:

```
npm run discover
```

**Find data cutoff** — binary-searches for the earliest available month for both transactions and PDF statements:

```
npm run find-cutoff
```

## What it does

- Auto-discovers account details (entityId, accountId, currencyCode) from the API
- Downloads **CSV transaction data** for each month, one file per month
- Downloads **PDF monthly statements**
- Skips the current (incomplete) month
- Skips months that have already been downloaded
- Sets each file's last-modified timestamp to the end of that month
- Works backwards from the most recent complete month, stopping when it hits already-synced data

## Output structure

```
data/
  transactions/
    GBP/
      2024-01-01-GBP-transactions.csv
      2024-02-01-GBP-transactions.csv
      ...
  statements/
    GBP/
      2024-01-01-GBP-statement.pdf
      2024-02-01-GBP-statement.pdf
      ...
```

## Data cutoff limits

Metro Bank imposes different history limits for different data types:

- **CSV transactions**: limited to approximately **5 years**. Requests for older months return a server error (HTTP 500). The sync handles this gracefully — it catches the error and stops downloading older months for that account.
- **PDF statements**: may go back **much further** than transactions (e.g. to when the account was opened).

The `cutoffDate` in config sets the earliest month the tool will attempt to sync. If omitted, it defaults to 5 years back. If you set it earlier than 5 years, the tool will still work — it will download all available PDFs and stop CSV downloads when it hits the server limit.

Use `npm run find-cutoff` to determine the exact limits for your account. It binary-searches the transaction API (~7 requests) and checks the full PDF statement list to report the earliest available month for each.
