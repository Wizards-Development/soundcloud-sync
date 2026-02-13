import { inject, Injectable } from '@angular/core';
import {
    BehaviorSubject,
    EMPTY,
    from,
    interval,
    merge,
    Observable,
    of,
    throwError,
} from 'rxjs';
import {
    catchError,
    finalize,
    map,
    mergeMap,
    switchMap,
    tap,
    toArray,
    takeWhile,
} from 'rxjs/operators';
import { invoke } from '@tauri-apps/api/core';
import { SoundCloudService } from './soundcloud.service';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SoundCloudTrack } from '../models/soundcloud.model';
import { SyncProgress, SyncStatus } from '../models/sync.model';

type SyncTrackResponse = {
    action: 'skipped' | 'downloaded' | 'streamed' | 'unsupported' | 'error';
    path: string;
    reason?: string | null;
};

@Injectable({ providedIn: 'root' })
export class SyncService {
    private soundcloudService = inject(SoundCloudService);
    private authService = inject(SoundCloudAuthService);

    private playlistTrackCountCache = new Map<string, number>();

    private progressSubject = new BehaviorSubject<SyncProgress>({
        status: 'idle',
        total: 0,
        processed: 0,
        downloaded: 0,
        streamed: 0,
        skipped: 0,
        unsupported: 0,
        errors: 0,
    });

    public progress$ = this.progressSubject.asObservable();

    private update(patch: Partial<SyncProgress>) {
        this.progressSubject.next({ ...this.progressSubject.value, ...patch });
    }

    public resetProgress() {
        this.progressSubject.next({
            status: 'idle',
            total: 0,
            processed: 0,
            downloaded: 0,
            streamed: 0,
            skipped: 0,
            unsupported: 0,
            errors: 0,
        });
    }

    public cancel() {
        this.update({ status: 'canceled' });
    }

    public checkAndSyncPlaylists(
        playlists: Map<string, string>,
        directory: string,
        tracksConcurrency = 10,
        playlistConcurrency = 2,
        syncIfMissingInCache = true
    ): Observable<void> {
        if (this.progressSubject.value.status === 'running') {
            return EMPTY;
        }

        const entries = Array.from(playlists.entries());

        return from(entries).pipe(
            mergeMap(([playlistId, fallbackTitle]) => {
                return this.soundcloudService.getPlaylistById(playlistId, false).pipe(
                    map(p => ({
                        playlistId,
                        title: p?.title ?? fallbackTitle,
                        trackCount: p?.track_count ?? 0,
                        ok: true,
                    })),
                    catchError(err => {
                        console.error('getPlaylistById error', playlistId, err);
                        return of({
                            playlistId,
                            title: fallbackTitle,
                            trackCount: 0,
                            ok: false,
                        });
                    })
                );
            }, playlistConcurrency),
            toArray(),
            switchMap(results => {
                const toSync = new Map<string, string>();

                results.forEach(playlist => {
                    if (!playlist.ok) return;

                    const prev = this.playlistTrackCountCache.get(playlist.playlistId);

                    const changed =
                        prev === undefined ? syncIfMissingInCache : (playlist.trackCount !== prev);

                    if (changed) {
                        toSync.set(playlist.playlistId, playlist.title);
                    }

                    this.playlistTrackCountCache.set(playlist.playlistId, playlist.trackCount);
                });

                if (toSync.size === 0) {
                    return EMPTY;
                }

                return this.syncPlaylists(toSync, directory, tracksConcurrency, playlistConcurrency);
            })
        );
    }


    public syncPlaylists(
        playlists: Map<string, string>,
        directory: string,
        tracksConcurrency = 10,
        playlistConcurrency = 2
    ): Observable<void> {
        if (this.progressSubject.value.status === 'running') {
            return EMPTY;
        }

        const entries = Array.from(playlists.entries());
        const startedAt = Date.now();

        this.update({
            status: 'running',
            total: 0,
            processed: 0,
            downloaded: 0,
            streamed: 0,
            skipped: 0,
            unsupported: 0,
            errors: 0,
            startedAt,
            elapsedMs: 0,
            rate: 0,
            etaMs: undefined,
            lastTickAt: startedAt,
        });

        const tick$ = interval(250).pipe(
            takeWhile(() => this.progressSubject.value.status === 'running'),
            tap(() => {
                const cur = this.progressSubject.value;
                const now = Date.now();

                const elapsedMs = now - (cur.startedAt ?? now);
                const rate = this.computeRate(cur.startedAt ?? now, cur.processed);
                const remaining = Math.max(0, (cur.total || 0) - cur.processed);
                const etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : undefined;

                this.update({
                    elapsedMs,
                    rate,
                    etaMs,
                    lastTickAt: now,
                });
            }),
            map(() => void 0)
        );

        const main$ = from(entries).pipe(
            mergeMap(([playlistId, playlistTitle]) => {
                return this.soundcloudService.getPlaylistsTracks(playlistId).pipe(
                    map(tracks => ({ playlistTitle, tracks: tracks ?? [] })),
                    catchError(err => {
                        console.error('getPlaylistsTracks error', playlistId, err);
                        return of({ playlistTitle, tracks: [] as SoundCloudTrack[] });
                    })
                );
            }, playlistConcurrency),
            toArray(),
            switchMap(all => {
                const flat = all.flatMap(x => x.tracks.map(t => ({ t, playlistTitle: x.playlistTitle })));
                this.update({ total: flat.length });

                return from(flat).pipe(
                    mergeMap(
                        ({ t, playlistTitle }) =>
                            this.syncOneTrack(t, playlistTitle, directory).pipe(
                                tap(res => this.onTrackResult(res, startedAt))
                            ),
                        tracksConcurrency
                    ),
                    map(() => void 0)
                );
            }),
            finalize(() => {
                const cur = this.progressSubject.value;
                const status: SyncStatus =
                    cur.status === 'canceled'
                        ? 'canceled'
                        : cur.status === 'error'
                            ? 'error'
                            : 'done';

                this.update({
                    status,
                    elapsedMs: Date.now() - startedAt,
                    rate: this.computeRate(startedAt),
                    etaMs: 0,
                });
            }),
            catchError(err => {
                console.error('syncPlaylists fatal error', err);
                this.update({ status: 'error' });
                return throwError(() => err);
            })
        );
        return merge(tick$, main$).pipe(
            catchError(err => throwError(() => err))
        );
    }

    private onTrackResult(res: SyncTrackResponse | null, startedAt: number) {
        const cur = this.progressSubject.value;
        const processed = cur.processed + 1;
        let downloaded = cur.downloaded;
        let streamed = cur.streamed;
        let skipped = cur.skipped;
        let unsupported = cur.unsupported;
        let errors = cur.errors;

        switch (res?.action) {
            case 'downloaded':
                downloaded++;
                break;
            case 'streamed':
                streamed++;
                break;
            case 'skipped':
                skipped++;
                break;
            case 'unsupported':
                unsupported++;
                break;
            case 'error':
                errors++;
                break;
            default:
                errors++;
                break;
        }

        const now = Date.now();
        const elapsedMs = now - startedAt;
        const rate = this.computeRate(startedAt, processed);
        const remaining = Math.max(0, (cur.total || 0) - processed);
        const etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : undefined;

        this.update({
            processed,
            downloaded,
            streamed,
            skipped,
            unsupported,
            errors,
            elapsedMs,
            rate,
            etaMs,
            lastTickAt: now,
        });
    }

    private computeRate(startedAt: number, processedOverride?: number) {
        const processed = processedOverride ?? this.progressSubject.value.processed;
        const elapsedSec = (Date.now() - startedAt) / 1000;
        if (elapsedSec <= 0) return 0;
        return +((processed / elapsedSec).toFixed(2));
    }

    private syncOneTrack(track: SoundCloudTrack, playlistTitle: string, directory: string) {
        return from(
            invoke<SyncTrackResponse>('sync_track', {
                req: {
                    track,
                    playlistTitle,
                    directory,
                    token: `OAuth ${this.authService.accessToken}`,
                    apiBase: this.soundcloudService.apiBase,
                },
            })
        ).pipe(
            catchError(err => {
                console.error(`✗ ${track.title}`, err);
                return of({
                    action: 'error',
                    path: '',
                    reason: err?.message ?? 'invoke failed',
                } as SyncTrackResponse);
            })
        );
    }
}
