import easyocr
import numpy as np

_reader: easyocr.Reader | None = None


def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


def recognize_text(image: np.ndarray) -> str:
    reader = _get_reader()
    results = reader.readtext(image, detail=0, paragraph=True)
    return " ".join(results).strip()
