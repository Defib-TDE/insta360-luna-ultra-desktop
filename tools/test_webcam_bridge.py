"""Bridge tests use generated frames and a fake sink, never camera hardware."""
import argparse
import contextlib
import io
import json
import queue
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import webcam_bridge as bridge


class BridgeTests(unittest.TestCase):
    def test_cli_rejects_incomplete_output_dimensions(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            bridge.parse_args(["--width", "1280"])

    def test_latest_queue_discards_only_decoded_frames(self):
        frames = queue.Queue(maxsize=1)
        first = bridge.DecodedFrame("first", 640, 480, 30, 1)
        second = bridge.DecodedFrame("second", 640, 480, 30, 2)
        bridge.replace_latest(frames, first)
        bridge.replace_latest(frames, second)
        self.assertIs(frames.get_nowait(), second)

    def test_source_events_are_not_container_fps_estimates(self):
        stop = threading.Event()
        frame = SimpleNamespace(width=640, height=480)
        def decode(**_):
            yield frame
            yield frame
            stop.set()
        container = SimpleNamespace(streams=SimpleNamespace(video=[SimpleNamespace(average_rate=25, base_rate=None, guessed_rate=None)]), decode=decode)
        args = bridge.parse_args(["--json-events", "--width", "1280", "--height", "720", "--fps", "30"])
        stdout = io.StringIO()
        with patch.object(bridge, "open_stream", return_value=contextlib.nullcontext(container)), patch.object(bridge, "frame_pixels", return_value="pixels"), patch.object(bridge.time, "monotonic", side_effect=[0, 0.1, 5.1]), contextlib.redirect_stdout(stdout):
            bridge.decode_latest(None, None, args, queue.Queue(maxsize=1), stop)
        events = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(events[0], {"event": "source", "width": 640, "height": 480, "observedDecodeFps": None})
        self.assertEqual(events[1]["observedDecodeFps"], 0.2)

    def test_stalled_output_uses_a_slate_and_reports_recovery(self):
        try:
            import numpy
        except ImportError:
            self.skipTest("numpy required for pixel tests")
        pixels = numpy.full((2, 2, 3), 255, dtype=numpy.uint8)
        sent = []
        holder = {}
        def decoder(_av, _numpy, _args, output, _stop):
            holder["queue"] = output
            output.put(bridge.DecodedFrame(pixels, 2, 2, 30, 0))
        class Camera:
            fps = 30
            device = "Simulated camera"
            backend = "fake"
            def __init__(self, **_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def send(self, frame): sent.append(frame.copy())
            def sleep_until_next_frame(self):
                if len(sent) == 2:
                    holder["queue"].put(bridge.DecodedFrame(pixels, 2, 2, 30, 3))
                if len(sent) == 3:
                    raise KeyboardInterrupt()
        fake = SimpleNamespace(Camera=Camera, PixelFormat=SimpleNamespace(RGB="RGB"))
        stdout = io.StringIO()
        with patch.dict(sys.modules, {"pyvirtualcam": fake}), patch.object(bridge, "decode_latest", decoder), patch.object(bridge.time, "monotonic", side_effect=[0.5, 3, 3.1]), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bridge.run_virtual_camera(None, bridge.parse_args(["--json-events"])), 0)
        self.assertTrue(numpy.all(sent[0] == 255))
        self.assertTrue(numpy.all(sent[1] == (17, 17, 24)))
        self.assertTrue(numpy.all(sent[2] == 255))
        events = [json.loads(line)["event"] for line in stdout.getvalue().splitlines()]
        self.assertEqual(events, ["publishing", "stalled", "resumed"])


if __name__ == "__main__":
    unittest.main()
