# GoldiMattress — project context

## Overview
- A hackathon project (HackTX 2026), inspired by Goldilocks and the three beds.
- A phone web app plus a simple weighted rig: a steel slab with the phone strapped on top.
- A user calibrates on a mattress or cushion they like (the reference).
- They then test other surfaces. The app reports whether each one is too hard, too soft or just right *for them*.
- Scope: mattresses first (the costliest wrong purchase), plus couches, chairs and cushions.
- It measures two properties:
  - **Hardness**: how the surface resists a load (the downward phase, including bottoming out).
  - **Springiness**: how the surface bounces back while the load is still on it.
- The sensor is the phone's accelerometer. The load is the rig (`rig-drop`), released by hand from 5–10 cm.
- People are consumers. They run the rig routine and use the app, nothing more.

### Why a rig, not the body
- Body drops vary 13% (best set) to 27–44% from rep to rep. Instrument noise is about 1%, so the person is the noise source.
- A 5-versus-5 body test resolves only about 1.7× to 2.5× in stiffness. This is too coarse for neighbouring cushions or mattress grades.
- A fixed mass removes the person. Hand release still adds some noise.
- The body routines (sit-drop, bridge drop) are frozen as legacy code and fixtures. They are not a fallback product.

### Gate: the plate experiment
- No plate data exists yet. The plan covers the build case; the gate is a switch.
- From 10 drops of a 5 lb plate on one surface:
  - Spread of about 5% or less: fine discrimination is possible. Build the slab rig.
  - Spread of 10% or more: the release or surface is the limit. Pivot to another fixed-load rig. Do not return to the body method.
- After the gate, tune `FLIGHT_ACCEL`, the flight-mismatch ramp, the 5% floor and the tilt limits from the real fixtures.

## Measurement physics
Model the surface as a mass-spring-damper. A mass m falls from height h. For the rig, m is the slab plus the phone.
- **Impact speed**: v = √(2gh). The same height gives the same momentum, so drops are comparable.
- **Free fall**: a released rig reads |a| ≈ 0 for t = √(2h/g). At 5 cm that is 0.101 s, about 6 samples at 60 Hz.
  - The rig uses the nominal height for v. The measured fall time is a cross-check only, good to about ±17%.
- **Hardness (impulse)**: F·Δt = Δp. A firm surface gives a tall, narrow spike; a soft one gives a low, wide hump.
  Features: peak |a| and stopping time.
- **Stiffness (SHM)**: the mass bobs with period T = 2π√(m/k), so k = 4π²m/T².
- **Springiness (damping)**: amplitude ratio of consecutive bounce peaks, A₂/A₁. Near 1 = springy; near 0 = dead (memory foam).
- **Peak and stiffness**: for a linear spring, a_peak ≈ v·√(k/m). At fixed m and h, peak scales with √k.
  - A 1.3× stiffness gap is about a 14% peak gap.
- **Orientation**: use |a| = √(ax²+ay²+az²). It does not depend on how the phone faces.

Caveats:
- Real foam is nonlinear: it stiffens as it compresses. Use the same rig, mass and height for the reference and every test.
- A drop that is too high makes the rig leave the surface again (a second ~0 g window). Detect this.
- Slow memory-foam recovery after the load is removed is out of scope.
- Hardness and damping are separate axes. Firm foam and a soft innerspring can share hardness but differ in damping. Report both.

### The k rule
- Never report k in N/m.
- A relative **rig index** (peak in g and bounce ratio) is allowed. Label it "for this rig".
- The index depends on rig mass and drop height. Compare indexes only at the same `(massKg, dropHeightCm)`.

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
- iOS gives about 57–60 Hz.
- Coaching: Web Audio beeps and `speechSynthesis`. `navigator.wakeLock` keeps the screen on. iOS has no `navigator.vibrate`.
- At ~60 Hz a short spike can fall between samples. Prefer robust statistics over many reps to a single peak value.

### Code structure
- The **signal core** is plain TS with no DOM or framework imports. It is unit-testable and portable.
- `SensorSource` returns arrays of `(t, ax, ay, az)`.
  - `DeviceMotionSource` is the first implementation.
  - A future Bluetooth IMU puck (ESP32 + IMU) needs a native or Expo shell, because iOS Safari has no Web Bluetooth.
- `Store` persists people, references and tests.
  - `LocalStore` (`localStorage`) is the first implementation. `CloudStore` is the stretch goal.
- The sensing half hands the app half one agreed result type, in `src/packages/domain`.

### Per-rep analysis: `analyzeRep` with a drop-model seam
- `analyzeRep(trace, ref?)` returns `RepResult` for every routine. Callers do not change.
- Inside, a private **drop model** fills three slots. It lives in `signal/internal/drop-model.ts`.
  - `findDrop`: body uses the dip segmentation. Free-fall finds a run of |a| < `FLIGHT_ACCEL` (2 m/s², provisional) of at least 3 samples, then the first peak after it.
  - `impactSpeed`: body integrates (|a| − g). Free-fall returns √(2gh) from `trace.rig.dropHeightCm`, or `DEFAULT_RIG`. It also records the measured `flightS`.
  - `quality`: body scores jitter and a caught landing. Free-fall scores jitter, `flight-mismatch` and `tilted-landing`.
- The shared shell: rate check → `findDrop` → gap check → hover assessment → `leftSurface` → `impactSpeed` → features → `quality`.
- The model choice lives in the private `SPECS` table in `routine.ts` (`dropModel: 'body' | 'free-fall'`). The public `RoutineSpec` does not expose it.
- Do not use the body segmentation for the rig. Its 0.1 s minimum descent rejects a 5 cm free fall.

### Live session: `createRepSession`
- One session serves every routine. The rig has a hover: the user holds the slab still on the spacer before release.
- Routine-driven config:
  - `SessionOptions.rig` is stamped onto each trace.
  - Cue text is per routine, from one override table. `CueKey` and `LiveState` do not change.
  - The level check uses `maxLeanDeg` per routine (20° for rig-drop, provisional).
- Release detection is automatic. The user never taps during a rep.

### Surface summary: `summarize`
- `summarize(reps)` is the one place that computes the robust centre and spread of usable reps.
  - Centre: weighted trimmed mean (drop the top and bottom 20% by weight). Below 5 reps, the weighted median.
  - Spread: scaled MAD (1.4826 · MAD).
- `buildReference` is `summarize` plus the outlier rule. `compare` uses `summarize` for the test side.
- The rig index on the result screen is `summarize(testReps)`, stored on `TestRecord.index`.

### Rig setup
- `RigSetup` = `{ massKg, baseCm, dropHeightCm, spot }`.
- `DEFAULT_RIG`: 2.1 kg (1.9 kg slab + 0.2 kg phone), 17.5 × 9 cm, 5 cm, `center`.
- `Person.rig` stores the user's rig. The mass is a stored constant with an advanced override.
- The override supports a demo fallback: a heavy flat object with its own mass.

### Data recorded per test
- **Person**: anonymous ID, rig setup, one reference per routine.
- **Surface**: ID, name, type (mattress, couch, cushion, pad).
- **Test**: person ID, surface ID, routine, timestamp, device model, sample rate, per-rep features, rejected reps with reasons, rig index.
- **Raw acceleration per rep** (~3 s, a few kB), with the `rig` block. Keep it, so improved feature code can recompute old tests.

### Prototyping tool
- phyphox (free, RWTH Aachen) can log the iPhone IMU at ~100 Hz for quick offline comparisons. It is not part of the product.

## Design decisions
| Decision | Choice | Reason |
|---|---|---|
| Output | % match to the reference, plus per-feature direction ("firmer, less bouncy") | Comparing to a reference avoids calibrating an absolute scale. |
| Secondary output | Rig index "for this rig" (peak in g, bounce ratio) | Lets a user measure a surface with no reference ("Measure only"). |
| Measurement | A drop onto the surface, not a press | A drop fixes the input energy. A hand press adds human variation. |
| Load | A steel slab rig, ~2.1 kg with the phone | A fixed mass removes the person, the largest noise source. |
| Method abstraction | `'rig-drop'` is a third `Routine` | Placement varies only inside the body method, so a separate seam is hypothetical. |
| Body routines | Frozen as legacy code and fixtures | They are too noisy for the product. Their tests stay green. |
| Phone placement | Strapped face up on the slab top | The phone rides the load and never touches the surface. |
| Springiness | Bounce and damping while the load stays on the surface | Hardness alone cannot tell foam from springs. |
| Sensor | `DeviceMotionEvent` behind `SensorSource` | Runs in any phone browser. A Bluetooth IMU can replace it later. |
| Platform | Vanilla TS + Vite web app on GitHub Pages | No install, any phone, no laptop needed. |
| Analysis | On the phone | Works offline; no server to fail. |
| Storage | `LocalStore` now, `CloudStore` later | Local first; the interface allows a shared database. |
| Calibration | 3 to 5 usable reps out of up to 10 attempts; store each feature's robust centre and scaled MAD | Robust statistics and the spread separate real differences from noise. |
| References | One per routine per person | Routines produce different signals and cannot be compared. |
| Surface identity | Typed name with autocomplete | Simplest way to link tests of the same item. |
| Demo | (i) the rig live on cushions and couches; fallback (ii) a heavy flat object with the mass override | No bed at the venue. |

## Rig protocol (`rig-drop`)
### Rig
- Block: a steel slab, 175 × 90 mm, about 1.9 kg (4.2 lb), 1.5 cm thick. With the phone it presses about 1.3 kPa, which matches a lying body (1.2–1.4 kPa).
- Footprint: keep it wide and flat. A small base presses much harder than a body and bottoms out thin cushions.
- Material: steel, edges chamfered, painted or wrapped against rust. Leave the bottom face bare: anything soft there adds compliance.
- Phone holder: the phone's back lies flat on a 1 mm silicone or rubber sheet. Use a Velcro strap through two slots, or a spring bar clamp. No foam, no flexible arm: a soft link damps the impact.
- Cost target: $15 or less in hardware.
- Depth: the rig reads to about one to two times its footprint width (about 9 to 18 cm). This is a rough elastic estimate. The topper experiment checks it.

### Movement
- Strap the phone face up on the slab. Rest the slab flat on a 5–10 cm spacer over the test spot.
- Hold the slab level and still with both hands. The app arms after a still hold.
- Let go with both hands at once. Do not push or drag it down.
- Leave the slab on the surface until the app says the rep is done.
- Test spots: the middle of a mattress (`center`), the middle of a seat (`seat-middle`) or `other`.
- Loose cushions and pads go on the same chair every time. This fixes the height and avoids bottoming out onto the floor.

### Checks the app runs on every rep
Provisional numbers are tuned with the rig simulator and the plate experiment.
- **Invalid (dropped, never scored)**: `no-drop-found`, `left-surface`, `low-sample-rate`, and no still hover.
- **Scored (weight 0 to 1)**: hover jitter, `flight-mismatch` (fall time vs √(2h/g), ramped beyond ±25%) and `tilted-landing` (rest angle after settle vs hold angle). A rep with weight ≥ 0.5 is *usable*.
- **Covariates**: record hold tilt (`leanDeg`), measured fall time (`flightS`) and rest length on every rep.
- **Level check**: if the held slab tilts past 20° (provisional), the app says to hold it level.
- Every dropped or low-weight rep shows a short fix message ("hold the slab level", "let go with both hands").

### Rep session rules
- Up to 10 attempts. Finish at 5 usable reps.
- The user may finish at 3 usable reps. The result is then marked low confidence.
- Fewer than 3 usable reps after 10 attempts: say the technique or surface is not working and offer a retry.
- Rest defaults to 20 s so foam recovers. The user may skip it. The rep records the skip.
- Progress counts usable reps out of 5.

### Safety
- Strap the phone on. Keep drops at 10 cm or less.
- Keep hands and feet clear of the landing spot.
- Check what is under a loose cushion. Avoid exposed frames and box-spring edges.

## Verdict rule
Features per rep:
| Feature | Property | Firmer / springier means |
|---|---|---|
| `peak` (excess g, first-lobe max) | Hardness | higher = firmer |
| `bounce_ratio` = A₂/A₁ | Springiness | higher = springier |
| `stop_time` (impact to first return to 1 g; the lobe width) | none (recorded only) | — |
| `peak_over_v` = a_peak / v_impact | none (recorded only) | — |
| `settle_time` (until within ±0.05 g of rest) | none (reported only) | — |

At fixed rig mass and height, raw peak needs no speed normalization. The body routines used `peak_over_v` because body impact speed varied.

Steps:
1. Calibration stores each feature's `summarize` centre μ_ref and scaled MAD over its usable reps.
   - Auto-drop a rep more than 3 scaled MADs from the median on a scored feature, only when at least 5 reps are valid and never below 3. Show a note, not a redo request.
   - A reference needs at least 3 usable reps.
2. A test takes the same `summarize` centre over its usable reps to get μ_test.
3. Per feature: z = (μ_test − μ_ref) / σ_eff, where σ_eff = max(scaled MAD, relative floor · μ_ref, absolute floor).
   - Relative floor: 5% for the rig (provisional). The body routines used 8%.
   - Absolute floor for `peak`: 0.1 m/s².
   - With 3 or 4 reference reps, multiply the floor by 1.5.
   - The floor stops very consistent runs from flagging imperceptible differences.
4. Hardness score H = z_peak. Springiness score S = z_bounce_ratio.
5. Labels: |score| < 2 = just right / same bounce; 2–3 = "slightly"; > 3 = "much". The sign gives harder/softer and bouncier/deader.
6. Match = 100 · e^(−(H² + S²) / 8). Examples: H = S = 0 → 100%; H = 2, S = 0 → 61%; H = S = 2 → 37%.
   - Until the towel ladder sets `hardnessReliable`, the match uses S only and hardness shows "can't tell yet".

Uncertainty:
- Standard error per axis is about σ_eff/√n, with n the usable reps.
- The interval straddles a label boundary (2 or 3): say "close call".
- Fewer than 3 usable reps, or a low mean weight: say "not enough data" and show no label.
- After 3 usable reps the app offers "finish now". It reads "confident" only when the interval sits inside one label.
- Never give a confident label from fewer than 3 reps.
- Caveats list any skipped rests and a rig setup that differs from calibration.

±2 is used because ~95% of a run's own reps on the reference fall inside it.

### Measure only
- A user with no reference can measure a surface. The result shows the rig index "for this rig" and no verdict.

## Validation
- **Plate experiment (gate)**: 10 drops of a 5 lb plate on one surface, recorded with the capture page. See "Gate" above.
- **Towel ladder**: rig drops on 0, 1, 2 and 3 folded towels on a hard surface. The peak must fall in order. It gates `hardnessReliable`.
- **Topper experiment**: rig drops on (A) a bare springy mattress, (B) a soft topper on that mattress, (C) the topper on the floor. It gates the mattress claim.
  - B between A and C: the drop reaches the core.
  - B ≈ C: it reads only the topper.
- Recorded traces become test fixtures.

## Legacy: body routines (frozen)
The body routines stay in the code with their fixtures and tests. Do not tune or extend them.

| Routine | Surfaces | Phone placement | Movement |
|---|---|---|---|
| **Sit-drop** | Couches, chairs, loose cushions and pads | Flat on the sternum, portrait, screen out, arms crossed over it | Stand with your back to the surface, squat to hover ~10 cm above it, hold still, relax the legs and drop |
| **Bridge drop** | Mattresses (hip zone) | Flat on the lower belly over the hip bones, held with both hands | Lie on your back, lift the hips ~10 cm into a glute bridge, hold still, go limp and drop |

- Body drops are not free fall: the legs still carry some weight, so |a| does not reach ~0. Impact speed integrates (|a| − g) from the end of the hover to impact.
- Hardness uses `peak_over_v`, because body impact speed varies.
- The sit-drop phone position cue fires past 55° from upright.
- Lean and speed are covariates, not scored against the reference. Calibration drops a rep whose lean or speed is far from the person's own other reps.
- A seated human body resonates vertically at ~4–6 Hz, and its tissue adds damping. Results are relative only.
- Safety: hover 10 cm or less. People with back or tailbone problems should not do drop tests.

## Load options considered
Target contact pressure ≈ 1.2–1.4 kPa (an average lying body: ~70 kg over ~0.5 m²). P = mg/A.

| Steel block | Total with phone | Pressure | Thickness |
|---|---|---|---|
| 1.0 kg | 1.25 kg | 0.78 kPa | 0.8 cm |
| 1.5 kg | 1.75 kg | 1.09 kPa | 1.2 cm |
| 1.9 kg (chosen) | 2.15 kg | 1.34 kPa | 1.5 cm |
| 2.3 kg (5 lb) | 2.55 kg | 1.59 kPa | 1.9 cm |

- **Phone alone** (~0.2 kg, ~0.18 kPa): reads only the top 1–2 cm, never bottoms out, and bounces at ~10 Hz with ~10 samples per cycle. Too light.
- **Body**: real pressure, but 13–44% rep-to-rep spread. Frozen as legacy.
- **Weighted plate** (5 lb plate on a board): the gate experiment. No water bottles or sandbags (slosh adds fake damping), no foam between phone and plate.
- **Textbook**: one 2 kg book gives only ~0.36 kPa; a body pressure needs ~8 kg.
- **Other**: phone tilt beside the person (hardness only), ball drop (light probe), LiDAR depth (needs a custom iOS app), hand press (no force reading).

## Stretch goal: shared surface listings
Start only after the core rig flow works.
- People upload test results (not the analysis) to a shared database. Provider chosen at the event (Supabase, Firebase or sponsor cloud).
- A listing is the median and spread of stored `TestRecord.index` values for one surface.
- Group listings by `(massKg, dropHeightCm)`, because mass and height change the peak.
- The rig removes the person, so there is no person-effect model.
- Listings show the test count and spread, because the same model varies with age and toppers.
- A neural network is not appropriate: the dataset is tiny.

## Out of scope
- Bluetooth or ESP32 hardware (needs a native or Expo shell).
- Tuning or extending the body routines, and the back-flop routine.
- A 2.3 kg vs 4.5 kg rig depth check.
- Slow memory-foam recovery after unloading.
- Any absolute stiffness value.
- Whole-body fit (spine alignment, pressure maps).

## Development
- Check command: `npm run check` runs typecheck, lint, Vitest and dependency-cruiser (package boundaries). Run it before every merge.
- Tests feed the signal core **synthetic acceleration traces** with known answers. Rig traces: a still hold, a free fall for √(2h/g), then a damped spring at v = √(2gh). Body traces stay as legacy tests.
- Phone testing during development: Vite dev server + an ngrok HTTPS tunnel (iOS needs HTTPS for motion permission).
- Users always use the GitHub Pages build, which runs without any laptop.

### Rig simulator
`testkit` makes synthetic rig reps with realistic variation: drop-height sd, hold tilt, landing-tilt rate, hand-drag rate and spot offset. The policy passes only if, over many simulated users:
1. At least 90% finish calibration within 8 attempts.
2. At least 90% who retest the same surface read "just right" on both axes.
3. Two surfaces 1.3× apart in stiffness (~14% in peak) separate in at least 90% of runs.
4. At most 5% give a confident wrong direction.
Change these numbers only with the lead's approval. The body simulator and its criteria stay as legacy tests.

### Lanes
- **Lane 1 (sensing)**: `summarize`, the `peak` feature, the contract diff, the rig synth, the drop-model seam, the rig simulator, tuning from the plate fixtures.
- **Lane 2 (app and data)**: rig recordings and capture setup, session config for the rig, the rig app flow and "Measure only", the `FeatureStats` rename with store migration v2. Stretch: `CloudStore`, listings screen.

## Git workflow
- `main` stays clean. Each task gets a branch: `feat/<name>`, `fix/<name>`, `docs/<name>`.
- Each branch lives in a worktree: `../goldimattress-hacktx2026-worktrees/<branch-with-dashes>`.
  - Create: `git worktree add ../goldimattress-hacktx2026-worktrees/feat-x -b feat/x`.
- Keep commits small. Use short, descriptive subjects.
- Merge with `git merge --no-ff <branch>` on main, push, then remove the worktree and delete the branch.
