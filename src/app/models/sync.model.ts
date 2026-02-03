export type SyncStatus = 'idle' | 'running' | 'done' | 'error' | 'canceled';

export interface SyncProgress {
  status: SyncStatus;

  total: number;
  processed: number;

  downloaded: number;
  streamed: number;
  skipped: number;
  unsupported: number;
  errors: number;

  startedAt?: number;
  elapsedMs?: number;

  rate?: number;
  etaMs?: number;
  lastTickAt?: number;
}