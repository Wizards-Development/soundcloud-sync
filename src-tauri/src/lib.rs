use futures_util::StreamExt;
use serde::{ Deserialize, Serialize };
use std::path::Path;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrackRequest {
  pub track: SoundCloudTrack,
  pub playlist_title: String,
  pub directory: String,
  pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct SoundCloudTrack {
  pub id: i64,
  pub title: Option<String>,

  pub streamable: Option<bool>,
  pub downloadable: Option<bool>,

  #[serde(rename = "stream_url")]
  pub stream_url: Option<String>,

  #[serde(rename = "download_url")]
  pub download_url: Option<String>,

  #[serde(rename = "http_mp3_128_url")]
  pub http_mp3_128_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrackResponse {
  pub action: String,
  pub path: String,
  pub reason: Option<String>,
}

fn sanitize_filename(s: &str) -> String {
  let bad = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
  let cleaned: String = s
    .chars()
    .map(|c| if bad.contains(&c) { '_' } else { c })
    .collect();
  cleaned.trim().to_string()
}

async fn download_file(
  url: &str,
  destination_path: &str,
  token: &str
) -> Result<(), Box<dyn std::error::Error>> {
  let client = reqwest::Client::new();

  let response = client.get(url).header("Authorization", token).send().await?;

  if !response.status().is_success() {
    return Err(format!("Erreur HTTP: {}", response.status()).into());
  }

  let bytes = response.bytes().await?;

  if let Some(parent) = Path::new(destination_path).parent() {
    tokio::fs::create_dir_all(parent).await?;
  }

  let mut file = tokio::fs::File::create(destination_path).await?;
  file.write_all(&bytes).await?;

  Ok(())
}

async fn stream_to_file(
  url: &str,
  destination_path: &str,
  token: &str
) -> Result<(), Box<dyn std::error::Error>> {
  let client = reqwest::Client::new();

  let response = client.get(url).header("Authorization", token).send().await?;

  if !response.status().is_success() {
    return Err(format!("Erreur HTTP: {}", response.status()).into());
  }

  if let Some(parent) = Path::new(destination_path).parent() {
    tokio::fs::create_dir_all(parent).await?;
  }

  let mut file = tokio::fs::File::create(destination_path).await?;
  let mut stream = response.bytes_stream();

  while let Some(chunk) = stream.next().await {
    let data = chunk?;
    file.write_all(&data).await?;
  }

  Ok(())
}

async fn track_exists(path: String) -> bool {
  tokio::fs
    ::metadata(path).await
    .map(|m| m.is_file())
    .unwrap_or(false)
}

fn resp(action: &str, path: &str, reason: Option<&str>) -> SyncTrackResponse {
  SyncTrackResponse {
    action: action.to_string(),
    path: path.to_string(),
    reason: reason.map(|s| s.to_string()),
  }
}

#[tauri::command]
async fn sync_track(req: SyncTrackRequest) -> Result<SyncTrackResponse, String> {
  let title = req.track.title.clone().unwrap_or_else(|| format!("track-{}", req.track.id));

  let safe_title = sanitize_filename(&title);
  let safe_playlist = sanitize_filename(&req.playlist_title);

  let path = format!("{}/{}/{}.mp3", req.directory, safe_playlist, safe_title);

  if track_exists(path.clone()).await {
    return Ok(resp("skipped", &path, Some("already_exists")));
  }

  let downloadable = req.track.downloadable.unwrap_or(false);
  if downloadable {
    if let Some(url) = req.track.download_url.as_deref() {
      download_file(url, &path, &req.token).await.map_err(|e| e.to_string())?;
      return Ok(resp("downloaded", &path, None));
    }
  }

  let streamable = req.track.streamable.unwrap_or(false);
  if streamable {
    if let Some(url) = req.track.http_mp3_128_url.as_deref() {
      stream_to_file(url, &path, &req.token).await.map_err(|e| e.to_string())?;
      return Ok(resp("streamed", &path, None));
    } else {
      return Ok(resp("error", &path, Some("missing_http_mp3_128_url")));
    }
  }

  Ok(resp("unsupported", &path, Some("not_downloadable_nor_streamable")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder
    ::default()
    .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![sync_track])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app
          .handle()
          .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
