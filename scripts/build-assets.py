#!/usr/bin/env python3
"""Готовит иконки и логотип CodeDock из исходных файлов автора.

  logo.png   — обрезается по прозрачным полям, высота 112 px (2x от 44 px в шапке)
  icon.png   — 512x512 из исходной иконки 849x696: поля добираются градиентом фона
  icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon-180.png

Исходники сохраняются в assets-src/, скрипт можно запускать повторно.

Запуск: python scripts/build-assets.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ORIGINALS = ROOT / 'assets-src'
SOURCE_LOGO = (ORIGINALS / 'logo.png') if (ORIGINALS / 'logo.png').exists() else (ROOT / 'logo.png')
SOURCE_ICON = (ORIGINALS / 'icon.png') if (ORIGINALS / 'icon.png').exists() else (ROOT / 'icon.png')
ICON_SIZE = 512


def average_color(image, box):
    region = image.crop(box).convert('RGB')
    return region.resize((1, 1), Image.LANCZOS).getpixel((0, 0))


def square_icon(source, size=849):
    """Квадрат: исходник по центру, поля залиты вертикальным градиентом его краёв."""
    canvas = Image.new('RGBA', (size, size))
    draw = ImageDraw.Draw(canvas)

    top = average_color(source, (0, 0, source.width, 2))
    bottom = average_color(source, (0, source.height - 2, source.width, source.height))
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line([(0, y), (size, y)], fill=(*color, 255))

    offset = ((size - source.width) // 2, (size - source.height) // 2)
    canvas.paste(source, offset, source)
    return canvas


def write_icon(image, path):
    """Сохраняет PNG; если файл тяжёлый — переводит в 256 цветов."""
    image.save(path, 'PNG', optimize=True)
    if path.stat().st_size > 120 * 1024:
        image.quantize(colors=256, method=Image.FASTOCTREE).save(path, 'PNG', optimize=True)


def main():
    originals = ROOT / 'assets-src'
    originals.mkdir(exist_ok=True)
    for name in ('logo.png', 'icon.png'):
        backup = originals / name
        if not backup.exists():
            backup.write_bytes((ROOT / name).read_bytes())
            print(f'исходник сохранён: assets-src/{name}')

    logo = Image.open(SOURCE_LOGO).convert('RGBA')
    trimmed = logo.crop(logo.getbbox())
    height = 112
    width = round(trimmed.width * height / trimmed.height)
    trimmed.resize((width, height), Image.LANCZOS).save(SOURCE_LOGO, 'PNG', optimize=True)
    print(f'logo.png      {width}x{height}, {SOURCE_LOGO.stat().st_size / 1024:.0f} КБ')

    icon = Image.open(SOURCE_ICON).convert('RGBA')
    base = square_icon(icon, size=849)

    for name, size in (
        ('icon-512.png', 512),
        ('icon.png', 512),
        ('icon-192.png', 192),
        ('apple-touch-icon-180.png', 180),
    ):
        write_icon(base.resize((size, size), Image.LANCZOS), ROOT / name)

    # Maskable: рисунок в безопасной зоне 80%, фон залит цветом из угла
    maskable = Image.new('RGBA', (512, 512), (*tuple(int(c) for c in average_color(icon, (0, 0, 4, 4))), 255))
    inner = base.resize((410, 410), Image.LANCZOS)
    maskable.paste(inner, ((512 - 410) // 2, (512 - 410) // 2), inner)
    write_icon(maskable, ROOT / 'icon-maskable-512.png')

    for name in ('icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon-180.png'):
        path = ROOT / name
        image = Image.open(path)
        print(f'{name:26} {image.size[0]}x{image.size[1]}, {path.stat().st_size / 1024:.0f} КБ')


if __name__ == '__main__':
    main()
