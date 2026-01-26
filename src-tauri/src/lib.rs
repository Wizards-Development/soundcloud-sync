use futures_util::StreamExt;
use std::path::Path;
use tokio::io::AsyncWriteExt;

async fn download_file(
    url: &str,
    destination_path: &str,
    token: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let response = client
        .get(url)
        .header("Authorization", token)
        .send()
        .await?;

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
    token: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let response = client
        .get(url)
        .header("Authorization", token)
        .send()
        .await?;

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

#[tauri::command]
async fn download(url: String, path: String, token: String) -> Result<String, String> {
    download_file(&url, &path, &token)
        .await
        .map(|_| format!("Fichier téléchargé avec succès vers {}", path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stream(url: String, path: String, token: String) -> Result<String, String> {
    stream_to_file(&url, &path, &token)
        .await
        .map(|_| format!("Fichier streamé avec succès vers {}", path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn track_exists(path: String) -> bool {
    tokio::fs::metadata(path)
        .await
        .map(|m| m.is_file())
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![download, stream, track_exists])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
