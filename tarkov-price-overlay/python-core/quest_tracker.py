"""Quest progress tracker — parses EFT game logs to detect quest start/complete/fail.

Pure file-reading: opens push-notifications log files that the game writes to disk
and parses JSON blocks for `new_message` notifications with quest-related types.
No game memory access, no DLL injection, no process interaction — same safety
profile as reading any text file the game produced.

PVE vs PVP separation
---------------------
EFT writes a separate log session folder per launch, and each session is either
PVP (regular) or PVE. Quest progress on the two servers is independent — a quest
completed on PVE is NOT completed on PVP, and vice versa. So we detect the mode
per session folder and keep two parallel quest-state dicts. Mode detection uses
two signals, in order:

  1. application_*.log line ~141: "|Info|application|Session mode: Pve" (or Pvp)
  2. backend_*.log first ~20 lines: the /client/game/start request URL is either
     gw-pve.escapefromtarkov.com or gw-pvp.escapefromtarkov.com

The first signal is more reliable but only appears once per session. The second
is a fallback. Default is "pvp" if neither is found — matches the pre-PVE
historical assumption.

Reference for the log format:
- Zeliper/Tarkov-Item-Helper LogSyncService.cs
- Live EFT writes to: <install>/Logs/log_YYYY.MM.DD_HH-MM-SS_VERSION/
- SPT-AKI / some custom builds use: <install>/build/Logs/...
  We try both layouts so users on either don't have to know the difference.
  File name pattern: <timestamp> <player>_push-notifications_*.log

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
from typing import Literal, Optional

# Quest event message type codes (from EFT push-notifications schema).
MSG_STARTED = 10
MSG_FAILED = 11
MSG_COMPLETED = 12

# How often the background watcher re-checks the log folder for new entries.
POLL_INTERVAL_SEC = 2.5

GameMode = Literal["pvp", "pve"]
MODES: tuple[GameMode, ...] = ("pvp", "pve")

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
    # F:/G: added after multiple users with secondary game drives reported
    # "EFT 설치 경로 못 찾음" despite valid installs — registry lookup
    # often misses these because BSG launcher only writes its own install
    # path, not relocated copies.
    r"F:\Battlestate Games\EFT",
    r"F:\Games\Escape from Tarkov",
    r"G:\Battlestate Games\EFT",
    r"G:\Games\Escape from Tarkov",
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


# Folder name pattern: `log_2025.12.02_19-46-45_1.0.0.2.42157`
# EFT does NOT zero-pad single-digit hours/minutes/seconds, so a 2 AM session
# shows up as `log_2025.12.02_2-46-45_...` not `02-46-45`. Allow 1-2 digits
# for the time components — using {2} dropped roughly a third of all folders
# in a long-running player's history.
_LOG_FOLDER_RE = re.compile(r"^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{1,2})-(\d{1,2})")


# Subfolder layouts we know about, in priority order.
# Live EFT writes directly to <install>/Logs/. SPT-AKI and a few custom
# launchers nest it under <install>/build/Logs/. Empty tuple means "the
# install root IS the logs root" — kept as a last-ditch fallback for users
# who pointed at the Logs folder itself instead of the EFT install root.
_LOGS_SUBPATHS: tuple[tuple[str, ...], ...] = (
    ("Logs",),
    ("build", "Logs"),
    (),
)


def _resolve_logs_root(install_path: str) -> Optional[Path]:
    """Find the actual `log_*` folder container under `install_path`.
    Returns the Logs directory if any known layout has at least one
    `log_YYYY.MM.DD_*` folder inside it, else None.

    We require at least one matching child folder rather than just the
    directory existing — a stray empty `Logs` next to the install root
    shouldn't shadow the real logs further down.
    """
    if not install_path:
        return None
    base = Path(install_path)
    for parts in _LOGS_SUBPATHS:
        candidate = base.joinpath(*parts) if parts else base
        if not candidate.is_dir():
            continue
        try:
            for entry in candidate.iterdir():
                if entry.is_dir() and _LOG_FOLDER_RE.match(entry.name):
                    return candidate
        except OSError:
            continue
    return None


def _registry_install_path() -> Optional[str]:
    """Look for an explicit EFT install entry in the Windows registry.
    Returns a path to the install root (containing a Logs/ subtree) or None.

    Also checks the Steam Uninstall entry (DisplayName "Escape from Tarkov"),
    since the BSG-launcher key is often empty when the game was installed
    or relocated via Steam.
    """
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
    # Steam Uninstall registry — scan for a DisplayName matching EFT.
    uninstall_roots = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, subkey in uninstall_roots:
        try:
            with winreg.OpenKey(hive, subkey) as root:
                i = 0
                while True:
                    try:
                        sub = winreg.EnumKey(root, i)
                    except OSError:
                        break
                    i += 1
                    try:
                        with winreg.OpenKey(root, sub) as k:
                            try:
                                name, _ = winreg.QueryValueEx(k, "DisplayName")
                            except FileNotFoundError:
                                continue
                            if not isinstance(name, str) or "Escape from Tarkov" not in name or "Arena" in name:
                                continue
                            try:
                                loc, _ = winreg.QueryValueEx(k, "InstallLocation")
                            except FileNotFoundError:
                                continue
                            if loc and Path(loc).is_dir():
                                return str(loc)
                    except OSError:
                        continue
        except OSError:
            continue
    return None


def detect_install_path() -> Optional[str]:
    """Try registry first, then common install dirs. Returns the install
    root that has a usable Logs subtree (any known layout), or None.

    Falls back to the registry hit even without logs so the UI can show
    "we found EFT here but no logs yet" rather than "we found nothing".
    """
    candidate = _registry_install_path()
    if candidate and _resolve_logs_root(candidate) is not None:
        return candidate
    for path in COMMON_INSTALL_PATHS:
        if _resolve_logs_root(path) is not None:
            return path
    return candidate


def is_valid_install_path(path: str) -> bool:
    """A path is usable if any known layout (Logs/, build/Logs/, or the
    path itself) has at least one log_* folder inside."""
    return _resolve_logs_root(path) is not None


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
    logs_root = _resolve_logs_root(install_path)
    if logs_root is None:
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


# How many bytes to read from application/backend logs when sniffing the mode.
# The "Session mode: Pve/Pvp" line lands around byte 18000-25000, and the
# backend /client/game/start request is in the first few KB. 64 KB is enough
# headroom for both without slurping the full multi-MB log.
_MODE_SNIFF_BYTES = 64 * 1024

# Capture ANY mode word, not just Pve|Pvp. EFT 1.1.0 (2026-07 seasonal system)
# introduces an opt-in seasonal realm with its own fresh-start character — if
# those sessions self-report a NEW mode label, silently defaulting them to
# "pvp" would pollute the user's permanent-PVP quest state with seasonal
# events. Unknown labels are classified "unknown" and their quest events are
# ignored until we ship real support for the new mode.
_RE_SESSION_MODE = re.compile(r"Session mode:\s*([A-Za-z0-9_]+)", re.IGNORECASE)
_RE_BACKEND_HOST = re.compile(r"https://gw-([a-z0-9_-]+)\.escapefromtarkov\.com/client/game/start", re.IGNORECASE)

# What scanning classifies a session folder as. "unknown" = a mode label we
# don't recognize (likely a new game mode) — quest events from those folders
# are skipped rather than guessed into the wrong bucket.
SessionMode = Literal["pvp", "pve", "unknown"]


def _classify_mode_word(word: str) -> SessionMode:
    w = word.lower()
    if w == "pve":
        return "pve"
    if w in ("pvp", "regular"):
        return "pvp"
    return "unknown"


def detect_session_mode(folder: Path) -> SessionMode:
    """Inspect a single session folder and return 'pve', 'pvp', or 'unknown'.

    Falls back to 'pvp' only when NO mode signal is found at all — that's the
    pre-PVE historical default and matches the "regular" game_mode value the
    frontend has been sending since before PVE existed. A signal that IS found
    but isn't a known label returns 'unknown' (new game mode — don't guess).
    """
    # Signal 1: application_*.log "Session mode: X" line. Strongest signal
    # because it's the game's own self-reported mode rather than inference from
    # network traffic. If present, it's authoritative — including for labels
    # we don't recognize.
    for app_log in folder.glob("*application_*.log"):
        try:
            with app_log.open("rb") as f:
                chunk = f.read(_MODE_SNIFF_BYTES).decode("utf-8", errors="replace")
        except OSError:
            continue
        m = _RE_SESSION_MODE.search(chunk)
        if m:
            return _classify_mode_word(m.group(1))
        break  # only one application log per folder

    # Signal 2: backend_*.log /client/game/start request host. The first
    # /client/menu/locale request hits gw-pvp even on PVE (menu service is
    # shared), so we specifically look for /client/game/start which is mode-
    # specific.
    for backend_log in folder.glob("*backend_*.log"):
        try:
            with backend_log.open("rb") as f:
                chunk = f.read(_MODE_SNIFF_BYTES).decode("utf-8", errors="replace")
        except OSError:
            continue
        m = _RE_BACKEND_HOST.search(chunk)
        if m:
            return _classify_mode_word(m.group(1))
        break

    return "pvp"


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


def _normalize_request_mode(mode: Optional[str]) -> GameMode:
    """Map the frontend's `game_mode` values to our internal pvp/pve labels.
    Frontend uses 'regular' for live PVP; anything unrecognized defaults to
    PVP so old clients keep working."""
    if mode == "pve":
        return "pve"
    return "pvp"


class QuestTracker:
    """Watches EFT log folders and maintains the latest known quest status
    per quest ID, separately for PVP and PVE servers. Thread-safe accessors
    for the FastAPI request handlers."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # mode -> quest_id -> {"status": "started"|"completed"|"failed", "ts": int}
        # The latest-by-`ts` event wins within a mode, so scan order doesn't matter.
        self._status: dict[GameMode, dict[str, dict]] = {m: {} for m in MODES}
        # mode -> epoch seconds; log events with ts BEFORE this are ignored.
        # 0 = no watermark (default). Set by the "wipe reset" — after an EFT
        # wipe/season reset the in-game progress is fresh but the old log
        # folders still hold pre-wipe completions, so a plain rescan would just
        # resurrect stale state. The watermark makes "start over from now"
        # actually stick while keeping the log-derived design.
        self._ignore_before: dict[GameMode, int] = {m: 0 for m in MODES}
        # Per-file read offset so each poll only reads the new tail bytes.
        self._file_offsets: dict[str, int] = {}
        # session_folder_path -> detected mode. Cached so we don't re-sniff
        # the log header on every poll; mode is fixed for the lifetime of a
        # session folder (game can't switch mid-raid). "unknown" folders are
        # cached too — their quest events are skipped (new-mode guard).
        self._folder_mode: dict[str, SessionMode] = {}
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
        # Two on-disk shapes are accepted:
        #   New:  {"status_by_mode": {"pvp": {...}, "pve": {...}}, ...}
        #   Old:  {"status": {qid: "completed" | {status, ts}}, ...}
        # The old shape predates PVE support and stored a single global dict.
        # We migrate by copying it into BOTH modes — the user's existing
        # progress is treated as applying to whichever server they're on next.
        # Worst case they reset one of the two modes from the UI.
        normalized: dict[GameMode, dict[str, dict]] = {m: {} for m in MODES}
        new_shape = data.get("status_by_mode")
        if isinstance(new_shape, dict):
            for mode in MODES:
                raw = new_shape.get(mode, {})
                if not isinstance(raw, dict):
                    continue
                for qid, val in raw.items():
                    if isinstance(val, dict):
                        normalized[mode][qid] = {
                            "status": val.get("status", "started"),
                            "ts": int(val.get("ts", 0)),
                        }
                    elif isinstance(val, str):
                        normalized[mode][qid] = {"status": val, "ts": 0}
        else:
            legacy = data.get("status", {})
            for qid, val in legacy.items():
                if isinstance(val, dict):
                    entry = {
                        "status": val.get("status", "started"),
                        "ts": int(val.get("ts", 0)),
                    }
                elif isinstance(val, str):
                    entry = {"status": val, "ts": 0}
                else:
                    continue
                for mode in MODES:
                    normalized[mode][qid] = dict(entry)
            if legacy:
                print(
                    f"[quest] migrated {len(legacy)} legacy quests to both "
                    f"PVP+PVE modes (next save will use new shape)"
                )
        ignore_before: dict[GameMode, int] = {m: 0 for m in MODES}
        raw_ignore = data.get("ignore_before")
        if isinstance(raw_ignore, dict):
            for mode in MODES:
                try:
                    ignore_before[mode] = max(0, int(raw_ignore.get(mode, 0)))
                except (TypeError, ValueError):
                    pass
        with self._lock:
            self._status = normalized
            self._ignore_before = ignore_before
            self._install_path = data.get("install_path") or None
            self._enabled = bool(data.get("enabled", True))
        print(
            f"[quest] loaded state: pvp={len(self._status['pvp'])}, "
            f"pve={len(self._status['pve'])} "
            f"(install_path={self._install_path}, enabled={self._enabled})"
        )

    def _save_state(self) -> None:
        with self._lock:
            payload = {
                "status_by_mode": {m: dict(self._status[m]) for m in MODES},
                "ignore_before": dict(self._ignore_before),
                "install_path": self._install_path,
                "enabled": self._enabled,
            }
        try:
            _state_file().write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )
        except OSError as e:
            print(f"[quest] WARN: failed to save state - {e}")

    # ---------- public API ----------

    def _count(self, mode: GameMode) -> dict:
        counts = {"started": 0, "completed": 0, "failed": 0}
        for entry in self._status[mode].values():
            s = entry.get("status") if isinstance(entry, dict) else entry
            if s in counts:
                counts[s] += 1
        return counts

    def get_status(self) -> dict:
        with self._lock:
            counts_by_mode = {m: self._count(m) for m in MODES}
            ignore_before = dict(self._ignore_before)
            unknown_folders = sum(
                1 for v in self._folder_mode.values() if v == "unknown"
            )
            user_path = self._install_path
            enabled = self._enabled
        auto_path = detect_install_path()
        # The path actually used by scanning is user-set if present, else
        # auto-detected. The frontend shows this so users see a clear
        # "syncing from X" or "couldn't find EFT install".
        effective = user_path or auto_path
        # Legacy aggregate counts — frontend code that reads
        # completed_count/started_count without picking a mode falls back to
        # PVP (the historical default before PVE existed). New frontend
        # should use counts_by_mode to show mode-specific numbers. Using
        # sum() here would double-count migrated legacy quests; using
        # union-of-IDs would be more accurate but obscures the per-server
        # split that's the whole point of this change.
        agg = counts_by_mode["pvp"]
        return {
            "enabled": enabled,
            "install_path": user_path,  # user override (None if auto)
            "auto_detected_path": auto_path,
            "effective_path": effective,
            "effective_path_valid": is_valid_install_path(effective or ""),
            "quest_count": agg["started"] + agg["completed"] + agg["failed"],
            "completed_count": agg["completed"],
            "started_count": agg["started"],
            "failed_count": agg["failed"],
            "counts_by_mode": counts_by_mode,
            # epoch seconds per mode; >0 means a wipe reset is active and log
            # events before that moment are ignored. UI can show "새 시즌 기준".
            "ignore_before_by_mode": ignore_before,
            # Session folders whose game mode we couldn't classify (likely a
            # new mode after a game update). >0 = time to add mode support.
            "unknown_mode_folders": unknown_folders,
        }

    def is_enabled(self) -> bool:
        """Thread-safe read of the enabled flag. Cheaper than get_status()
        (which probes the registry + filesystem on every call) so it's
        usable on the /lookup hot path."""
        with self._lock:
            return self._enabled

    def quest_status_for(self, quest_id: str, game_mode: Optional[str] = None) -> Optional[str]:
        """Return 'started' | 'completed' | 'failed' | None for a quest ID
        in the given game mode (default: 'pvp' / regular).

        Returns None when the tracker is disabled, even if we have cached
        state — disable should hide the overlay entirely so the user gets
        the un-filtered view back.
        """
        if not quest_id:
            return None
        mode = _normalize_request_mode(game_mode)
        with self._lock:
            if not self._enabled:
                return None
            entry = self._status[mode].get(quest_id)
            if not entry:
                return None
            return entry.get("status") if isinstance(entry, dict) else entry

    def all_status(self, game_mode: Optional[str] = None) -> dict[str, str]:
        mode = _normalize_request_mode(game_mode)
        with self._lock:
            return {
                qid: (entry.get("status") if isinstance(entry, dict) else entry)
                for qid, entry in self._status[mode].items()
            }

    def set_install_path(self, path: str) -> dict:
        """User-set install path. Empty string clears it (back to auto-detect)."""
        normalized = path.strip()
        with self._lock:
            self._install_path = normalized or None
            # Clearing the path means we should rescan everything fresh next tick.
            self._file_offsets.clear()
            self._folder_mode.clear()
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

    def reset(self, game_mode: Optional[str] = None, from_now: bool = False) -> None:
        """Wipe known quest state and re-scan from scratch.

        If `game_mode` is given ('pvp' or 'pve'), only that mode is cleared
        and the file-offset cache is preserved (other mode's offsets still
        valid). If omitted, both modes are wiped and we rescan everything.

        `from_now=True` is the WIPE RESET: it also sets an ignore-watermark
        at the current time, so pre-existing log events won't repopulate the
        cleared state. Use after an EFT wipe/season reset, when the in-game
        progress is fresh but old logs still hold last season's completions.
        A plain reset (`from_now=False`) CLEARS the watermark again and
        re-derives everything from the full log history — that doubles as the
        undo for an accidental wipe reset.
        """
        target_modes: tuple[GameMode, ...] = (
            MODES if game_mode is None else (_normalize_request_mode(game_mode),)
        )
        watermark = int(time.time()) if from_now else 0
        if from_now:
            # One-deep safety net before the destructive path. A plain reset
            # re-derives state from logs, but entries whose log folders have
            # since been deleted (launcher cleanups) are NOT recoverable that
            # way — observed live: 3 of 379 completed quests lost on a
            # wipe→plain-reset round trip. Keep the pre-wipe snapshot so that
            # worst case is a manual file restore, not permanent loss.
            try:
                src = _state_file()
                if src.exists():
                    (_state_dir() / "quest_state.pre-wipe.json").write_bytes(
                        src.read_bytes()
                    )
            except OSError as e:
                print(f"[quest] WARN: pre-wipe backup failed - {e}")
        with self._lock:
            for m in target_modes:
                self._status[m].clear()
                self._ignore_before[m] = watermark
            # Rescan from byte 0 either way. For a wipe reset the watermark
            # (not the offset cache) is what keeps old events out; for a plain
            # reset the full re-read is the whole point. Offsets are shared
            # across modes, so single-mode resets re-read the other mode's
            # files too — idempotent (same ts wins), just a little I/O.
            self._file_offsets.clear()
            self._folder_mode.clear()
        self._save_state()
        self.scan_once()

    # ---------- scanning ----------

    def _effective_install_path(self) -> Optional[str]:
        with self._lock:
            return self._install_path or detect_install_path()

    def _mode_for_folder(self, folder: Path) -> SessionMode:
        key = str(folder)
        cached = self._folder_mode.get(key)
        if cached is not None:
            return cached
        mode = detect_session_mode(folder)
        self._folder_mode[key] = mode
        return mode

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
            mode = self._mode_for_folder(folder)
            if mode == "unknown":
                # New/unrecognized game mode (e.g. a future seasonal realm).
                # Guessing a bucket would corrupt permanent progress — skip
                # and surface via get_status so we notice and add support.
                continue
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
                        # Wipe-reset watermark: events from before the user's
                        # declared fresh-start moment are pre-wipe history and
                        # must not resurrect stale progress.
                        if new_ts < self._ignore_before[mode]:
                            continue
                        prev = self._status[mode].get(qid)
                        prev_ts = (
                            prev.get("ts", 0) if isinstance(prev, dict) else 0
                        )
                        # Latest event wins by timestamp. Equal-or-greater so
                        # ts=0 (legacy entries) gets overwritten by any real
                        # event, and ties (same-second events) prefer the
                        # later-read one in scan order.
                        if prev is None or new_ts >= prev_ts:
                            self._status[mode][qid] = {
                                "status": new_status,
                                "ts": new_ts,
                            }
                            new_events += 1
        if new_events:
            self._save_state()
            self._last_scan_count += new_events
            print(
                f"[quest] +{new_events} events "
                f"(pvp={len(self._status['pvp'])}, pve={len(self._status['pve'])})"
            )
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
