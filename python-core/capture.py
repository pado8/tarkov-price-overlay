import mss
import numpy as np


def capture_region(x: int, y: int, width: int, height: int) -> np.ndarray:
    region = {"left": x, "top": y, "width": width, "height": height}
    with mss.mss() as sct:
        shot = sct.grab(region)
        return np.array(shot)
