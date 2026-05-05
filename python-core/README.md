# python-core

Tarkov 가격 오버레이의 Python 코어 (화면 캡처 + OCR + tarkov.dev API).

## 설치

```bash
cd python-core
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 실행

```bash
python main.py
```

서버: `http://127.0.0.1:8765`

## 엔드포인트

- `GET /health` - 상태 확인
- `POST /lookup` - 영역 캡처 → OCR → 가격 조회
  ```json
  { "x": 100, "y": 100, "width": 300, "height": 50 }
  ```
