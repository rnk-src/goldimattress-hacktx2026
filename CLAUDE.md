# GoldiMattress — project context

## Overview
- A hackathon project (HackTX 2026), inspired by Goldilocks and the three beds.
- A user calibrates the device on a mattress or cushion they like (the reference).
- They then test other surfaces. The device reports how close each one is to the reference.
- It measures two properties:
  - **Hardness**: how the surface resists a load (the downward phase, including bottoming out).
  - **Springiness**: how the surface bounces back while the load is still on it.
- The sensor is a smartphone accelerometer, read through the phyphox app.
- There is no check command yet.

## Measurement physics
Model the surface as a mass-spring-damper. A known mass m falls from height h.
- **Impact speed**: v = √(2gh). The same height gives the same momentum, so drops are comparable.
- **Hardness (impulse)**: F·Δt = Δp. A firm surface gives a tall, narrow spike; a soft one gives a low, wide hump.
  Features: peak |a| and stopping time.
- **Stiffness (SHM)**: the mass bobs with period T = 2π√(m/k), so k = 4π²m/T².
- **Springiness (damping)**: amplitude ratio of consecutive bounce peaks, A₂/A₁. Near 1 = springy; near 0 = dead (memory foam).
- **Free-fall trigger**: in "Acceleration with g" mode, |a| ≈ 0 during free fall, then jumps at impact.
  - Fall time gives h = ½gt² and v = g·t.
- **Height normalization**: for a linear spring, a_peak / v ≈ √(k/m), independent of drop height.
- **Orientation**: use |a| = √(ax²+ay²+az²). It does not depend on how the phone faces.

Caveats:
- Real foam is nonlinear: it stiffens as it compresses. Use the same load for the reference and every test.
- A drop that is too high makes the mass leave the surface again (a second ~0 g window). Detect this.
- Slow memory-foam recovery after the load is removed is out of scope.
- Hardness and damping are separate axes. Firm foam and a soft innerspring can share hardness but differ in damping. Report both.

## Sensor and architecture
### phyphox (current source)
- Free, open-source app from RWTH Aachen. The iPhone IMU runs at about 100 Hz.
- Experiment: "Acceleration with g" (raw, so free fall reads ~0).
- Remote access: enable it in the app. It shows a URL like `http://<phone-ip>:8080`.
  - Control: `/control?cmd=start`, `/control?cmd=stop`, `/control?cmd=clear`.
  - Data: `/get?accX=full&accY=full&accZ=full&acc_time=full` returns JSON.
- Pattern: clear → start → drop → wait ~2 s → stop → fetch the full buffer. Live polling misses the impact.
- Network: venue Wi-Fi may block device-to-device traffic. Test it first. Fall back to a phone hotspot.
- Keep phyphox in the foreground. Turn off auto-lock.
- At 100 Hz a short impact spike can fall between samples. Prefer frequency, damping and settle time over a single peak value.

### Code structure
- A `SensorSource` interface returns arrays of `(t, ax, ay, az)`.
- `PhyphoxSource` is the first implementation.
- A future `SerialSource` (ESP32 + MPU6050) plugs in without changing feature extraction or the UI.
- Pipeline: source → drop segmentation (free-fall window, impact) → features → compare to reference → verdict.
- Language: Python.

## Design decisions
| Decision | Choice | Reason |
|---|---|---|
| Output | % match to the reference, plus per-feature direction ("firmer, less bouncy") | Comparing to a reference avoids calibrating an absolute scale. |
| Measurement | Free drop from a fixed height | The drop height fixes the input energy. A hand press adds human variation. |
| Springiness | Bounce and damping while the load stays on the surface | Hardness alone cannot tell foam from springs. |
| Sensor | phyphox now, behind `SensorSource` | A microcontroller IMU can replace it later. |
| Calibration | 5 reference drops; store each feature's mean and spread | The spread separates real differences from noise. |
| Demo surfaces | Cushions, pads and pillows brought to the demo | Does not depend on a bed at the venue. |

## Load options
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

### Body sit-drop
- Hold the phone flat against the chest, then drop into a sit on the surface. The body is the load, at real body pressure.
- It recovers bottoming out and deep support. The bounce is ~1–3 Hz, which samples well.
- It calibrates to the person: "just right for you".
- Risk: people do not sit the same way twice. Mitigate with a fixed routine, impact-speed normalization, 5 reps and outlier rejection.
- Consistency test: 5 sit-drops each on two surfaces. Keep the method if the within-surface spread is smaller than the between-surface gap. Otherwise fall back to the plate.
- Limits: it tests the edge zone, and surfaces must hold a seated person.

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
