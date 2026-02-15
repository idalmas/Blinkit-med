# Frontend Context: Hands-Free Interface

## Overview
The Blinket frontend is a React-based web application designed for hands-free interaction. It uses computer vision (MediaPipe) to translate facial gestures—specifically eye blinks and winks—into navigation and control commands across a suite of specialized applications.

## Core Technology Stack
- **Framework**: React 18 with Vite
- **Routing**: React Router
- **Gestures**: MediaPipe Face Landmarker
- **Styling**: Tailwind CSS

## Gesture Detection System (`src/hooks/useBlinkDetection.ts`)
The heart of the frontend is the `useBlinkDetection` hook, which processes video frames to detect:
- **Single Blink**: Basic trigger.
- **Double Blink**: Open/Select action.
- **Triple Blink**: Reset or special action.
- **Wink Left / Wink Right**: Navigation (previous/next).
- **Long Close**: State change or "back" action.

The system uses Exponential Moving Averages (EMA) to smooth noisy data from the camera and relative eye-opening ratios to distinguish between intentional winks and natural blinks.

## Application Suite
The frontend is organized into several "apps," each accessible from the main launcher (`AppsPage.tsx`):

### 1. Apps Launcher (`AppsPage.tsx`)
A grid-based launcher where users browse apps using winks and select them with a double blink.

### 2. Talk Page (`TalkPage.tsx`)
A voice-based conversation interface.
- Supports real-time transcription and diarization.
- Uses a state machine (Idle -> Listening -> Thinking -> Speaking) controlled by blinks.
- Integrates with Fish Audio for voice cloning.

### 3. Books Page (`BooksPage.tsx`)
An EPUB reader.
- Page flipping is controlled by left/right winks.
- Hands-free reading experience.

### 4. Search Apps
- **Amazon Search**: Browse products and send links via email.
- **Web Search**: Scroll through Google search results using winks.
- **Maps**: Navigate locations hands-free.

### 5. Games
- **Flappy Bird**: Control the bird's jump using blinks.

## Backend Integration
- **API Base**: Configured in `src/config.ts` (typically `http://localhost:3001`).
- **Communication**: Uses standard `fetch` for REST and WebSockets for real-time features.

## Planned Integration: EOG
The frontend is being prepared to accept input from the **Hardware EOG System**. This will allow users to navigate by looking left or right (EOG mode) in addition to the existing camera-based blink detection.
