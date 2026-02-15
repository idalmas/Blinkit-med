---
name: Create Context Files
overview: Create descriptive context.md files for backend, frontend, and hardware to document the current state and planned EOG integration.
todos:
  - id: create-backend-context-final
    content: Create backend/context.md with API and RAG details
    status: completed
  - id: create-frontend-context-final
    content: Create frontend/context.md with MediaPipe and App details
    status: completed
  - id: update-hardware-context-final
    content: Update hardware/context.md with EOG/Blink mode plans and current code logic
    status: completed
isProject: false
---

I will create three context files:

1. `backend/context.md`: Document the Hono/Bun architecture, Elasticsearch RAG system, and app-specific endpoints.
2. `frontend/context.md`: Document the React/Vite structure, MediaPipe blink detection system, and the various hands-free apps.
3. `hardware/context.md`: Update the existing file with the latest `main.py` and `plotter.py` logic, and detail the planned EOG (look left/right) vs Blink modes.

The hardware context will specifically address the transition from raw ADC sampling to a dual-mode system (EOG for gaze tracking and Blink for triggers).