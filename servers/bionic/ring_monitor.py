#!/usr/bin/env python3
"""
Native HID ring monitor for demo mode.

Reads a local HID device and pushes press events to the Flask backend
(/ring-event/push), so the extension can toggle high contrast without
front-end WebHID pairing.
"""

import argparse
import json
import signal
import sys
import time

import httpx

try:
    import hid  # type: ignore
except Exception as exc:  # pragma: no cover
    print(
        "[ring-monitor] Missing dependency 'hid'. Install with:\n"
        "  pip install hidapi\n"
        f"Import error: {exc}",
        file=sys.stderr,
    )
    raise


STOP = False
PREFERRED_RING_NAME_EXACT = "yiser-j6"
PREFERRED_RING_NAME_TOKENS = ("yiser", "ring", "page", "turn")
PREFERRED_RING_VID_PID = (0x05AC, 0x022C)


def _parse_int(raw, default=0):
    if raw is None:
        return default
    token = str(raw).strip().lower()
    if not token:
        return default
    try:
        if token.startswith("0x"):
            return int(token, 16)
        return int(token, 10)
    except Exception:
        return default


def _hex4(value):
    return f"0x{int(value or 0):04X}"


def _device_label(info):
    return (
        f"{info.get('product_string') or 'Unknown'} "
        f"(VID {_hex4(info.get('vendor_id'))}, PID {_hex4(info.get('product_id'))}, "
        f"usage_page {_hex4(info.get('usage_page'))}, usage {_hex4(info.get('usage'))})"
    )


def _device_name_blob(info):
    product = str(info.get("product_string") or "").strip().lower()
    manufacturer = str(info.get("manufacturer_string") or "").strip().lower()
    serial = str(info.get("serial_number") or "").strip().lower()
    return f"{product} {manufacturer} {serial}".strip()


def _stable_device_key(info):
    path = info.get("path")
    if isinstance(path, (bytes, bytearray)):
        path_token = path.hex()
    else:
        path_token = str(path or "")
    return (
        int(info.get("vendor_id") or 0),
        int(info.get("product_id") or 0),
        int(info.get("usage_page") or 0),
        int(info.get("usage") or 0),
        int(info.get("interface_number") if info.get("interface_number") is not None else -1),
        str(info.get("product_string") or ""),
        path_token,
    )


def _score_candidate(info):
    score = 0
    vendor_id = int(info.get("vendor_id") or 0)
    product_id = int(info.get("product_id") or 0)
    usage_page = int(info.get("usage_page") or 0)
    usage = int(info.get("usage") or 0)
    name_blob = _device_name_blob(info)

    if usage_page == 0x000D:
        score += 60
    if usage == 0x0001:
        score += 20
    if (vendor_id, product_id) == PREFERRED_RING_VID_PID:
        score += 90
    if PREFERRED_RING_NAME_EXACT in name_blob:
        score += 300
    for token in PREFERRED_RING_NAME_TOKENS:
        if token in name_blob:
            score += 30
    if "keyboard" in name_blob:
        score -= 8
    return score


def _enumerate_candidates(args):
    all_devices = hid.enumerate()
    candidates = []
    for item in all_devices:
        vendor_id = int(item.get("vendor_id") or 0)
        product_id = int(item.get("product_id") or 0)
        usage_page = int(item.get("usage_page") or 0)
        product_name = str(item.get("product_string") or "").lower()
        manufacturer = str(item.get("manufacturer_string") or "").lower()

        if args.vid is not None and vendor_id != args.vid:
            continue
        if args.pid is not None and product_id != args.pid:
            continue
        if args.usage_page is not None and usage_page != args.usage_page:
            continue
        if args.name_contains:
            needle = args.name_contains.lower()
            if needle not in product_name and needle not in manufacturer:
                continue

        # By default, prioritize digitizer/touch usage page (0x000D) from your logs.
        if not args.all_usages and args.usage_page is None and usage_page != 0x000D:
            continue

        candidates.append(item)
    return candidates


def _pick_device(args):
    candidates = _enumerate_candidates(args)
    if not candidates:
        return None

    if args.index >= 0:
        if args.index < len(candidates):
            return candidates[args.index]
        return candidates[0]

    ranked = sorted(
        candidates,
        key=lambda item: (-_score_candidate(item), _stable_device_key(item)),
    )
    if args.verbose:
        for i, item in enumerate(ranked[:8]):
            print(f"[ring-monitor] candidate[{i}] score={_score_candidate(item)} {_device_label(item)}")
    return ranked[0]


def _push_ring_event(client, endpoint, device_info, report, verbose=False):
    payload = {
        "source": "native-ring-monitor",
        "vendorId": int(device_info.get("vendor_id") or 0),
        "productId": int(device_info.get("product_id") or 0),
        "usagePage": int(device_info.get("usage_page") or 0),
        "usage": int(device_info.get("usage") or 0),
        "reportPreview": report[:12],
        "timestamp": time.time(),
    }
    response = client.post(endpoint, json=payload, timeout=3.0)
    response.raise_for_status()
    if verbose:
        data = response.json()
        print(
            f"[ring-monitor] pushed event cursor={data.get('cursor')} "
            f"lastEventTs={data.get('lastEventTs')}"
        )


def _monitor_device(args, device_info):
    path = device_info.get("path")
    if not path:
        raise RuntimeError("Device has no HID path")

    endpoint = f"{args.server_base.rstrip('/')}/ring-event/push"
    client = httpx.Client()
    device = hid.device()
    device.open_path(path)
    device.set_nonblocking(True)

    print(f"[ring-monitor] connected: {_device_label(device_info)}")
    last_report = None
    last_press_ms = 0.0
    press_armed = True

    try:
        while not STOP:
            try:
                report = device.read(args.report_length)
            except Exception as read_error:
                raise RuntimeError(f"HID read failed: {read_error}")

            if not report:
                time.sleep(args.poll_ms / 1000.0)
                continue

            report_norm = tuple(int(byte) & 0xFF for byte in report)
            if last_report is None:
                last_report = report_norm
                if args.verbose:
                    print(f"[ring-monitor] baseline={json.dumps(list(report_norm)[:16])}")
                continue

            if report_norm == last_report:
                continue

            rising_edge = False
            falling_edge = False
            changed = 0
            for i in range(min(len(last_report), len(report_norm))):
                if last_report[i] != report_norm[i]:
                    changed += 1
                    if last_report[i] == 0 and report_norm[i] != 0:
                        rising_edge = True
                    if last_report[i] != 0 and report_norm[i] == 0:
                        falling_edge = True
            # If there is no explicit 0->nonzero edge, fall back to "any change"
            # so devices with non-binary reports still work.
            should_emit = False
            if rising_edge:
                if press_armed:
                    should_emit = True
                    press_armed = False
            elif changed > 0 and not falling_edge:
                # Fallback mode for unusual reports that don't expose clean edges.
                should_emit = True

            if falling_edge:
                press_armed = True

            now_ms = time.time() * 1000.0
            if should_emit and (now_ms - last_press_ms >= args.debounce_ms):
                try:
                    _push_ring_event(
                        client,
                        endpoint,
                        device_info=device_info,
                        report=report,
                        verbose=args.verbose,
                    )
                    print("[ring-monitor] ring press detected")
                    last_press_ms = now_ms
                except Exception as push_error:
                    print(f"[ring-monitor] failed to push event: {push_error}", file=sys.stderr)

            last_report = report_norm
            if args.verbose:
                print(
                    f"[ring-monitor] report={json.dumps(list(report_norm)[:16])} "
                    f"rising_edge={rising_edge} falling_edge={falling_edge} "
                    f"armed={press_armed} changed={changed}"
                )
    finally:
        try:
            device.close()
        except Exception:
            pass
        client.close()
        print("[ring-monitor] disconnected")


def _handle_signal(_signum, _frame):
    global STOP
    STOP = True


def _build_arg_parser():
    parser = argparse.ArgumentParser(description="Monitor HID ring presses and push events to backend.")
    parser.add_argument("--server-base", default="http://localhost:8080", help="Backend base URL.")
    parser.add_argument("--vid", default=None, help="Optional VID filter, e.g. 0x1234.")
    parser.add_argument("--pid", default=None, help="Optional PID filter, e.g. 0x5678.")
    parser.add_argument("--usage-page", default=None, help="Optional usage page filter, default auto=0x000D.")
    parser.add_argument("--all-usages", action="store_true", help="Do not restrict by usage page when auto-matching.")
    parser.add_argument("--name-contains", default="", help="Optional product/manufacturer substring.")
    parser.add_argument("--index", type=int, default=-1, help="Candidate index to use. -1 = auto-select best match.")
    parser.add_argument("--poll-ms", type=int, default=15, help="Read polling interval in ms.")
    parser.add_argument("--debounce-ms", type=int, default=260, help="Debounce for press events.")
    parser.add_argument("--report-length", type=int, default=64, help="HID report read length.")
    parser.add_argument("--verbose", action="store_true", help="Verbose HID logging.")
    return parser


def main():
    parser = _build_arg_parser()
    args = parser.parse_args()
    args.vid = _parse_int(args.vid, default=None) if args.vid is not None else None
    args.pid = _parse_int(args.pid, default=None) if args.pid is not None else None
    args.usage_page = _parse_int(args.usage_page, default=None) if args.usage_page is not None else None

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    print("[ring-monitor] starting. Press Ctrl+C to stop.")
    while not STOP:
        device_info = _pick_device(args)
        if not device_info:
            print("[ring-monitor] waiting for matching HID device...")
            time.sleep(1.0)
            continue

        try:
            _monitor_device(args, device_info)
        except Exception as exc:
            if STOP:
                break
            print(f"[ring-monitor] device loop error: {exc}", file=sys.stderr)
            time.sleep(1.0)

    print("[ring-monitor] stopped.")


if __name__ == "__main__":
    main()
