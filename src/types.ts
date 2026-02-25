export interface AuthHeaders {
  cookie: string;
  csrfToken: string;
}

/** A resolved account ready for syncing. */
export interface Account {
  entityId: string;
  accountId: string;
  accountName: string;
  currencyCode: string;
}

export interface AccountConfig {
  name: string;
  outputDir: string;
  /** Earliest month to sync, e.g. "2020-01". Defaults to 5 years ago. */
  cutoffDate?: string;
}

export interface SyncConfig {
  curlFile: string;
  accounts: AccountConfig[];
}

// --- API response shapes ---

export interface Entity {
  entityId: string;
  entityName: string;
  entityType: string;
}

export interface EntitlementsResponse {
  entities: Entity[];
}

export interface ApiAccount {
  accountId: string;
  accountName: string;
  currencyCode: string;
  entityId: string;
  entityName: string;
}

export interface AccountsResponse {
  accounts: ApiAccount[];
}

export interface DocumentListItem {
  docId: string;
  monthYear: string;
  documentType: string;
}

export interface DocumentListResponse {
  documentsList: DocumentListItem[];
}

export interface DocumentDownloadResponse {
  pdfContent: string;
}

export interface TransactionDownloadResponse {
  fileContent: string | null;
  exp?: string;
}
