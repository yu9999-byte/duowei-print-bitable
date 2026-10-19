"""Freeze explicit backend source roots, excluding runtime config and build outputs."""
import hashlib
import json
import subprocess
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]).resolve()
if destination == root or root in destination.parents:
    raise SystemExit("Use an evidence directory outside the source tree")
destination.mkdir(parents=True, exist_ok=False)
files = [root / name for name in ("pom.xml", "README.md", ".editorconfig", ".gitignore")]
for name in ("src", "migrations", "scripts", "docs"):
    files.extend(path for path in (root / name).rglob("*") if path.is_file())
for path in files:
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise SystemExit("Unexpected source link")
    if path.name.startswith(".env") or path.suffix.lower() in (".key", ".pem", ".p12", ".pfx") or "__pycache__" in path.parts:
        raise SystemExit("Unexpected runtime/configuration file in source roots")
manifest = {"capturedAt": datetime.now(timezone.utc).isoformat(), "scope": "Backend source only; excludes .env including .env.example, target, node_modules, original runtime dependencies and production data. Not an acceptance verdict.", "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(), "files": []}
with zipfile.ZipFile(destination / "backend-source.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        data = path.read_bytes()
        relative = path.relative_to(root).as_posix()
        archive.writestr(relative, data)
        manifest["files"].append({"path": relative, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
manifest["zipSha256"] = hashlib.sha256((destination / "backend-source.zip").read_bytes()).hexdigest()
(destination / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
with zipfile.ZipFile(destination / "backend-source.zip") as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(files)
    for item in manifest["files"]:
        assert hashlib.sha256(archive.read(item["path"])).hexdigest() == item["sha256"]
print(json.dumps({"directory": str(destination), "files": len(files), "zipSha256": manifest["zipSha256"]}))
