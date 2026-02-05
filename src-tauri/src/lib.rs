use futures_util::StreamExt;
use serde::{ Deserialize, Serialize };
use std::path::Path;
use tokio::io::AsyncWriteExt;
use lofty::picture::{ Picture, PictureType };
use lofty::tag::{ Accessor, Tag, TagExt, TagType, ItemKey, ItemValue, TagItem };
use lofty::file::TaggedFileExt;
use lofty::config::WriteOptions;
use std::io::Cursor;
use image::imageops::FilterType;
use image::codecs::jpeg::JpegEncoder;
use image::GenericImageView;

type AnyError = Box<dyn std::error::Error + Send + Sync + 'static>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrackRequest {
  pub track: SoundCloudTrack,
  pub playlist_title: String,
  pub directory: String,
  pub token: String,
  pub api_base: String,
}

#[derive(Debug, Deserialize)]
pub struct SoundCloudUser {
  pub username: Option<String>,
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

  pub artwork_url: Option<String>,
  pub user: Option<SoundCloudUser>,

  pub description: Option<String>,
  pub label_name: Option<String>,
  pub genre: Option<String>,
  pub tag_list: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Stream {
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

async fn remove_if_exists(path: &str) {
  let _ = tokio::fs::remove_file(path).await;
}

async fn cleanup_part_for(destination_path: &str) {
  let tmp_path = format!("{}.part", destination_path);
  let _ = tokio::fs::remove_file(tmp_path).await;
}

async fn write_response_to_temp_then_rename(
  response: reqwest::Response,
  destination_path: &str
) -> Result<(), AnyError> {
  let dest = Path::new(destination_path);

  if let Some(parent) = dest.parent() {
    tokio::fs::create_dir_all(parent).await?;
  }

  let tmp_path = format!("{}.part", destination_path);
  remove_if_exists(&tmp_path).await;

  let expected_len = response.content_length();

  let mut file = tokio::fs::File::create(&tmp_path).await?;
  let mut stream = response.bytes_stream();

  let mut written: u64 = 0;
  while let Some(chunk) = stream.next().await {
    let data = chunk?;
    file.write_all(&data).await?;
    written += data.len() as u64;
  }

  file.flush().await?;
  file.sync_all().await?;
  drop(file);

  if let Some(exp) = expected_len {
    if written != exp {
      remove_if_exists(&tmp_path).await;
      return Err(
        format!("Téléchargement incomplet: écrit {} octets, attendu {} octets", written, exp).into()
      );
    }
  }

  tokio::fs::rename(&tmp_path, destination_path).await?;
  Ok(())
}

async fn fetch_to_file_atomic(
  url: &str,
  destination_path: &str,
  token: &str
) -> Result<(), AnyError> {
  let client = reqwest::Client::new();
  let response = client.get(url).header("Authorization", token).send().await?;

  if !response.status().is_success() {
    return Err(format!("Erreur HTTP: {}", response.status()).into());
  }

  if let Err(e) = write_response_to_temp_then_rename(response, destination_path).await {
    let msg = e.to_string();
    let tmp_path = format!("{}.part", destination_path);
    remove_if_exists(&tmp_path).await;
    return Err(msg.into());
  }

  Ok(())
}

fn normalize_soundcloud_artwork_url(url: &str) -> String {
  url.replace("-large.", "-t500x500.")
}

fn square_and_resize_cover_jpeg(
  input_bytes: &[u8],
  size: u32,
  quality: u8
) -> Result<Vec<u8>, AnyError> {
  let img = image::load_from_memory(input_bytes)?;
  let (w, h) = img.dimensions();
  let side = w.min(h);

  let x = (w - side) / 2;
  let y = (h - side) / 2;

  let cropped = img.crop_imm(x, y, side, side);
  let resized = cropped.resize_exact(size, size, FilterType::Lanczos3);

  let mut out = Vec::new();
  let mut enc = JpegEncoder::new_with_quality(&mut out, quality);
  enc.encode_image(&resized)?;
  Ok(out)
}

async fn tag_mp3_after_success(
  path: &str,
  artist: Option<&str>,
  artwork_url: Option<&str>,
  comment: Option<&str>,
  label: Option<&str>,
  genre: Option<&str>
) -> Result<(), AnyError> {
  let mut tag = match lofty::read_from_path(path) {
    Ok(tf) =>
      tf
        .primary_tag()
        .cloned()
        .unwrap_or_else(|| Tag::new(TagType::Id3v2)),
    Err(_) => Tag::new(TagType::Id3v2),
  };

  tag.re_map(TagType::Id3v2);

  if let Some(a) = artist.filter(|s| !s.trim().is_empty()) {
    tag.set_artist(a.to_string());
  }

  if let Some(url) = artwork_url.filter(|s| !s.trim().is_empty()) {
    let url = normalize_soundcloud_artwork_url(url);

    let bytes = reqwest::get(&url).await?.bytes().await?;

    let squared_jpeg = square_and_resize_cover_jpeg(&bytes, 500, 90)?;

    let mut pic = Picture::from_reader(&mut Cursor::new(squared_jpeg))?;
    pic.set_pic_type(PictureType::CoverFront);

    tag.set_picture(0, pic);
  }

  if let Some(g) = genre.filter(|s| !s.trim().is_empty()) {
    tag.set_genre(g.to_string());
  }

  if let Some(c) = comment.filter(|s| !s.trim().is_empty()) {
    tag.insert_text(ItemKey::Comment, c.to_string());
  }

  if let Some(l) = label.filter(|s| !s.trim().is_empty()) {
    let item = TagItem::new(ItemKey::Unknown("TPUB".to_string()), ItemValue::Text(l.to_string()));
    tag.insert_unchecked(item);
  }

  tag.save_to_path(path, WriteOptions::default())?;
  Ok(())
}

async fn fetch_track_stream(
  api_base: &str,
  track_id: i64,
  token: &str
) -> Result<Option<Stream>, AnyError> {
  let base = api_base.trim_end_matches('/');
  let url = format!("{}/tracks/soundcloud:tracks:{}/streams", base, track_id);

  let client = reqwest::Client::new();
  let res = client.get(&url).header("Authorization", token).send().await?;

  if
    res.status() == reqwest::StatusCode::UNAUTHORIZED ||
    res.status() == reqwest::StatusCode::FORBIDDEN
  {
    return Ok(None);
  }

  if !res.status().is_success() {
    return Err(format!("streams endpoint HTTP error: {}", res.status()).into());
  }

  let body = res.text().await?;
  if body.trim().is_empty() || body.trim() == "null" {
    return Ok(None);
  }

  let stream: Stream = serde_json::from_str(&body)?;
  Ok(Some(stream))
}

#[tauri::command]
async fn sync_track(req: SyncTrackRequest) -> Result<SyncTrackResponse, String> {
  let title = req.track.title.clone().unwrap_or_else(|| format!("track-{}", req.track.id));

  let safe_title = sanitize_filename(&title);
  let safe_playlist = sanitize_filename(&req.playlist_title);

  let path = format!("{}/{}/{}.mp3", req.directory, safe_playlist, safe_title);

  cleanup_part_for(&path).await;

  if track_exists(path.clone()).await {
    return Ok(resp("skipped", &path, Some("already_exists")));
  }

  /*   let downloadable = req.track.downloadable.unwrap_or(false);
  if downloadable {
    if let Some(url) = req.track.download_url.as_deref() {
      fetch_to_file_atomic(url, &path, &req.token).await.map_err(|e| e.to_string())?;
      return Ok(resp("downloaded", &path, None));
    }
  } */
 
  let streamable = req.track.streamable.unwrap_or(false);
  if streamable {
    let mut mp3_url = req.track.http_mp3_128_url.clone();

    if mp3_url.as_deref().unwrap_or("").is_empty() {
      match fetch_track_stream(&req.api_base, req.track.id, &req.token).await {
        Ok(Some(stream)) => {
          mp3_url = stream.http_mp3_128_url;
        }
        Ok(None) => {
          return Ok(resp("error", &path, Some("stream_resolve_returned_null_or_unauthorized")));
        }
        Err(e) => {
          return Ok(resp("error", &path, Some(&format!("stream_resolve_failed: {}", e))));
        }
      }
    }

    if let Some(url) = mp3_url.as_deref().filter(|s| !s.trim().is_empty()) {
      fetch_to_file_atomic(url, &path, &req.token).await.map_err(|e| e.to_string())?;

      let artist = req.track.user.as_ref().and_then(|u| u.username.as_deref());
      let artwork = req.track.artwork_url.as_deref();

      let comment = req.track.description.as_deref();

      let label = req.track.tag_list.as_deref();
      let genre = req.track.genre.as_deref();

      if let Err(e) = tag_mp3_after_success(&path, artist, artwork, comment, label, genre).await {
        return Ok(resp("error", &path, Some(&format!("tagging_failed: {}", e))));
      }

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
