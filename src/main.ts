import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { error } from '@tauri-apps/plugin-log';

bootstrapApplication(App, appConfig)
  .catch((err) => {
    console.error(err);
    error(`bootstrapApplication failed: ${err?.message ?? err}`);
  });