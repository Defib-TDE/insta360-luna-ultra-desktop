//! Live preview transport.
//!
//! Asks the camera to start a preview stream over the control session that
//! already exists, then re-serves the resulting Annex-B elementary stream on
//! localhost. The relay retains codec headers and the current GOP so a late or
//! briefly lagged client can begin on a decodable keyframe.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::{broadcast, watch, Mutex};
use tokio::task::{JoinHandle, JoinSet};

use crate::diagnostics::{DiagnosticEvent, EventLog};
use crate::luna::{
    wire_field_varint, LunaState, Session, CODE_START_LIVE_STREAM, CODE_STOP_LIVE_STREAM,
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
/// A predictable port lets an external bridge reconnect after Wi-Fi recovery.
/// If another process owns it, the relay falls back to an ephemeral port and
/// returns that actual port to the UI.
const PREFERRED_PORT: u16 = 49_183;
/// Never retain an unbounded GOP if a camera stops producing keyframes.
const MAX_BOOTSTRAP_BYTES: usize = 16 * 1024 * 1024;

/// StartLiveStream, per `insta360.messages.StartLiveStream`:
///   2 enableVideo, 6 videoBitrate, 7 resolution, 8 enableGyro,
///   9 videoBitrate1, 10 resolution1
/// Resolution 9 is RES_1440_720P30 and 18 is RES_480_240P30, matching the
/// known-good capture. The baseline preserves that request exactly. Named
/// experiments change only the primary resolution; schema presence is not a
/// guarantee that Luna supports the requested preview.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
pub enum PreviewProfile {
    #[default]
    #[serde(rename = "baseline")]
    Baseline,
    #[serde(rename = "1080p30")]
    FullHd30,
    #[serde(rename = "1080p60")]
    FullHd60,
    #[serde(rename = "4k30")]
    Uhd30,
    #[serde(rename = "4k60")]
    Uhd60,
}

impl PreviewProfile {
    fn resolution(self) -> u32 {
        match self {
            Self::Baseline => 9,
            Self::FullHd30 => 29,
            Self::FullHd60 => 40,
            Self::Uhd30 => 24,
            Self::Uhd60 => 23,
        }
    }
}

fn build_start_live_stream_body(profile: PreviewProfile) -> Vec<u8> {
    let mut body = wire_field_varint(2, 1);
    body.extend(wire_field_varint(6, 40));
    body.extend(wire_field_varint(7, profile.resolution()));
    body.extend(wire_field_varint(8, 1));
    body.extend(wire_field_varint(9, 40));
    body.extend(wire_field_varint(10, 18));
    body
}

fn response_head() -> Vec<u8> {
    concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: application/octet-stream\r\n",
        "Cache-Control: no-store\r\n",
        "Access-Control-Allow-Origin: *\r\n",
        "X-Luna-Stream-Format: annex-b\r\n",
        "Connection: close\r\n\r\n"
    )
    .as_bytes()
    .to_vec()
}

/// Counters so a failed run explains itself instead of showing a blank canvas.
#[derive(Default)]
struct Stats {
    bytes: AtomicU64,
    packets: AtomicU64,
    first_bytes: StdMutex<Vec<u8>>,
    started: StdMutex<Option<Instant>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Codec {
    H264,
    H265,
}

#[derive(Clone)]
struct StreamPacket {
    generation: u64,
    sequence: u64,
    keyframe: bool,
    data: Arc<[u8]>,
}

#[derive(Default)]
struct Bootstrap {
    generation: u64,
    codec: Option<Codec>,
    parameter_sets: Vec<(u8, Vec<u8>)>,
    gop: Vec<Arc<[u8]>>,
    gop_bytes: usize,
    through_sequence: u64,
}

struct BootstrapSnapshot {
    generation: u64,
    through_sequence: u64,
    ready: bool,
    chunks: Vec<Arc<[u8]>>,
}

impl Bootstrap {
    fn invalidate_gop(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.gop.clear();
        self.gop_bytes = 0;
    }

    fn ingest(&mut self, sequence: u64, payload: Arc<[u8]>) -> bool {
        self.through_sequence = sequence;
        let units = annexb_units(&payload);

        if self.codec.is_none() {
            self.codec = units.iter().find_map(|unit| detect_codec(unit));
        }

        let mut keyframe = false;
        let mut headers_changed = false;
        if let Some(codec) = self.codec {
            for unit in units {
                let Some(nal_type) = nal_type(unit, codec) else {
                    continue;
                };
                if is_parameter_set(codec, nal_type) {
                    let bytes = unit.to_vec();
                    if let Some((_, saved)) = self
                        .parameter_sets
                        .iter_mut()
                        .find(|(saved_type, _)| *saved_type == nal_type)
                    {
                        headers_changed |= *saved != bytes;
                        *saved = bytes;
                    } else {
                        self.parameter_sets.push((nal_type, bytes));
                    }
                }
                keyframe |= is_keyframe(codec, nal_type);
            }
        }

        if headers_changed {
            self.invalidate_gop();
        }
        if keyframe {
            self.gop.clear();
            self.gop_bytes = 0;
        }
        if keyframe || !self.gop.is_empty() {
            self.gop_bytes += payload.len();
            self.gop.push(payload);
            if self.gop_bytes > MAX_BOOTSTRAP_BYTES {
                self.gop.clear();
                self.gop_bytes = 0;
            }
        }
        keyframe
    }

    fn snapshot(&self) -> BootstrapSnapshot {
        let mut chunks: Vec<Arc<[u8]>> = self
            .parameter_sets
            .iter()
            .map(|(_, bytes)| Arc::<[u8]>::from(bytes.clone()))
            .collect();
        chunks.extend(self.gop.iter().cloned());
        BootstrapSnapshot {
            generation: self.generation,
            through_sequence: self.through_sequence,
            ready: !self.gop.is_empty(),
            chunks,
        }
    }
}

fn start_code_len(bytes: &[u8], at: usize) -> Option<usize> {
    if bytes.get(at..at + 4) == Some(&[0, 0, 0, 1]) {
        Some(4)
    } else if bytes.get(at..at + 3) == Some(&[0, 0, 1]) {
        Some(3)
    } else {
        None
    }
}

fn annexb_units(bytes: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut cursor = 0;
    while cursor + 3 <= bytes.len() {
        if let Some(prefix) = start_code_len(bytes, cursor) {
            starts.push((cursor, prefix));
            cursor += prefix;
        } else {
            cursor += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .filter_map(|(index, (start, prefix))| {
            let end = starts
                .get(index + 1)
                .map(|(next, _)| *next)
                .unwrap_or(bytes.len());
            (*start + *prefix < end).then_some(&bytes[*start..end])
        })
        .collect()
}

fn nal_header(unit: &[u8]) -> Option<u8> {
    let prefix = start_code_len(unit, 0)?;
    unit.get(prefix).copied()
}

fn detect_codec(unit: &[u8]) -> Option<Codec> {
    let header = nal_header(unit)?;
    match (header & 0x1f, (header >> 1) & 0x3f) {
        (7 | 8, _) => Some(Codec::H264),
        (_, 32..=34) => Some(Codec::H265),
        _ => None,
    }
}

fn nal_type(unit: &[u8], codec: Codec) -> Option<u8> {
    let header = nal_header(unit)?;
    Some(match codec {
        Codec::H264 => header & 0x1f,
        Codec::H265 => (header >> 1) & 0x3f,
    })
}

fn is_parameter_set(codec: Codec, nal_type: u8) -> bool {
    match codec {
        Codec::H264 => matches!(nal_type, 7 | 8),
        Codec::H265 => matches!(nal_type, 32..=34),
    }
}

fn is_keyframe(codec: Codec, nal_type: u8) -> bool {
    match codec {
        Codec::H264 => nal_type == 5,
        Codec::H265 => (16..=21).contains(&nal_type),
    }
}

#[derive(Default)]
pub struct LiveViewState {
    inner: Mutex<Option<Running>>,
    diagnostics: Arc<RelayDiagnostics>,
}

#[derive(Default)]
struct RelayDiagnostics {
    source_lagged_packets: AtomicU64,
    client_lagged_packets: AtomicU64,
    header_changes: AtomicU64,
    client_connections: AtomicU64,
    last_packet: StdMutex<Option<Instant>>,
    events: EventLog,
}

struct Running {
    port: u16,
    profile: PreviewProfile,
    session: Weak<Session>,
    stats: Arc<Stats>,
    shutdown: watch::Sender<bool>,
    server: JoinHandle<()>,
    pump: JoinHandle<()>,
}

impl Running {
    fn belongs_to(&self, session: &Arc<Session>) -> bool {
        self.session
            .upgrade()
            .is_some_and(|running_session| Arc::ptr_eq(&running_session, session))
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
        self.server.abort();
        self.pump.abort();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewInfo {
    pub url: String,
    pub port: u16,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewStats {
    pub bytes: u64,
    /// UCD2 media payloads received; these are not necessarily decoded frames.
    pub packets: u64,
    pub first_bytes_hex: String,
    pub seconds: f64,
    /// Cumulative for this app process, preserved across preview restarts.
    pub source_lagged_packets: u64,
    pub client_lagged_packets: u64,
    pub header_changes: u64,
    pub client_connections: u64,
    pub last_packet_age_seconds: Option<f64>,
    pub events: Vec<DiagnosticEvent>,
    pub requested_profile: Option<PreviewProfile>,
}

async fn write_bootstrap(
    socket: &mut TcpStream,
    snapshot: &BootstrapSnapshot,
) -> std::io::Result<()> {
    for chunk in &snapshot.chunks {
        socket.write_all(chunk).await?;
    }
    Ok(())
}

async fn serve_client(
    mut socket: TcpStream,
    stream_tx: broadcast::Sender<StreamPacket>,
    bootstrap: Arc<StdMutex<Bootstrap>>,
    mut shutdown: watch::Receiver<bool>,
    diagnostics: Arc<RelayDiagnostics>,
) {
    diagnostics
        .client_connections
        .fetch_add(1, Ordering::Relaxed);
    let mut receiver = stream_tx.subscribe();
    let mut scratch = [0u8; 1024];
    let request = tokio::select! {
        _ = shutdown.changed() => return,
        request = socket.read(&mut scratch) => request,
    };
    if request.is_err() || socket.write_all(&response_head()).await.is_err() {
        return;
    }

    let snapshot = bootstrap.lock().unwrap().snapshot();
    let through_sequence = snapshot.through_sequence;
    let mut ready = snapshot.ready;
    if write_bootstrap(&mut socket, &snapshot).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            received = receiver.recv() => match received {
                Ok(packet) => {
                    if packet.generation < snapshot.generation {
                        continue;
                    }
                    // A lost encoded packet or new codec headers breaks this
                    // decoder's history. Close so clients join a fresh bootstrap.
                    if packet.generation != snapshot.generation {
                        diagnostics.events.note("Decoder client rejoining after source headers changed or source packets were lost.");
                        return;
                    }
                    if packet.sequence <= through_sequence || (!ready && !packet.keyframe) {
                        continue;
                    }
                    if packet.keyframe {
                        ready = true;
                    }
                    if socket.write_all(&packet.data).await.is_err() {
                        break;
                    }
                }
                // Replaying headers into a decoder with missing references
                // is unreliable. A new HTTP connection gets a fresh decoder.
                Err(RecvError::Lagged(lost)) => {
                    diagnostics.client_lagged_packets.fetch_add(lost, Ordering::Relaxed);
                    diagnostics.events.note(format!("Decoder client fell behind by {lost} encoded payloads; closing for a fresh keyframe."));
                    break;
                },
                Err(RecvError::Closed) => break,
            }
        }
    }
}

/// Serve the elementary stream to whichever clients connect. Each connection
/// gets a bootstrap snapshot followed by the live edge.
async fn serve(
    listener: TcpListener,
    stream_tx: broadcast::Sender<StreamPacket>,
    bootstrap: Arc<StdMutex<Bootstrap>>,
    mut shutdown: watch::Receiver<bool>,
    diagnostics: Arc<RelayDiagnostics>,
) {
    let mut clients = JoinSet::new();
    loop {
        let accepted = tokio::select! {
            _ = shutdown.changed() => break,
            _ = clients.join_next(), if !clients.is_empty() => continue,
            accepted = listener.accept() => accepted,
        };
        let Ok((socket, _)) = accepted else { break };
        clients.spawn(serve_client(
            socket,
            stream_tx.clone(),
            Arc::clone(&bootstrap),
            shutdown.clone(),
            Arc::clone(&diagnostics),
        ));
    }
    // Also cancels clients blocked while writing to a slow consumer. JoinSet's
    // drop aborts them if Running aborts this listener task during teardown.
    clients.abort_all();
    while clients.join_next().await.is_some() {}
}

async fn bind_listener() -> Result<TcpListener, String> {
    match TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).await {
        Ok(listener) => Ok(listener),
        Err(preferred_error) => TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|fallback_error| {
                format!(
                    "cannot open local stream port {PREFERRED_PORT} ({preferred_error}) or an ephemeral port ({fallback_error})"
                )
            }),
    }
}

#[tauri::command]
pub async fn luna_liveview_start(
    luna: State<'_, LunaState>,
    live: State<'_, LiveViewState>,
    profile: Option<PreviewProfile>,
) -> Result<LiveViewInfo, String> {
    let profile = profile.unwrap_or_default();
    let session = luna
        .session()
        .await
        .ok_or_else(|| "camera is not connected".to_string())?;

    let mut guard = live.inner.lock().await;
    if let Some(running) = guard.as_ref() {
        if running.belongs_to(&session) {
            if running.profile != profile {
                return Err("Stop the current preview before changing source profile.".into());
            }
            return Ok(LiveViewInfo {
                url: format!("http://127.0.0.1:{}/stream", running.port),
                port: running.port,
            });
        }
        // A reconnect replaced the control session. Stop the stale relay before
        // binding a new one, even if the UI never managed to call stop.
        guard.take();
    }

    let listener = bind_listener().await?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("cannot read the local stream port: {e}"))?
        .port();

    let stats = Arc::new(Stats::default());
    *stats.started.lock().unwrap() = Some(Instant::now());
    let bootstrap = Arc::new(StdMutex::new(Bootstrap::default()));
    let (stream_tx, _) = broadcast::channel::<StreamPacket>(512);
    let (shutdown, shutdown_rx) = watch::channel(false);

    let pump_stats = Arc::clone(&stats);
    let pump_bootstrap = Arc::clone(&bootstrap);
    let pump_tx = stream_tx.clone();
    let pump_shutdown = shutdown.clone();
    let pump_diagnostics = Arc::clone(&live.diagnostics);
    let mut camera_rx = session.subscribe_stream();
    let pump = tokio::spawn(async move {
        let mut sequence = 0u64;
        loop {
            match camera_rx.recv().await {
                Ok(payload) => {
                    *pump_diagnostics.last_packet.lock().unwrap() = Some(Instant::now());
                    sequence = sequence.wrapping_add(1);
                    pump_stats
                        .bytes
                        .fetch_add(payload.len() as u64, Ordering::Relaxed);
                    pump_stats.packets.fetch_add(1, Ordering::Relaxed);
                    let mut first = pump_stats.first_bytes.lock().unwrap();
                    if first.is_empty() {
                        *first = payload.iter().copied().take(64).collect();
                    }
                    drop(first);

                    let data = Arc::<[u8]>::from(payload);
                    let (keyframe, generation) = {
                        let mut bootstrap = pump_bootstrap.lock().unwrap();
                        let previous_generation = bootstrap.generation;
                        let keyframe = bootstrap.ingest(sequence, Arc::clone(&data));
                        if bootstrap.generation != previous_generation {
                            pump_diagnostics
                                .header_changes
                                .fetch_add(1, Ordering::Relaxed);
                            pump_diagnostics
                                .events
                                .note("Camera codec headers changed; discarding the old GOP.");
                        }
                        (keyframe, bootstrap.generation)
                    };
                    let _ = pump_tx.send(StreamPacket {
                        generation,
                        sequence,
                        keyframe,
                        data,
                    });
                }
                Err(RecvError::Lagged(lost)) => {
                    pump_diagnostics
                        .source_lagged_packets
                        .fetch_add(lost, Ordering::Relaxed);
                    pump_diagnostics.events.note(format!("Video relay fell behind by {lost} encoded payloads; waiting for a fresh keyframe."));
                    let generation = {
                        let mut bootstrap = pump_bootstrap.lock().unwrap();
                        bootstrap.invalidate_gop();
                        bootstrap.generation
                    };
                    let _ = pump_tx.send(StreamPacket {
                        generation,
                        sequence,
                        keyframe: false,
                        data: Arc::from([]),
                    });
                }
                Err(RecvError::Closed) => {
                    pump_diagnostics.events.note("Camera video source closed.");
                    break;
                }
            }
        }
        let _ = pump_shutdown.send(true);
    });

    let server = tokio::spawn(serve(
        listener,
        stream_tx,
        bootstrap,
        shutdown_rx,
        Arc::clone(&live.diagnostics),
    ));
    let running = Running {
        port,
        profile,
        session: Arc::downgrade(&session),
        stats,
        shutdown,
        server,
        pump,
    };

    if let Err(error) = session
        .send_command(
            CODE_START_LIVE_STREAM,
            &build_start_live_stream_body(profile),
            COMMAND_TIMEOUT,
        )
        .await
    {
        drop(running);
        return Err(format!("camera rejected START_LIVE_STREAM: {error}"));
    }

    *guard = Some(running);
    live.diagnostics.events.note(format!("Camera preview request {profile:?} accepted; delivered quality must be decoded and measured."));
    Ok(LiveViewInfo {
        url: format!("http://127.0.0.1:{port}/stream"),
        port,
    })
}

#[tauri::command]
pub async fn luna_liveview_stop(
    luna: State<'_, LunaState>,
    live: State<'_, LiveViewState>,
) -> Result<(), String> {
    // Dropping Running broadcasts shutdown to every accepted HTTP client before
    // aborting the listener and camera pump.
    live.inner.lock().await.take();
    live.diagnostics
        .events
        .note("Camera preview stopped by the app.");
    if let Some(session) = luna.session().await {
        let _ = session
            .send_command(CODE_STOP_LIVE_STREAM, &[], COMMAND_TIMEOUT)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn luna_liveview_stats(live: State<'_, LiveViewState>) -> Result<LiveViewStats, String> {
    let guard = live.inner.lock().await;
    let diagnostics = &live.diagnostics;
    let snapshot = LiveViewStats {
        source_lagged_packets: diagnostics.source_lagged_packets.load(Ordering::Relaxed),
        client_lagged_packets: diagnostics.client_lagged_packets.load(Ordering::Relaxed),
        header_changes: diagnostics.header_changes.load(Ordering::Relaxed),
        client_connections: diagnostics.client_connections.load(Ordering::Relaxed),
        last_packet_age_seconds: diagnostics
            .last_packet
            .lock()
            .unwrap()
            .map(|at| at.elapsed().as_secs_f64()),
        events: diagnostics.events.snapshot(),
        ..LiveViewStats::default()
    };
    let Some(running) = guard.as_ref() else {
        return Ok(snapshot);
    };
    let first = running.stats.first_bytes.lock().unwrap().clone();
    let seconds = running
        .stats
        .started
        .lock()
        .unwrap()
        .map(|at| at.elapsed().as_secs_f64())
        .unwrap_or_default();
    Ok(LiveViewStats {
        bytes: running.stats.bytes.load(Ordering::Relaxed),
        packets: running.stats.packets.load(Ordering::Relaxed),
        first_bytes_hex: first.iter().map(|b| format!("{b:02x}")).collect(),
        seconds,
        requested_profile: Some(running.profile),
        ..snapshot
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h264(nal_type: u8, marker: u8) -> Arc<[u8]> {
        Arc::from(vec![0, 0, 0, 1, 0x60 | nal_type, marker])
    }

    /// The body must match the capture from published reverse-engineering
    /// work byte for byte: enableVideo, videoBitrate 40, resolution 9
    /// (RES_1440_720P30), enableGyro, videoBitrate1 40, resolution1 18.
    #[test]
    fn start_live_stream_body_matches_known_capture() {
        let expected: Vec<u8> = vec![
            0x10, 0x01, 0x30, 0x28, 0x38, 0x09, 0x40, 0x01, 0x48, 0x28, 0x50, 0x12,
        ];
        assert_eq!(
            build_start_live_stream_body(PreviewProfile::Baseline),
            expected
        );
    }

    #[test]
    fn experimental_requests_change_only_primary_resolution_and_reject_unknown_profiles() {
        let baseline = build_start_live_stream_body(PreviewProfile::Baseline);
        for (profile, resolution) in [
            (PreviewProfile::FullHd30, 29),
            (PreviewProfile::FullHd60, 40),
            (PreviewProfile::Uhd30, 24),
            (PreviewProfile::Uhd60, 23),
        ] {
            let mut expected = baseline.clone();
            expected[5] = resolution;
            assert_eq!(build_start_live_stream_body(profile), expected);
        }
        assert!(serde_json::from_str::<PreviewProfile>("\"arbitrary\"").is_err());
        assert_eq!(PreviewProfile::default(), PreviewProfile::Baseline);
    }

    #[test]
    fn http_response_head_declares_a_streaming_body() {
        let head = String::from_utf8(response_head()).unwrap();
        assert!(head.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(head.contains("Content-Type: application/octet-stream"));
        assert!(head.contains("Access-Control-Allow-Origin: *"));
        assert!(head.contains("X-Luna-Stream-Format: annex-b"));
        assert!(head.ends_with("\r\n\r\n"));
    }

    #[test]
    fn bootstrap_contains_headers_and_current_gop_for_late_clients() {
        let mut bootstrap = Bootstrap::default();
        bootstrap.ingest(1, h264(7, 0x11));
        bootstrap.ingest(2, h264(8, 0x22));
        bootstrap.ingest(3, h264(5, 0x33));
        bootstrap.ingest(4, h264(1, 0x44));

        let snapshot = bootstrap.snapshot();
        assert!(snapshot.ready);
        assert_eq!(snapshot.through_sequence, 4);
        assert_eq!(snapshot.chunks.len(), 4);
        assert_eq!(snapshot.chunks[0].last(), Some(&0x11));
        assert_eq!(snapshot.chunks[1].last(), Some(&0x22));
        assert_eq!(snapshot.chunks[2].last(), Some(&0x33));
        assert_eq!(snapshot.chunks[3].last(), Some(&0x44));
    }

    #[test]
    fn newer_keyframe_replaces_old_gop() {
        let mut bootstrap = Bootstrap::default();
        bootstrap.ingest(1, h264(7, 0x11));
        bootstrap.ingest(2, h264(8, 0x22));
        bootstrap.ingest(3, h264(5, 0x33));
        bootstrap.ingest(4, h264(1, 0x44));
        bootstrap.ingest(5, h264(5, 0x55));

        let snapshot = bootstrap.snapshot();
        assert_eq!(snapshot.through_sequence, 5);
        assert_eq!(snapshot.chunks.len(), 3);
        assert_eq!(snapshot.chunks[2].last(), Some(&0x55));
    }

    #[test]
    fn changed_headers_discard_reference_frames_until_a_fresh_keyframe() {
        let mut bootstrap = Bootstrap::default();
        bootstrap.ingest(1, h264(7, 0x11));
        bootstrap.ingest(2, h264(8, 0x22));
        bootstrap.ingest(3, h264(5, 0x33));
        bootstrap.ingest(4, h264(7, 0x66));
        bootstrap.ingest(5, h264(1, 0x44));
        let snapshot = bootstrap.snapshot();
        assert_eq!(snapshot.generation, 1);
        assert!(!snapshot.ready);
        assert_eq!(snapshot.chunks.len(), 2);
        assert_eq!(snapshot.chunks[0].last(), Some(&0x66));
        bootstrap.ingest(6, h264(5, 0x55));
        assert!(bootstrap.snapshot().ready);
        assert_eq!(bootstrap.snapshot().chunks.len(), 3);
    }

    #[test]
    fn hevc_bootstrap_retains_vps_sps_pps_and_waits_for_a_new_random_access_frame() {
        let nal = |kind: u8, byte: u8| Arc::<[u8]>::from(vec![0, 0, 0, 1, kind << 1, 1, byte]);
        let mut bootstrap = Bootstrap::default();
        bootstrap.ingest(1, nal(32, 0x11));
        bootstrap.ingest(2, nal(33, 0x22));
        bootstrap.ingest(3, nal(34, 0x33));
        bootstrap.ingest(4, nal(19, 0x44));
        assert!(bootstrap.snapshot().ready);
        assert_eq!(bootstrap.snapshot().chunks.len(), 4);
        bootstrap.ingest(5, nal(33, 0x55));
        assert!(!bootstrap.snapshot().ready);
        assert_eq!(bootstrap.snapshot().generation, 1);
        bootstrap.ingest(6, nal(1, 0x66));
        assert!(!bootstrap.snapshot().ready);
        bootstrap.ingest(7, nal(21, 0x77));
        assert!(bootstrap.snapshot().ready);
        assert_eq!(bootstrap.snapshot().chunks.len(), 4);
    }

    #[tokio::test]
    async fn invalidated_decoder_history_closes_existing_http_client() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stream_tx, _) = broadcast::channel(4);
        let bootstrap = Arc::new(StdMutex::new(Bootstrap::default()));
        let (shutdown, shutdown_rx) = watch::channel(false);
        let server = tokio::spawn(serve(
            listener,
            stream_tx.clone(),
            bootstrap,
            shutdown_rx,
            Arc::new(RelayDiagnostics::default()),
        ));
        let mut client = TcpStream::connect(address).await.unwrap();
        client
            .write_all(b"GET /stream HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = [0u8; 256];
        assert!(client.read(&mut response).await.unwrap() > 0);
        assert!(stream_tx
            .send(StreamPacket {
                generation: 1,
                sequence: 1,
                keyframe: false,
                data: Arc::from([]),
            })
            .is_ok());
        let closed = tokio::time::timeout(Duration::from_secs(1), client.read(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(closed, 0);
        shutdown.send(true).unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn shutdown_closes_existing_http_client() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stream_tx, _) = broadcast::channel(4);
        let bootstrap = Arc::new(StdMutex::new(Bootstrap::default()));
        let (shutdown, shutdown_rx) = watch::channel(false);
        let server = tokio::spawn(serve(
            listener,
            stream_tx,
            bootstrap,
            shutdown_rx,
            Arc::new(RelayDiagnostics::default()),
        ));

        let mut client = TcpStream::connect(address).await.unwrap();
        client
            .write_all(b"GET /stream HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = [0u8; 256];
        let count = client.read(&mut response).await.unwrap();
        assert!(String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 200 OK"));

        shutdown.send(true).unwrap();
        server.await.unwrap();
        let closed = tokio::time::timeout(Duration::from_secs(1), client.read(&mut response))
            .await
            .expect("client socket stayed open after shutdown")
            .unwrap();
        assert_eq!(closed, 0);
    }

    #[tokio::test]
    async fn slow_decoder_gets_a_clean_close_and_a_recorded_lag_reason() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stream_tx, _) = broadcast::channel(1);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let diagnostics = Arc::new(RelayDiagnostics::default());
        let server = tokio::spawn(serve(
            listener,
            stream_tx.clone(),
            Arc::default(),
            shutdown_rx,
            Arc::clone(&diagnostics),
        ));
        let mut client = TcpStream::connect(address).await.unwrap();
        client
            .write_all(b"GET /stream HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = [0; 256];
        assert!(client.read(&mut response).await.unwrap() > 0);
        for sequence in 1..=3 {
            assert!(stream_tx
                .send(StreamPacket {
                    generation: 0,
                    sequence,
                    keyframe: true,
                    data: h264(5, 1),
                })
                .is_ok());
        }
        let closed = tokio::time::timeout(Duration::from_secs(1), client.read(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(closed, 0);
        assert_eq!(diagnostics.client_lagged_packets.load(Ordering::Relaxed), 2);
        assert!(diagnostics
            .events
            .snapshot()
            .iter()
            .any(|event| event.message.contains("fell behind")));
        shutdown.send(true).unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn aborting_listener_also_releases_its_client_tasks() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stream_tx, _) = broadcast::channel(4);
        let (_shutdown, shutdown_rx) = watch::channel(false);
        let server = tokio::spawn(serve(
            listener,
            stream_tx,
            Arc::new(StdMutex::new(Bootstrap::default())),
            shutdown_rx,
            Arc::new(RelayDiagnostics::default()),
        ));
        let mut client = TcpStream::connect(address).await.unwrap();
        client
            .write_all(b"GET /stream HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = [0u8; 256];
        assert!(client.read(&mut response).await.unwrap() > 0);
        server.abort();
        assert!(server.await.unwrap_err().is_cancelled());
        let closed = tokio::time::timeout(Duration::from_secs(1), client.read(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(closed, 0);
    }
}
