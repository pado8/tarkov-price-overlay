import easyocr
import numpy as np

_readers: dict[tuple[str, ...], easyocr.Reader] = {}


def _get_reader(langs: tuple[str, ...]) -> easyocr.Reader:
    if langs not in _readers:
        _readers[langs] = easyocr.Reader(list(langs), gpu=False)
    return _readers[langs]


def recognize_text(image: np.ndarray, langs: tuple[str, ...] = ("ko", "en")) -> str:
    reader = _get_reader(langs)
    results = reader.readtext(image, detail=0, paragraph=True)
    return " ".join(results).strip()
