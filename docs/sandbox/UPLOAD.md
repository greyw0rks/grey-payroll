# Submission preparation

The prepared form copy is in [DEVPOST.md](DEVPOST.md) and [fields.json](fields.json). The accepted evidence covers 32 local Core checks from fresh setup, 36 hosted Core/Convex checks, 63 hosted browser checks, and 445 automated tests. Media and the source/docs/evidence ZIP are prepared. Final repository publication and Devpost submission confirmation remain separate steps.

1. Open [DEVPOST.md](DEVPOST.md) for the name, pitch, story, technology tags, links, and additional information.
2. Choose `submission/media/00-thumbnail.png` as the thumbnail and the six numbered gallery PNGs. All are 1500 × 1000, 3:2, and below 5 MB, with accepted visual reviews and source hashes.
3. Upload `submission/bitcoin-sandbox-devpost.zip` as the required file. Its adjacent `.sha256` and `validation.json` record archive size, source/media checks, CRC, and extracted hashes. The archive excludes private runtime directories, wallet files, keys, credentials, dependencies, and rendered videos.
4. Record the [three-minute demo](DEMO.md) from the accepted app. The user owns final rendering/export, playback review, YouTube/Vimeo upload, and entry of the actual video URL.
5. After final repository publication, check the app/source links and enter the prepared fields, media, video URL, and ZIP in Devpost.
6. Keep the public project URL and submission confirmation. A prepared kit, local file, or video outline does not establish submission.

`fields.json` is the canonical form copy; `python3 docs/sandbox/prepare-kit.py --check` rechecks strict preflight, and `python3 docs/sandbox/prepare-kit.py` regenerates the kit from the accepted source snapshot. The script never publishes the app, uploads a video, or submits Devpost. The user owns the final video rendering/export, upload, and URL entry.
