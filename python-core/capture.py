import os
from datetime import datetime

import mss
import numpy as np
from PIL import Image

DEBUG_DIR = os.path.join(os.path.dirname(__file__), "_debug_captures")


def capture_region(x: int, y: int, width: int, height: int) -> np.ndarray:
    region = {"left": x, "top": y, "width": width, "height": height}
    with mss.mss() as sct:
        shot = sct.grab(region)
        arr = np.array(shot)

    os.makedirs(DEBUG_DIR, exist_ok=True)
    ts = datetime.now().strftime("%H%M%S")
    debug_path = os.path.join(DEBUG_DIR, f"capture_{ts}_x{x}_y{y}_{width}x{height}.png")
    Image.fromarray(arr[:, :, :3][:, :, ::-1]).save(debug_path)
    print(f"[capture] region={region} -> {debug_path}")

    return arr
