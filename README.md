# DartLine Friends Edition

Private friend groups can play darts online using iPhone camera scoring, built on the open-source [InstaDarts](https://github.com/Instadarts/instadarts) AI camera model and real-time match server.

## Added by DartLine
- Standard Cricket and Cut-Throat Cricket, 20–15 plus bull
- Around the Clock 1 through 20, optional bull finish; singles/doubles/triples
- Friends-first welcome, iPhone home-screen metadata, DartLine branding
- Existing upstream x01 games (301, 501, 701), private join codes, score correction, camera calibration and WebSocket synchronization

## Deploy
The Dockerfile clones the pinned InstaDarts revision, applies changes from scripts/apply_dartline.py, builds/tests the combined app, and starts the persistent server. Use a long-running HTTPS/WSS host such as Railway with a public domain. Railway sets PORT and RAILWAY_PUBLIC_DOMAIN automatically. Game server uses HTTP behind the HTTPS proxy.

## Important limitations
**Not yet validated on real iPhones.** The inherited InstaDarts system uses a phone as the camera scorer and another screen for the match. Combined single-phone camera and scoreboard is a separate feature not implemented here. Real-world camera accuracy and remote board video (which may require TURN on restrictive networks) need real-device testing. Server games are ephemeral and will not survive a process restart.

## License
AGPL-3.0-only; see DARTLINE_NOTICE.md. Complete reproducible source is this repository plus the precise upstream commit specified in Dockerfile. The app must display original notices and make corresponding source available to remote users.
