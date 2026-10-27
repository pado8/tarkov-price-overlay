"""지도 그림 층 스타일(radar.style_svg_layers) — tarkov.dev SVG 의 최상위 그룹을 층별로 켜고 끈다"""
import radar

SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="Ground_Level"/><g id="First_Floor" data-keep-with-group="Ground_Level"/><g id="Second_Floor"/><g id="Underground_Level"/></svg>'


def test_base_only_when_no_layer():
    out = radar.style_svg_layers(SVG, "Ground_Level", None).decode()
    assert out.startswith('<?xml version="1.0"?><svg') and "<style>" in out
    assert 'svg > g { display: none }' in out and 'g#Ground_Level, svg > g[data-keep-with-group="Ground_Level"] { display: inline }' in out
    assert "Second_Floor" not in out.split("</style>")[0]


def test_layer_dims_base_and_shows_layer():
    out = radar.style_svg_layers(SVG, "Ground_Level", "Second_Floor").decode()
    css = out.split("<style>")[1].split("</style>")[0]
    assert "opacity: 0.35" in css and "svg > g#Second_Floor { display: inline; opacity: 1 }" in css


def test_unknown_base_leaves_svg_untouched():
    assert radar.style_svg_layers(SVG, None, "Second_Floor") == SVG
    assert radar.style_svg_layers(b"not an svg", "Ground_Level", None) == b"not an svg"


def test_meta_has_layers_for_customs():
    m = radar.map_image_meta("customs")
    assert m and m["base"] == "Ground_Level"
    assert {l["g"] for l in m["layers"]} >= {"Second_Floor", "Underground_Level"}
    assert radar.map_image_meta("night-factory")["base"] == "Ground_Floor"  # 변형 맵 alias
