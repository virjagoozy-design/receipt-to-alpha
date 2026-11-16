# ErgoLens
A browser-only hackathon wellness prototype for “Elevate the Ordinary.”

## Run
From this directory run `npm start` (Python 3 required), then open http://localhost:5173. No npm installation or API key required. Chrome or Edge recommended. Camera requires localhost or HTTPS. MediaPipe runtime, both WebAssembly variants, and model files are bundled locally. No external AI downloads are needed at runtime. Optional Google Fonts need internet; system fonts work offline. Include vendor/ and models/ when copying or deploying this project.

## Demo in 60 seconds
1. Click Slouching, then Optimal: show the overlay, metrics and score react. Label this as simulation.
2. Start camera, grant permission, frame face and both shoulders, then Calibrate posture for three seconds.
3. Gently shift posture; show relative head shift and shoulder tilt. This is not a clinical neck angle.
4. Trigger a posture warning to see automatic recommendations, then open Session recap and export a CSV.
5. Explain that pre-trained neural networks estimate landmarks; our rules turn them into coaching cues. We did not train a new model.

## Structure
- index.html / styles.css: responsive dashboard
- app.js: MediaPipe inference, camera lifecycle, simulation, calibration, session and UI
- metrics.js: pure measurements and heuristic score
- metrics.test.js: numerical behavior tests (`npm test`)

## Deployment / shared GitHub repository
Clone this repository, then run `npm start` from its root. Serve as static files with no build command. GitHub Pages or any HTTPS static host can serve it. No secrets, backend, authentication, or database are needed.

## Honest limitations
Front head drop measures only a reduction in normalized nose-to-shoulder height from the upright baseline. Sitting taller is not penalized. Side deviation measures an increase in ear-to-shoulder inclination. It can react to leaning or camera movement and does not identify the cause. Shoulder tilt is a 2D projection. EAR and blink counting are rough estimates, not validated fatigue/drowsiness/attention measures. Score is a posture-only heuristic shared by the main gauge and warning on every tracked frame; thresholds are not medical cutoffs. No score appears until live calibration and the required posture landmarks are available. Missing landmarks do not create session samples. Inference is throttled to about 15 Hz maximum; actual speed depends on device. Brief blinks may be missed. Refresh clears session history. Switching live/demo starts a separate session.

## Privacy
No application video upload, recording, or analytics. Video is analyzed in browser memory. AI files are served from the same origin as the page. Optional font downloads contact Google. Exported CSV contains only numeric session samples and a live/demo label. Camera stops on switching to demo or leaving the page. Pausing stops analysis, not the camera stream.

## Credits
Google MediaPipe Tasks Vision 0.10.21, Pose Landmarker Lite and Face Landmarker; Google Fonts DM Sans and Manrope. Model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js and https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js

## On-screen posture warning
A prominent red on-screen coaching banner shows a posture-only score when it stays below 55/100 for two seconds. It clears after the score stays at or above 70 for one second, or immediately when tracking is lost, analysis pauses, calibration starts, or the mode changes. These are prototype thresholds. Eye openness does not affect this warning. Live warnings require calibration. Try Slouching in the demo for two seconds to preview it.

Posture measurements use time-based exponential smoothing (350 ms time constant); shoulder tilt displays whole degrees to reduce visible jitter. The warning pulses rose-red every two seconds and respects reduced-motion settings.

## View adaptation and sound
The same Calibrate posture button sets a baseline for the current camera angle. A geometric heuristic distinguishes narrow/profile views from broad shoulder views; it is not a trained orientation classifier. Changes must persist for one second. Each view has a separate baseline remembered for the current camera session. Calibrate each angle once; switching back restores its saved baseline. Side views use visible ear-to-shoulder angle change and a posture-only score. When no face is visible in a broad view (including rear views), only shoulder tilt is scored; head/neck posture cannot be inferred. Occlusion and camera framing can affect view selection. Sound defaults on, is unlocked by a camera/calibration/demo click, and plays a short beep once every second while a warning is active and the shared score is below 55. Sound can be muted.

Calibration requires at least 15 samples over three seconds and rejects an unstable central 80% sample range. Landmark visibility must be at least 0.75 for required points; hip-based view selection ignores low-confidence hips. The timeline records the shared score once per second, while both displayed scores refresh together at inference rate (up to about 15 Hz). These consistency improvements are not clinical validation.

Overlay drawing now uses its own confidence threshold and 90 ms coordinate smoothing, independent of score eligibility. Missing points are retained for at most 450 ms for visual continuity and never used for scoring; a completely missing detection is shown dimmed briefly. Warning popups include targeted posture recommendations; recommendations appear automatically in the on-screen warning. The manual coaching card has been removed.

Calibration now tolerates tracking gaps up to 1.2 seconds, shows percentage progress, and stops with instructions after an eight-second timeout. Steadiness checks remain in place.

Front/side detection now uses estimated 3D shoulder rotation when available, with separate entry/exit thresholds to prevent rapid view switching. A 2D fallback remains. A missing face mesh alone no longer changes front posture tracking to shoulder-only mode. These model depth estimates still need live-camera validation.

Side view now immediately provides a labeled generic-reference score before personal side calibration. Its 15-degree ear-to-shoulder reference is an unvalidated prototype heuristic, not a clinical cutoff or a substitute for calibration. Front baselines are retained. The overlay includes detected arm, hand, leg and foot connections, face contours, and a stylized torso grid interpolated between shoulders and hips (not a measured body surface).

Warning timers no longer reset on every valid camera-angle change. Tracking gaps up to 700 ms pause, rather than erase, warning timing; no beep or score is shown from missing data. Longer gaps reset warning state. Test alert verifies audible playback and displays an explicitly labeled test notification.

Directional scoring fixes the previous absolute-deviation bug that could penalize straightening up. Calibrate while upright with the camera fixed; slouching during calibration sets an unsuitable reference. A front webcam still cannot reliably distinguish all types of forward leaning or head movement. This is not validated posture classification.

In profile, eye openness uses the larger visible eye contour when at least 10 pixels wide, instead of disabling EAR or averaging the hidden eye. If no usable face contour is detected, EAR is unavailable. Profile EAR remains approximate. Shoulder symmetry is explicitly unavailable in a side view, because both shoulders cannot be reliably compared. Neither unavailable value reduces the side posture score.
