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
