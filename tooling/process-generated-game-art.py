#!/usr/bin/env python3
"""Crop ImageGen chroma-key outputs into compact runtime game sprites."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def fit_alpha_sprite(source: Image.Image, size: tuple[int, int], padding: int) -> Image.Image:
    alpha = source.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        raise ValueError("sprite has no visible pixels")

    cropped = source.crop(bounds)
    max_width = size[0] - padding * 2
    max_height = size[1] - padding * 2
    scale = min(max_width / cropped.width, max_height / cropped.height)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    output.alpha_composite(
        resized,
        ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2),
    )
    return output


def process_memory_icons() -> None:
    atlas_path = ROOT / "games/memory-match/art/memory-icons-atlas-transparent.png"
    output_dir = ROOT / "games/memory-match/public/assets"
    names = ("rocket", "planet", "star", "lightning", "heart", "crystal", "crown", "note")
    atlas = Image.open(atlas_path).convert("RGBA")
    cell_width = atlas.width // 2
    cell_height = atlas.height // 4

    for index, name in enumerate(names):
        column = index % 2
        row = index // 2
        cell = atlas.crop((
            column * cell_width,
            row * cell_height,
            (column + 1) * cell_width,
            (row + 1) * cell_height,
        ))
        fit_alpha_sprite(cell, (192, 192), 10).save(output_dir / f"memory-{name}.png", optimize=True)


def process_cat() -> None:
    source_path = ROOT / "games/catch-the-cat/art/cat-mascot-transparent.png"
    output_path = ROOT / "games/catch-the-cat/public/assets/cat-mascot.png"
    source = Image.open(source_path).convert("RGBA")
    fit_alpha_sprite(source, (256, 256), 8).save(output_path, optimize=True)


if __name__ == "__main__":
    process_memory_icons()
    process_cat()
