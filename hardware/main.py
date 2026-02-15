import machine
import time
from machine import Pin, ADC

# Configuration based on hardware/context.md
ADC_PIN = 34  # GPIO34
LED_PIN = 2   # Standard onboard LED for most ESP32s
SAMPLING_RATE = 200  # Hz
SLEEP_MS = 1000 // SAMPLING_RATE

# Initialize ADC
# GPIO34 is an input-only pin, safe for ADC1
adc = ADC(Pin(ADC_PIN))

# Initialize LED
led = Pin(LED_PIN, Pin.OUT)

# Configure ADC for 0-3.3V range
# ATTN_11DB allows full range up to ~3.6V (clamped at 3.3V)
adc.atten(ADC.ATTN_11DB)

# 12-bit resolution (0-4095)
adc.width(ADC.WIDTH_12BIT)

print("EOG System Initialized")
print(f"Sampling GPIO{ADC_PIN} at {SAMPLING_RATE}Hz")

def run_loop():
    print("Starting sampling loop... Press Ctrl+C to stop.")
    counter = 0
    try:
        while True:
            # Read raw ADC value
            raw_val = adc.read()
            
            # Convert to voltage (approximate)
            # 4095 corresponds to ~3.3V
            voltage = (raw_val / 4095.0) * 3.3
            
            # Blink LED every 100 samples (~0.5 seconds at 200Hz)
            if counter % 100 == 0:
                led.value(not led.value())
            
            # Print data in format readable by serial plotters
            # Format: raw_value, voltage
            print(f"{raw_val},{voltage:.4f}")
            
            counter += 1
            # Maintain sampling rate
            time.sleep_ms(SLEEP_MS)
            
    except KeyboardInterrupt:
        print("\nSampling stopped by user.")

if __name__ == "__main__":
    run_loop()
