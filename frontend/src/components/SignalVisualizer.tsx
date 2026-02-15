import React, { useEffect, useRef, useState } from 'react';

interface SignalData {
  raw: number;
  voltage: number;
  timestamp: number;
  yMin?: number;
  yMax?: number;
  leftLimit?: number;
  rightLimit?: number;
  noiseThreshold?: number;
  direction?: -1 | 0 | 1;
}

interface SignalVisualizerProps {
  compact?: boolean;
}

export const SignalVisualizer: React.FC<SignalVisualizerProps> = ({ compact = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<SignalData[]>([]);
  const [connected, setConnected] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [lastRaw, setLastRaw] = useState<number | null>(null);
  const [directionText, setDirectionText] = useState<'LEFT' | 'RIGHT' | ''>('');
  const uiTickRef = useRef(0);

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
        uiTickRef.current += 1;
        if (uiTickRef.current % 8 === 0) {
          setSampleCount((c) => c + 8);
          setLastRaw(msg.raw);
          if (msg.direction === 1) setDirectionText('LEFT');
          else if (msg.direction === -1) setDirectionText('RIGHT');
          else setDirectionText('');
        }
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
        const latest = currentData[currentData.length - 1];
        const minVal = latest.yMin ?? 1750;
        const maxVal = latest.yMax ?? 2250;
        const range = maxVal - minVal;
        const leftLimit = latest.leftLimit ?? 2020;
        const rightLimit = latest.rightLimit ?? 1920;
        const mapY = (v: number) => {
          const normalized = range > 1 ? (v - minVal) / range : 0.5;
          return canvas.height - Math.max(0, Math.min(1, normalized)) * canvas.height;
        };

        // Limit lines in compact/full graph: LEFT=red, RIGHT=blue.
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
        ctx.beginPath();
        ctx.moveTo(0, mapY(leftLimit));
        ctx.lineTo(canvas.width, mapY(leftLimit));
        ctx.stroke();

        ctx.strokeStyle = 'rgba(96, 165, 250, 0.95)';
        ctx.beginPath();
        ctx.moveTo(0, mapY(rightLimit));
        ctx.lineTo(canvas.width, mapY(rightLimit));
        ctx.stroke();

        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const xDenom = Math.max(1, currentData.length - 1);

        currentData.forEach((point, i) => {
          const x = (i / xDenom) * canvas.width;
          const y = mapY(point.raw);
          
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
      background: compact ? 'rgba(0,0,0,0.35)' : '#111', 
      padding: compact ? '0' : '20px', 
      borderRadius: compact ? '12px' : '16px', 
      border: '1px solid #333',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {!compact && (
        <>
          <h3 style={{ color: '#fff', margin: '0 0 10px 0', fontSize: '14px', opacity: 0.7 }}>Live EOG Signal</h3>
          <div style={{ color: connected ? '#4ade80' : '#f87171', fontSize: '12px', marginBottom: '8px' }}>
            {connected ? 'Connected' : 'Disconnected'} · Samples: {sampleCount} · Last ADC: {lastRaw ?? '-'} · {directionText || 'CENTER'}
          </div>
        </>
      )}
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={200} 
        style={{ width: '100%', height: compact ? '100%' : 'auto', display: 'block' }}
      />
      {compact && (
        <>
          <div
            style={{
              position: 'absolute',
              left: 6,
              bottom: 6,
              fontSize: 10,
              color: connected ? '#4ade80' : '#f87171',
              background: 'rgba(0,0,0,0.65)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {connected ? 'EOG live' : 'EOG offline'} · {lastRaw ?? '-'}
          </div>
          <div
            style={{
              position: 'absolute',
              right: 6,
              top: 6,
              fontSize: 10,
              color: directionText === 'LEFT' ? '#f87171' : directionText === 'RIGHT' ? '#60a5fa' : 'rgba(255,255,255,0.7)',
              background: 'rgba(0,0,0,0.65)',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            {directionText || 'CENTER'}
          </div>
        </>
      )}
    </div>
  );
};
