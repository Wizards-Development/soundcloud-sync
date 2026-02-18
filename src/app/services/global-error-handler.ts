import { ErrorHandler, Injectable } from '@angular/core';
import { error } from '@tauri-apps/plugin-log';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(err: unknown): void {
    const message =
      err instanceof Error
        ? `${err.message}\n${err.stack ?? ''}`
        : JSON.stringify(err);

    console.error('GlobalErrorHandler caught:', err);

    error(`GlobalErrorHandler: ${message}`);
  }
}