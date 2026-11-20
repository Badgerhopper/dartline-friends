# DartLine Friends Edition

Personal-use AI darts scoring and remote matches for friends. Based on the open-source [InstaDarts](https://github.com/Instadarts/instadarts) trained camera model and WebSocket match engine, with DartLine additions.

## Quick start: **one iPhone**
1. Open **https://dartline-friends-production.up.railway.app/** in Safari.
2. Tap **Use this iPhone as the scoring camera**. DartLine will request a pairing code internally and connect the camera automatically: no other phone or QR scanner is needed.
3. Follow camera permission, device self-test and board alignment in the full-height scorer panel. Mount the phone securely to the side of the board, outside the path of stray darts.
4. Tap **Show game**. The scoring camera remains visible and mounted in a floating inset; the match screen can now be used on the same phone.
5. Choose **Host Friends Game**, add yourself and share the invitation code. Your friend opens the same site, chooses **Join Friends Game**, and follows the same camera setup.
6. If a camera score is misread, use the existing **Undo** and manual board correction before removing darts. The camera will normally advance after darts are removed.

The app also supports separate camera and match devices using **Cameras → Pair scoring device**.

## Included game modes
- 301, 501, 701 with double-in/double-out rules
- Standard Cricket and Cut-Throat Cricket (20–15 + bull)
- Around the Clock (1–20, optional bull finish and ring requirement)
- Original InstaDarts Whac-A-Mole practice mode

## Deployment
The `Dockerfile` obtains InstaDarts at a fixed upstream commit, runs the original DartLine overlay and the single-phone overlay, compiles TypeScript, runs unit and integration tests, then serves a persistent Node/WebSocket server. The `PORT` environment variable controls its local HTTP listener.

### Free Render deployment

[**Deploy DartLine on Render Free**](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FBadgerhopper%2Fdartline-friends) (review the Free plan before approving deployment).

A [Render Blueprint](render.yaml) creates **one Free Docker web service** in Virginia, with an HTTPS domain and WebSocket support. It creates **no database, disk or paid workers**. Render automatically supplies `RENDER_EXTERNAL_URL`, which DartLine uses as its exact WebSocket-allowed public origin. `PUBLIC_ORIGIN` can override it, e.g. when using a custom HTTPS domain. For portability the Railway configuration remains supported.

1. Connect the Render hosting plugin (or sign in to Render without adding a payment method).
2. Import the public GitHub repo **Badgerhopper/dartline-friends** as a Blueprint, using `render.yaml`.
3. Verify the service shows **Free** and is not attached to any paid compute, persistent disk or database.
4. Confirm the deployment health check passes, the app homepage loads, and live games can connect using its `onrender.com` domain.
5. **Only after verifying Render works**, shut down the old DartLine Railway service. The repository stays in GitHub.

The Blueprint intentionally disables automatic redeploys to avoid consuming free build minutes on every commit. Deploy new code manually when you intentionally update it.

Free Render services sleep after 15 idle minutes, and a wake-up can take about a minute. They can restart unexpectedly; DartLine stores active matches only in server memory, so a restart ends them. Free service limits are not a warranty against bills when a payment method is attached: Render may charge for excess bandwidth and build pipeline minutes. Do not attach a payment method if you want hard no-charge suspension on limits. See [Render free-tier rules](https://render.com/docs/free).

## Verification status
- Production TypeScript build: passes.
- Automated tests: **1,290 passing** for the current application revision, including three single-phone URL tests.
- Railway deployment: successful, HTTPS routing and health check configured.
- **Not yet established:** camera detection accuracy with a physical dartboard, iOS Safari same-phone iframe camera behavior on specific devices, and an actual internet match with two physically separate iPhones. Those require real-device testing. Network video may require additional TURN support in some home networks. Live scores do not depend on peer video.
- The server keeps matches in memory; a server restart ends current matches. This is intentional for private short matches but does not constitute a persistent league leaderboard.
- As a web app, no App Store installation is required. The user can choose Safari → Share → Add to Home Screen.

## License and attribution
The app and extensions are **AGPL-3.0-only**. See [DARTLINE_NOTICE.md](DARTLINE_NOTICE.md). The complete reproducible corresponding source is this repository plus the exact upstream commit recorded in the Dockerfile. Original model, training work, license files, third-party notices and credits remain attributable to InstaDarts.
