#!/usr/bin/env python3
"""Prepare the Devpost files without publishing, rendering, or using wallet keys."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/sandbox"
OUTPUT = DOCS / "submission"
ZIP_LIMIT = 35_000_000
IMAGE_LIMIT = 5_000_000
EXCLUDED = {
    ".git", ".data", ".tools", "node_modules", "dist", ".next", ".cache",
    ".vercel", ".railway", ".atlas", ".qa", "__pycache__", "screenshots",
    "visual-review", "hosted-acceptance", "submission", "demo-video", "videos",
    "renders", "test-results", "playwright-report",
}
SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".html",
    ".md", ".json", ".yaml", ".yml", ".sh", ".svg", ".png", ".jpg",
    ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".txt",
}
PRIVATE_FILENAMES = {"keys.txt", "credentials.json", "config.local.json", "runtime.json", "runner-secret", "master.key"}
ROOT_FILES = {
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json",
    "vitest.config.ts", "playwright.config.ts", ".env.example", ".gitignore",
    ".dockerignore", ".vercelignore", "AGENTS.md", "LICENSE", "README.md",
    "SECURITY.md", "CONTRIBUTING.md", "start.sh", "Dockerfile.sandbox",
    "compose.sandbox.yml", "vercel.json", "SANDBOX.md",
}
REQUIRED_SOURCE = {
    "package.json", "pnpm-lock.yaml", "start.sh", "Dockerfile.sandbox",
    "compose.sandbox.yml", "tsconfig.sandbox.json", "apps/sandbox/index.html",
    "apps/sandbox/vite.config.ts", "apps/sandbox/src/App.tsx",
    "scripts/setup-bitcoin.ts", "scripts/setup-sandbox.ts",
    "scripts/dev-sandbox.ts", "scripts/build.ts", "scripts/verify-sandbox.ts",
    "server/sandbox-local.ts", "server/sandbox.ts", "server/bitcoin.ts",
    "server/auth.ts", "server/store.ts", "server/env.ts", "server/context.ts",
    "server/sandbox-runner.ts", "server/sandbox-runner-app.ts",
    "convex/sandboxHttp.ts", "convex/sandboxModel.ts", "convex/sandboxSchema.ts",
    "packages/sandbox/src/bridge.ts", "packages/nwc-gate/src/types.ts",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_source(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    return (
        path.is_file()
        and not path.is_symlink()
        and not (set(relative.parts) & EXCLUDED)
        and path.name not in PRIVATE_FILENAMES
        and not (path.name.startswith(".env") and path.name != ".env.example")
        and path.suffix.lower() in SOURCE_EXTENSIONS
    )


def source_snapshot() -> dict[str, bytes]:
    selected: dict[str, bytes] = {}
    for name in ROOT_FILES | {path.name for path in ROOT.glob("tsconfig.*.json")}:
        path = ROOT / name
        if path.is_file() and not path.is_symlink():
            selected[name] = path.read_bytes()
    for directory in ("apps", "convex", "packages", "scripts", "server", "tests"):
        for path in (ROOT / directory).rglob("*"):
            if safe_source(path):
                selected[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for path in DOCS.rglob("*"):
        if safe_source(path):
            selected[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for path in sorted((ROOT / "docs/evidence").glob("sandbox*.json")):
        require(path.is_file() and not path.is_symlink(), "Evidence must be a regular local file.")
        selected[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    hosted = sorted(DOCS.glob("hosted-acceptance/*/ui-verification.json"))
    require(bool(hosted), "The accepted hosted-browser evidence is missing.")
    selected[hosted[-1].relative_to(ROOT).as_posix()] = hosted[-1].read_bytes()
    requirements = ROOT / "docs/DEVPOST-REQUIREMENTS.md"
    selected[requirements.relative_to(ROOT).as_posix()] = requirements.read_bytes()
    require(REQUIRED_SOURCE <= selected.keys(), "The source snapshot is missing required setup or runtime files.")
    package = json.loads(selected["package.json"])
    for command in ("setup:sandbox", "dev:sandbox", "build", "verify:sandbox"):
        require(command in package.get("scripts", {}), f"Missing package command: {command}")
    require(b"pnpm setup:sandbox" in selected["start.sh"] and b"pnpm dev:sandbox" in selected["start.sh"], "The launcher is not the dedicated Sandbox entry.")
    return selected


def image_dimensions(path: Path) -> tuple[str, int, int]:
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR":
        return "PNG", *struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "GIF", *struct.unpack("<HH", data[6:10])
    if data.startswith(b"\xff\xd8"):
        offset = 2
        while offset + 4 <= len(data):
            if data[offset] != 0xFF:
                offset += 1
                continue
            while offset < len(data) and data[offset] == 0xFF:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in {0x00, 0x01, *range(0xD0, 0xDA)}:
                continue
            length = struct.unpack(">H", data[offset:offset + 2])[0]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
                return "JPEG", width, height
            if length < 2:
                break
            offset += length
    raise ValueError(f"Unsupported or malformed submission image: {path.name}")


def select_media() -> tuple[Path, list[Path], list[dict]]:
    media = OUTPUT / "media"
    files = sorted(path for path in media.iterdir() if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif"})
    thumbnails = [path for path in files if "thumbnail" in path.stem.lower()]
    require(len(thumbnails) == 1, "Provide exactly one named thumbnail in submission/media.")
    thumbnail = thumbnails[0]
    gallery = [path for path in files if path != thumbnail]
    require(1 <= len(gallery) <= 15, "Devpost requires a selected gallery of at most 15 images.")
    details = []
    for path in [thumbnail, *gallery]:
        require(not path.is_symlink(), "Submission media cannot be a symlink.")
        kind, width, height = image_dimensions(path)
        require(path.stat().st_size <= IMAGE_LIMIT, f"Image exceeds 5 MB: {path.name}")
        require(width > 0 and height > 0 and width * 2 == height * 3, f"Image must be 3:2: {path.name}")
        details.append({"file": path.name, "format": kind, "width": width, "height": height, "bytes": path.stat().st_size, "sha256": digest(path.read_bytes())})
    return thumbnail, gallery, details


def validate_media_provenance(images: list[dict]) -> dict:
    manifest = load_json(OUTPUT / "MEDIA-MANIFEST.json")
    by_name = {item["file"]: item for item in images}
    assets = manifest.get("assets", [])
    require(len(assets) == len(images), "Media manifest does not cover every selected image.")
    for asset in assets:
        path = ROOT / asset["file"]
        require(path.parent == OUTPUT / "media" and path.name in by_name, "Media manifest names an unselected output.")
        actual = by_name[path.name]["sha256"]
        require(asset["sha256"] == actual, f"Media output changed: {path.name}")
        review = asset.get("visualReview", {})
        require(review.get("status") == "accepted" and review.get("reviewedSha256") == actual, f"Selected image lacks its accepted visual review: {path.name}")
        require(all(asset.get("validation", {}).get(key) is True for key in ("loadedFonts", "noTextOverflow", "noDocumentOverflow", "noNetworkRequests", "noPageErrors")), f"Selected image has incomplete render validation: {path.name}")
    source_records = list(manifest.get("sourceCaptures", {}).values())
    source_records += [manifest["renderer"], manifest["brand"]["originalMark"]]
    source_records += manifest["brand"].get("typography", [])
    for item in source_records:
        relative = Path(item["file"])
        require(not relative.is_absolute() and ".." not in relative.parts, "Unsafe media provenance path.")
        path = ROOT / relative
        require(digest(path.read_bytes()) == item["sha256"], f"Media provenance changed: {relative}")
    return {"assets": len(assets), "visualReviewsAccepted": True, "sourceAndOutputHashesMatch": True}


def evidence_snapshot(source: dict[str, bytes]) -> tuple[dict[str, bytes], list[dict]]:
    inputs = [
        (ROOT / "docs/evidence/sandbox-regtest.json", False),
        (ROOT / "apps/sandbox/.qa/ui-verification.json", True),
    ]
    inputs += [(path, False) for path in sorted((ROOT / "docs/evidence").glob("sandbox*.json")) if path != inputs[0][0]]
    hosted = sorted(DOCS.glob("hosted-acceptance/*/ui-verification.json"))
    require(bool(hosted), "The accepted hosted-browser evidence is missing.")
    inputs.append((hosted[-1], True))
    included: dict[str, bytes] = {}
    records = []
    for path, frontend in inputs:
        value = load_json(path)
        checks = value.get("checks", [])
        require(value.get("status") == "passed" or value.get("complete") is True or value.get("passed") is True, f"Evidence is incomplete: {path.name}")
        require(all(not isinstance(item, dict) or item.get("passed") is not False for item in checks), f"Evidence contains a failed check: {path.name}")
        hashes = value.get("sourceHashes", {})
        require(bool(hashes), f"Evidence has no source hashes: {path.name}")
        for name, expected in hashes.items():
            relative = name
            if relative not in source and f"apps/sandbox/src/{name}" in source:
                relative = f"apps/sandbox/src/{name}"
            require(relative in source, f"Evidence source is missing: {relative}")
            require(digest(source[relative]) == expected, f"Evidence source changed; rerun acceptance: {relative}")
        evidence_name = "hosted-ui-verification.json" if "hosted-acceptance" in path.parts else "local-ui-verification.json" if frontend else path.name
        included[f"evidence/{evidence_name}"] = path.read_bytes()
        records.append({"file": evidence_name, "sourceFile": path.relative_to(ROOT).as_posix(), "checks": len(checks), "finishedAt": value.get("finishedAt") or value.get("checkedAt"), "sourceHashesMatch": True, "classification": value.get("classification")})
    return included, records


def form_markdown(fields: dict) -> str:
    links = fields.get("tryItOutLinks", [])
    formatted = []
    for link in links:
        if isinstance(link, str):
            formatted.append(f"- {link}")
        else:
            formatted.append(f"- [{link.get('label', 'Project link')}]({link['url']})")
    return (
        "# Bitcoin Sandbox · Devpost fields\n\n"
        "Prepared submission material. The user supplies the final rendered video URL; submission confirmation is recorded separately.\n\n"
        f"## Project name\n\n{fields['projectName']}\n\n"
        f"## Elevator pitch\n\n{fields['elevatorPitch']}\n\n"
        f"## About the project\n\n{fields['aboutProjectMarkdown']}\n\n"
        f"## Built with\n\n{', '.join(fields['builtWith'])}\n\n"
        "## Try it out\n\n" + ("\n".join(formatted) or "Public app and source links await release acceptance.") + "\n\n"
        f"## Thumbnail\n\n{fields.get('thumbnail') or 'Pending selected thumbnail.'}\n\n"
        "## Image gallery\n\n" + ("\n".join(f"- {path}" for path in fields.get('gallery', [])) or "Pending selected gallery.") + "\n\n"
        f"## Video demo URL\n\n{fields.get('videoUrl') or 'User will render/export, upload to YouTube or Vimeo, and enter the URL at submission.'}\n\n"
        f"## Additional information for judges\n\n{fields['additionalInfo']}\n\n"
        f"## Required upload\n\n{fields.get('uploadFile') or 'Pending validated source/docs/media ZIP, at most 35 MB.'}\n\n"
        "## Submission status\n\n" + ("Confirmed." if fields.get("submissionConfirmed") else "Prepared material; no Devpost submission confirmation is recorded.") + "\n"
    )


def base_revision() -> str | None:
    rtk = shutil.which("rtk")
    fallback = Path("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk")
    if not rtk and fallback.exists():
        rtk = str(fallback)
    command = ([rtk, "proxy"] if rtk else []) + ["git", "rev-parse", "HEAD"]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def write_entry(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, (2026, 11, 16, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    executable = name.endswith("/start.sh")
    info.external_attr = (0o100755 if executable else 0o100644) << 16
    archive.writestr(info, data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check inputs and source hashes without generating the archive.")
    parser.add_argument("--sync-fields", action="store_true", help="Refresh DEVPOST.md from fields.json without packaging.")
    arguments = parser.parse_args()
    fields = load_json(DOCS / "fields.json")
    require(0 < len(fields["projectName"]) <= 60, "Project name exceeds 60 characters.")
    require(0 < len(fields["elevatorPitch"]) <= 200, "Elevator pitch exceeds 200 characters.")
    require(0 < len(fields["builtWith"]) <= 25, "Technology tags exceed 25.")
    if arguments.sync_fields:
        (DOCS / "DEVPOST.md").write_text(form_markdown(fields), encoding="utf-8")
        print(json.dumps({"status": "synced", "nameCharacters": len(fields["projectName"]), "pitchCharacters": len(fields["elevatorPitch"]), "tags": len(fields["builtWith"])}))
        return
    thumbnail, gallery, image_details = select_media()
    media_validation = validate_media_provenance(image_details)
    fields["thumbnail"] = thumbnail.relative_to(ROOT).as_posix()
    fields["gallery"] = [path.relative_to(ROOT).as_posix() for path in gallery]
    fields["uploadFile"] = "docs/sandbox/submission/bitcoin-sandbox-devpost.zip"
    source = source_snapshot()
    evidence, evidence_details = evidence_snapshot(source)
    if arguments.check:
        print(json.dumps({"status": "passed", "sourceFiles": len(source), "images": image_details, "mediaProvenance": media_validation, "evidence": evidence_details}, indent=2))
        return
    fields_bytes = (json.dumps(fields, indent=2, ensure_ascii=False) + "\n").encode()
    markdown_bytes = form_markdown(fields).encode()
    (DOCS / "fields.json").write_bytes(fields_bytes)
    (DOCS / "DEVPOST.md").write_bytes(markdown_bytes)
    source["docs/sandbox/fields.json"] = fields_bytes
    source["docs/sandbox/DEVPOST.md"] = markdown_bytes
    entries = {f"source/{name}": data for name, data in source.items()}
    entries.update(evidence)
    entries["DEVPOST.md"] = markdown_bytes
    entries["fields.json"] = fields_bytes
    for path in [thumbnail, *gallery]:
        entries[f"media/{path.name}"] = path.read_bytes()
        entries[f"source/{path.relative_to(ROOT).as_posix()}"] = path.read_bytes()
    for name in ("MEDIA-MANIFEST.json", "manifest.json", "DESIGN-NOTES.md"):
        path = OUTPUT / "media" / name
        if path.is_file() and not path.is_symlink():
            entries[f"media/{name}"] = path.read_bytes()
            entries[f"source/{path.relative_to(ROOT).as_posix()}"] = path.read_bytes()
    media_manifest = OUTPUT / "MEDIA-MANIFEST.json"
    if media_manifest.is_file() and not media_manifest.is_symlink():
        entries["MEDIA-MANIFEST.json"] = media_manifest.read_bytes()
        entries[f"source/{media_manifest.relative_to(ROOT).as_posix()}"] = media_manifest.read_bytes()
    renderer = OUTPUT / "render-media.mjs"
    require(renderer.is_file() and not renderer.is_symlink(), "The media renderer source is missing.")
    entries[f"source/{renderer.relative_to(ROOT).as_posix()}"] = renderer.read_bytes()
    provenance = OUTPUT / "media/sources"
    for path in sorted(provenance.rglob("*")):
        if path.is_file() and not path.is_symlink() and path.suffix.lower() in SOURCE_EXTENSIONS and path.name not in PRIVATE_FILENAMES:
            require(path.stat().st_size <= IMAGE_LIMIT, f"Provenance file exceeds its size bound: {path.name}")
            entries[f"media/sources/{path.relative_to(provenance).as_posix()}"] = path.read_bytes()
            entries[f"source/{path.relative_to(ROOT).as_posix()}"] = path.read_bytes()
    entries["README.md"] = (
        "# Bitcoin Sandbox submission kit\n\n"
        "Open DEVPOST.md for form copy and media/ for the thumbnail/gallery.\n\n"
        "The complete source snapshot is in source/. From that directory, run `./start.sh sandbox` on Linux x64 with Node22 and pnpm12.16.1, then open http://127.0.0.1:4404. See source/docs/sandbox/SETUP.md for Docker and hosting.\n\n"
        "evidence/ contains builder-controlled regtest and browser acceptance. Coins have no monetary value. SHA256SUMS checks archive integrity; it is not an independent security attestation.\n\n"
        "The user renders/exports and uploads the final demo, then enters its YouTube/Vimeo URL in Devpost. No submission confirmation is implied.\n"
    ).encode()
    entries["SHA256SUMS"] = ("\n".join(f"{digest(data)}  {name}" for name, data in sorted(entries.items())) + "\n").encode()
    with tempfile.TemporaryDirectory(prefix="sandbox-kit-") as temporary:
        candidate = Path(temporary) / "bitcoin-sandbox-devpost.zip"
        with zipfile.ZipFile(candidate, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(entries.items()):
                write_entry(archive, name, data)
        require(candidate.stat().st_size <= ZIP_LIMIT, "Submission ZIP exceeds 35 MB.")
        with zipfile.ZipFile(candidate) as archive:
            require(archive.testzip() is None, "Submission archive CRC check failed.")
            require(all(not name.startswith("/") and ".." not in Path(name).parts for name in archive.namelist()), "Unsafe archive path.")
            archive.extractall(Path(temporary) / "extracted")
        extracted = Path(temporary) / "extracted"
        for name, data in entries.items():
            require(digest((extracted / name).read_bytes()) == digest(data), f"Extracted entry differs: {name}")
        OUTPUT.mkdir(exist_ok=True)
        destination = OUTPUT / candidate.name
        shutil.copyfile(candidate, destination)
    checksum = digest(destination.read_bytes())
    (OUTPUT / "bitcoin-sandbox-devpost.zip.sha256").write_text(f"{checksum}  {destination.name}\n", encoding="utf-8")
    report = {"status": "passed", "archive": destination.name, "bytes": destination.stat().st_size, "sha256": checksum, "entries": len(entries), "sourceBaseRevision": base_revision(), "sourceSnapshotIntegrity": "SHA256SUMS records the actual packaged worktree; base revision alone does not identify modified files.", "nameCharacters": len(fields["projectName"]), "pitchCharacters": len(fields["elevatorPitch"]), "tags": len(fields["builtWith"]), "images": image_details, "mediaProvenance": media_validation, "evidence": evidence_details, "zipCrcVerified": True, "extractedHashesVerified": True, "freshSetupExecuted": False, "videoRenderingOwner": "user", "submissionConfirmed": bool(fields.get("submissionConfirmed"))}
    (OUTPUT / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"Submission preparation stopped: {error}") from None
