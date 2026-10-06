//! Supervise the video-only Python bridge. Commands accept profiles, never shell text.
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebcamStatus {
    pub phase: String,
    pub url: Option<String>,
    pub device: Option<String>,
    pub source_width: Option<u64>,
    pub source_height: Option<u64>,
    pub source_fps: Option<f64>,
    pub output_fps: Option<f64>,
    pub reconnects: u64,
    pub error: Option<String>,
    pub logs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebcamEnvironment {
    pub supported: bool,
    pub python_found: bool,
    pub runtime_ready: bool,
    pub obs_installed: bool,
    pub bundled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebcamOptions {
    pub url: String,
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub mirror: bool,
}

struct Running {
    stop: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

pub struct WebcamState {
    status: Arc<StdMutex<WebcamStatus>>,
    running: Mutex<Option<Running>>,
    operation: Mutex<()>,
}

impl Default for WebcamState {
    fn default() -> Self {
        Self {
            status: Arc::new(StdMutex::new(WebcamStatus {
                phase: "stopped".into(),
                ..Default::default()
            })),
            running: Mutex::new(None),
            operation: Mutex::new(()),
        }
    }
}

fn log_line(status: &Arc<StdMutex<WebcamStatus>>, line: String) {
    let mut status = status.lock().unwrap();
    let at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    status.logs.push(format!("[{at}] {}", line.chars().take(1000).collect::<String>()));
    if status.logs.len() > 60 {
        status.logs.remove(0);
    }
}

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.kill_on_drop(true).stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("webcam-runtime"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn webcam_open_help(topic: &str) -> Result<(), String> {
    let url = match topic {
        "obs" => "https://obsproject.com/download",
        "python" => "https://www.python.org/downloads/windows/",
        "whatnot" => "https://help.whatnot.com/hc/en-us/articles/5497980244749-Using-OBS-with-your-Livestream",
        _ => return Err("Unknown setup help topic.".into()),
    };
    if !cfg!(target_os = "windows") {
        return Err("Open setup help in your browser.".into());
    }
    let mut cmd = std::process::Command::new("rundll32.exe");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn runtime_python(dir: &Path) -> PathBuf {
    dir.join("venv").join("Scripts").join("python.exe")
}

fn bundled_helper(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("resources/webcam/webcam-bridge/webcam-bridge.exe"))
        .filter(|path| path.is_file())
}

fn stage_bridge(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    std::fs::write(
        dir.join("webcam_bridge.py"),
        include_str!("../../tools/webcam_bridge.py"),
    )
    .map_err(|error| error.to_string())?;
    std::fs::write(
        dir.join("requirements.txt"),
        include_str!("../../tools/webcam-requirements.txt"),
    )
    .map_err(|error| error.to_string())
}

async fn checked(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| {
            "The webcam runtime operation timed out. Try again with internet access.".to_string()
        })?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .chars()
            .rev()
            .take(2000)
            .collect::<String>()
            .chars()
            .rev()
            .collect());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

async fn python_launcher() -> Option<(String, Vec<String>)> {
    for (program, prefix) in [("py", vec!["-3"]), ("python", vec![])] {
        let mut cmd = command(program);
        cmd.args(&prefix).args([
            "-c",
            "import sys; assert sys.version_info >= (3,11); print(sys.version)",
        ]);
        if checked(cmd, Duration::from_secs(5)).await.is_ok() {
            return Some((program.into(), prefix.iter().map(|s| (*s).into()).collect()));
        }
    }
    None
}

async fn runtime_ready(dir: &Path) -> bool {
    if !runtime_python(dir).is_file() {
        return false;
    }
    let mut cmd = command(runtime_python(dir));
    cmd.args(["-c", "import av, numpy, pyvirtualcam"]);
    checked(cmd, Duration::from_secs(10)).await.is_ok()
}

#[tauri::command]
pub async fn webcam_environment(app: AppHandle) -> Result<WebcamEnvironment, String> {
    if !cfg!(target_os = "windows") {
        return Ok(WebcamEnvironment {
            supported: false,
            python_found: false,
            runtime_ready: false,
            obs_installed: false,
            bundled: false,
        });
    }
    let mut driver = command("reg.exe");
    driver.args([
        "query",
        "HKCR\\CLSID\\{A3FCE0F5-3493-419F-958A-ABA1250EC20B}",
        "/reg:64",
    ]);
    let bundled = bundled_helper(&app).is_some();
    Ok(WebcamEnvironment {
        supported: true,
        python_found: bundled || python_launcher().await.is_some(),
        runtime_ready: bundled || runtime_ready(&runtime_dir(&app)?).await,
        obs_installed: checked(driver, Duration::from_secs(5)).await.is_ok(),
        bundled,
    })
}

#[tauri::command]
pub async fn webcam_setup(app: AppHandle, state: State<'_, WebcamState>) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Webcam output currently requires Windows.".into());
    }
    let _operation = state.operation.lock().await;
    if state
        .running
        .lock()
        .await
        .as_ref()
        .is_some_and(|running| !running.task.is_finished())
    {
        return Err("Stop webcam output before updating its runtime.".into());
    }
    state.status.lock().unwrap().phase = "installing".into();
    let result = async {
        let (program, prefix) = python_launcher()
            .await
            .ok_or("Install Python 3.11 or newer, then check setup again.")?;
        let dir = runtime_dir(&app)?;
        stage_bridge(&dir)?;
        log_line(
            &state.status,
            "Creating the isolated webcam runtime…".into(),
        );
        let mut venv = command(program);
        venv.args(prefix).args(["-m", "venv"]).arg(dir.join("venv"));
        checked(venv, Duration::from_secs(60)).await?;
        log_line(
            &state.status,
            "Installing video dependencies. Internet access is needed for this step.".into(),
        );
        let mut pip = command(runtime_python(&dir));
        pip.args([
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--only-binary=:all:",
            "-r",
        ])
        .arg(dir.join("requirements.txt"));
        checked(pip, Duration::from_secs(300)).await?;
        if !runtime_ready(&dir).await {
            return Err("Runtime validation failed. Check Python and try setup again.".into());
        }
        log_line(&state.status, "Webcam runtime is ready.".into());
        Ok::<(), String>(())
    }
    .await;
    let mut status = state.status.lock().unwrap();
    status.phase = if result.is_ok() { "stopped" } else { "error" }.into();
    status.error = result.as_ref().err().cloned();
    result
}

fn validate(options: &WebcamOptions) -> Result<(), String> {
    let port = options
        .url
        .strip_prefix("http://127.0.0.1:")
        .and_then(|rest| rest.strip_suffix("/stream"))
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port > 0);
    if port.is_none() {
        return Err("Use the app's local camera stream URL.".into());
    }
    if !matches!(options.codec.as_str(), "h264" | "hevc") {
        return Err("Unsupported video codec.".into());
    }
    if !matches!(
        (options.width, options.height),
        (1280, 720) | (720, 1280) | (1920, 1080)
    ) || !matches!(options.fps, 24 | 25 | 30 | 60)
    {
        return Err("Choose a supported webcam profile.".into());
    }
    Ok(())
}

fn bridge_event(status: &Arc<StdMutex<WebcamStatus>>, line: &str) {
    let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let mut status = status.lock().unwrap();
    match event["event"].as_str() {
        Some("publishing") => {
            status.phase = "publishing".into();
            status.device = event["device"].as_str().map(str::to_string);
            status.output_fps = event["fps"].as_f64();
            status.error = None;
        }
        Some("reconnecting") => {
            status.phase = "reconnecting".into();
            status.reconnects += 1;
        }
        Some("stalled") => status.phase = "reconnecting".into(),
        Some("error") => {
            status.phase = "error".into();
            status.error = event["message"].as_str().map(str::to_string);
        }
        Some("resumed") if status.device.is_some() => status.phase = "publishing".into(),
        Some("source") => {
            status.source_width = event["width"].as_u64();
            status.source_height = event["height"].as_u64();
            status.source_fps = event["observedDecodeFps"].as_f64();
            if status.device.is_some() {
                status.phase = "publishing".into();
            }
        }
        _ => {}
    }
}

async fn stop_worker(state: &WebcamState) {
    if let Some(running) = state.running.lock().await.take() {
        let _ = running.stop.send(());
        let _ = running.task.await;
    }
    let mut status = state.status.lock().unwrap();
    status.phase = "stopped".into();
    status.url = None;
}

async fn supervise(
    mut child: Child,
    status: Arc<StdMutex<WebcamStatus>>,
    mut stopped: oneshot::Receiver<()>,
) {
    let mut events = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
    let mut logs = BufReader::new(child.stderr.take().expect("piped stderr")).lines();
    let mut events_open = true;
    let mut logs_open = true;
    loop {
        tokio::select! {
            _ = &mut stopped => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                break;
            }
            line = events.next_line(), if events_open => match line {
                Ok(Some(line)) => bridge_event(&status, &line),
                _ => events_open = false,
            },
            line = logs.next_line(), if logs_open => match line {
                Ok(Some(line)) => log_line(&status, line),
                _ => logs_open = false,
            },
            result = child.wait() => {
                // The process can exit before select! handles its last stdout
                // event. Keep the specific startup error instead of losing it
                // to a generic exit-code message. Bound inherited pipe waits.
                let _ = tokio::time::timeout(std::time::Duration::from_millis(250), async {
                    while let Ok(Some(line)) = events.next_line().await {
                        bridge_event(&status, &line);
                    }
                    while let Ok(Some(line)) = logs.next_line().await {
                        log_line(&status, line);
                    }
                }).await;
                let mut status = status.lock().unwrap();
                status.phase = "error".into();
                if status.error.is_none() {
                    status.error = Some(format!("Webcam output stopped ({}). Close any other OBS Virtual Camera publisher, check diagnostics, then start again.",
                        result.map(|code| code.to_string()).unwrap_or_else(|error| error.to_string())));
                }
                break;
            }
        }
    }
}

#[tauri::command]
pub async fn webcam_start(
    app: AppHandle,
    state: State<'_, WebcamState>,
    options: WebcamOptions,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Webcam output currently requires Windows.".into());
    }
    validate(&options)?;
    let _operation = state.operation.lock().await;
    stop_worker(&state).await;
    let dir = runtime_dir(&app)?;
    let mut cmd = if let Some(helper) = bundled_helper(&app) {
        command(helper)
    } else {
        if !runtime_ready(&dir).await {
            return Err("Set up the webcam runtime first.".into());
        }
        stage_bridge(&dir)?;
        let mut cmd = command(runtime_python(&dir));
        cmd.arg("-u").arg(dir.join("webcam_bridge.py"));
        cmd
    };
    cmd.args([
        "--url",
        &options.url,
        "--codec",
        &options.codec,
        "--backend",
        "obs",
        "--json-events",
        "--width",
    ])
    .arg(options.width.to_string())
    .arg("--height")
    .arg(options.height.to_string())
    .arg("--fps")
    .arg(options.fps.to_string())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    if options.mirror {
        cmd.arg("--mirror");
    }
    let child = cmd
        .spawn()
        .map_err(|error| format!("Cannot start webcam output: {error}"))?;
    *state.status.lock().unwrap() = WebcamStatus {
        phase: "starting".into(),
        url: Some(options.url),
        ..Default::default()
    };
    let status = Arc::clone(&state.status);
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(supervise(child, status, stopped));
    *state.running.lock().await = Some(Running { stop, task });
    Ok(())
}

#[tauri::command]
pub async fn webcam_stop(state: State<'_, WebcamState>) -> Result<(), String> {
    let _operation = state.operation.lock().await;
    stop_worker(&state).await;
    Ok(())
}

#[tauri::command]
pub fn webcam_status(state: State<'_, WebcamState>) -> WebcamStatus {
    state.status.lock().unwrap().clone()
}

pub async fn shutdown(state: &WebcamState) {
    stop_worker(state).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn stop_and_exit_reap_the_supervised_process() {
        let state = WebcamState::default();
        let mut cmd = if cfg!(target_os = "windows") {
            let mut cmd = command("powershell.exe");
            cmd.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
            cmd
        } else {
            let mut cmd = command("sh");
            cmd.args(["-c", "exec sleep 30"]);
            cmd
        };
        let child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let (stop, stopped) = oneshot::channel();
        let task = tokio::spawn(supervise(child, Arc::clone(&state.status), stopped));
        *state.running.lock().await = Some(Running { stop, task });
        state.status.lock().unwrap().url = Some("http://127.0.0.1:49183/stream".into());
        tokio::time::timeout(Duration::from_secs(3), shutdown(&state))
            .await
            .unwrap();
        assert!(state.running.lock().await.is_none());
        assert_eq!(state.status.lock().unwrap().phase, "stopped");
        assert_eq!(state.status.lock().unwrap().url, None);
        // Stop remains safe after the process has already been reaped.
        shutdown(&state).await;
    }
    #[test]
    fn accepts_only_local_stream_and_bounded_profiles() {
        let mut options = WebcamOptions {
            url: "http://127.0.0.1:49183/stream".into(),
            codec: "hevc".into(),
            width: 1280,
            height: 720,
            fps: 30,
            mirror: false,
        };
        assert!(validate(&options).is_ok());
        options.url = "http://example.com:49183/stream".into();
        assert!(validate(&options).is_err());
        options.url = "http://127.0.0.1:1/stream".into();
        options.width = 100000;
        assert!(validate(&options).is_err());
    }
    #[test]
    fn tracks_decoder_reconnect_and_measured_source_without_confusing_output() {
        let status = Arc::new(StdMutex::new(WebcamStatus::default()));
        bridge_event(
            &status,
            r#"{"event":"publishing","device":"OBS Virtual Camera","fps":30}"#,
        );
        bridge_event(&status, r#"{"event":"reconnecting"}"#);
        assert_eq!(status.lock().unwrap().phase, "reconnecting");
        bridge_event(
            &status,
            r#"{"event":"source","width":1280,"height":960,"observedDecodeFps":23.7}"#,
        );
        let status = status.lock().unwrap();
        assert_eq!(status.phase, "publishing");
        assert_eq!(status.source_fps, Some(23.7));
        assert_eq!(status.output_fps, Some(30.0));
        assert_eq!(status.reconnects, 1);
    }

    #[test]
    fn preserves_actionable_helper_startup_errors() {
        let status = Arc::new(StdMutex::new(WebcamStatus::default()));
        bridge_event(
            &status,
            r#"{"event":"error","message":"No decoded video arrived before the startup deadline."}"#,
        );
        let status = status.lock().unwrap();
        assert_eq!(status.phase, "error");
        assert!(status.error.as_ref().unwrap().contains("startup deadline"));
    }
}
