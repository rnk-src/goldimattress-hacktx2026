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
