import base64
import io
import json
import math
import re
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parent
WIDTH = 720
HEIGHT = 1280
FPS = 24


def load_config():
    with (ROOT / "config.json").open("r", encoding="utf-8") as file:
        return json.load(file)


def open_image(path):
    if isinstance(path, str) and path.startswith("data:image/"):
        payload = path.split(",", 1)[1]
        return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGBA")
    return Image.open(ROOT / path).convert("RGBA")


def cover_resize(image, width, height):
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    x = (width - resized.width) // 2
    y = (height - resized.height) // 2
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (x, y))
    return canvas


def font(size, weight="regular"):
    candidates = {
        "regular": [
            "C:/Windows/Fonts/malgun.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
        ],
        "semibold": [
            "C:/Windows/Fonts/malgunbd.ttf",
            "C:/Windows/Fonts/seguisb.ttf",
        ],
        "bold": [
            "C:/Windows/Fonts/malgunbd.ttf",
            "C:/Windows/Fonts/segoeuib.ttf",
        ],
    }
    for candidate in candidates.get(weight, candidates["regular"]):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


FONTS = {
    "brand": font(13, "semibold"),
    "small": font(19, "semibold"),
    "title": font(62, "semibold"),
    "artist": font(25, "regular"),
    "intro_kicker": font(14, "semibold"),
    "intro_title": font(58, "semibold"),
    "intro_sub": font(24, "regular"),
}


def build_scenes(config):
    intro = float(config.get("timing", {}).get("intro", 2))
    album = float(config.get("timing", {}).get("album", 10))
    outro = float(config.get("timing", {}).get("outro", 2))
    scenes = []
    cursor = 0
    scenes.append({
        "start": cursor,
        "end": cursor + intro,
        "type": "intro",
        "kicker": config.get("issue", ""),
        "title": config.get("headline", ""),
        "subtitle": config.get("introSubtitle") or config.get("brand", ""),
    })
    cursor += intro
    for index, track in enumerate(config.get("tracks", [])):
        scene = dict(track)
        scene.update({"start": cursor, "end": cursor + album, "type": "album", "imageIndex": index})
        scenes.append(scene)
        cursor += album
    outro_config = config.get("outro", {})
    scenes.append({
        "start": cursor,
        "end": cursor + outro,
        "type": "outro",
        "kicker": outro_config.get("kicker", ""),
        "title": outro_config.get("title", ""),
        "subtitle": outro_config.get("subtitle", ""),
    })
    return scenes, cursor + outro


def ease(value):
    value = max(0, min(1, value))
    return 1 - (1 - value) ** 3


def fade_for(scene, time):
    local = time - scene["start"]
    remaining = scene["end"] - time
    return max(0, min(1, min(ease(local / 0.8), ease(remaining / 0.55))))


def rgba(color):
    r, g, b, a = color
    return (r, g, b, round(a * 255))


def vertical_gradient(width, height, stops):
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    for y in range(height):
        position = y / max(1, height - 1)
        left = stops[0]
        right = stops[-1]
        for index in range(len(stops) - 1):
            if stops[index][0] <= position <= stops[index + 1][0]:
                left = stops[index]
                right = stops[index + 1]
                break
        span = max(0.0001, right[0] - left[0])
        mix = (position - left[0]) / span
        color = [round(left[1][i] * (1 - mix) + right[1][i] * mix) for i in range(4)]
        arr[y, :, :] = color
    return Image.fromarray(arr, "RGBA")


def horizontal_gradient(width, height, stops):
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    for x in range(width):
        position = x / max(1, width - 1)
        left = stops[0]
        right = stops[-1]
        for index in range(len(stops) - 1):
            if stops[index][0] <= position <= stops[index + 1][0]:
                left = stops[index]
                right = stops[index + 1]
                break
        span = max(0.0001, right[0] - left[0])
        mix = (position - left[0]) / span
        color = [round(left[1][i] * (1 - mix) + right[1][i] * mix) for i in range(4)]
        arr[:, x, :] = color
    return Image.fromarray(arr, "RGBA")


def draw_wrapped(draw, text, x, y, max_width, line_height, font_obj, fill):
    words = str(text).split(" ")
    lines = []
    line = ""
    for word in words:
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=font_obj) > max_width and line:
            lines.append(line)
            line = word
        else:
            line = test
    lines.append(line)
    for index, item in enumerate(lines):
        draw.text((x, y + index * line_height), item, font=font_obj, fill=fill)
    return y + len(lines) * line_height


def draw_fitted_title(draw, text, x, y, max_width, fill):
    text = str(text)
    manual_lines = re.split(r"\\n|\n", text)
    if len(manual_lines) > 1:
        current_y = y
        for index, line in enumerate(manual_lines):
            indent = 0 if index == 0 else 18
            line_x = x + indent
            current_y = draw_fitted_title(draw, line.strip(), line_x, current_y, max_width - indent, fill) + 8
        return current_y - 8

    size = 62
    while size > 42:
        font_obj = font(size, "semibold")
        if draw.textlength(text, font=font_obj) <= max_width:
            draw.text((x, y), text, font=font_obj, fill=fill)
            return y + size
        size -= 2
    return draw_wrapped(draw, text, x, y, max_width, 56, font(42, "semibold"), fill)


def alpha_layer(size, alpha):
    return ImageEnhance.Brightness(size.split()[-1]).enhance(alpha)


def paste_with_alpha(base, layer, position, alpha=1):
    if alpha >= 0.999:
        base.alpha_composite(layer, position)
        return
    faded = layer.copy()
    faded.putalpha(alpha_layer(faded, alpha))
    base.alpha_composite(faded, position)


def draw_record(frame, record_image, local_time, alpha, config):
    size = 520
    seconds_per_rotation = config.get("record", {}).get("secondsPerRotation", 16)
    angle = -local_time * 360 / seconds_per_rotation
    record = record_image.resize((size, size), Image.Resampling.LANCZOS).rotate(angle, resample=Image.Resampling.BICUBIC)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=round(alpha * 255))
    record.putalpha(mask)
    frame.alpha_composite(record, ((WIDTH - size) // 2, (HEIGHT - size) // 2 - 70))


def draw_footer(frame, time, duration, config):
    draw = ImageDraw.Draw(frame)
    draw.text((48, 88), config.get("brand", ""), font=FONTS["brand"], fill=rgba((232, 240, 247, 0.58)))


def draw_scene_text(frame, scene, alpha, y_offset):
    text_layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_layer)
    x = 48
    bottom = 1024 if scene["type"] == "album" else 1180
    offset = round(y_offset)
    if scene["type"] == "album":
        draw.text((x, bottom - 190 + offset), scene.get("number", ""), font=FONTS["small"], fill=rgba((205, 218, 228, 0.46)))
        after_title = draw_fitted_title(draw, scene.get("title", ""), x, bottom - 128 + offset, 640, rgba((244, 248, 252, 0.94)))
        draw_wrapped(draw, scene.get("artist", ""), x, after_title + 26, 600, 34, FONTS["artist"], rgba((222, 232, 240, 0.68)))
    else:
        draw.text((x, bottom - 238 + offset), str(scene.get("kicker", "")).upper(), font=FONTS["intro_kicker"], fill=rgba((205, 218, 228, 0.46)))
        after_title = draw_wrapped(draw, scene.get("title", ""), x, bottom - 184 + offset, 590, 62, FONTS["intro_title"], rgba((244, 248, 252, 0.94)))
        draw_wrapped(draw, scene.get("subtitle", ""), x, after_title + 24, 560, 34, FONTS["intro_sub"], rgba((222, 232, 240, 0.68)))
    paste_with_alpha(frame, text_layer, (0, 0), alpha)


def main():
    config = load_config()
    scenes, duration = build_scenes(config)
    background = cover_resize(open_image(config["background"]), WIDTH, HEIGHT)
    albums = [open_image(track["image"]) for track in config["tracks"]]
    dark_vertical = vertical_gradient(WIDTH, HEIGHT, [
        (0, (4, 10, 16, 5)),
        (0.64, (3, 8, 13, 138)),
        (1, (1, 5, 9, 224)),
    ])
    dark_horizontal = horizontal_gradient(WIDTH, HEIGHT, [
        (0, (1, 4, 8, 87)),
        (0.42, (1, 4, 8, 8)),
        (1, (1, 4, 8, 64)),
    ])
    output = ROOT / f"{config.get('outputName', 'midnight-frequency-archive')}.mp4"
    total_frames = math.ceil(duration * FPS)

    writer = imageio.get_writer(
        output,
        fps=FPS,
        codec="libx264",
        quality=7,
        macro_block_size=16,
        ffmpeg_params=["-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    )
    try:
        for frame_index in range(total_frames):
            time = min(frame_index / FPS, duration - 0.001)
            scene = next((item for item in scenes if item["start"] <= time < item["end"]), scenes[-1])
            alpha = fade_for(scene, time)
            y_offset = (1 - alpha) * 18
            frame = background.copy()
            frame.alpha_composite(dark_vertical)
            frame.alpha_composite(dark_horizontal)
            draw_footer(frame, time, duration, config)
            if scene["type"] == "album":
                draw_record(frame, albums[scene["imageIndex"]], time - scene["start"], alpha, config)
            draw_scene_text(frame, scene, alpha, y_offset)
            writer.append_data(np.asarray(frame.convert("RGB")))
            if frame_index % FPS == 0:
                print(f"rendering {frame_index // FPS:02d}/{math.ceil(duration)}s")
    finally:
        writer.close()
    print(output)


if __name__ == "__main__":
    main()
