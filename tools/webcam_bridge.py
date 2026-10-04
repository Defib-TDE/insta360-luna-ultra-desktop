#!/usr/bin/env python3
"""Decode the Luna Annex-B preview and publish the freshest frame to a virtual camera."""

from __future__ import annotations

import argparse
import json
import queue
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any

DEFAULT_URL = "http://127.0.0.1:49183/stream"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Decode the Luna Ultra localhost Annex-B feed and send it to an OBS or "
            "Unity Capture virtual camera."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="Local stream URL shown by the app")
    parser.add_argument(
        "--codec",
        choices=("h264", "hevc"),
        default="h264",
        help="Elementary-stream codec (hardware-test the default before changing it)",
    )
    parser.add_argument("--fps", type=float, help="Virtual-camera frame rate (default: detected or 30)")
    parser.add_argument("--width", type=int, default=0, help="Optional output width")
    parser.add_argument("--height", type=int, default=0, help="Optional output height")
    parser.add_argument("--mirror", action="store_true", help="Mirror output horizontally")
    parser.add_argument(
        "--backend",
        choices=("auto", "obs", "unitycapture"),
        default="auto",
        help="pyvirtualcam backend",
    )
    parser.add_argument("--device", help="Optional backend-specific virtual-camera device name")
    parser.add_argument(
        "--read-timeout",
        type=float,
        default=8.0,
        help="Seconds without stream data before reconnecting",
    )
    parser.add_argument(
        "--probe-only",
        action="store_true",
        help="Decode frames and report source properties without opening a virtual camera",
    )
    parser.add_argument(
        "--probe-frames",
        type=int,
        default=30,
        help="Frames to decode in probe mode",
    )
    args = parser.parse_args(argv)
    if bool(args.width) != bool(args.height):
        parser.error("--width and --height must be supplied together")
    if args.fps is not None and args.fps <= 0:
        parser.error("--fps must be positive")
    if args.probe_frames <= 0:
        parser.error("--probe-frames must be positive")
    return args


def load_decoder() -> Any:
    try:
        import av
    except ImportError as error:
        raise SystemExit(
            "PyAV is not installed. Run tools/start-webcam.ps1, or install "
            "tools/webcam-requirements.txt into your Python environment."
        ) from error
    return av


def open_stream(av: Any, args: argparse.Namespace) -> Any:
    timeout_us = str(max(1, int(args.read_timeout * 1_000_000)))
    return av.open(
        args.url,
        mode="r",
        format=args.codec,
        options={
            "fflags": "nobuffer",
            "flags": "low_delay",
            "probesize": "32768",
            "analyzeduration": "0",
            "rw_timeout": timeout_us,
        },
    )


def detected_fps(stream: Any) -> float:
    for candidate in (stream.average_rate, stream.base_rate, stream.guessed_rate):
        if candidate:
            rate = float(candidate)
            if 1 <= rate <= 240:
                return rate
    return 30.0


def probe(av: Any, args: argparse.Namespace) -> int:
    started = time.monotonic()
    decoded = 0
    width = 0
    height = 0
    rate = 30.0
    with open_stream(av, args) as container:
        stream = container.streams.video[0]
        rate = detected_fps(stream)
        for frame in container.decode(video=0):
            width, height = frame.width, frame.height
            decoded += 1
            if decoded >= args.probe_frames:
                break
    result = {
        "codec": args.codec,
        "decodedFrames": decoded,
        "fps": rate,
        "height": height,
        "seconds": round(time.monotonic() - started, 3),
        "url": args.url,
        "width": width,
    }
    print(json.dumps(result, sort_keys=True))
    return 0 if decoded == args.probe_frames else 1


@dataclass
class DecodedFrame:
    pixels: Any
    width: int
    height: int
    fps: float


def replace_latest(target: queue.Queue[DecodedFrame], frame: DecodedFrame) -> None:
    try:
        target.put_nowait(frame)
        return
    except queue.Full:
        pass
    try:
        target.get_nowait()
    except queue.Empty:
        pass
    target.put_nowait(frame)


def frame_pixels(frame: Any, width: int, height: int, mirror: bool, numpy: Any) -> Any:
    if frame.width == width and frame.height == height:
        pixels = frame.to_ndarray(format="rgb24")
    else:
        scale = min(width / frame.width, height / frame.height)
        scaled_width = max(1, round(frame.width * scale))
        scaled_height = max(1, round(frame.height * scale))
        scaled = frame.reformat(width=scaled_width, height=scaled_height, format="rgb24")
        pixels = numpy.zeros((height, width, 3), dtype=numpy.uint8)
        left = (width - scaled_width) // 2
        top = (height - scaled_height) // 2
        pixels[top : top + scaled_height, left : left + scaled_width] = scaled.to_ndarray()
    if mirror:
        pixels = pixels[:, ::-1]
    return numpy.ascontiguousarray(pixels)


def decode_latest(
    av: Any,
    numpy: Any,
    args: argparse.Namespace,
    output: queue.Queue[DecodedFrame],
    stop: threading.Event,
) -> None:
    delay = 0.5
    recovering = False
    target_width = args.width
    target_height = args.height
    while not stop.is_set():
        try:
            with open_stream(av, args) as container:
                stream = container.streams.video[0]
                rate = args.fps or detected_fps(stream)
                received = False
                for frame in container.decode(video=0):
                    if stop.is_set():
                        return
                    if recovering:
                        print("Stream recovered.", file=sys.stderr)
                        recovering = False
                    if not target_width:
                        target_width, target_height = frame.width, frame.height
                    pixels = frame_pixels(frame, target_width, target_height, args.mirror, numpy)
                    replace_latest(
                        output,
                        DecodedFrame(pixels, target_width, target_height, rate),
                    )
                    received = True
                    delay = 0.5
                if received and not stop.is_set():
                    print("Stream ended; waiting to reconnect...", file=sys.stderr)
                    recovering = True
        except Exception as error:  # PyAV exposes several FFmpeg exception types.
            if stop.is_set():
                return
            print(f"Stream unavailable ({error}); retrying in {delay:.1f}s...", file=sys.stderr)
            recovering = True
        stop.wait(delay)
        delay = min(delay * 2, 5.0)


def run_virtual_camera(av: Any, args: argparse.Namespace) -> int:
    try:
        import numpy
        import pyvirtualcam
    except ImportError as error:
        raise SystemExit(
            "numpy and pyvirtualcam are required for webcam output. Run tools/start-webcam.ps1."
        ) from error

    latest: queue.Queue[DecodedFrame] = queue.Queue(maxsize=1)
    stop = threading.Event()
    worker = threading.Thread(
        target=decode_latest,
        args=(av, numpy, args, latest, stop),
        name="luna-decoder",
        daemon=True,
    )
    worker.start()

    print(f"Waiting for decoded video from {args.url}...", file=sys.stderr)
    try:
        first = latest.get()
        backend = None if args.backend == "auto" else args.backend
        camera_options: dict[str, Any] = {
            "width": first.width,
            "height": first.height,
            "fps": args.fps or first.fps,
            "fmt": pyvirtualcam.PixelFormat.RGB,
        }
        if backend:
            camera_options["backend"] = backend
        if args.device:
            camera_options["device"] = args.device

        with pyvirtualcam.Camera(**camera_options) as camera:
            print(
                f"Publishing {first.width}x{first.height} at {camera.fps:g} fps to "
                f"{camera.device} ({getattr(camera, 'backend', args.backend)}).",
                file=sys.stderr,
            )
            current = first
            while True:
                try:
                    while True:
                        current = latest.get_nowait()
                except queue.Empty:
                    pass
                camera.send(current.pixels)
                camera.sleep_until_next_frame()
    except KeyboardInterrupt:
        print("Stopping webcam bridge.", file=sys.stderr)
        return 0
    finally:
        stop.set()
        worker.join(timeout=2)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    av = load_decoder()
    if args.probe_only:
        return probe(av, args)
    return run_virtual_camera(av, args)


if __name__ == "__main__":
    raise SystemExit(main())
