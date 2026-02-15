import json
import threading
import time

import serial
import websocket

# Configuration
PORT = '/dev/cu.usbserial-0001'
BAUD = 115200
WS_URL = "ws://localhost:3001/ws"

def on_message(ws, message):
    pass

def on_error(ws, error):
    print(f"WS Error: {error}")

def on_close(ws, close_status_code, close_msg):
    print("WS Closed")

def stream_serial(ws):
    try:
        ser = serial.Serial(PORT, BAUD, timeout=1)
        print(f"Connected to Serial {PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if ',' in line:
                    parts = line.split(',')
                    if len(parts) >= 2:
                        try:
                            raw_val = float(parts[0])
                            voltage = float(parts[1])
                            
                            payload = {
                                "type": "signal",
                                "raw": raw_val,
                                "voltage": voltage,
                                "timestamp": time.time()
                            }
                            ws.send(json.dumps(payload))
                        except ValueError:
                            continue
            time.sleep(0.001) # Small sleep to prevent CPU hogging
            
    except Exception as e:
        print(f"Serial Error: {e}")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()

def on_open(ws):
    print("WS Connected")
    thread = threading.Thread(target=stream_serial, args=(ws,), daemon=True)
    thread.start()


if __name__ == "__main__":
    print(f"Connecting bridge to {WS_URL}")
    while True:
        ws = websocket.WebSocketApp(
            WS_URL,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        ws.run_forever()
        print("Reconnecting in 1s...")
        time.sleep(1)
