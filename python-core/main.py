from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from capture import capture_region
from ocr import recognize_text
from tarkov_api import get_item_price

app = FastAPI(title="Tarkov Price Overlay Core")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CaptureRequest(BaseModel):
    x: int
    y: int
    width: int
    height: int


class LookupResponse(BaseModel):
    raw_text: str
    item_name: str | None
    flea_price: int | None
    trader_price: int | None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/lookup", response_model=LookupResponse)
def lookup(req: CaptureRequest) -> LookupResponse:
    image = capture_region(req.x, req.y, req.width, req.height)
    text = recognize_text(image)
    price = get_item_price(text)
    return LookupResponse(
        raw_text=text,
        item_name=price.get("name"),
        flea_price=price.get("flea"),
        trader_price=price.get("trader"),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
