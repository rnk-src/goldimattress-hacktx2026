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
- Per test: up to 10 attempts, 3 to 5 usable reps → weighted medians → compare to reference → verdict with uncertainty.
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
| Measurement | A drop onto the surface, not a press | A drop fixes the input energy. A hand press adds human variation. |
| Load | The user's body | Real body pressure with nothing to carry. A phone alone reads only the top layer. |
| Routines | Sit-drop for seating, bridge drop for mattresses | The bridge drop tests where people sleep, not the edge. |
| Phone placement | Sternum (sit-drop), lower belly over hip bones (bridge drop) | The phone must ride on the body part that drops. |
| Posture | Natural lean, recorded on every rep, never enforced | Lean differs by surface (real sets: 2–12°, 22–29°, 27–44°), so matching the calibration lean is not possible; the phone measures it so users need not. |
| Springiness | Bounce and damping while the load stays on the surface | Hardness alone cannot tell foam from springs. |
| Sensor | `DeviceMotionEvent` behind `SensorSource` | Runs in any phone browser. A Bluetooth IMU can replace it later. |
| Platform | Vanilla TS + Vite web app on GitHub Pages | No install, any phone, no laptop needed. |
| Analysis | On the phone | Works offline; no server to fail. |
| Storage | `LocalStore` now, `CloudStore` later | Local first; the interface allows a shared database. |
| Calibration | 3 to 5 usable reps out of up to 10 attempts; store each feature's weighted median and scaled MAD | People are not perfect every rep; robust statistics and the spread separate real differences from noise. |
| References | One per routine per person | Routines produce different signals and cannot be compared. |
| Surface identity | Typed name with autocomplete | Simplest way to link tests of the same item. |
| Demo | Live on cushions and couches; video of a bed; topper experiment slide | No bed at the venue. |

## Body test protocol
The same person calibrates and tests, so the protocol must make the body act the same way every rep. The app checks this, not the user.

### Routines
| Routine | Surfaces | Phone placement | Movement |
|---|---|---|---|
| **Sit-drop** | Couches, chairs, loose cushions and pads | Flat on the sternum, portrait, screen out, arms crossed over it | Stand with your back to the surface, squat to hover ~10 cm (a fist) above it with a natural forward lean, hold still, relax the legs and drop |
| **Bridge drop** | Mattresses (middle of the bed, hip zone) | Flat on the lower belly over the hip bones, held with both hands | Lie on your back, lift the hips ~10 cm into a glute bridge, hold still, go limp and drop |

- Loose cushions and pads go on the same chair every time. This fixes the height and avoids bottoming out onto the floor.
- A mattress sit-drop at the edge measures edge support, not the sleep surface. Use the bridge drop for mattresses.

### Checks the app runs on every rep
People are not perfect for five whole reps. The app scores each rep instead of passing or failing it. Provisional numbers are tuned with the human-error simulator and real data.
- **Invalid (dropped, never scored)**: `no-drop-found` (including an impact speed below 0.2 m/s, which is not a real drop), `left-surface`, `low-sample-rate`, and no still hover (jitter above a high ceiling).
- **Scored (weight 0 to 1)**: hover jitter and caught landing. Each lowers the weight smoothly. A rep with weight ≥ 0.5 is *usable*.
- **Covariates**: record lean, impact speed, rest length and whether the rest was skipped on every rep.
- **Jitter is per person**: the first 2 reps use a global prior. After that the scale is the median jitter of the person's valid reps. The reference stores it and tests reuse it.
- **Lean and speed are not scored against the reference.** They differ by surface, and a penalty made most reps on a new surface unusable. Calibration drops a rep whose lean or speed is far from the person's own other reps (the outlier rule below). A test median is robust to one odd rep. A lean difference from calibration becomes a verdict caveat.
- **Speed**: `peak_over_v` already divides by speed.
- **No lean matching.** The user is not asked to match the calibration lean.
- **Phone position cue (absolute).** In a sit-drop the phone must ride upright on the sternum. If the hover angle from the phone's upright axis passes 55° (provisional: valid sets measured 2 to 44°, flat phones 58 to 78°), the app says to hold it against the breastbone. It confirms once the angle is back inside by 5°. The capture screen shows the live angle and plays the same cues outside the drop windows. The check is off for the bridge drop until there is data.
- Every dropped or low-weight rep shows a short fix message ("lean a bit less", "hold still").

### Rep session rules
- Up to 10 attempts. Finish at 5 usable reps.
- The user may finish at 3 usable reps. The result is then marked low confidence.
- Fewer than 3 usable reps after 10 attempts: say the technique or surface is not working and offer a retry.
- Rest defaults to 20 s. The user may skip it. The rep records the skip.
- Progress counts usable reps out of 5.

### Held constant by the user
- Same person, shoes off, pockets empty, thin clothing over the phone.
- Legs fully relaxed at impact. Feet flat, same distance from the surface.
- Same landing spot: sit-drop ~30 cm in from the edge; bridge drop at normal hip position.
- Stay still and hold your breath for 2 s after impact.
- Rest ~20 s between reps so foam recovers (the user may skip). Aim for 5 usable reps per test.

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
| `settle_time` (until within ±0.05 g of rest) | none (reported only) | too noisy: breathing keeps it from settling, and it varied 1.5 to 2.9 s on one surface |

Steps:
1. Calibration stores each feature's quality-weighted median μ_ref and scaled MAD (1.4826 · MAD) over its usable reps.
   - Auto-drop a rep more than 3 scaled MADs from the median on a scored feature, lean or impact speed, only when at least 5 reps are valid and never below 3. Show a note, not a redo request.
   - A reference needs at least 3 usable reps.
2. A test takes the same weighted median over its usable reps to get μ_test.
3. Per feature: z = (μ_test − μ_ref) / σ_eff, where σ_eff = max(scaled MAD, 8% of μ_ref, absolute floor).
   - With 3 or 4 reference reps, multiply the floor by 1.5.
   - The floor stops very consistent users from getting imperceptible differences flagged. Tune 8% and 1.5 with real data and the simulator.
4. Hardness score H = mean(z_peak_over_v, −z_stop_time). Springiness score S = z_bounce_ratio.
5. Labels: |score| < 2 = just right / same bounce; 2–3 = "slightly"; > 3 = "much". The sign gives harder/softer and bouncier/deader.
6. Match = 100 · e^(−(H² + S²) / 8). Examples: H = S = 0 → 100%; H = 2, S = 0 → 61%; H = S = 2 → 37%.
   - Until the multi-surface data fixes the hardness axis, the match uses S only and hardness shows "can't tell yet".

Uncertainty:
- Standard error per axis is about σ_eff/√n, with n the usable reps.
- The interval straddles a label boundary (2 or 3): say "close call".
- Fewer than 3 usable reps, or a low mean weight: say "not enough data" and show no label.
- After 3 usable reps the app offers "finish now". It reads "confident" only when the interval sits inside one label.
- Never give a confident label from fewer than 3 reps.
- Caveats list the lean difference from calibration and any skipped rests.

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
- Product form (earlier idea): a 3 in × 1 in steel puck (~0.9 kg) with an ESP32 + IMU inside. See "Proposed product form: slab rig" below for the current proposal.

### Proposed product form: slab rig (proposal, not scheduled)
Status: build it only if the 5 lb plate experiment shows a much smaller rep-to-rep spread than the body. The lead decides.

Why:
- Body drops vary 13% (best set) to 27–44% from rep to rep. Instrument noise is about 1%, so the person is the noise source.
- A 5-versus-5 test then resolves about a 30% to 60% difference in peak. Peak scales with √stiffness, so that is about 1.7× to 2.5× in stiffness. This is too coarse to separate neighbouring cushions or mattress grades.
- A fixed mass removes the person. Hand release still adds some noise.

Spec:
- Block: a steel slab, 175 × 90 mm (the largest phone with a thick case, centred on it). The phone rides on top. Any smaller phone fits on the same block, so the rig does not depend on the phone or case model.
- Mass: about 1.9 kg (4.2 lb), 1.5 cm thick. With the phone the rig is about 2.15 kg and presses about 1.3 kPa, which matches a body (1.2–1.4 kPa). The same footprint with a 5 lb block (2.3 kg, 1.9 cm thick) presses about 1.6 kPa.

| Steel block | Total with phone | Pressure | Thickness |
|---|---|---|---|
| 1.0 kg | 1.25 kg | 0.78 kPa | 0.8 cm |
| 1.5 kg | 1.75 kg | 1.09 kPa | 1.2 cm |
| 1.9 kg (chosen) | 2.15 kg | 1.34 kPa | 1.5 cm |
| 2.3 kg (5 lb) | 2.55 kg | 1.59 kPa | 1.9 cm |

- Footprint: keep it wide and flat. A small base presses much harder than a body (about 9 kPa at 6 cm, 3.5 kPa at 10 cm), so it reads the top layer and bottoms out on thin cushions.
- Material: steel. Aluminium needs a 4.5 cm block for the same mass. No lead. Chamfer the edges, paint or wrap against rust, leave the bottom face bare because anything soft there adds compliance.
- Phone holder: the phone's back lies flat on the top face with a 1 mm silicone or rubber sheet. Use a Velcro strap through two slots, or a manual spring bar clamp. No motor, no foam, no flexible arm. A soft link damps the impact: the same chair gave stop time 0.22 s and bounce ratio 0.13 with the phone held out, and 0.14 s and 0.26 on the chest.
- Release: by hand from a 5 to 10 cm spacer, flat, with both hands. A PVC pipe as a guide is optional. Use the nominal height for the impact speed, v = √(2gh). The fall time (v = g·t) is only a cross-check: at 5 cm the fall lasts about 0.1 s, about 6 samples, so it is good to roughly ±17%.
- Cost target: hardware of $15 or less (scrap or thrift steel, silicone sheet, strap). A motorized car mount alone costs more than that. Supplier prices are unchecked; an online cut-to-size steel plate may cost $15 to $30.
- Depth: the rig reads to about one to two times its footprint width (about 9 to 18 cm). This is a rough elastic estimate and is not checked on foam. The rig will not reach a 20 cm support core. Check it with the topper experiment, using a 2.3 kg and a 4.5 kg rig.
- Safety: strap the phone on, keep drops at 10 cm or less, keep hands and feet clear.

Software, when the rig is chosen:
- A new routine, `rig-drop`, with no hover check and no phone-position cue. The free fall (|a| near 0) marks the release.
- Hardness is the raw peak and springiness is the bounce ratio. Do not use speed-based features.

Decision gate, from 10 drops on one surface: a spread of about 5% or less means fine discrimination is possible and the rig is worth building. A spread of 10% to 15% means the surface itself is the limit, and the rig is dropped. The rig is no longer phone-only.

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

## Validation before building analysis
Build a raw-capture page first (permission button, record, show `event.interval`, export JSON). Use it for:
1. **Sample rate**: if a real iPhone gives < ~50 Hz, reconsider Expo.
2. **Consistency**: 5 sit-drops each on two surfaces. The method works if the within-surface spread is smaller than the between-surface gap.
3. **Depth (topper experiment)**: bridge drops on (A) a bare springy mattress, (B) a soft topper on that mattress, (C) the topper on the floor.
   - B between A and C: the drop reaches the core.
   - B ≈ C: it reads only the topper.
Recorded traces become test fixtures.

## Stretch goal: shared surface listings
Start only after the core works on both routines.
- People upload test results (not the analysis) to a shared database. Provider chosen at the event (Supabase, Firebase or sponsor cloud).
- Body-dependent results must be separated into a surface effect and a person effect:
  - **Layer 1 (physics)**: each person enters body weight. k ≈ m · (a_peak / v)² and k = 4π²m·f² scale results toward the surface's own stiffness.
  - **Layer 2 (statistics)**: model each result as surface effect + person effect + noise. Solve by least squares (two-way fixed effects, a simple matrix factorization). It works with few people if they share surfaces.
  - Layer 2 runs on the phone after downloading results. The cloud only stores data.
- Cold start: a new person tests one listed surface to fix their person effect.
- Then anyone can compare a listing against their own reference without testing it.
- k-means on (hardness, springiness) tags listings as foam-like, spring-like or hybrid-like.
- Listings show the test count and spread, because the same model varies with age and toppers.
- A neural network is not appropriate: the dataset is tiny.

## Out of scope
- Bluetooth or ESP32 hardware (needs a native or Expo shell).
- The back-flop routine.
- Slow memory-foam recovery after unloading.
- Any absolute stiffness value.
- Whole-body fit (spine alignment, pressure maps).

## Development
- Check command: `npm run check` runs typecheck, lint, Vitest and dependency-cruiser (package boundaries). Run it before every merge.
- Tests feed the signal core **synthetic acceleration traces** with known answers (hover, then a damped spring at a set f and A₂/A₁). They also check that tilted, moving and caught-landing reps are rejected.
- Phone testing during development: Vite dev server + an ngrok HTTPS tunnel (iOS needs HTTPS for motion permission).
- Users always use the GitHub Pages build, which runs without any laptop.
- A human-error simulator in `testkit` makes synthetic reps with realistic variation: speed sd 25%, lean sd 6° on a surface offset, hover sway across the measured range and a 35% bad-rep rate. The policy passes only if, over many simulated users:
  1. At least 90% finish calibration within 8 attempts.
  2. At least 90% who retest the same surface read "just right" on both axes.
  3. Two surfaces with a realistic gap separate in at least 90% of runs.
  4. At most 5% give a confident wrong direction.
  Change these numbers only with the lead's approval. The hardness gap in criterion 3 is set from real multi-surface data.
- Work splits into two lanes of equal size:
  - **Sensing**: contract types, `signal` scoring and robust statistics, verdict uncertainty, simulator, hardness-axis fix, bridge-drop tuning. Stretch: shared listings model.
  - **App and data**: store hardening, capture export fixes, the `session` finish rule, calibrate, test and result screens, routines, autocomplete, offline. Stretch: `CloudStore`, listings screen.
  - Both lanes collect data: sloppy-but-honest sets from non-athletes (app lane); one person on 4+ surfaces of known order (sensing lane).

## Git workflow
- `main` stays clean. Each task gets a branch: `feat/<name>`, `fix/<name>`, `docs/<name>`.
- Each branch lives in a worktree: `../goldimattress-hacktx2026-worktrees/<branch-with-dashes>`.
  - Create: `git worktree add ../goldimattress-hacktx2026-worktrees/feat-x -b feat/x`.
- Keep commits small. Use short, descriptive subjects.
- Merge with `git merge --no-ff <branch>` on main, push, then remove the worktree and delete the branch.
