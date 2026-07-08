# 포스트잇 모티프 아이콘 PNG 생성 (16/32/48/128px).
# icons/icon.svg와 같은 디자인을 PIL로 그린다 (1024px 슈퍼샘플링 후 축소).
# 사용법: python scripts/make-icons.py  (저장소 어디서 실행해도 됨)
import os
from PIL import Image, ImageDraw

S = 8  # 128 기준 좌표 → 1024 캔버스
W = 128 * S
FOLD = 34 * S

BODY = (255, 224, 102, 255)     # #FFE066
FOLD_C = (232, 184, 75, 255)    # #E8B84B
LINE = (168, 130, 40, 166)      # #A88228, 65% 알파

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 본체: 둥근 사각형
x0, y0, x1, y1 = 8 * S, 10 * S, 120 * S, 118 * S
d.rounded_rectangle([x0, y0, x1, y1], radius=14 * S, fill=BODY)

# 오른쪽 아래 모서리를 투명하게 잘라내기 (PIL은 픽셀을 그대로 대체하므로 알파 0으로 구멍이 뚫림)
d.polygon([(x1, y1 - FOLD), (x1, y1), (x1 - FOLD, y1)], fill=(0, 0, 0, 0))

# 접힌 귀퉁이
d.polygon([(x1 - FOLD, y1), (x1, y1 - FOLD), (x1 - FOLD, y1 - FOLD)], fill=FOLD_C)

# 텍스트 라인 3줄
for i, (ly, lw) in enumerate([(36, 76), (56, 76), (76, 52)]):
    d.rounded_rectangle(
        [26 * S, ly * S, (26 + lw) * S, (ly + 7) * S],
        radius=int(3.5 * S),
        fill=LINE,
    )

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(
        os.path.join(out_dir, f"icon{size}.png")
    )
    print(f"icon{size}.png OK")
