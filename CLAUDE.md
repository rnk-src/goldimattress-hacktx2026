# GoldiMattress — project context

## Overview
- A hackathon project (HackTX 2026), inspired by Goldilocks and the three beds.
- A phone-only web app. Users need nothing but their phone: no laptop, no extra hardware.
- A user calibrates on a mattress or cushion they like (the reference).
- They then test other surfaces. The app reports whether each one is too hard, too soft or just right *for them*.
- Scope: mattresses first (the costliest wrong purchase), plus couches, chairs and cushions.
- It measures two properties:
  - **Hardness**: how the surface resists a load (the downward phase, including bottoming out).
  - **Springiness**: how the surface bounces back while the load is still on it.
- The sensor is the phone's accelerometer. The load is the user's own body.

## Measurement physics
Model the surface as a mass-spring-damper. A mass m falls from height h. With the body as the load, m is the user's effective body mass.
- **Impact speed**: v = √(2gh). The same height gives the same momentum, so drops are comparable.
- **Hardness (impulse)**: F·Δt = Δp. A firm surface gives a tall, narrow spike; a soft one gives a low, wide hump.
  Features: peak |a| and stopping time.
- **Stiffness (SHM)**: the mass bobs with period T = 2π√(m/k), so k = 4π²m/T².
- **Springiness (damping)**: amplitude ratio of consecutive bounce peaks, A₂/A₁. Near 1 = springy; near 0 = dead (memory foam).
- **Body drops are not free fall**: the legs still carry some weight while they give way, so |a| does not reach ~0.
  - Start: detect the still hover (low jitter, |a| ≈ 1 g). This is the zero-velocity point.
  - Impact speed: integrate (|a| − g) from the end of the hover to impact (~0.3 s window).
  - A dropped object does reach ~0 g; then fall time gives h = ½gt² and v = g·t.
- **Speed normalization**: for a linear spring, a_peak / v ≈ √(k/m), independent of drop height.
- **Orientation**: use |a| = √(ax²+ay²+az²). It does not depend on how the phone faces.

Caveats:
- Real foam is nonlinear: it stiffens as it compresses. Use the same load for the reference and every test.
- A drop that is too high makes the mass leave the surface again (a second ~0 g window). Detect this.
- Slow memory-foam recovery after the load is removed is out of scope.
- Hardness and damping are separate axes. Firm foam and a soft innerspring can share hardness but differ in damping. Report both.
- A seated human body resonates vertically at ~4–6 Hz, and its tissue adds damping. The body-on-surface bounce is ~1–3 Hz.
  Body effects cancel when the same person calibrates and tests, so results are relative only. Never report an absolute k.

## Architecture
### Platform
- Web app (PWA) in vanilla **TypeScript + Vite**. No UI framework.
- All analysis runs **on the phone**. There is no backend in the core app.
- Users reach it through **GitHub Pages** (HTTPS), deployed by a GitHub Action on every push to `main`.
- Fallback if the browser sample rate is too low: Expo (`expo-sensors`, ~100 Hz). The signal core ports unchanged.

### Sensor: `DeviceMotionEvent`
- Read `accelerationIncludingGravity` (raw, gravity included).
- iOS: call `DeviceMotionEvent.requestPermission()` from a user tap, over HTTPS. Otherwise no events arrive.
- Android: `requestPermission` is undefined. Feature-detect and listen directly.
- The iOS sample rate is unverified (~60 Hz expected). Log `event.interval` on a real device before building analysis.
- Coaching: Web Audio beeps and `speechSynthesis`. `navigator.wakeLock` keeps the screen on. iOS has no `navigator.vibrate`.
- At ~60 Hz a short spike can fall between samples. Prefer frequency, damping and settle time over a single peak value.

### Code structure
- The **signal core** is plain TS with no DOM or framework imports. It is unit-testable and portable.
- `SensorSource` returns arrays of `(t, ax, ay, az)`.
  - `DeviceMotionSource` is the first implementation.
  - A future Bluetooth IMU puck (ESP32 + IMU) needs a native or Expo shell, because iOS Safari has no Web Bluetooth.
- `Store` persists people, references and tests.
  - `LocalStore` (`localStorage`) is the first implementation. `CloudStore` is the stretch goal.
- Pipeline per rep: hover detect → stillness + angle check → impact segmentation → impact speed → features → accept or reject.
- Per test: 5 accepted reps → feature means → compare to reference → verdict.
- The sensing half hands the app half one agreed result type (features + verdict + rejected reps). Fix it before building either side.

### Data recorded per test
- **Person**: anonymous ID, body weight, one reference per routine.
- **Surface**: ID, name, type (mattress, couch, cushion, pad).
- **Test**: person ID, surface ID, routine, timestamp, device model, sample rate, per-rep features, rejected reps with reasons.
- **Raw acceleration per rep** (~3 s, a few kB). Keep it, so improved feature code can recompute old tests.

### Prototyping tool
- phyphox (free, RWTH Aachen) can log the iPhone IMU at ~100 Hz for quick offline comparisons. It is not part of the product.

## Design decisions
| Decision | Choice | Reason |
|---|---|---|
| Output | % match to the reference, plus per-feature direction ("firmer, less bouncy") | Comparing to a reference avoids calibrating an absolute scale. |
| Measurement | Free drop from a fixed height | The drop height fixes the input energy. A hand press adds human variation. |
| Springiness | Bounce and damping while the load stays on the surface | Hardness alone cannot tell foam from springs. |
| Sensor | phyphox now, behind `SensorSource` | A microcontroller IMU can replace it later. |
| Calibration | 5 reference drops; store each feature's mean and spread | The spread separates real differences from noise. |
| Demo surfaces | Cushions, pads and pillows brought to the demo | Does not depend on a bed at the venue. |

## Body test protocol
The same person calibrates and tests, so the protocol must make the body act the same way every rep. The app checks this, not the user.

### Routines
| Routine | Surfaces | Phone placement | Movement |
|---|---|---|---|
| **Sit-drop** | Couches, chairs, loose cushions and pads | Flat on the sternum, portrait, screen out, arms crossed over it | Stand with your back to the surface, squat to hover ~10 cm (a fist) above it with a natural forward lean, hold still, relax the legs and drop |
| **Bridge drop** | Mattresses (middle of the bed, hip zone) | Flat on the lower belly over the hip bones, held with both hands | Lie on your back, lift the hips ~10 cm into a glute bridge, hold still, go limp and drop |

- Loose cushions and pads go on the same chair every time. This fixes the height and avoids bottoming out onto the floor.
- A mattress sit-drop at the edge measures edge support, not the sleep surface. Use the bridge drop for mattresses.

### Checks the app enforces on every rep
- **Stillness**: low jitter during the hover before the drop.
- **Angle**: torso lean (sit-drop) or pelvis angle (bridge drop) from the gravity vector during the hover. Calibration records it; test reps must be within ±5°.
- **Impact speed**: within ±20% of the reference.
- **Caught landing**: a soft, smeared impact suggests tensed legs. Reject it.
- Rejected reps show a message ("lean a bit less", "hold still") and do not count.

### Held constant by the user
- Same person, shoes off, pockets empty, thin clothing over the phone.
- Legs fully relaxed at impact. Feet flat, same distance from the surface.
- Same landing spot: sit-drop ~30 cm in from the edge; bridge drop at normal hip position.
- Stay still and hold your breath for 2 s after impact.
- Rest ~20 s between reps so foam recovers. 5 accepted reps per test.

### Safety
- Hover 10 cm or less. Never drop from standing height.
- Check what is under a loose cushion. Avoid exposed frames and box-spring edges.
- People with back or tailbone problems should not do drop tests.

## Verdict rule
Features per rep:
| Feature | Property | Firmer / springier means |
|---|---|---|
| `peak_over_v` = a_peak / v_impact | Hardness | higher = firmer |
| `stop_time` (impact to first return to 1 g) | Hardness | shorter = firmer |
| `bounce_ratio` = A₂/A₁ | Springiness | higher = springier |
| `settle_time` (until within ±0.05 g of rest) | Springiness | longer = springier |

Steps:
1. Calibration stores each feature's mean μ_ref and standard deviation σ_ref over 5 reps.
2. A test averages 5 reps to get μ_test.
3. Per feature: z = (μ_test − μ_ref) / σ_eff, where σ_eff = max(σ_ref, 8% of μ_ref).
   The floor stops very consistent users from getting imperceptible differences flagged. Tune 8% with real data.
4. Hardness score H = mean(z_peak_over_v, −z_stop_time). Springiness score S = mean(z_bounce_ratio, z_settle_time).
5. Labels: |score| < 2 = just right / same bounce; 2–3 = "slightly"; > 3 = "much". The sign gives harder/softer and bouncier/deader.
6. Match = 100 · e^(−(H² + S²) / 8). Examples: H = S = 0 → 100%; H = 2, S = 0 → 61%; H = S = 2 → 37%.

±2 is used because ~95% of a person's own reps on the reference fall inside it.

## Load options considered
Target contact pressure ≈ 1.2–1.4 kPa (an average lying body: ~70 kg over ~0.5 m²). P = mg/A.

### Phone alone (~0.2 kg, ~0.18 kPa)
Works for very different surfaces, extreme springiness and thin pads. It cannot gather:
- **Bottoming out**: it never compresses a cushion to its limit.
- **Deep support**: it reads only the top 1–2 cm. A pillow-top over a firm core reads soft (the opposite verdict).
- **Mid-range damping**: the bounce is ~10 Hz and dies in 1–2 cycles, giving only ~10 samples per cycle.
- **Meaningful k**: stiffness at a feather load does not describe a body load.
- **Fine discrimination**: similar surfaces overlap within run-to-run noise.

Robust phone-only features: peak |a|/v, stopping time, settle time (within ±0.05 g), rebound yes/no, whole-waveform correlation to the reference.

### Weighted plate rig (~1.5 kg on a 5–6 in base, ~1.0 kPa)
- Parts: one 2.5 lb standard weight plate (1 in hole, ~6.5 in × 0.8 in), small round cutting board, hard polycarbonate case, 3M VHB tape or 5-min epoxy.
- Stack: board → plate → case → phone, screen up. The phone rides on top and never touches the surface.
- Rules: no superglue (brittle, does not bond TPU), no water bottles or sandbags (slosh adds fake damping), no foam between phone and plate. Keep drops under 15 cm and tether the rig.
- Drawback: a carried weight is not practical.
- Product form: a 3 in × 1 in steel puck (~0.9 kg) with an ESP32 + IMU inside.

### Textbook
- A flat 8.5 × 11 in book needs ~8 kg (3–5 hardcovers) for body pressure. One 2 kg book gives ~0.36 kPa.
- One book fixes the sampling problem but not bottoming out. A small base under it (a CD case) gives ~1.1 kPa but may tip.

### Body (chosen)
- The body applies real body pressure and needs no carried weight. See "Body test protocol".

### Other options
- Phone tilt beside the person: hardness only, and it depends on distance.
- Ball drop (phyphox "(In)elastic collision" or 240 fps video): gives coefficient of restitution, but a light probe.
- LiDAR depth: needs a custom iOS app.
- Hand press: no force reading.

## Open questions
- **Load source**: body sit-drop, plate, or sit-drop with a plate fallback.
- **Height method**: marked guide + free-fall timing to correct speed and reject drops >15% off. A sit-drop uses impact-speed normalization instead.
- **Display**: local Streamlit page with a live plot and a "Too hard / Too soft / Just right" verdict.
- **Team**: roles are not yet assigned.

## Git workflow
- `main` stays clean. Each task gets a branch: `feat/<name>`, `fix/<name>`, `docs/<name>`.
- Each branch lives in a worktree: `../goldimattress-hacktx2026-worktrees/<branch-with-dashes>`.
  - Create: `git worktree add ../goldimattress-hacktx2026-worktrees/feat-x -b feat/x`.
- Keep commits small. Use short, descriptive subjects.
- Merge with `git merge --no-ff <branch>` on main, push, then remove the worktree and delete the branch.
