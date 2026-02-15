import React, { useEffect, useRef, useState } from 'react';

interface SignalData {
  raw: number;
  voltage: number;
  timestamp: number;
}

export const SignalVisualizer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<SignalData[]>([]);
  const [connected, setConnected] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [lastRaw, setLastRaw] = useState<number | null>(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001/ws');

    ws.onopen = () => {
      console.log('Connected to signal stream');
      setConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe' }));
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'signal') {
        dataRef.current.push(msg);
        if (dataRef.current.length > 500) {
          dataRef.current.shift();
        }
        setSampleCount((c) => c + 1);
        setLastRaw(msg.raw);
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const currentData = dataRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw grid
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      for (let i = 0; i < canvas.width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < canvas.height; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      if (currentData.length > 1) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const minVal = 1750;
        const maxVal = 2250;
        const range = maxVal - minVal;

        currentData.forEach((point, i) => {
          const x = (i / 500) * canvas.width;
          const y = canvas.height - ((point.raw - minVal) / range) * canvas.height;
          
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div style={{ 
      background: '#111', 
      padding: '20px', 
      borderRadius: '16px', 
      border: '1px solid #333',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
    }}>
      <h3 style={{ color: '#fff', margin: '0 0 10px 0', fontSize: '14px', opacity: 0.7 }}>Live EOG Signal</h3>
      <div style={{ color: connected ? '#4ade80' : '#f87171', fontSize: '12px', marginBottom: '8px' }}>
        {connected ? 'Connected' : 'Disconnected'} · Samples: {sampleCount} · Last ADC: {lastRaw ?? '-'}
      </div>
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={200} 
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
    </div>
  );
};
