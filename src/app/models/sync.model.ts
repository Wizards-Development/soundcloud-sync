export interface SyncProgress {
  running: boolean;

  playlistsDone: number;
  playlistsTotal: number;

  currentPlaylistTitle?: string;

  tracksDone: number;
  tracksTotal: number;

  currentTrackTitle?: string;

  downloadedCount: number;
  streamedCount: number;
  skippedExistingCount: number;
  unsupportedCount: number;
  errorCount: number;
  error?: string;
}
