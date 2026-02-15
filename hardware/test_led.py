import machine
import time
from machine import Pin

# Common onboard LED pins for various ESP32 boards:
# 2: Standard ESP32 DevKit
# 5: Some newer boards
# 22: Some Wemos/Lolin boards
# 8: Some ESP32-C3/S3 boards
PINS_TO_TEST = [2, 5, 22, 8]

print("Starting LED Pin Discovery...")
print("Testing pins:", PINS_TO_TEST)

leds = []
for p in PINS_TO_TEST:
    try:
        leds.append(Pin(p, Pin.OUT))
        print(f"Initialized GPIO{p}")
    except Exception as e:
        print(f"Could not initialize GPIO{p}: {e}")

try:
    while True:
        for led in leds:
            # Blink each pin in sequence
            print(f"Blinking GPIO{led}")
            for _ in range(5):
                led.value(1)
                time.sleep(0.1)
                led.value(0)
                time.sleep(0.1)
        time.sleep(1)
except KeyboardInterrupt:
    print("Stopped.")
