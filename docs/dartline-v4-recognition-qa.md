# DartLine v4 recognition architecture and QA review

This change is an engineering improvement, **not a verified claim of perfect iPhone scoring**. One camera cannot see fully occluded tips, and trained model accuracy needs representative labeled iPhone images.

## Full pipeline, with responsibilities

1. **Capture / framing:** Keep the same 1280 or 960 model choice that was previously usable. Phone and model use a center-square crop. Camera stays mounted across visits.
2. **Motion detection:** Fast path detects a small impact and requests the normal inference; pending triggers queue behind a busy model.
3. **Model inference:** LiteRT runs once at a time. Temporary loss of board landmarks is not an excuse to force slow CPU processing or restart the camera.
4. **Geometry:** Eight board landmarks define perspective. Robust RANSAC rejects bad markers and the v3.7 refit uses *all agreeing* markers. If too few agree, retain the original fit rather than guessing.
5. **Tip extraction:** Strict 0.80 predictions are available for ordinary impact scoring. Relaxed 0.50 predictions must have repeat observations; background probes never publish raw guesses.
6. **Missed-motion recovery:** An independent, candidate-only inference occurs roughly every 2.2 seconds while the assigned local player owns an incomplete visit. Strong candidates need two observations; weaker/intermittent candidates require three. An inference skipped because the model is busy is not a valid observation. One missed/occluded model frame may be tolerated.
7. **Dart identity:** Confirmed old-tip witnesses accompany a newly confirmed close dart, so the server can match old to old and recognize the new one. The server still fuses all camera reports and suppresses repeat scores.
8. **Turn ownership:** The authoritative match, visit identity and registered-dart count travel from the mobile scoreboard through the camera dock to the same-origin scorer iframe. No background scoring when a player does not own the turn or when three darts are already registered.
9. **Removal:** Candidate-only probes never report an empty board and cannot trigger takeout. After three registered darts the separate removal monitor takes priority; the server requires two board-located, empty, independent scans.
10. **Camera health:** Delayed status messages no longer tear down an active iPhone camera. On-device diagnostics show inference duration, background recovery frames and confirmed batches. No photos are transmitted for analytics.

## Regression cases required before any claim of improvement

- All three distinct tips still score with **zero motion events**, once each.
- A transient false tip on only one frame cannot score.
- Two closely spaced actual tips remain distinct; existing-tip witnesses are not counted twice.
- One missed intermediate AI frame must not permanently lose a real stable tip or promote one false sighting.
- A rejected/busy inference never counts as a valid model observation or empty board.
- Remote opponents and completed visits cannot receive new local camera scores.
- Candidate-only empty scans cannot auto-submit or reset server tracking.
- Actual retrieval still requires two independent, board-located empty scans.
- The compiled production Docker image contains v4 modules and reports the matching public version marker.
- Full app TypeScript build and project unit tests pass.

## What still needs real device evidence

- iOS Safari/WebKit video readiness, thermal behavior, GPU/WASM inference latency, and camera frame freshness.
- Accuracy on the user's installed dartboard, from its actual camera angle, with real lighting and clustered darts.
- A repeatable labeled dataset of true dart-tip positions and misses. Without it, precise recall and error rates are unmeasured.

**Do not call this system 100% accurate or fully validated until a hardware acceptance test and labeled evaluation support those claims.** Keep the v3.7 backup branch for emergency rollback.

The GitHub pull-request workflow must build the production Docker image and run all unit tests, including the revised physical-tip repeat semantics; a green static type check alone is not sufficient.
