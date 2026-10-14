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
    def test_decoder_does_not_convert_frames_replaced_before_publication(self):
        stop = threading.Event()
        frames = [SimpleNamespace(width=640, height=480) for _ in range(3)]
        def decode(**_):
            yield from frames
            stop.set()
        container = SimpleNamespace(streams=SimpleNamespace(video=[SimpleNamespace(average_rate=30, base_rate=None, guessed_rate=None)]), decode=decode)
        latest = queue.Queue(maxsize=1)
        with patch.object(bridge, "open_stream", return_value=contextlib.nullcontext(container)), patch.object(bridge, "frame_pixels", return_value="pixels") as convert:
            bridge.decode_latest(None, bridge.parse_args([]), latest, stop)
        self.assertEqual(convert.call_count, 0, "conversion belongs to the selected output frame")
        self.assertIs(latest.get_nowait().frame, frames[-1])

    def test_decoder_reconnect_keeps_output_size_and_marks_the_new_generation(self):
        stop = threading.Event()
        first = SimpleNamespace(width=640, height=480)
        recovered = SimpleNamespace(width=1280, height=720)
        def decode_first(**_):
            yield first
            raise RuntimeError("synthetic read failure")
        def decode_recovered(**_):
            yield recovered
            stop.set()
        stream = SimpleNamespace(average_rate=30, base_rate=None, guessed_rate=None)
        containers = [contextlib.nullcontext(SimpleNamespace(streams=SimpleNamespace(video=[stream]), decode=decode)) for decode in (decode_first, decode_recovered)]
        latest = queue.Queue(maxsize=1)
        stdout = io.StringIO()
        with patch.object(bridge, "open_stream", side_effect=containers), patch.object(stop, "wait", return_value=False), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(stdout):
            bridge.decode_latest(None, bridge.parse_args(["--json-events"]), latest, stop)
        frame = latest.get_nowait()
        self.assertIs(frame.frame, recovered)
        self.assertEqual((frame.width, frame.height), (640, 480))
        self.assertEqual(frame.generation, 2)
        self.assertEqual([json.loads(line)["event"] for line in stdout.getvalue().splitlines()], ["source", "reconnecting", "source"])

    def test_publisher_converts_only_selected_frames_and_reuses_repeats(self):
        import numpy
        import av
        older = av.VideoFrame.from_ndarray(numpy.full((2, 2, 3), 30, dtype=numpy.uint8), format="rgb24")
        newest = av.VideoFrame.from_ndarray(numpy.full((2, 2, 3), 200, dtype=numpy.uint8), format="rgb24")
        sent = []
        holder = {}
        def decoder(_av, _args, output, _stop):
            holder["queue"] = output
            output.put(bridge.DecodedFrame(older, 2, 2, 30, 0))
        class Camera:
            fps = 30
            device = "Simulated camera"
            backend = "fake"
            def __init__(self, **_): pass
            def __enter__(self):
                # A newer decoded frame arrives while the output device opens.
                holder["queue"].put(bridge.DecodedFrame(newest, 2, 2, 30, 0))
                return self
            def __exit__(self, *_): pass
            def send(self, frame): sent.append(frame)
            def sleep_until_next_frame(self):
                if len(sent) == 3:
                    raise KeyboardInterrupt()
        fake = SimpleNamespace(Camera=Camera, PixelFormat=SimpleNamespace(RGB="RGB"))
        with patch.dict(sys.modules, {"pyvirtualcam": fake}), patch.object(bridge, "decode_latest", decoder), patch.object(bridge, "frame_pixels", wraps=bridge.frame_pixels) as convert, patch.object(bridge.time, "monotonic", return_value=.5), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bridge.run_virtual_camera(None, bridge.parse_args([])), 0)
        self.assertEqual(convert.call_count, 1)
        self.assertIs(convert.call_args.args[0], newest)
        self.assertTrue(numpy.all(sent[0] == 200))
        self.assertTrue(all(frame is sent[0] for frame in sent))

    def test_same_aspect_resize_needs_no_padding_canvas(self):
        import numpy
        import av
        frame = av.VideoFrame.from_ndarray(numpy.full((4, 8, 3), 127, dtype=numpy.uint8), format="rgb24")
        with patch.object(numpy, "zeros", wraps=numpy.zeros) as allocate_padding:
            pixels = bridge.frame_pixels(frame, 16, 8, False, numpy)
        self.assertEqual(pixels.shape, (8, 16, 3))
        self.assertTrue(numpy.all(pixels == 127))
        self.assertEqual(allocate_padding.call_count, 0)

    def test_conversion_failure_uses_slate_until_a_fresh_frame_arrives(self):
        import numpy
        import av
        class BrokenFrame:
            width = height = 2
            def to_ndarray(self, **_):
                raise ValueError("synthetic invalid decoded frame")
        bad = BrokenFrame()
        good = av.VideoFrame.from_ndarray(numpy.full((2, 2, 3), 200, dtype=numpy.uint8), format="rgb24")
        sent = []
        holder = {}
        def decoder(_av, _args, output, _stop):
            holder["queue"] = output
            output.put(bridge.DecodedFrame(bad, 2, 2, 30, 0))
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
                    holder["queue"].put(bridge.DecodedFrame(good, 2, 2, 30, 0))
                if len(sent) == 3:
                    raise KeyboardInterrupt()
        fake = SimpleNamespace(Camera=Camera, PixelFormat=SimpleNamespace(RGB="RGB"))
        stderr = io.StringIO()
        stdout = io.StringIO()
        with patch.dict(sys.modules, {"pyvirtualcam": fake}), patch.object(bridge, "decode_latest", decoder), patch.object(bridge, "frame_pixels", wraps=bridge.frame_pixels) as convert, patch.object(bridge.time, "monotonic", return_value=.5), contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(stdout):
            self.assertEqual(bridge.run_virtual_camera(None, bridge.parse_args(["--json-events"])), 0)
        self.assertEqual(convert.call_count, 2, "a failed frame must not be retried every output tick")
        self.assertTrue(numpy.all(sent[0] == (17, 17, 24)))
        self.assertTrue(numpy.all(sent[1] == (17, 17, 24)))
        self.assertTrue(numpy.all(sent[2] == 200))
        self.assertIn("Frame conversion failed", stderr.getvalue())
        self.assertEqual([json.loads(line)["event"] for line in stdout.getvalue().splitlines()], ["stalled", "publishing"])

    def test_fast_decoder_reconnect_reports_resume_after_sending_fresh_pixels(self):
        import numpy
        import av
        frame = av.VideoFrame.from_ndarray(numpy.full((2, 2, 3), 200, dtype=numpy.uint8), format="rgb24")
        sent = []
        holder = {}
        stdout = io.StringIO()
        def decoder(_av, _args, output, _stop):
            holder["queue"] = output
            output.put(bridge.DecodedFrame(frame, 2, 2, 30, 0))
        class Camera:
            fps = 30
            device = "Simulated camera"
            backend = "fake"
            def __init__(self, **_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def send(self, pixels):
                sent.append(pixels)
                # Healthy output events must follow a successful send.
                self_events = [json.loads(line)["event"] for line in stdout.getvalue().splitlines()]
                if len(sent) == 1:
                    assert self_events == []
                elif len(sent) == 2:
                    assert self_events == ["publishing"]
            def sleep_until_next_frame(self):
                if len(sent) == 1:
                    recovered = bridge.DecodedFrame(frame, 2, 2, 30, 0)
                    recovered.generation = 1
                    holder["queue"].put(recovered)
                if len(sent) == 2:
                    raise KeyboardInterrupt()
        fake = SimpleNamespace(Camera=Camera, PixelFormat=SimpleNamespace(RGB="RGB"))
        with patch.dict(sys.modules, {"pyvirtualcam": fake}), patch.object(bridge, "decode_latest", decoder), patch.object(bridge.time, "monotonic", return_value=.5), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(stdout):
            self.assertEqual(bridge.run_virtual_camera(None, bridge.parse_args(["--json-events"])), 0)
        self.assertEqual([json.loads(line)["event"] for line in stdout.getvalue().splitlines()], ["publishing", "resumed"])

    def test_pixel_conversion_preserves_padding_mirroring_and_contiguous_output(self):
        import numpy
        import av
        source = numpy.zeros((4, 8, 3), dtype=numpy.uint8)
        source[:, :4] = (220, 30, 10)
        source[:, 4:] = (10, 60, 230)
        frame = av.VideoFrame.from_ndarray(source, format="rgb24")
        for width, height in [(8, 4), (16, 8), (8, 16)]:
            with self.subTest(width=width, height=height):
                normal = bridge.frame_pixels(frame, width, height, False, numpy)
                mirrored = bridge.frame_pixels(frame, width, height, True, numpy)
                self.assertEqual(normal.shape, (height, width, 3))
                self.assertTrue(normal.flags.c_contiguous)
                self.assertTrue(mirrored.flags.c_contiguous)
                numpy.testing.assert_array_equal(mirrored, normal[:, ::-1])
                if height == 16:
                    numpy.testing.assert_array_equal(normal[6:10], source)
                    self.assertFalse(normal[:6].any())
                    self.assertFalse(normal[10:].any())

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

    def test_cli_rejects_unbounded_timeouts_and_rates(self):
        for option in ["--startup-timeout", "--read-timeout", "--probe-timeout", "--fps"]:
            for value in ["0", "-1", "nan", "inf"]:
                with self.subTest(option=option, value=value), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    bridge.parse_args([option, value])

    def test_probe_excludes_warmup_and_verifies_actual_cadence_instead_of_raw_fps_guess(self):
        frame = SimpleNamespace(width=1280, height=720)
        container = SimpleNamespace(streams=SimpleNamespace(video=[SimpleNamespace(average_rate=25, base_rate=None, guessed_rate=None)]), decode=lambda **_: iter([frame] * 5))
        args = bridge.parse_args(["--probe-only", "--probe-frames", "3", "--warmup-seconds", "1", "--expect-profile", "baseline"])
        with patch.object(bridge, "open_stream", return_value=contextlib.nullcontext(container)), patch.object(bridge.time, "monotonic", side_effect=[0, .1, .2, 1.2, 1.2 + 1/30, 1.2 + 2/30, 1.3]):
            result = bridge.probe_result(None, args)
        self.assertEqual(result["warmupFrames"], 2)
        self.assertEqual(result["decodedFrames"], 3)
        self.assertEqual(result["fps"], 25)
        self.assertEqual(result["observedDecodeFps"], 30)
        self.assertEqual(result["verification"]["status"], "matched_sample")

    def test_probe_marks_an_ignored_resolution_request_and_returns_nonzero(self):
        args = bridge.parse_args(["--probe-only", "--probe-frames", "3", "--expect-profile", "4k60"])
        measured = {"decodedFrames": 3, "width": 1280, "height": 720, "verification": {"status": "different_output"}}
        with patch.object(bridge, "probe_result", return_value=measured), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bridge.probe(None, args), 2)

    def test_probe_deadline_bounds_a_decoder_that_never_returns(self):
        release = threading.Event()
        finished = threading.Event()
        def blocked(*_):
            release.wait(1)
            finished.set()
            return {}
        stdout = io.StringIO()
        args = bridge.parse_args(["--probe-only", "--probe-timeout", ".02"])
        try:
            with patch.object(bridge, "probe_result", blocked), contextlib.redirect_stdout(stdout):
                self.assertEqual(bridge.probe(None, args), 1)
            self.assertEqual(json.loads(stdout.getvalue())["error"], "probe_timeout")
        finally:
            release.set()
            self.assertTrue(finished.wait(1))

    def test_first_frame_deadline_releases_decoder_without_opening_a_camera(self):
        stopped = threading.Event()
        def decoder(_av, _args, _output, stop):
            stop.wait(1)
            if stop.is_set():
                stopped.set()
        fake = SimpleNamespace(Camera=lambda **_: self.fail("Opened sink without decoded video"))
        stdout = io.StringIO()
        with patch.dict(sys.modules, {"numpy": SimpleNamespace(), "pyvirtualcam": fake}), patch.object(bridge, "decode_latest", decoder), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
            result = bridge.run_virtual_camera(None, bridge.parse_args(["--json-events", "--startup-timeout", "0.02"]))
        self.assertEqual(result, 1)
        self.assertTrue(stopped.is_set())
        event = json.loads(stdout.getvalue())
        self.assertEqual(event["event"], "error")
        self.assertIn("startup deadline", event["message"])

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
            bridge.decode_latest(None, args, queue.Queue(maxsize=1), stop)
        events = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(events[0], {"event": "source", "width": 640, "height": 480, "observedDecodeFps": None})
        self.assertEqual(events[1]["observedDecodeFps"], 0.2)

    def test_stalled_output_uses_a_slate_and_reports_recovery(self):
        try:
            import numpy
            import av
        except ImportError:
            self.skipTest("numpy and PyAV required for pixel tests")
        pixels = numpy.full((2, 2, 3), 255, dtype=numpy.uint8)
        frame = av.VideoFrame.from_ndarray(pixels, format="rgb24")
        sent = []
        holder = {}
        def decoder(_av, _args, output, _stop):
            holder["queue"] = output
            output.put(bridge.DecodedFrame(frame, 2, 2, 30, 0))
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
                    holder["queue"].put(bridge.DecodedFrame(frame, 2, 2, 30, 3))
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
