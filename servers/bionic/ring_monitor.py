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
YISER_J6_DEFAULT_BUTTON_INDEX = 1
YISER_J6_DEFAULT_PRESS_VALUE = 3
YISER_J6_HIGH_CONTRAST_VALUES = (1, 2)
YISER_J6_DIRECTIONAL_ACTIVE_VALUE = 3
YISER_J6_DIRECTIONAL_IDLE_VALUE = 0
YISER_J6_DIRECTIONAL_MIN_DELTA = 80
YISER_J6_DIRECTIONAL_ACTION_BY_BUTTON = {
    "left": "toggle_line_guide",
    "right": "toggle_image_veil",
    "top": "toggle_reduced_crowding",
    "bottom": "toggle_font_color",
}
NON_RING_NAME_TOKENS = ("keyboard", "trackpad", "touchpad", "mouse", "apple internal")


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
    interface_number = info.get("interface_number")
    interface_label = (
        f", interface {int(interface_number)}"
        if interface_number is not None
        else ""
    )
    return (
        f"{info.get('product_string') or 'Unknown'} "
        f"(VID {_hex4(info.get('vendor_id'))}, PID {_hex4(info.get('product_id'))}, "
        f"usage_page {_hex4(info.get('usage_page'))}, usage {_hex4(info.get('usage'))}{interface_label})"
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


def _is_preferred_ring(info):
    vendor_id = int(info.get("vendor_id") or 0)
    product_id = int(info.get("product_id") or 0)
    return (vendor_id, product_id) == PREFERRED_RING_VID_PID


def _is_obvious_non_ring(info):
    name_blob = _device_name_blob(info)
    if not name_blob:
        return False
    return any(token in name_blob for token in NON_RING_NAME_TOKENS)


def _is_likely_ring(info):
    vendor_id = int(info.get("vendor_id") or 0)
    product_id = int(info.get("product_id") or 0)
    usage_page = int(info.get("usage_page") or 0)
    usage = int(info.get("usage") or 0)
    name_blob = _device_name_blob(info)

    if (vendor_id, product_id) == PREFERRED_RING_VID_PID:
        return True
    if PREFERRED_RING_NAME_EXACT in name_blob:
        return True
    if any(token in name_blob for token in PREFERRED_RING_NAME_TOKENS):
        return True
    if usage_page == 0x000D and usage == 0x0001 and vendor_id != 0 and product_id != 0:
        return True
    return False


def _is_os_protected_hid_profile(info):
    usage_page = int(info.get("usage_page") or 0)
    usage = int(info.get("usage") or 0)
    name_blob = _device_name_blob(info)
    # On macOS, keyboard/consumer-control style interfaces are commonly protected.
    if usage_page in (0x000C, 0x0001):
        return True
    if usage in (0x0001, 0x0006):
        return True
    if any(token in name_blob for token in ("keyboard", "consumer", "media")):
        return True
    return False


def _matches_yiser_j6_frame_signature(report_norm):
    if len(report_norm) >= 6 and (
        report_norm[0] == 1
        and report_norm[2] == 220
        and report_norm[3] == 0
        and report_norm[4] == 44
        and report_norm[5] == 1
    ):
        return True
    if len(report_norm) >= 2 and report_norm[0] == 5:
        return True
    return False


def _extract_yiser_button_value(report_norm):
    if not report_norm:
        return None
    if len(report_norm) >= 2 and report_norm[0] == 5:
        return int(report_norm[1]) & 0xFF
    if len(report_norm) >= 6 and (
        report_norm[0] == 1
        and report_norm[2] == 220
        and report_norm[3] == 0
        and report_norm[4] == 44
        and report_norm[5] == 1
    ):
        return int(report_norm[1]) & 0xFF
    return None


def _extract_yiser_directional_axes(report_norm):
    if not report_norm or len(report_norm) < 6:
        return None
    if int(report_norm[0]) != 1:
        return None
    state_value = int(report_norm[1]) & 0xFF
    if state_value not in (YISER_J6_DIRECTIONAL_ACTIVE_VALUE, YISER_J6_DIRECTIONAL_IDLE_VALUE):
        return None
    x_axis = (int(report_norm[2]) & 0xFF) | ((int(report_norm[3]) & 0xFF) << 8)
    y_axis = (int(report_norm[4]) & 0xFF) | ((int(report_norm[5]) & 0xFF) << 8)
    return {
        "pressed": state_value == YISER_J6_DIRECTIONAL_ACTIVE_VALUE,
        "x": int(x_axis),
        "y": int(y_axis),
    }


def _classify_yiser_direction_button(delta_x, delta_y):
    abs_x = abs(int(delta_x))
    abs_y = abs(int(delta_y))
    if max(abs_x, abs_y) < YISER_J6_DIRECTIONAL_MIN_DELTA:
        return None
    if abs_x >= abs_y:
        # This ring reports right as a negative X sweep and left as a positive X sweep.
        return "right" if int(delta_x) < 0 else "left"
    # This ring reports bottom as a negative Y sweep and top as a positive Y sweep.
    return "bottom" if int(delta_y) < 0 else "top"


def _action_for_directional_button(button_label):
    if not button_label:
        return None
    return YISER_J6_DIRECTIONAL_ACTION_BY_BUTTON.get(str(button_label).strip().lower())


def _enumerate_candidates(args):
    all_devices = hid.enumerate()
    candidates = []
    for item in all_devices:
        vendor_id = int(item.get("vendor_id") or 0)
        product_id = int(item.get("product_id") or 0)
        usage_page = int(item.get("usage_page") or 0)
        product_name = str(item.get("product_string") or "").lower()
        manufacturer = str(item.get("manufacturer_string") or "").lower()
        name_blob = _device_name_blob(item)

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

        # By default, prioritize digitizer/touch usage page (0x000D),
        # but keep other interfaces for likely ring identities so we can
        # fail over if one interface is blocked on macOS.
        if not args.all_usages and args.usage_page is None and usage_page != 0x000D:
            is_ring_identity = (
                (vendor_id, product_id) == PREFERRED_RING_VID_PID
                or PREFERRED_RING_NAME_EXACT in name_blob
                or any(token in name_blob for token in PREFERRED_RING_NAME_TOKENS)
            )
            if not is_ring_identity:
                continue

        if not args.allow_non_ring:
            if _is_obvious_non_ring(item):
                continue
            if not _is_likely_ring(item):
                continue

        candidates.append(item)
    return candidates


def _pick_device(args):
    ranked = _rank_candidates(args)
    if not ranked:
        return None
    return ranked[0]


def _rank_candidates(args):
    candidates = _enumerate_candidates(args)
    if not candidates:
        return []

    if args.index >= 0:
        if args.index < len(candidates):
            ranked = [candidates[args.index]]
        else:
            ranked = [candidates[0]]
    else:
        ranked = sorted(
            candidates,
            key=lambda item: (-_score_candidate(item), _stable_device_key(item)),
        )

    if args.verbose:
        for i, item in enumerate(ranked[:8]):
            print(f"[ring-monitor] candidate[{i}] score={_score_candidate(item)} {_device_label(item)}")
    return ranked


def _push_ring_event(client, endpoint, device_info, report, action, button_label=None, verbose=False):
    payload = {
        "source": "native-ring-monitor",
        "vendorId": int(device_info.get("vendor_id") or 0),
        "productId": int(device_info.get("product_id") or 0),
        "usagePage": int(device_info.get("usage_page") or 0),
        "usage": int(device_info.get("usage") or 0),
        "action": str(action or "toggle_voice_mic"),
        "reportPreview": report[:12],
        "timestamp": time.time(),
    }
    if button_label:
        payload["buttonLabel"] = str(button_label)
    response = client.post(endpoint, json=payload, timeout=3.0)
    response.raise_for_status()
    if verbose:
        data = response.json()
        print(
            f"[ring-monitor] pushed event cursor={data.get('cursor')} "
            f"lastEventTs={data.get('lastEventTs')}"
        )


def _open_hid_device(device_info):
    path = device_info.get("path")
    if not path:
        raise RuntimeError("Device has no HID path")

    vendor_id = int(device_info.get("vendor_id") or 0)
    product_id = int(device_info.get("product_id") or 0)
    serial_number = str(device_info.get("serial_number") or "").strip() or None

    open_errors = []
    canonical_bytes_path = None
    canonical_str_path = None
    try:
        if isinstance(path, str):
            canonical_str_path = path
            canonical_bytes_path = path.encode("utf-8")
        elif isinstance(path, (bytes, bytearray, memoryview)):
            canonical_bytes_path = bytes(path)
            try:
                canonical_str_path = canonical_bytes_path.decode("utf-8")
            except Exception:
                canonical_str_path = None
        else:
            canonical_str_path = str(path)
            canonical_bytes_path = canonical_str_path.encode("utf-8")
    except Exception:
        canonical_str_path = str(path)
        canonical_bytes_path = None

    open_attempts = []
    if canonical_bytes_path is not None:
        open_attempts.append(("open_path(canonical_bytes_path)", canonical_bytes_path))
    open_attempts.append(("open_path(raw_path)", path))

    for label, candidate_path in open_attempts:
        device = hid.device()
        try:
            device.open_path(candidate_path)
            return device, label
        except Exception as exc:
            open_errors.append(f"{label}: {exc}")
            try:
                device.close()
            except Exception:
                pass

    device = hid.device()
    try:
        if serial_number:
            device.open(vendor_id, product_id, serial_number)
            return device, "open(vendor_id, product_id, serial_number)"
        device.open(vendor_id, product_id)
        return device, "open(vendor_id, product_id)"
    except Exception as exc:
        open_errors.append(f"open(vendor_id, product_id[, serial_number]): {exc}")
        try:
            device.close()
        except Exception:
            pass

    raise RuntimeError("open failed; attempts=" + " | ".join(open_errors))


def _monitor_device(args, device_info):
    endpoint = f"{args.server_base.rstrip('/')}/ring-event/push"
    client = httpx.Client()
    device, open_method = _open_hid_device(device_info)
    device.set_nonblocking(True)

    print(f"[ring-monitor] connected: {_device_label(device_info)} via {open_method}")
    use_strict_yiser_profile = _is_preferred_ring(device_info) and not args.disable_yiser_filter
    if use_strict_yiser_profile:
        print(
            "[ring-monitor] strict button filter active: "
            f"byte_index={args.target_byte_index} press_value={args.yiser_press_value} "
            f"high_contrast_values={list(YISER_J6_HIGH_CONTRAST_VALUES)} "
            f"directional_actions={YISER_J6_DIRECTIONAL_ACTION_BY_BUTTON}"
        )

    last_report = None
    last_press_ms = 0.0
    press_armed = True
    press_active = False
    press_started_ms = 0.0
    hold_reported = False
    directional_active = False
    directional_start_x = 0
    directional_start_y = 0
    directional_last_x = 0
    directional_last_y = 0
    directional_min_x = 0
    directional_max_x = 0
    directional_min_y = 0
    directional_max_y = 0
    directional_frame_count = 0

    try:
        while not STOP:
            now_ms = time.time() * 1000.0
            try:
                report = device.read(args.report_length)
            except Exception as read_error:
                raise RuntimeError(f"HID read failed: {read_error}")

            if not report:
                if press_active and not hold_reported and (now_ms - press_started_ms >= args.hold_ms):
                    hold_reported = True
                    print(
                        f"[ring-monitor] hold ongoing duration_ms={now_ms - press_started_ms:.1f} "
                        f"(threshold={args.hold_ms})"
                    )
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

            rising_edge_indexes = []
            falling_edge_indexes = []
            changed = 0
            action = "toggle_voice_mic"
            button_label = None
            unknown_button_value = None
            directional_emit = False

            if use_strict_yiser_profile:
                prev_value = _extract_yiser_button_value(last_report)
                curr_value = _extract_yiser_button_value(report_norm)

                if curr_value is None:
                    prev_directional = _extract_yiser_directional_axes(last_report)
                    curr_directional = _extract_yiser_directional_axes(report_norm)
                    if curr_directional is None:
                        if directional_active:
                            directional_active = False
                            directional_frame_count = 0
                            if args.verbose:
                                print(
                                    "[ring-monitor] directional gesture reset due to "
                                    f"unexpected frame={json.dumps(list(report_norm)[:16])}"
                                )
                        elif args.verbose:
                            print(f"[ring-monitor] ignored non-target frame={json.dumps(list(report_norm)[:16])}")
                        last_report = report_norm
                        continue

                    prev_pressed = bool(prev_directional and prev_directional.get("pressed"))
                    curr_pressed = bool(curr_directional.get("pressed"))
                    prev_x = int(prev_directional.get("x")) if prev_directional else int(curr_directional.get("x"))
                    prev_y = int(prev_directional.get("y")) if prev_directional else int(curr_directional.get("y"))
                    curr_x = int(curr_directional.get("x"))
                    curr_y = int(curr_directional.get("y"))
                    if prev_pressed != curr_pressed or prev_x != curr_x or prev_y != curr_y:
                        changed = 1

                    if not prev_pressed and curr_pressed:
                        directional_active = True
                        directional_start_x = curr_x
                        directional_start_y = curr_y
                        directional_last_x = curr_x
                        directional_last_y = curr_y
                        directional_min_x = curr_x
                        directional_max_x = curr_x
                        directional_min_y = curr_y
                        directional_max_y = curr_y
                        directional_frame_count = 1
                        if args.verbose:
                            print(
                                f"[ring-monitor] directional gesture start x={curr_x} y={curr_y} "
                                f"report={json.dumps(list(report_norm)[:16])}"
                            )
                        last_report = report_norm
                        continue

                    if curr_pressed:
                        if not directional_active:
                            directional_active = True
                            directional_start_x = prev_x
                            directional_start_y = prev_y
                            directional_min_x = min(prev_x, curr_x)
                            directional_max_x = max(prev_x, curr_x)
                            directional_min_y = min(prev_y, curr_y)
                            directional_max_y = max(prev_y, curr_y)
                            directional_frame_count = 0
                        directional_last_x = curr_x
                        directional_last_y = curr_y
                        directional_min_x = min(directional_min_x, curr_x)
                        directional_max_x = max(directional_max_x, curr_x)
                        directional_min_y = min(directional_min_y, curr_y)
                        directional_max_y = max(directional_max_y, curr_y)
                        directional_frame_count += 1
                        last_report = report_norm
                        continue

                    if prev_pressed and directional_active:
                        directional_last_x = curr_x
                        directional_last_y = curr_y
                        directional_min_x = min(directional_min_x, curr_x)
                        directional_max_x = max(directional_max_x, curr_x)
                        directional_min_y = min(directional_min_y, curr_y)
                        directional_max_y = max(directional_max_y, curr_y)
                        directional_frame_count += 1
                        delta_x = int(directional_last_x - directional_start_x)
                        delta_y = int(directional_last_y - directional_start_y)
                        button_label = _classify_yiser_direction_button(delta_x, delta_y)
                        directional_active = False
                        if button_label:
                            action = _action_for_directional_button(button_label)
                            if action:
                                directional_emit = True
                                print(
                                    f"[ring-monitor] directional button={button_label} "
                                    f"dx={delta_x} dy={delta_y} span_x={int(directional_max_x - directional_min_x)} "
                                    f"span_y={int(directional_max_y - directional_min_y)} frames={directional_frame_count} "
                                    f"action={action}"
                                )
                            else:
                                print(
                                    "[ring-monitor] unknown directional key press "
                                    f"button={button_label} dx={delta_x} dy={delta_y} frames={directional_frame_count} "
                                    f"report={json.dumps(list(report_norm)[:16])}"
                                )
                        else:
                            print(
                                "[ring-monitor] unknown directional key press "
                                f"dx={delta_x} dy={delta_y} frames={directional_frame_count} "
                                f"report={json.dumps(list(report_norm)[:16])}"
                            )
                        directional_frame_count = 0
                    else:
                        last_report = report_norm
                        continue
                else:
                    if directional_active:
                        directional_active = False
                        directional_frame_count = 0

                if curr_value is not None:
                    if prev_value is None:
                        prev_value = 0

                    if prev_value != curr_value:
                        changed = 1

                    if prev_value == 0 and curr_value != 0:
                        rising_edge_indexes.append(int(args.target_byte_index))
                        if curr_value == int(args.yiser_press_value):
                            action = "toggle_voice_mic"
                            button_label = "center"
                        elif curr_value in YISER_J6_HIGH_CONTRAST_VALUES:
                            action = "toggle_high_contrast"
                            button_label = "home"
                        else:
                            action = None
                            unknown_button_value = int(curr_value)
                    if prev_value != 0 and curr_value == 0:
                        falling_edge_indexes.append(int(args.target_byte_index))

                    if changed and not rising_edge_indexes and not falling_edge_indexes:
                        if args.verbose:
                            print(
                                "[ring-monitor] ignored transition "
                                f"byte[{int(args.target_byte_index)}] {prev_value}->{curr_value} "
                                "(not target press/release)"
                            )
                        last_report = report_norm
                        continue
            else:
                for i in range(min(len(last_report), len(report_norm))):
                    if last_report[i] != report_norm[i]:
                        changed += 1
                        if last_report[i] == 0 and report_norm[i] != 0:
                            rising_edge_indexes.append(i)
                        if last_report[i] != 0 and report_norm[i] == 0:
                            falling_edge_indexes.append(i)
            rising_edge = len(rising_edge_indexes) > 0
            falling_edge = len(falling_edge_indexes) > 0

            if rising_edge and not press_active:
                press_active = True
                press_started_ms = now_ms
                hold_reported = False
                print(
                    f"[ring-monitor] press down edge_indexes={rising_edge_indexes} "
                    f"report={json.dumps(list(report_norm)[:16])}"
                )

            # If there is no explicit 0->nonzero edge, fall back to "any change"
            # so devices with non-binary reports still work.
            should_emit = False
            if use_strict_yiser_profile:
                if directional_emit:
                    should_emit = True
                    press_armed = True
                elif rising_edge and press_armed:
                    press_armed = False
                    if action:
                        should_emit = True
                    elif unknown_button_value is not None:
                        print(
                            "[ring-monitor] unknown key press "
                            f"value={unknown_button_value} known_mic={int(args.yiser_press_value)} "
                            f"known_high_contrast={list(YISER_J6_HIGH_CONTRAST_VALUES)} "
                            f"report={json.dumps(list(report_norm)[:16])}"
                        )
            else:
                if rising_edge:
                    if press_armed:
                        should_emit = True
                        press_armed = False
                elif changed > 0 and not falling_edge:
                    # Fallback mode for unusual reports that don't expose clean edges.
                    should_emit = True

            if falling_edge:
                press_armed = True
                if press_active:
                    duration_ms = now_ms - press_started_ms
                    if hold_reported or duration_ms >= args.hold_ms:
                        print(
                            f"[ring-monitor] hold detected duration_ms={duration_ms:.1f} "
                            f"(threshold={args.hold_ms}) edge_indexes={falling_edge_indexes}"
                        )
                    else:
                        print(
                            f"[ring-monitor] tap detected duration_ms={duration_ms:.1f} "
                            f"edge_indexes={falling_edge_indexes}"
                        )
                    press_active = False
                    hold_reported = False
                    press_started_ms = 0.0

            if should_emit and (now_ms - last_press_ms >= args.debounce_ms):
                try:
                    _push_ring_event(
                        client,
                        endpoint,
                        device_info=device_info,
                        report=report,
                        action=action,
                        button_label=button_label,
                        verbose=args.verbose,
                    )
                    if button_label:
                        print(f"[ring-monitor] ring press detected action={action} button={button_label}")
                    else:
                        print(f"[ring-monitor] ring press detected action={action}")
                    last_press_ms = now_ms
                except Exception as push_error:
                    print(f"[ring-monitor] failed to push event: {push_error}", file=sys.stderr)

            last_report = report_norm
            if args.verbose:
                print(
                    f"[ring-monitor] report={json.dumps(list(report_norm)[:16])} "
                    f"rising_edge={rising_edge} falling_edge={falling_edge} "
                    f"armed={press_armed} press_active={press_active} changed={changed}"
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
    parser.add_argument(
        "--allow-non-ring",
        action="store_true",
        help="Allow fallback to non-ring HID devices (disabled by default).",
    )
    parser.add_argument("--poll-ms", type=int, default=15, help="Read polling interval in ms.")
    parser.add_argument("--debounce-ms", type=int, default=260, help="Debounce for press events.")
    parser.add_argument("--hold-ms", type=int, default=450, help="Hold threshold in ms for hold/tap logging.")
    parser.add_argument(
        "--disable-yiser-filter",
        action="store_true",
        help="Disable strict button filtering for Yiser-J6 (not recommended for your demo).",
    )
    parser.add_argument(
        "--target-byte-index",
        type=int,
        default=YISER_J6_DEFAULT_BUTTON_INDEX,
        help="Strict filter byte index used for target button transitions.",
    )
    parser.add_argument(
        "--yiser-press-value",
        default=str(YISER_J6_DEFAULT_PRESS_VALUE),
        help="Strict filter press value for target byte (accepts decimal or hex, e.g. 3 or 0x03).",
    )
    parser.add_argument("--report-length", type=int, default=64, help="HID report read length.")
    parser.add_argument(
        "--open-retry-sec",
        type=float,
        default=2.0,
        help="Cooldown (seconds) before retrying a candidate that failed to open.",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose HID logging.")
    return parser


def main():
    parser = _build_arg_parser()
    args = parser.parse_args()
    args.vid = _parse_int(args.vid, default=None) if args.vid is not None else None
    args.pid = _parse_int(args.pid, default=None) if args.pid is not None else None
    args.usage_page = _parse_int(args.usage_page, default=None) if args.usage_page is not None else None
    args.yiser_press_value = _parse_int(args.yiser_press_value, default=YISER_J6_DEFAULT_PRESS_VALUE)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    failed_open_until = {}

    print("[ring-monitor] starting. Press Ctrl+C to stop.")
    while not STOP:
        ranked = _rank_candidates(args)
        if not ranked:
            print("[ring-monitor] waiting for matching HID device...")
            time.sleep(1.0)
            continue

        now = time.time()
        expired_keys = [key for key, until in failed_open_until.items() if until <= now]
        for key in expired_keys:
            failed_open_until.pop(key, None)

        attempted_any = False
        opened_any = False
        for device_info in ranked:
            device_key = _stable_device_key(device_info)
            blocked_until = failed_open_until.get(device_key, 0.0)
            if blocked_until > now:
                if args.verbose:
                    remaining = max(0.0, blocked_until - now)
                    print(
                        f"[ring-monitor] skipping candidate (cooldown {remaining:.1f}s): "
                        f"{_device_label(device_info)}"
                    )
                continue

            attempted_any = True
            try:
                _monitor_device(args, device_info)
                opened_any = True
                failed_open_until.pop(device_key, None)
                if STOP:
                    break
            except Exception as exc:
                if STOP:
                    break
                message = str(exc)
                print(f"[ring-monitor] device loop error: {message}", file=sys.stderr)
                message_lower = message.lower()
                if "open failed" in message_lower or "access denied" in message_lower or "permission" in message_lower:
                    failed_open_until[device_key] = time.time() + max(0.5, float(args.open_retry_sec))
                    if _is_os_protected_hid_profile(device_info):
                        print(
                            "[ring-monitor] hint: macOS is likely denying user-level access to this "
                            "keyboard/consumer HID interface (not necessarily another app lock)."
                        )
                        print(
                            "[ring-monitor] hint: run one quick elevated test to confirm:\n"
                            "  sudo -E python3 servers/bionic/ring_monitor.py --server-base http://localhost:8080 --verbose --open-retry-sec 1"
                        )
                    else:
                        print(
                            "[ring-monitor] hint: another process may hold this HID interface "
                            "(e.g. extension WebHID). Disconnect WebHID ring first."
                        )
                time.sleep(0.2)

        if STOP:
            break
        if not attempted_any:
            print("[ring-monitor] all matching candidates are cooling down after open failures...")
            time.sleep(0.6)
            continue
        if not opened_any:
            time.sleep(1.0)
            continue

    print("[ring-monitor] stopped.")


if __name__ == "__main__":
    main()
