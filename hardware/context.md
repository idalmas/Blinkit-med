## Project: ESP32-Based Electrooculography (EOG) System

---

## 1. System Overview

This project implements a horizontal Electrooculography (EOG) system using:

* **Microcontroller**: ELEGOO ESP32 Type-C (ESP32-D0WD-V3, dual core, WiFi + Bluetooth)
* **Analog Front-End**: AD620ANZ instrumentation amplifier
* **Electrodes**: 3 surface Ag/AgCl electrodes
* **Power Architecture**:

  * ESP32 powered via Mac USB
  * AD620 + analog front-end powered by 9V battery
* **Data Output**:

  * USB serial to Mac (development phase)
  * Possible BLE transmission in later phase

The system measures corneo-retinal potential to estimate horizontal eye movement.

---

## 2. Biophysical Signal Being Measured

The eye behaves like a dipole:

* Cornea = relatively positive
* Retina = relatively negative

This creates a corneo-retinal potential.

When the eye rotates left or right, the dipole rotates, causing a measurable voltage difference at the skin surface.

Typical EOG characteristics:

* Signal type: Voltage
* Units: Volts (typically microvolts to millivolts)
* Magnitude: ~50 µV to ~3 mV
* Frequency content: mostly < 30 Hz
* Very low frequency drift present

The system measures differential voltage between two electrodes.

---

## 3. Electrode Configuration

Three surface electrodes are used:

1. Left electrode (outer canthus)
2. Right electrode (outer canthus)
3. Reference electrode (forehead or mastoid)

The AD620 measures the voltage difference between left and right electrodes.

The reference electrode stabilizes common-mode voltage.

Electrode placement directly affects:

* Signal amplitude
* Noise
* Polarity (sign of signal)
* Stability

---

## 4. Analog Front-End: AD620ANZ

Component: AD620 instrumentation amplifier

Purpose:

* Amplify small differential voltage (EOG signal)
* Reject common-mode noise (50/60 Hz, body noise)

Key configuration:

* Gain set using resistor between pins 1 and 8
  Formula:
  G = 1 + (49.4kΩ / Rg)

* Output is referenced to the REF pin

Single-supply configuration:

* AD620 powered by 9V battery
* REF pin tied to mid-supply reference (~1.65V)
* Output centered around 1.65V
* Output must remain within 0–3.3V for ESP32 ADC compatibility

Important constraint:
ESP32 ADC cannot read negative voltages.

---

## 5. Power Architecture

### ESP32 Power

* Powered via Mac USB
* Provides stable 3.3V rail
* Used for logic and ADC

### Analog Front-End Power

* Powered by 9V battery
* Battery negative = analog ground
* Analog ground tied to ESP32 GND

Important:
Amplifier ground MUST be connected to ESP32 ground so ADC has reference.

Do NOT power ESP32 from 9V directly.

---

## 6. ESP32 Pin Configuration

Board: ELEGOO ESP32 Type-C
Chip: ESP32-D0WD-V3

### Analog Input Pin

Amplifier output connected to:

* D34 → GPIO34 → ADC1 channel

GPIO34 characteristics:

* ADC1 pin
* Input-only
* Safe for WiFi usage
* Good for biosignal measurement

MicroPython access:

```
ADC(Pin(34))
```

ADC range:

* 0 to 3.3V
* 12-bit resolution (0–4095)

Recommended configuration:

```
adc.atten(ADC.ATTN_11DB)
adc.width(ADC.WIDTH_12BIT)
```

---

## 7. Signal Processing Goals

System outputs two values:

1. Discrete 5-state classification:

   * Extreme Left
   * Left
   * Middle
   * Right
   * Extreme Right

2. Continuous scalar:

   * Range: -100 to 100
   * Represents normalized horizontal gaze direction

Processing pipeline:

1. Sample ADC at ~200–300 Hz
2. Track slow baseline drift
3. High-pass via baseline subtraction
4. Apply smoothing filter
5. Calibrate extreme left, center, extreme right
6. Normalize signal
7. Output scalar + discrete state

---

## 8. Data Transmission (Development Phase)

Transport method: USB serial

Reasons:

* Simple
* Low latency
* No BLE complexity
* Easy debugging

ESP32 prints:

* Raw ADC
* Filtered signal
* Scalar
* Label

Mac reads via:

* Python serial
* Plotting tool
* Serial monitor

BLE may be added later.

---

## 9. Constraints and Safety

* Analog front-end battery powered
* USB only powers ESP32
* Grounds shared
* No direct 9V connection to ESP32 VIN
* Avoid negative voltage into ADC
* Keep electrode wiring short
* Keep analog wiring away from USB cable

---

## 10. Current Hardware State

* ESP32 connected to Mac via USB
* AD620 powered by 9V battery
* Amplifier output connected to D34 (GPIO34)
* Serial output visible on Mac
* Ready for MicroPython ADC sampling

---

## 11. Immediate Coding Phase Objectives

1. Implement stable ADC sampling loop
2. Confirm signal reacts to eye movement
3. Implement baseline removal
4. Add smoothing
5. Add calibration routine
6. Map to scalar [-100, 100]
7. Map to 5 discrete states
8. Stream via serial

---

## 12. Future Expansion

* Add BLE transmission
* Add filtering stage (bandpass)
* Add artifact detection
* Add wearable battery pack
* Possibly upgrade analog front-end to integrated biopotential IC

