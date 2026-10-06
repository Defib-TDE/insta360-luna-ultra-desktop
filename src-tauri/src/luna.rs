//! Insta360 Luna Ultra TCP control protocol (UCD2 framing), ported from
//! luna-ai-cut's electron/insta360TcpProtocol.ts. The camera exposes:
//! - TCP control on port 6666: auth handshake, device info, delete commands.
//!   A live control session also unlocks the camera's HTTP media index.
//! - HTTP on port 80: autoindex-style media listings and Range downloads
//!   (consumed from the frontend via the http plugin).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpStream;
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;

use crate::diagnostics::{BuildIdentity, DiagnosticEvent, EventLog};

const UCD2_MAGIC: &[u8; 4] = b"UCD2";
const UCD2_VERSION: u8 = 0x01;
const UCD2_FLAGS: u8 = 0x0c;
const UCD2_FILE: u8 = 0x04;
const UCD2_STREAM: u8 = 0x05;
/// Live media (video, secondary preview, gyro) rides its own frame type.
const UCD2_MEDIA: u8 = 0x01;

/// Every media frame opens with a 9-byte header; the Annex-B elementary
/// stream begins immediately after it.
const MEDIA_HEADER_LEN: usize = 9;
/// Substream selector, the first header byte. 0x30 is the secondary preview
/// and 0x40 is gyro; only the primary video is forwarded.
pub(crate) const MEDIA_VIDEO: u8 = 0x20;

pub(crate) const CODE_START_LIVE_STREAM: u16 = 1;
pub(crate) const CODE_STOP_LIVE_STREAM: u16 = 2;
const CODE_TAKE_PICTURE: u16 = 3;
const CODE_START_CAPTURE: u16 = 4;
const CODE_STOP_CAPTURE: u16 = 5;
const CODE_SET_OPTIONS: u16 = 7;
const CODE_GET_OPTIONS: u16 = 8;
const CODE_SET_PHOTOGRAPHY_OPTIONS: u16 = 9;
const CODE_GET_PHOTOGRAPHY_OPTIONS: u16 = 10;
const CODE_DELETE_FILES: u16 = 12;
const CODE_GET_FILE_LIST: u16 = 13;
const CODE_GET_CURRENT_CAPTURE_STATUS: u16 = 15;

const CONTROL_PORT: u16 = 6666;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(3);
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);
const RECEIVE_GRACE: Duration = Duration::from_secs(12);

/// Insta360's packet checksum, appended little-endian to every UCD2 FILE
/// frame. A nonstandard CRC-32 variant (poly 0x04C11DB7): each input byte is
/// XORed into the LOW byte and followed by four MSB table rounds. Ported
/// verbatim from insta360TcpProtocol.ts; do not "fix" it to a standard CRC.
fn checksum_table() -> &'static [u32; 256] {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (i, slot) in table.iter_mut().enumerate() {
            let mut value = (i as u32) << 24;
            for _ in 0..8 {
                value = if value & 0x8000_0000 != 0 {
                    (value << 1) ^ 0x04c1_1db7
                } else {
                    value << 1
                };
            }
            *slot = value;
        }
        table
    })
}

fn insta360_checksum(data: &[u8]) -> u32 {
    let table = checksum_table();
    let mut checksum: u32 = 0xffff_ffff;
    for &byte in data {
        checksum ^= u32::from(byte);
        for _ in 0..4 {
            checksum = (checksum << 8) ^ table[(checksum >> 24) as usize];
        }
    }
    checksum
}

fn wire_varint(mut value: u32) -> Vec<u8> {
    let mut out = Vec::new();
    while value > 0x7f {
        out.push(((value & 0x7f) as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
    out
}

pub(crate) fn wire_field_varint(field: u32, value: u32) -> Vec<u8> {
    let mut out = wire_varint(field << 3);
    out.extend(wire_varint(value));
    out
}

/// DeleteFiles { repeated string uri = 1 }
fn build_delete_files_body(camera_paths: &[String]) -> Vec<u8> {
    let mut body = Vec::new();
    for path in camera_paths {
        let bytes = path.as_bytes();
        body.push(0x0a);
        body.extend(wire_varint(bytes.len() as u32));
        body.extend_from_slice(bytes);
    }
    body
}

fn build_ucd2(frame_type: u8, seq: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.extend_from_slice(UCD2_MAGIC);
    frame.push(UCD2_VERSION);
    frame.push(UCD2_FLAGS);
    frame.push(frame_type);
    frame.push(seq);
    frame.extend_from_slice(payload);
    frame
}

fn build_stream_hello(seq: u8) -> Vec<u8> {
    let mut payload = vec![0u8; 4];
    payload.extend_from_slice(&[0xf6, 0xcc, 0x4f, 0x09]);
    build_ucd2(UCD2_STREAM, seq, &payload)
}

fn build_file_command(seq: u8, code: u16, request_id: u16, body: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity(9 + body.len());
    raw.extend_from_slice(&code.to_le_bytes());
    raw.push(0x02);
    raw.extend_from_slice(&request_id.to_le_bytes());
    raw.extend_from_slice(&0x8000u32.to_le_bytes());
    raw.extend_from_slice(body);

    let mut payload = Vec::with_capacity(4 + raw.len());
    payload.extend_from_slice(&(raw.len() as u32).to_le_bytes());
    payload.extend_from_slice(&raw);

    let mut frame = build_ucd2(UCD2_FILE, seq, &payload);
    let trailer = insta360_checksum(&frame).to_le_bytes();
    frame.extend_from_slice(&trailer);
    frame
}

#[derive(Debug, Clone)]
pub(crate) struct RawResponse {
    /// Echoed command code. A reply alone does not establish command success.
    code: u16,
    request_id: u16,
    response_type: u8,
    envelope_value: u32,
    body: Vec<u8>,
}

impl RawResponse {
    /// Numeric envelope metadata only: never export opaque camera reply bodies.
    /// The envelope value is intentionally not interpreted as a success code.
    pub(crate) fn diagnostic_summary(&self) -> String {
        format!(
            "reply command {}, type {}, envelope {}, body {} bytes",
            self.code,
            self.response_type,
            self.envelope_value,
            self.body.len()
        )
    }
}

/// A parsed UCD2 frame. FILE answers commands, STREAM is the keepalive
/// echo, and MEDIA carries the live preview substreams.
#[derive(Debug, Clone)]
pub(crate) enum Frame {
    File(RawResponse),
    /// Keepalive echo. Carries no payload we use — the probe proved video
    /// rides MEDIA frames, never these.
    Stream,
    Media {
        substream: u8,
        data: Vec<u8>,
    },
}

/// Incremental UCD2 frame scanner over the receive buffer. Returns complete
/// frames and consumes processed bytes.
///
/// All three frame types share one length formula: `12 + declared + 4`. The
/// keepalive hello declares zero and is 16 bytes, so it is simply the
/// degenerate case rather than a special case.
fn drain_frames(buffer: &mut Vec<u8>) -> Vec<Frame> {
    let mut frames = Vec::new();
    loop {
        let Some(start) = buffer.windows(4).position(|w| w == UCD2_MAGIC) else {
            // TCP may split anywhere, including inside UCD2. Retain a trailing
            // magic prefix instead of silently losing the next encoded packet.
            let keep = (1..UCD2_MAGIC.len())
                .rev()
                .find(|&len| buffer.ends_with(&UCD2_MAGIC[..len]))
                .unwrap_or(0);
            buffer.drain(..buffer.len() - keep);
            break;
        };
        if start > 0 {
            buffer.drain(..start);
        }
        if buffer.len() < 12 {
            break;
        }
        let frame_type = buffer[6];
        if frame_type != UCD2_FILE && frame_type != UCD2_STREAM && frame_type != UCD2_MEDIA {
            buffer.drain(..8);
            continue;
        }
        let declared = u32::from_le_bytes([buffer[8], buffer[9], buffer[10], buffer[11]]) as usize;
        // Guard against a corrupt length turning into an unbounded allocation
        if declared > 8 * 1024 * 1024 {
            buffer.drain(..8);
            continue;
        }
        let frame_len = 12 + declared + 4;
        if buffer.len() < frame_len {
            break;
        }
        let frame: Vec<u8> = buffer.drain(..frame_len).collect();

        if frame_type == UCD2_STREAM {
            frames.push(Frame::Stream);
            continue;
        }
        if frame_type == UCD2_MEDIA {
            if declared > MEDIA_HEADER_LEN {
                frames.push(Frame::Media {
                    substream: frame[12],
                    data: frame[12 + MEDIA_HEADER_LEN..12 + declared].to_vec(),
                });
            }
            continue;
        }
        if declared < 9 {
            continue;
        }
        let raw = &frame[12..12 + declared];
        frames.push(Frame::File(RawResponse {
            code: u16::from_le_bytes([raw[0], raw[1]]),
            request_id: u16::from_le_bytes([raw[3], raw[4]]),
            response_type: raw[2],
            envelope_value: u32::from_le_bytes([raw[5], raw[6], raw[7], raw[8]]),
            body: raw[9..].to_vec(),
        }));
    }
    frames
}

fn extract_ascii_strings(data: &[u8]) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();
    for &byte in data {
        if (0x20..=0x7e).contains(&byte) {
            current.push(byte as char);
        } else {
            if current.len() >= 4 {
                strings.push(std::mem::take(&mut current));
            }
            current.clear();
        }
    }
    if current.len() >= 4 {
        strings.push(current);
    }
    strings
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaDeviceInfo {
    pub host: String,
    pub device_name: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    pub ssid: Option<String>,
}

/// Heuristic device-info extraction from GET_OPTIONS / capture-status
/// responses, mirroring luna-ai-cut's insta360DeviceInfo.ts.
fn parse_device_info(host: &str, bodies: &[Vec<u8>]) -> LunaDeviceInfo {
    let mut seen: Vec<String> = Vec::new();
    for body in bodies {
        for text in extract_ascii_strings(body) {
            if !seen.contains(&text) {
                seen.push(text);
            }
        }
    }
    let contains_brand = |text: &str| {
        let lower = text.to_lowercase();
        lower.contains("insta360") || lower.contains("luna") || lower.contains("ultra")
    };
    let device_name = seen.iter().find(|text| contains_brand(text)).cloned();
    let serial = seen
        .iter()
        .find(|text| {
            text.len() >= 8
                && text
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        })
        .cloned();
    let firmware = seen
        .iter()
        .find(|text| {
            let stripped = text.strip_prefix('v').unwrap_or(text);
            let parts: Vec<&str> = stripped.splitn(3, '.').collect();
            parts.len() == 3 && parts.iter().take(2).all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        })
        .cloned();
    let ssid = seen
        .iter()
        .find(|text| {
            let lower = text.to_lowercase();
            (lower.contains("luna") || lower.contains("ultra") || lower.contains(".osc"))
                && Some(*text) != device_name.as_ref()
        })
        .cloned();
    LunaDeviceInfo {
        host: host.to_string(),
        device_name,
        serial,
        firmware,
        ssid,
    }
}

pub(crate) struct Session {
    writer: Mutex<OwnedWriteHalf>,
    pending: Arc<StdMutex<HashMap<u16, oneshot::Sender<RawResponse>>>>,
    seq: AtomicU8,
    request_id: AtomicU16,
    reader: StdMutex<Option<JoinHandle<()>>>,
    keepalive: StdMutex<Option<JoinHandle<()>>>,
    info: StdMutex<LunaDeviceInfo>,
    stream_tx: broadcast::Sender<Vec<u8>>,
    health: Arc<SessionHealth>,
    events: Arc<EventLog>,
}

struct SessionHealth {
    closed: AtomicBool,
    last_received: StdMutex<Instant>,
    last_video: StdMutex<Option<Instant>>,
    command_timeouts: AtomicU64,
}

impl Default for SessionHealth {
    fn default() -> Self {
        Self {
            closed: AtomicBool::new(false),
            last_received: StdMutex::new(Instant::now()),
            last_video: StdMutex::new(None),
            command_timeouts: AtomicU64::new(0),
        }
    }
}

impl SessionHealth {
    fn recently_received(&self) -> bool {
        !self.closed.load(Ordering::Relaxed)
            && self.last_received.lock().unwrap().elapsed() < RECEIVE_GRACE
    }
}

/// Removes an unanswered request even when its caller cancels the future.
struct PendingRequest<'a> {
    pending: &'a StdMutex<HashMap<u16, oneshot::Sender<RawResponse>>>,
    id: u16,
}

impl Drop for PendingRequest<'_> {
    fn drop(&mut self) {
        self.pending.lock().unwrap().remove(&self.id);
    }
}

impl Session {
    pub(crate) fn receiving_control(&self) -> bool {
        self.health.recently_received()
    }

    fn next_seq(&self) -> u8 {
        self.seq.fetch_add(1, Ordering::Relaxed)
    }

    fn next_request_id(&self) -> u16 {
        self.request_id.fetch_add(1, Ordering::Relaxed)
    }

    fn device_info(&self) -> LunaDeviceInfo {
        self.info.lock().unwrap().clone()
    }

    async fn write(&self, packet: &[u8]) -> Result<(), String> {
        if self.health.closed.load(Ordering::Relaxed) {
            return Err("camera control session closed".into());
        }
        let result = tokio::time::timeout(WRITE_TIMEOUT, async {
            let mut writer = self.writer.lock().await;
            writer
                .write_all(packet)
                .await
                .map_err(|e| format!("camera write failed: {e}"))
        })
        .await
        .unwrap_or_else(|_| Err("camera write timed out".to_string()));
        if result.is_err() {
            self.health.closed.store(true, Ordering::Relaxed);
        }
        result
    }

    async fn send_packet(
        &self,
        packet: Vec<u8>,
        request_id: u16,
        timeout: Duration,
    ) -> Result<RawResponse, String> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(request_id, tx);
        let _request = PendingRequest {
            pending: &self.pending,
            id: request_id,
        };
        self.write(&packet).await?;
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err("camera control session closed".into()),
            Err(_) => {
                self.health.command_timeouts.fetch_add(1, Ordering::Relaxed);
                let code = u16::from_le_bytes([packet[12], packet[13]]);
                self.events.note(format!(
                    "Control command {code} timed out (request {request_id})."
                ));
                Err(format!("camera command timed out (request {request_id})"))
            }
        }
    }

    /// Subscribe to live video payloads. Bounded: a slow consumer drops
    /// frames rather than growing memory without limit.
    pub(crate) fn subscribe_stream(&self) -> broadcast::Receiver<Vec<u8>> {
        self.stream_tx.subscribe()
    }

    pub(crate) async fn send_command(
        &self,
        code: u16,
        body: &[u8],
        timeout: Duration,
    ) -> Result<RawResponse, String> {
        let request_id = self.next_request_id();
        let packet = build_file_command(self.next_seq(), code, request_id, body);
        self.send_packet(packet, request_id, timeout).await
    }

    /// Replays a captured command byte-for-byte (fixed seq and request id),
    /// as the original app does during the info handshake.
    async fn send_exact(
        &self,
        seq: u8,
        code: u16,
        request_id: u16,
        body: &[u8],
        timeout: Duration,
    ) -> Result<RawResponse, String> {
        let packet = build_file_command(seq, code, request_id, body);
        self.send_packet(packet, request_id, timeout).await
    }

    fn shutdown(&self) {
        self.health.closed.store(true, Ordering::Relaxed);
        self.pending.lock().unwrap().clear();
        if let Some(reader) = self.reader.lock().unwrap().take() {
            reader.abort();
        }
        if let Some(keepalive) = self.keepalive.lock().unwrap().take() {
            keepalive.abort();
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(reader) = self.reader.lock().unwrap().take() {
            reader.abort();
        }
        if let Some(keepalive) = self.keepalive.lock().unwrap().take() {
            keepalive.abort();
        }
    }
}

#[derive(Default)]
pub struct LunaState {
    session: Arc<Mutex<Option<Arc<Session>>>>,
    events: Arc<EventLog>,
    generation: Arc<AtomicU64>,
}

impl LunaState {
    /// The live control session, if one is open.
    pub(crate) async fn session(&self) -> Option<Arc<Session>> {
        self.session.lock().await.as_ref().cloned()
    }
}

/// An obsolete reader/heartbeat must never remove a replacement connection.
async fn remove_current(state: &Mutex<Option<Arc<Session>>>, session: &Arc<Session>) -> bool {
    let mut guard = state.lock().await;
    if guard
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, session))
    {
        guard.take();
        true
    } else {
        false
    }
}

async fn keepalive_tick(session: &Session) -> Result<(), String> {
    session
        .write(&build_stream_hello(session.next_seq()))
        .await?;
    if session.health.recently_received() {
        return Ok(());
    }
    session
        .send_command(CODE_GET_CURRENT_CAPTURE_STATUS, &[], Duration::from_secs(2))
        .await?;
    Ok(())
}

fn small_options_body() -> Vec<u8> {
    let mut body = wire_field_varint(1, 48);
    body.extend(wire_field_varint(1, 15));
    body.extend(wire_field_varint(1, 11));
    body
}

fn large_options_body() -> Vec<u8> {
    const HEX: &str = "0801080308020

84c0806084e084f080b0855080c080d08af01080e080f0813083708110814081e0824086e0872087508590874087308250826082a08280829083008310832084208840108
3a083b083c08430844085d08530852084608580867081008610885010886010877087a087b087c088001088101088701089601089501089301089b01089d01089e0108a001
08b30108a10108160850085108a70108a90108ad0108b40108b00108b1010878086f087908ac01";
    let cleaned: String = HEX.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    (0..cleaned.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).unwrap())
        .collect()
}

async fn open_session(
    app: AppHandle,
    state: Arc<Mutex<Option<Arc<Session>>>>,
    events: Arc<EventLog>,
    generation: Arc<AtomicU64>,
    attempt: u64,
    host: String,
) -> Result<LunaDeviceInfo, String> {
    let stream = tokio::time::timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect((host.as_str(), CONTROL_PORT)),
    )
    .await
    .map_err(|_| format!("connecting to {host}:{CONTROL_PORT} timed out"))?
    .map_err(|e| format!("cannot reach camera at {host}:{CONTROL_PORT}: {e}"))?;

    let (mut read_half, write_half) = stream.into_split();
    let pending: Arc<StdMutex<HashMap<u16, oneshot::Sender<RawResponse>>>> = Arc::default();

    let (stream_tx, _) = broadcast::channel::<Vec<u8>>(512);

    let session = Arc::new(Session {
        writer: Mutex::new(write_half),
        pending: Arc::clone(&pending),
        seq: AtomicU8::new(0x24),
        request_id: AtomicU16::new(1),
        reader: StdMutex::new(None),
        keepalive: StdMutex::new(None),
        info: StdMutex::new(LunaDeviceInfo::default()),
        stream_tx: stream_tx.clone(),
        health: Arc::new(SessionHealth::default()),
        events: Arc::clone(&events),
    });

    let reader_pending = pending;
    let reader_health = Arc::clone(&session.health);
    let reader_session = Arc::downgrade(&session);
    let reader_state = Arc::clone(&state);
    let reader_app = app.clone();
    let reader = tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        let reason = loop {
            match read_half.read(&mut chunk).await {
                Ok(0) => break "Camera closed the control socket.".to_string(),
                Err(error) => break format!("Camera socket read failed: {error}"),
                Ok(n) => {
                    buffer.extend_from_slice(&chunk[..n]);
                    for frame in drain_frames(&mut buffer) {
                        *reader_health.last_received.lock().unwrap() = Instant::now();
                        match frame {
                            Frame::File(response) => {
                                if let Some(tx) = reader_pending.lock().unwrap().remove(&response.request_id) {
                                    let _ = tx.send(response);
                                }
                            }
                            Frame::Media { substream, data }
                                if substream == MEDIA_VIDEO && !data.is_empty() =>
                            {
                                *reader_health.last_video.lock().unwrap() = Some(Instant::now());
                                let _ = stream_tx.send(data);
                            }
                            // Secondary preview and gyro substreams are ignored
                            Frame::Media { .. } => {}
                            // STREAM frames are keepalive echoes, never video
                            Frame::Stream => {}
                        }
                    }
                }
            }
        };
        reader_health.closed.store(true, Ordering::Relaxed);
        // Socket gone: anything still pending gets a closed-channel error
        reader_pending.lock().unwrap().clear();
        if let Some(session) = reader_session.upgrade() {
            if remove_current(&reader_state, &session).await {
                session.events.note(reason);
                session.shutdown();
                let _ = reader_app.emit("luna://disconnected", ());
            }
        }
    });
    session.reader.lock().unwrap().replace(reader);

    // STREAM hello authorizes the HTTP media index a moment later
    session.write(&build_stream_hello(session.next_seq())).await?;

    // Device info probes; tolerate individual failures like the original app
    let info_timeout = Duration::from_secs(4);
    let mut bodies = Vec::new();
    let probes: [(u16, u16, Vec<u8>); 3] = [
        (CODE_GET_OPTIONS, 1, small_options_body()),
        (CODE_GET_CURRENT_CAPTURE_STATUS, 2, Vec::new()),
        (CODE_GET_OPTIONS, 3, large_options_body()),
    ];
    for (code, request_id, body) in probes {
        let seq = session.next_seq();
        if let Ok(response) = session.send_exact(seq, code, request_id, &body, info_timeout).await {
            bodies.push(response.body);
        }
    }
    session.request_id.store(12, Ordering::Relaxed);

    let info = parse_device_info(&host, &bodies);
    *session.info.lock().unwrap() = info.clone();

    // Continue the authorization hello, but avoid extra status/options traffic
    // while valid video, replies or echoes already prove the socket is alive.
    let ka_state = Arc::clone(&state);
    let ka_session = Arc::downgrade(&session);
    let ka_app = app.clone();
    let keepalive = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(KEEPALIVE_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let Some(session) = ka_session.upgrade() else {
                break;
            };
            match keepalive_tick(&session).await {
                Ok(()) => {}
                Err(error) => {
                    if session.health.recently_received() {
                        continue;
                    }
                    if remove_current(&ka_state, &session).await {
                        session
                            .events
                            .note(format!("Control connection stopped responding: {error}"));
                        session.shutdown();
                        let _ = ka_app.emit("luna://disconnected", ());
                    }
                    break;
                }
            }
        }
    });
    session.keepalive.lock().unwrap().replace(keepalive);

    let mut guard = state.lock().await;
    if generation.load(Ordering::Relaxed) != attempt {
        session.shutdown();
        return Err("camera connection attempt was cancelled".into());
    }
    if session.health.closed.load(Ordering::Relaxed) {
        return Err("camera closed the connection during startup".into());
    }
    guard.replace(session);
    events.note("Control connection established.");
    Ok(info)
}

#[tauri::command]
pub async fn luna_connect(
    app: AppHandle,
    state: State<'_, LunaState>,
    host: String,
) -> Result<LunaDeviceInfo, String> {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return Err("camera host is empty".into());
    }
    let attempt = {
        let mut guard = state.session.lock().await;
        let attempt = state.generation.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        if let Some(session) = guard.take() { session.shutdown(); }
        attempt
    };
    open_session(
        app,
        Arc::clone(&state.session),
        Arc::clone(&state.events),
        Arc::clone(&state.generation),
        attempt,
        trimmed.to_string(),
    )
    .await
}

#[tauri::command]
pub async fn luna_disconnect(state: State<'_, LunaState>) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    state.generation.fetch_add(1, Ordering::Relaxed);
    if let Some(session) = guard.take() {
        session.shutdown();
    }
    state.events.note("Control connection stopped by the app.");
    Ok(())
}

#[tauri::command]
pub async fn luna_status(state: State<'_, LunaState>) -> Result<Option<LunaDeviceInfo>, String> {
    Ok(state
        .session
        .lock()
        .await
        .as_ref()
        .map(|session| session.device_info()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDiagnostics {
    build: BuildIdentity,
    connected: bool,
    last_receive_age_seconds: Option<f64>,
    last_video_age_seconds: Option<f64>,
    command_timeouts: u64,
    events: Vec<DiagnosticEvent>,
}

#[tauri::command]
pub async fn luna_connection_diagnostics(
    state: State<'_, LunaState>,
) -> Result<ConnectionDiagnostics, String> {
    let session = state.session().await;
    Ok(ConnectionDiagnostics {
        build: BuildIdentity::current(),
        connected: session
            .as_ref()
            .is_some_and(|s| !s.health.closed.load(Ordering::Relaxed)),
        last_receive_age_seconds: session.as_ref().map(|s| {
            s.health
                .last_received
                .lock()
                .unwrap()
                .elapsed()
                .as_secs_f64()
        }),
        last_video_age_seconds: session.as_ref().and_then(|s| {
            s.health
                .last_video
                .lock()
                .unwrap()
                .map(|at| at.elapsed().as_secs_f64())
        }),
        command_timeouts: session
            .as_ref()
            .map_or(0, |s| s.health.command_timeouts.load(Ordering::Relaxed)),
        events: state.events.snapshot(),
    })
}

#[tauri::command]
pub async fn luna_delete_files(
    state: State<'_, LunaState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let session = {
        let guard = state.session.lock().await;
        guard.as_ref().cloned().ok_or_else(|| "camera is not connected".to_string())?
    };
    let mut unique: Vec<String> = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    if unique.is_empty() {
        return Err("nothing to delete".into());
    }
    for batch in unique.chunks(50) {
        session
            .send_command(
                CODE_DELETE_FILES,
                &build_delete_files_body(batch),
                Duration::from_secs(20),
            )
            .await?;
    }
    Ok(())
}

/// Commands the UI may send as raw protobuf. Deliberately excludes
/// DELETE_FILES, which keeps its own batching command, and anything not
/// listed here — the webview should not be able to reach arbitrary firmware
/// commands just because the transport can carry them.
fn is_allowed_command(code: u16) -> bool {
    matches!(
        code,
        CODE_TAKE_PICTURE
            | CODE_START_CAPTURE
            | CODE_STOP_CAPTURE
            | CODE_SET_OPTIONS
            | CODE_GET_OPTIONS
            | CODE_SET_PHOTOGRAPHY_OPTIONS
            | CODE_GET_PHOTOGRAPHY_OPTIONS
            | CODE_GET_CURRENT_CAPTURE_STATUS
            | CODE_GET_FILE_LIST
    )
}

/// Send a protobuf body to the camera and return the raw response body.
/// Encoding and decoding live in the frontend, which owns the schema.
#[tauri::command]
pub async fn luna_command(
    state: State<'_, LunaState>,
    code: u16,
    body: Vec<u8>,
) -> Result<Vec<u8>, String> {
    if !is_allowed_command(code) {
        return Err(format!("command {code} is not permitted"));
    }
    let session = state
        .session()
        .await
        .ok_or_else(|| "camera is not connected".to_string())?;
    let response = session.send_command(code, &body, Duration::from_secs(10)).await?;
    Ok(response.body)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// The mock server's second auth payload is a real captured frame:
    /// GET_OPTIONS small with seq 0x10, request 1, including its CRC trailer.
    #[test]
    fn file_command_matches_captured_auth_frame() {
        let expected = hex("55434432010c04100f0000000800020100008000000830080f080b7c008e7c");
        let built = build_file_command(0x10, CODE_GET_OPTIONS, 1, &small_options_body());
        assert_eq!(built, expected);
    }

    #[test]
    fn checksum_matches_captured_trailer() {
        let frame = hex("55434432010c04100f0000000800020100008000000830080f080b");
        assert_eq!(insta360_checksum(&frame), u32::from_le_bytes([0x7c, 0x00, 0x8e, 0x7c]));
    }

    #[test]
    fn stream_hello_is_sixteen_bytes() {
        let hello = build_stream_hello(0x24);
        assert_eq!(hello.len(), 16);
        assert_eq!(&hello[..4], UCD2_MAGIC);
        assert_eq!(hello[6], UCD2_STREAM);
    }

    #[test]
    fn delete_body_encodes_repeated_strings() {
        let body = build_delete_files_body(&["/DCIM/a.jpg".to_string()]);
        assert_eq!(body[0], 0x0a);
        assert_eq!(body[1] as usize, "/DCIM/a.jpg".len());
        assert_eq!(&body[2..], "/DCIM/a.jpg".as_bytes());
    }

    /// A STREAM frame carrying real video must be returned with its payload,
    /// STREAM frames are keepalive echoes only. Both a padded one and the
    /// 16-byte hello must be recognised and fully consumed, so that a MEDIA
    /// frame arriving behind them still parses.
    #[test]
    fn drain_frames_consumes_stream_frames_without_payload() {
        let mut padded = Vec::new();
        padded.extend_from_slice(&40u32.to_le_bytes());
        padded.extend_from_slice(&[0xAAu8; 40]);
        padded.extend_from_slice(&[0u8; 4]); // trailer
        let mut buffer = build_ucd2(UCD2_STREAM, 1, &padded);
        buffer.extend_from_slice(&build_stream_hello(2));

        let frames = drain_frames(&mut buffer);
        assert_eq!(frames.len(), 2);
        assert!(frames.iter().all(|f| matches!(f, Frame::Stream)));
        assert!(buffer.is_empty(), "both frames should be consumed");
    }

    /// The allowlist is the safety boundary between the webview and the
    /// camera. Destructive codes must not be reachable through it.
    #[test]
    fn command_allowlist_covers_settings_but_not_deletion() {
        for code in [
            CODE_TAKE_PICTURE,
            CODE_START_CAPTURE,
            CODE_STOP_CAPTURE,
            CODE_SET_OPTIONS,
            CODE_GET_OPTIONS,
            CODE_SET_PHOTOGRAPHY_OPTIONS,
            CODE_GET_PHOTOGRAPHY_OPTIONS,
            CODE_GET_CURRENT_CAPTURE_STATUS,
        ] {
            assert!(is_allowed_command(code), "code {code} should be allowed");
        }
        assert!(!is_allowed_command(CODE_DELETE_FILES), "deletion has its own command");
        assert!(!is_allowed_command(9999), "unknown codes must be refused");
    }

    /// Video rides UCD2 type 0x01, not STREAM. Each media frame begins with a
    /// 9-byte header whose first byte selects the substream; the Annex-B
    /// elementary stream follows. Header bytes are taken from a real capture.
    #[test]
    fn drain_frames_extracts_video_from_media_frames() {
        let annex_b = [0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x0c, 0x01];
        let build = |substream: u8| {
            let mut payload = vec![substream, 0x25, 0xde, 0xa9, 0, 0, 0, 0, 0];
            payload.extend_from_slice(&annex_b);
            let mut frame_payload = Vec::new();
            frame_payload.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            frame_payload.extend_from_slice(&payload);
            frame_payload.extend_from_slice(&[0u8; 4]); // trailer
            build_ucd2(UCD2_MEDIA, 7, &frame_payload)
        };

        let mut buffer = build(MEDIA_VIDEO);
        buffer.extend_from_slice(&build(0x40)); // gyro substream

        let frames = drain_frames(&mut buffer);
        assert_eq!(frames.len(), 2);
        match &frames[0] {
            Frame::Media { substream, data } => {
                assert_eq!(*substream, MEDIA_VIDEO);
                assert_eq!(data, &annex_b, "the 9-byte header must be stripped");
            }
            other => panic!("expected a media frame, got {other:?}"),
        }
        match &frames[1] {
            Frame::Media { substream, .. } => assert_eq!(*substream, 0x40),
            other => panic!("expected the gyro frame, got {other:?}"),
        }
        assert!(buffer.is_empty());
    }

    /// Every TCP split point, including U|CD2, UC|D2 and UCD|2, must
    /// preserve the exact encoded video and the following control response.
    #[test]
    fn tcp_fragmentation_never_discards_video_or_control_frames() {
        let video = [0, 0, 0, 1, 0x40, 1, 0x0c, 1];
        let mut media = vec![MEDIA_VIDEO; MEDIA_HEADER_LEN];
        media.extend_from_slice(&video);
        let mut payload = (media.len() as u32).to_le_bytes().to_vec();
        payload.extend(media);
        payload.extend([0; 4]);
        let mut wire = build_ucd2(UCD2_MEDIA, 1, &payload);
        wire.extend(build_stream_hello(2));
        wire.extend(build_file_command(
            3,
            CODE_GET_CURRENT_CAPTURE_STATUS,
            9,
            b"ok",
        ));
        for split in 1..wire.len() {
            let mut buffer = wire[..split].to_vec();
            let mut frames = drain_frames(&mut buffer);
            buffer.extend_from_slice(&wire[split..]);
            frames.extend(drain_frames(&mut buffer));
            assert!(buffer.is_empty(), "unconsumed bytes at split {split}");
            assert_eq!(frames.len(), 3, "lost frame at TCP split {split}");
            assert!(matches!(&frames[0], Frame::Media { data, .. } if data == &video));
            assert!(matches!(&frames[1], Frame::Stream));
            assert!(matches!(&frames[2], Frame::File(response) if response.body == b"ok"));
        }
        // Small reads repeatedly split both framing and payloads.
        let mut buffer = Vec::new();
        let mut frames = Vec::new();
        for byte in wire {
            buffer.push(byte);
            frames.extend(drain_frames(&mut buffer));
        }
        assert_eq!(frames.len(), 3);
    }

    #[test]
    fn parser_resynchronizes_without_discarding_a_partial_magic_suffix() {
        let mut buffer = b"noiseUC".to_vec();
        assert!(drain_frames(&mut buffer).is_empty());
        assert_eq!(buffer, b"UC");
        buffer.extend_from_slice(&build_stream_hello(1)[2..]);
        assert!(matches!(
            drain_frames(&mut buffer).as_slice(),
            [Frame::Stream]
        ));
    }

    pub(crate) async fn test_session() -> (Arc<Session>, TcpStream) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
        let (mut reader, writer) = client.unwrap().into_split();
        let (stream_tx, _) = broadcast::channel(8);
        let session = Arc::new(Session {
            writer: Mutex::new(writer),
            pending: Arc::default(),
            seq: AtomicU8::new(1),
            request_id: AtomicU16::new(1),
            reader: StdMutex::new(None),
            keepalive: StdMutex::new(None),
            info: StdMutex::new(LunaDeviceInfo::default()),
            stream_tx,
            health: Arc::new(SessionHealth::default()),
            events: Arc::default(),
        });
        let pending = Arc::clone(&session.pending);
        let health = Arc::clone(&session.health);
        let receiver = tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut chunk = [0; 4096];
            while let Ok(count) = reader.read(&mut chunk).await {
                if count == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..count]);
                for frame in drain_frames(&mut buffer) {
                    *health.last_received.lock().unwrap() = Instant::now();
                    if let Frame::File(reply) = frame {
                        if let Some(sender) = pending.lock().unwrap().remove(&reply.request_id) {
                            let _ = sender.send(reply);
                        }
                    }
                }
            }
        });
        session.reader.lock().unwrap().replace(receiver);
        (session, accepted.unwrap().0)
    }

    pub(crate) fn test_reply(request: &[u8]) -> Vec<u8> {
        let mut reply = build_file_command(
            request[7],
            u16::from_le_bytes([request[12], request[13]]),
            u16::from_le_bytes([request[15], request[16]]),
            &[],
        );
        reply[14] = 3;
        reply.truncate(reply.len() - 4);
        reply.extend_from_slice(&insta360_checksum(&reply).to_le_bytes());
        reply
    }

    #[tokio::test]
    async fn streaming_peer_does_not_need_to_answer_redundant_keepalive_queries() {
        let (session, mut camera) = test_session().await;
        *session.health.last_video.lock().unwrap() = Some(Instant::now());
        // Peer deliberately supplies no command responses. Fresh incoming
        // media still allows keepalive to finish with just the auth hello.
        tokio::time::timeout(Duration::from_millis(250), keepalive_tick(&session))
            .await
            .unwrap()
            .unwrap();
        let mut hello = [0; 16];
        camera.read_exact(&mut hello).await.unwrap();
        assert_eq!(&hello[..4], UCD2_MAGIC);
        assert_eq!(hello[6], UCD2_STREAM);
        assert!(session.pending.lock().unwrap().is_empty());
        assert_eq!(session.health.command_timeouts.load(Ordering::Relaxed), 0);

        // Once *all* valid incoming data is stale, a silent peer is no
        // longer excused; its lightweight status probe times out.
        *session.health.last_received.lock().unwrap() = Instant::now() - RECEIVE_GRACE;
        let error = keepalive_tick(&session).await.unwrap_err();
        assert!(error.contains("timed out"));
        assert!(!session.health.recently_received());
        assert_eq!(session.health.command_timeouts.load(Ordering::Relaxed), 1);
        assert!(session.pending.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cancelled_command_removes_pending_request_and_old_session_cannot_remove_new_one() {
        let (old, _peer) = test_session().await;
        let command_session = Arc::clone(&old);
        let command = tokio::spawn(async move {
            command_session
                .send_command(CODE_GET_OPTIONS, &[], Duration::from_secs(10))
                .await
        });
        for _ in 0..10 {
            if !old.pending.lock().unwrap().is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(old.pending.lock().unwrap().len(), 1);
        command.abort();
        assert!(command.await.unwrap_err().is_cancelled());
        assert!(old.pending.lock().unwrap().is_empty());

        let (new, _new_peer) = test_session().await;
        let state = Mutex::new(Some(Arc::clone(&new)));
        assert!(!remove_current(&state, &old).await);
        assert!(Arc::ptr_eq(state.lock().await.as_ref().unwrap(), &new));
        assert!(remove_current(&state, &new).await);
        assert!(state.lock().await.is_none());
    }

    /// The existing FILE parsing must be untouched by the refactor.
    #[test]
    fn drain_frames_still_parses_file_responses() {
        // Mirror of the mock server's buildRawResponse + buildUcd2
        let mut raw = Vec::new();
        raw.extend_from_slice(&12u16.to_le_bytes());
        raw.push(0x03);
        raw.extend_from_slice(&7u16.to_le_bytes());
        raw.extend_from_slice(&0x8000u32.to_le_bytes());
        raw.extend_from_slice(b"ok");
        let mut payload = Vec::new();
        payload.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        payload.extend_from_slice(&raw);
        payload.extend_from_slice(&[0u8; 4]);
        let mut buffer = build_ucd2(UCD2_FILE, 9, &payload);

        let frames = drain_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            Frame::File(response) => {
                assert_eq!(response.code, 12);
                assert_eq!(response.request_id, 7);
                assert_eq!(response.response_type, 3);
                assert_eq!(response.envelope_value, 0x8000);
                assert_eq!(response.body, b"ok");
            }
            other => panic!("expected a file response, got {other:?}"),
        }
    }

    #[test]
    fn reply_diagnostics_exclude_opaque_body_contents_and_success_claims() {
        let response = RawResponse {
            code: CODE_START_LIVE_STREAM,
            request_id: 20,
            response_type: 3,
            envelope_value: 0x8000,
            body: b"private-opaque-payload".to_vec(),
        };
        let summary = response.diagnostic_summary();
        assert!(summary.contains("reply command 1"));
        assert!(!summary.contains("private-opaque"));
        assert!(!summary.contains("accepted") && !summary.contains("success"));
    }

    /// End-to-end against the vendored luna_mock_server: our stream hello
    /// must authorize the HTTP index, and our delete frames must be parsed
    /// by the emulator and reflected in the listing.
    #[tokio::test]
    async fn handshake_and_delete_against_mock_server() {
        use std::process::{Child, Command, Stdio};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        if Command::new("node").arg("--version").stdout(Stdio::null()).status().is_err() {
            eprintln!("skipping: node not available");
            return;
        }

        struct KillOnDrop(Child);
        impl Drop for KillOnDrop {
            fn drop(&mut self) {
                let _ = self.0.kill();
            }
        }

        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let server = manifest_dir.join("../luna_mock_server/server.mjs");
        assert!(server.exists(), "vendored mock server missing at {server:?}");

        let media_root = std::env::temp_dir().join(format!("luna-it-{}", std::process::id()));
        let camera_dir = media_root.join("Camera01");
        std::fs::create_dir_all(&camera_dir).unwrap();
        let target = "IMG_20260718_142012_00_002.jpg";
        std::fs::write(camera_dir.join(target), b"fakejpeg").unwrap();
        std::fs::write(
            camera_dir.join("IMG_20260717_091205_00_003.jpg"),
            b"fakejpeg2",
        )
        .unwrap();

        let http_port = 18142u16;
        let tcp_port = 16142u16;
        let child = Command::new("node")
            .arg(&server)
            .args(["--root", media_root.to_str().unwrap()])
            .args(["--host", "127.0.0.1"])
            .args(["--http-port", &http_port.to_string()])
            .args(["--tcp-port", &tcp_port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let _guard = KillOnDrop(child);

        // Wait for the TCP control port to accept
        let mut control = None;
        for _ in 0..50 {
            if let Ok(stream) = TcpStream::connect(("127.0.0.1", tcp_port)).await {
                control = Some(stream);
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let mut control = control.expect("mock TCP port never came up");

        // Stream hello authorizes HTTP; a FILE command must get a response
        control.write_all(&build_stream_hello(0x24)).await.unwrap();
        control
            .write_all(&build_file_command(
                0x25,
                CODE_GET_OPTIONS,
                1,
                &small_options_body(),
            ))
            .await
            .unwrap();
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 4096];
        let response = loop {
            let n = tokio::time::timeout(Duration::from_secs(3), control.read(&mut chunk))
                .await
                .expect("timed out waiting for control response")
                .unwrap();
            assert!(n > 0, "mock closed the control socket");
            buffer.extend_from_slice(&chunk[..n]);
            let mut frames = drain_frames(&mut buffer);
            if let Some(Frame::File(response)) = frames.pop() {
                break response;
            }
        };
        assert_eq!(response.code, CODE_GET_OPTIONS);
        assert_eq!(response.request_id, 1);

        // The HTTP auth gate opens ~3s after the handshake
        async fn http_get(port: u16, path: &str) -> String {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut out = Vec::new();
            let _ = tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut out)).await;
            String::from_utf8_lossy(&out).to_string()
        }

        let mut index = String::new();
        for _ in 0..8 {
            tokio::time::sleep(Duration::from_millis(700)).await;
            index = http_get(http_port, "/storage_internal/DCIM/Camera01/").await;
            if index.starts_with("HTTP/1.1 200") {
                break;
            }
        }
        assert!(index.starts_with("HTTP/1.1 200"), "index not authorized: {index}");
        assert!(index.contains(target), "listing missing {target}: {index}");

        // Delete over TCP, then the file must vanish from the listing
        let delete_path = format!("/storage_internal/DCIM/Camera01/{target}");
        control
            .write_all(&build_file_command(
                0x26,
                CODE_DELETE_FILES,
                12,
                &build_delete_files_body(&[delete_path]),
            ))
            .await
            .unwrap();
        let deleted = loop {
            let n = tokio::time::timeout(Duration::from_secs(3), control.read(&mut chunk))
                .await
                .expect("timed out waiting for delete response")
                .unwrap();
            assert!(n > 0);
            buffer.extend_from_slice(&chunk[..n]);
            let mut frames = drain_frames(&mut buffer);
            if let Some(Frame::File(response)) = frames.pop() {
                break response;
            }
        };
        assert_eq!(deleted.code, CODE_DELETE_FILES);

        let after = http_get(http_port, "/storage_internal/DCIM/Camera01/").await;
        assert!(after.starts_with("HTTP/1.1 200"), "index lost after delete: {after}");
        assert!(!after.contains(target), "deleted file still listed");
        assert!(after.contains("IMG_20260717_091205_00_003.jpg"), "unrelated file disappeared");

        let _ = std::fs::remove_dir_all(&media_root);
    }

    #[test]
    fn device_info_heuristics() {
        let bodies = vec![b"\x00\x00Insta360 Luna Ultra\x00LU1XA4207731\x00v1.2.4_build1\x00Luna Ultra 1XLU42.OSC\x00".to_vec()];
        let info = parse_device_info("192.168.42.1", &bodies);
        assert_eq!(info.device_name.as_deref(), Some("Insta360 Luna Ultra"));
        assert_eq!(info.serial.as_deref(), Some("LU1XA4207731"));
        assert_eq!(info.firmware.as_deref(), Some("v1.2.4_build1"));
        assert_eq!(info.ssid.as_deref(), Some("Luna Ultra 1XLU42.OSC"));
    }
}
