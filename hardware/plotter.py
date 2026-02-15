import serial
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque
import sys

# Configuration
PORT = '/dev/cu.usbserial-0001'
BAUD = 115200
WINDOW_SIZE = 500  # Number of points to display

# Data buffers
x_data = deque(maxlen=WINDOW_SIZE)
y_data = deque(maxlen=WINDOW_SIZE)
count = 0

# Setup plot
fig, ax = plt.subplots()
line, = ax.plot([], [], lw=2)
ax.set_ylim(1750, 2250)  # ADC range
ax.set_xlim(0, WINDOW_SIZE)
ax.set_title("Live EOG Signal (Raw ADC)")
ax.set_xlabel("Samples")
ax.set_ylabel("ADC Value (0-4095)")
ax.grid(True)

def init():
    line.set_data([], [])
    return line,

def update(frame):
    global count
    try:
        # READ ALL AVAILABLE DATA to clear the buffer
        while ser.in_waiting > 0:
            line_str = ser.readline().decode('utf-8', errors='ignore').strip()
            if ',' in line_str:
                try:
                    parts = line_str.split(',')
                    if len(parts) >= 2:
                        raw_val = float(parts[0])
                        y_data.append(raw_val)
                        x_data.append(count)
                        count += 1
                except ValueError:
                    continue
        
        # Update the line with the latest data from the buffer
        if y_data:
            line.set_data(range(len(y_data)), y_data)
                
    except Exception as e:
        print(f"Error: {e}")
        
    return line,

try:
    ser = serial.Serial(PORT, BAUD, timeout=1)
    print(f"Connected to {PORT}")
    
    # Use animation to update the plot
    ani = animation.FuncAnimation(fig, update, init_func=init, interval=10, blit=True, cache_frame_data=False)
    plt.show()

except serial.SerialException as e:
    print(f"Could not open serial port {PORT}: {e}")
except KeyboardInterrupt:
    print("Stopping...")
finally:
    if 'ser' in locals() and ser.is_open:
        ser.close()
        print("Serial port closed.")
