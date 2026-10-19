"""Compare artifact pixels using Poppler; no network or production inputs."""
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageChops
from pypdf import PdfReader

root = Path(sys.argv[1]).resolve()
for name in ("original", "java"):
    subprocess.run(["pdftoppm", "-scale-to", "800", "-png", str(root / (name + ".pdf")), str(root / (name + "-page"))], check=True)
left = PdfReader(root / "original.pdf")
right = PdfReader(root / "java.pdf")
assert len(left.pages) == len(right.pages) == 2
results = []
for number, (a, b) in enumerate(zip(left.pages, right.pages), 1):
    assert a.mediabox == b.mediabox
    text_a, text_b = a.extract_text(), b.extract_text()
    assert text_a == text_b
    image_a = Image.open(root / f"original-page-{number}.png").convert("RGB")
    image_b = Image.open(root / f"java-page-{number}.png").convert("RGB")
    assert image_a.size == image_b.size
    diff = ImageChops.difference(image_a, image_b)
    differences = sum(1 for pixel in diff.get_flattened_data() if pixel != (0, 0, 0))
    diff.save(root / f"pdf-page-{number}-diff.png")
    results.append({"page": number, "dimensions": image_a.size, "pixelDifferences": differences, "extractedTextLength": len(text_a), "textClaim": "No text-content proof when extracted length is zero"})
    assert differences == 0
(root / "pdf-comparison.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results))
