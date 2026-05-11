"""Quest progress tracker — parses EFT game logs to detect quest start/complete/fail.

Pure file-reading: opens push-notifications log files that the game writes to disk
and parses JSON blocks for `new_message` notifications with quest-related types.
No game memory access, no DLL injection, no process interaction — same safety
profile as reading any text file the game produced.

Reference for the log format:
- Zeliper/Tarkov-Item-Helper LogSyncService.cs
- EFT writes to: <install>/build/Logs/log_YYYY.MM.DD_HH-MM-SS_VERSION/
  <timestamp> <player>_push-notifications_*.log

Quest event JSON shape:
    {
      "type": "new_message",
      "message": {
        "type": 10 | 11 | 12,         # 10=Started, 11=Failed, 12=Completed
        "templateId": "<questId> ...", # first space-separated token = quest ID
        "dt": 1700000000               # unix epoch seconds
      },
      "dialogId": "<traderId>"
    }
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Optional

# Quest event message type codes (from EFT push-notifications schema).
MSG_STARTED = 10
MSG_FAILED = 11
MSG_COMPLETED = 12

# How often the background watcher re-checks the log folder for new entries.
POLL_INTERVAL_SEC = 2.5

# Common EFT install locations to try when the user hasn't set a path manually.
# The Steam path covers users who relocated/symlinked their install there
# (mentioned by an early user — EFT isn't officially on Steam).
COMMON_INSTALL_PATHS = [
    r"C:\Battlestate Games\EFT",
    r"C:\Battlestate Games\EscapeFromTarkov",
    r"C:\Program Files\Battlestate Games\EFT",
    r"C:\Program Files (x86)\Battlestate Games\EFT",
    r"C:\Program Files (x86)\Steam\steamapps\common\Escape from Tarkov",
    r"D:\Battlestate Games\EFT",
    r"D:\Games\Escape from Tarkov",
    r"E:\Battlestate Games\EFT",
    r"E:\Games\Escape from Tarkov",
]


def _state_dir() -> Path:
    """Where we cache our discovered quest state — outside the game install
    so we never write into BSG's directory tree."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    else:
        base = Path.home() / ".local" / "share"
    d = base / "TarkovPriceOverlay"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _state_file() -> Path:
    return _state_dir() / "quest_state.json"


def _registry_install_path() -> Optional[str]:
    """Look for an explicit EFT install entry in the Windows registry.
    Returns a path to the install root (containing build/Logs/) or None."""
    if sys.platform != "win32":
        return None
    try:
        import winreg
    except ImportError:
        return None
    candidates = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Battlestate Games\EscapeFromTarkov"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Battlestate Games\EscapeFromTarkov"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Battlestate Games\EscapeFromTarkov"),
    ]
    for hive, subkey in candidates:
        try:
            with winreg.OpenKey(hive, subkey) as k:
                for value_name in ("InstallLocation", "Path", "InstallPath"):
                    try:
                        val, _ = winreg.QueryValueEx(k, value_name)
                        if val and Path(val).is_dir():
                            return str(val)
                    except FileNotFoundError:
                        continue
        except OSError:
            continue
    return None


def detect_install_path() -> Optional[str]:
    """Try registry first, then common install dirs. Returns a directory
    containing `build/Logs/`, or None if nothing matches."""
    candidate = _registry_install_path()
    if candidate and (Path(candidate) / "build" / "Logs").is_dir():
        return candidate
    for path in COMMON_INSTALL_PATHS:
        if (Path(path) / "build" / "Logs").is_dir():
            return path
    # Sometimes the registry/path points at the launcher dir, not the EFT root.
    # If we found a registry hit but no build/Logs, surface it anyway so the
    # user sees something — they can correct it in the UI.
    return candidate


def is_valid_install_path(path: str) -> bool:
    """A path is usable if it contains build/Logs/ that we can list."""
    if not path:
        return False
    p = Path(path) / "build" / "Logs"
    return p.is_dir()


# Folder name pattern: `log_2025.12.02_19-46-45_1.0.0.2.42157`
# EFT does NOT zero-pad single-digit hours/minutes/seconds, so a 2 AM session
# shows up as `log_2025.12.02_2-46-45_...` not `02-46-45`. Allow 1-2 digits
# for the time components — using {2} dropped roughly a third of all folders
# in a long-running player's history.
_LOG_FOLDER_RE = re.compile(r"^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{1,2})-(\d{1,2})")


def _folder_sort_key(folder: Path) -> tuple:
    """Sort folders chronologically by parsed timestamp from their name.
    A `log_2026.05.11_2-46-45_...` folder predates `log_2026.05.11_10-26-14_...`
    even though string-sort would order them backwards (`'1' < '2'` lexically
    when compared char-by-char ignoring length)."""
    m = _LOG_FOLDER_RE.match(folder.name)
    if not m:
        return (0, 0, 0, 0, 0, 0, folder.name)
    return tuple(int(g) for g in m.groups())


def _list_log_folders(install_path: str) -> list[Path]:
    """All `log_YYYY.MM.DD_HH-MM-SS*` folders, sorted chronologically (oldest
    first). Chronological order means later events naturally overwrite earlier
    ones in the status dict — no special-case logic needed."""
    logs_root = Path(install_path) / "build" / "Logs"
    if not logs_root.is_dir():
        return []
    folders = [
        p for p in logs_root.iterdir()
        if p.is_dir() and _LOG_FOLDER_RE.match(p.name)
    ]
    folders.sort(key=_folder_sort_key)
    return folders


def _push_notification_files(folder: Path) -> list[Path]:
    """Push-notifications log files inside a single session folder."""
    return sorted(folder.glob("*push-notifications*.log"))


# A push-notifications log is a sequence of JSON objects pretty-printed with
# braces on their own lines. We track brace depth to find complete blocks.
def _iter_json_blocks(text: str):
    """Yield each top-level JSON object found in `text`. Tolerates the
    multi-line pretty format EFT writes."""
    depth = 0
    start = -1
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    yield text[start : i + 1]
                    start = -1


def _parse_quest_event(block: str) -> Optional[dict]:
    """Return {quest_id, status, timestamp} for a single JSON block if it
    represents a quest event, else None."""
    try:
        obj = json.loads(block)
    except json.JSONDecodeError:
        return None
    if obj.get("type") != "new_message":
        return None
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return None
    msg_type = msg.get("type")
    if msg_type not in (MSG_STARTED, MSG_FAILED, MSG_COMPLETED):
        return None
    template_id = msg.get("templateId")
    if not isinstance(template_id, str) or not template_id:
        return None
    quest_id = template_id.split(" ", 1)[0]
    status = {
        MSG_STARTED: "started",
        MSG_FAILED: "failed",
        MSG_COMPLETED: "completed",
    }[msg_type]
    return {"quest_id": quest_id, "status": status, "ts": msg.get("dt", 0)}


class QuestTracker:
    """Watches EFT log folders and maintains the latest known quest status
    per quest ID. Thread-safe accessors for the FastAPI request handlers."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # quest_id -> {"status": "started"|"completed"|"failed", "ts": int}
        # The latest-by-`ts` event wins, so scan order doesn't matter.
        self._status: dict[str, dict] = {}
        # Per-file read offset so each poll only reads the new tail bytes.
        self._file_offsets: dict[str, int] = {}
        # User-configurable; falls back to auto-detect.
        self._install_path: Optional[str] = None
        # Background poll thread.
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._enabled = True
        self._last_scan_count = 0  # how many quest events we have on file
        self._load_state()

    # ---------- state persistence ----------

    def _load_state(self) -> None:
        try:
            data = json.loads(_state_file().read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return
        raw = data.get("status", {})
        # Migrate old shape `{qid: "completed"}` → `{qid: {status, ts: 0}}`.
        # Old entries get ts=0 so any newly seen real event will overwrite them.
        normalized: dict[str, dict] = {}
        for qid, val in raw.items():
            if isinstance(val, dict):
                normalized[qid] = {
                    "status": val.get("status", "started"),
                    "ts": int(val.get("ts", 0)),
                }
            elif isinstance(val, str):
                normalized[qid] = {"status": val, "ts": 0}
        with self._lock:
            self._status = normalized
            self._install_path = data.get("install_path") or None
            self._enabled = bool(data.get("enabled", True))
        print(
            f"[quest] loaded state: {len(self._status)} quests "
            f"(install_path={self._install_path}, enabled={self._enabled})"
        )

    def _save_state(self) -> None:
        with self._lock:
            payload = {
                "status": dict(self._status),
                "install_path": self._install_path,
                "enabled": self._enabled,
            }
        try:
            _state_file().write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )
        except OSError as e:
            print(f"[quest] WARN: failed to save state — {e}")

    # ---------- public API ----------

    def get_status(self) -> dict:
        with self._lock:
            counts = {"started": 0, "completed": 0, "failed": 0}
            for entry in self._status.values():
                s = entry.get("status") if isinstance(entry, dict) else entry
                if s in counts:
                    counts[s] += 1
            user_path = self._install_path
            enabled = self._enabled
        auto_path = detect_install_path()
        # The path actually used by scanning is user-set if present, else
        # auto-detected. The frontend shows this so users see a clear
        # "syncing from X" or "couldn't find EFT install".
        effective = user_path or auto_path
        return {
            "enabled": enabled,
            "install_path": user_path,  # user override (None if auto)
            "auto_detected_path": auto_path,
            "effective_path": effective,
            "effective_path_valid": is_valid_install_path(effective or ""),
            "quest_count": len(counts) and (counts["started"] + counts["completed"] + counts["failed"]),
            "completed_count": counts["completed"],
            "started_count": counts["started"],
            "failed_count": counts["failed"],
        }

    def quest_status_for(self, quest_id: str) -> Optional[str]:
        """Return 'started' | 'completed' | 'failed' | None for a quest ID.
        Returns None when the tracker is disabled, even if we have cached
        state — disable should hide the overlay entirely so the user gets
        the un-filtered view back."""
        if not quest_id:
            return None
        with self._lock:
            if not self._enabled:
                return None
            entry = self._status.get(quest_id)
            if not entry:
                return None
            return entry.get("status") if isinstance(entry, dict) else entry

    def all_status(self) -> dict[str, str]:
        with self._lock:
            return {
                qid: (entry.get("status") if isinstance(entry, dict) else entry)
                for qid, entry in self._status.items()
            }

    def set_install_path(self, path: str) -> dict:
        """User-set install path. Empty string clears it (back to auto-detect)."""
        normalized = path.strip()
        with self._lock:
            self._install_path = normalized or None
            # Clearing the path means we should rescan everything fresh next tick.
            self._file_offsets.clear()
        self._save_state()
        # Trigger an immediate scan with the new path.
        self.scan_once()
        return self.get_status()

    def set_enabled(self, enabled: bool) -> None:
        with self._lock:
            was = self._enabled
            self._enabled = bool(enabled)
        self._save_state()
        # Re-enabling kicks off an immediate scan so the user doesn't have
        # to wait for the next poll interval to see fresh data.
        if enabled and not was:
            self.scan_once()

    def reset(self) -> None:
        """Wipe all known quest state and re-scan from scratch.
        Useful after a wipe or if the user wants a fresh start."""
        with self._lock:
            self._status.clear()
            self._file_offsets.clear()
        self._save_state()
        self.scan_once()

    # ---------- scanning ----------

    def _effective_install_path(self) -> Optional[str]:
        with self._lock:
            return self._install_path or detect_install_path()

    def scan_once(self) -> int:
        """Read any new bytes from log files and update status. Returns the
        number of new quest events processed this scan."""
        if not self._enabled:
            return 0
        install = self._effective_install_path()
        if not install or not is_valid_install_path(install):
            return 0
        new_events = 0
        for folder in _list_log_folders(install):
            for log_file in _push_notification_files(folder):
                key = str(log_file)
                try:
                    size = log_file.stat().st_size
                except OSError:
                    continue
                offset = self._file_offsets.get(key, 0)
                # File rotated/truncated → restart from 0.
                if offset > size:
                    offset = 0
                if offset == size:
                    continue
                try:
                    with log_file.open("rb") as f:
                        f.seek(offset)
                        chunk = f.read()
                except OSError:
                    continue
                # Decode tolerantly — game logs are UTF-8 but we don't want a
                # stray byte to wipe out our progress.
                text = chunk.decode("utf-8", errors="replace")
                # Find the last complete `}` so we don't half-parse a record
                # that's still being written.
                last_brace = text.rfind("}")
                if last_brace < 0:
                    # No complete object in this chunk — wait for more.
                    continue
                consumable = text[: last_brace + 1]
                consumed_bytes = len(consumable.encode("utf-8"))
                self._file_offsets[key] = offset + consumed_bytes
                for block in _iter_json_blocks(consumable):
                    event = _parse_quest_event(block)
                    if not event:
                        continue
                    qid = event["quest_id"]
                    new_status = event["status"]
                    new_ts = int(event.get("ts") or 0)
                    with self._lock:
                        prev = self._status.get(qid)
                        prev_ts = (
                            prev.get("ts", 0) if isinstance(prev, dict) else 0
                        )
                        # Latest event wins by timestamp. Equal-or-greater so
                        # ts=0 (legacy entries) gets overwritten by any real
                        # event, and ties (same-second events) prefer the
                        # later-read one in scan order.
                        if prev is None or new_ts >= prev_ts:
                            self._status[qid] = {
                                "status": new_status,
                                "ts": new_ts,
                            }
                            new_events += 1
        if new_events:
            self._save_state()
            self._last_scan_count += new_events
            print(f"[quest] +{new_events} events (total tracked: {len(self._status)})")
        return new_events

    def _watch_loop(self) -> None:
        # Initial scan picks up everything that exists when the app starts.
        try:
            self.scan_once()
        except Exception as e:
            print(f"[quest] initial scan failed: {e!r}")
        while not self._stop_event.is_set():
            self._stop_event.wait(POLL_INTERVAL_SEC)
            if self._stop_event.is_set():
                break
            try:
                self.scan_once()
            except Exception as e:
                # Never let a bad log file kill the watcher.
                print(f"[quest] scan error: {e!r}")

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._watch_loop, name="quest-tracker", daemon=True
        )
        self._thread.start()
        print(
            f"[quest] watcher started (install={self._effective_install_path()}, "
            f"poll={POLL_INTERVAL_SEC}s)"
        )

    def stop(self) -> None:
        self._stop_event.set()


# Process-wide singleton — FastAPI handlers and the /lookup enrichment all
# read from the same instance.
_tracker: Optional[QuestTracker] = None


def get_tracker() -> QuestTracker:
    global _tracker
    if _tracker is None:
        _tracker = QuestTracker()
    return _tracker
