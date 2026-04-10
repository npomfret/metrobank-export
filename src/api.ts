import { Account, AccountsResponse, AuthHeaders, DocumentDownloadResponse, DocumentListResponse, EntitlementsResponse, TransactionDownloadResponse } from './types';

const BASE_URL = 'https://personal.metrobankonline.co.uk/onlinebanking/api';

export function parseCurl(curlText: string): AuthHeaders {
    const normalized = curlText.replace(/\\\n/g, ' ').replace(/\\\r\n/g, ' ');

    const cookieMatch = normalized.match(/-H\s+['"]Cookie:\s*([^'"]+)['"]/);
    const csrfMatch = normalized.match(/-H\s+['"]X-CSRF-Token:\s*([^'"]+)['"]/);

    if (!cookieMatch) throw new Error('Could not find Cookie header in curl command');
    if (!csrfMatch) throw new Error('Could not find X-CSRF-Token header in curl command');

    return {
        cookie: cookieMatch[1].trim(),
        csrfToken: csrfMatch[1].trim(),
    };
}

export class MetroBankApi {
    constructor(private auth: AuthHeaders) {}

    private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
        const res = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Cookie': this.auth.cookie,
                'X-CSRF-Token': this.auth.csrfToken,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} on POST ${path}\nRequest: ${JSON.stringify(body)}\nResponse: ${text}`);
        }

        const data = (await res.json()) as T & { code?: string; };
        if (data.code) {
            throw new Error(`API error on ${path}: ${JSON.stringify(data)}`);
        }

        return data;
    }

    private async get<T>(path: string): Promise<T> {
        const res = await fetch(`${BASE_URL}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Cookie': this.auth.cookie,
                'X-CSRF-Token': this.auth.csrfToken,
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} on GET ${path}\nResponse: ${text}`);
        }

        return (await res.json()) as T;
    }

    async getEntitlements(): Promise<EntitlementsResponse> {
        return this.get('/customer/entitlements');
    }

    async getAccounts(entityId: string): Promise<AccountsResponse> {
        return this.post('/accounts', { entityId });
    }

    /**
     * Discovers all accounts across all entities.
     * If `filterNames` is provided, only returns accounts whose name matches (case-insensitive).
     */
    async discoverAccounts(filterNames?: string[]): Promise<Account[]> {
        const { entities } = await this.getEntitlements();
        const allAccounts: Account[] = [];

        for (const entity of entities) {
            const { accounts } = await this.getAccounts(entity.entityId);
            for (const acct of accounts) {
                allAccounts.push({
                    entityId: entity.entityId,
                    accountId: acct.accountId,
                    accountName: acct.accountName,
                    currencyCode: acct.currencyCode,
                });
            }
        }

        if (!filterNames || filterNames.length === 0) return allAccounts;

        const lowerNames = filterNames.map(n => n.toLowerCase());
        const matched = allAccounts.filter(a => lowerNames.includes(a.accountName.toLowerCase()));

        if (matched.length === 0) {
            const available = allAccounts.map(a => `  - "${a.accountName}" (${a.currencyCode})`).join('\n');
            throw new Error(`No accounts matched the names in config.\nAvailable accounts:\n${available}`);
        }

        return matched;
    }

    async listDocuments(entityId: string, accountId: string): Promise<DocumentListResponse> {
        return this.post('/documents/list', {
            entityId,
            accountId,
            documentType: 'all',
        });
    }

    async downloadDocument(
        entityId: string,
        accountId: string,
        docId: string,
    ): Promise<DocumentDownloadResponse> {
        return this.post('/documents/download', {
            entityId,
            accountId,
            docId,
            documentType: 'monthlyStatement',
        });
    }

    async downloadTransactions(params: {
        accountId: string;
        currencyCode: string;
        transactionStartDate: string;
        transactionEndDate: string;
        entityId: string;
    }): Promise<TransactionDownloadResponse> {
        return this.post('/transactions/download', {
            ...params,
            exportType: 'CSV',
            searchParams: { transactionIn: true, transactionOut: true },
            requestSource: 'TRANSACTION_SUMMARY',
        });
    }
}
