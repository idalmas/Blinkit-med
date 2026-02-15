# Hardware Context: ESP32 EOG & Blink System

## Project Overview
This project implements a biopotential measurement system using an ESP32 to detect eye movements (Electrooculography - EOG) and blinks. The system is designed to provide hands-free control for the Blinket frontend.

## 1. System Components
- **Microcontroller**: ELEGOO ESP32 Type-C (ESP32-D0WD-V3)
- **Analog Front-End**: AD620ANZ instrumentation amplifier (Gain set for EOG levels)
- **Electrodes**: 3 Ag/AgCl electrodes (Left, Right, Reference)
- **Power**: 9V battery for the analog circuit, USB for ESP32. Grounds are shared.

## 2. Current Implementation (`main.py`)
The current firmware performs high-speed ADC sampling:
- **Pin**: GPIO34 (ADC1_CH6)
- **Sampling Rate**: 200Hz
- **Resolution**: 12-bit (0-4095)
- **Output**: Streams `raw_value,voltage` over Serial (115200 baud).
- **Indicator**: Onboard LED blinks every 100 samples to indicate activity.

## 3. Visualization (`plotter.py`)
A Python-based Matplotlib tool for real-time signal visualization:
- Connects to `/dev/cu.usbserial-0001`.
- Displays a rolling window of 500 samples.
- Optimized to clear the serial buffer to maintain low latency.

## 4. Planned Integration: Dual-Mode Operation
The system is transitioning from raw sampling to a functional input device with two distinct modes:

### Mode 1: EOG (Gaze Tracking)
- **Goal**: Detect horizontal eye movement (Look Left / Look Right).
- **Processing**:
  - Baseline drift removal (High-pass filtering).
  - Smoothing (Low-pass filtering).
  - Normalization to a scalar range `[-100, 100]`.
- **States**: Extreme Left, Left, Middle, Right, Extreme Right.

### Mode 2: Blink Detection
- **Goal**: Detect intentional blinks to serve as "triggers" or "clicks".
- **Logic**: Identify sharp spikes in the EOG signal that correspond to vertical eyelid movement or muscle artifacts associated with blinking.

## 5. Signal Processing Pipeline (To Be Implemented)
1. **Sampling**: 200-300Hz ADC reads.
2. **Baseline Subtraction**: Remove slow DC offset/drift.
3. **Filtering**: Bandpass filter (approx. 0.1Hz to 30Hz).
4. **Calibration**: Routine to set "Center", "Max Left", and "Max Right" thresholds.
5. **Classification**: Map filtered signal to discrete states and normalized scalar.

## 6. Data Transmission
Currently using **USB Serial** for development. **BLE (Bluetooth Low Energy)** is planned for the final wearable version to communicate with the frontend/backend wirelessly.
