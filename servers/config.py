import os
from pathlib import Path
from threading import Lock

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_ENV_PATH = _PROJECT_ROOT / ".env"
_ENV_CACHE = None
_ENV_LOCK = Lock()


def _strip_wrapping_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _parse_env_file(path: Path) -> dict:
    values = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if value and not value.startswith(("'", '"')) and " #" in value:
            value = value.split(" #", 1)[0].strip()

        values[key] = _strip_wrapping_quotes(value)

    return values


def _get_env_cache() -> dict:
    global _ENV_CACHE
    if _ENV_CACHE is not None:
        return _ENV_CACHE
    with _ENV_LOCK:
        if _ENV_CACHE is None:
            _ENV_CACHE = _parse_env_file(_ENV_PATH)
    return _ENV_CACHE


def get_env(name: str, default=None):
    env_value = os.environ.get(name)
    if env_value not in (None, ""):
        return env_value
    return _get_env_cache().get(name, default)

