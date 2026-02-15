module.exports = [
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/Documents/GitHub/revive/frontend/app/components/Timer.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Timer
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
;
/**
 * Timer Component
 *
 * Displays elapsed time in MM:SS format. Generic enough to be used by any
 * feature that needs a seconds counter (recording, workouts, etc.).
 *
 * Props:
 *   - elapsed: number of seconds elapsed.
 *
 * Used by: RecordPage (app/record/page.tsx)
 *
 * CSS: Uses Tailwind utility classes — monospaced font, large size,
 *      reduced-opacity foreground for a subtle look.
 */ /** Pad a number to two digits (e.g. 5 → "05"). */ function pad(n) {
    return n.toString().padStart(2, "0");
}
/**
 * formatTime — converts total seconds into an "MM:SS" string.
 * @param totalSeconds  The number of seconds to format.
 * @returns             A string in "MM:SS" format.
 */ function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${pad(mins)}:${pad(secs)}`;
}
function Timer({ elapsed }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        className: "font-mono text-5xl font-light tracking-widest text-foreground/80",
        children: formatTime(elapsed)
    }, void 0, false, {
        fileName: "[project]/Documents/GitHub/revive/frontend/app/components/Timer.tsx",
        lineNumber: 44,
        columnNumber: 5
    }, this);
}
}),
"[project]/Documents/GitHub/revive/frontend/app/components/RecordButton.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * RecordButton Component
 *
 * A large circular button that toggles between "record" and "stop" states.
 * While recording, a pulsing red ring provides visual feedback.
 *
 * Props:
 *   - isRecording: whether a recording session is currently active.
 *   - onToggle:    callback invoked when the button is clicked.
 *
 * Used by: RecordPage (app/record/page.tsx)
 *
 * CSS: The button is a 96px (h-24 / w-24) red circle. When recording it
 *      scales up to 110% and shows an animated ping ring behind it.
 *      The inner icon transitions between a circle (idle) and a rounded
 *      square (recording / stop).
 */ __turbopack_context__.s([
    "default",
    ()=>RecordButton
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
;
function RecordButton({ isRecording, onToggle }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "relative flex items-center justify-center",
        children: [
            isRecording && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "absolute h-32 w-32 animate-ping rounded-full bg-red-500/30"
            }, void 0, false, {
                fileName: "[project]/Documents/GitHub/revive/frontend/app/components/RecordButton.tsx",
                lineNumber: 37,
                columnNumber: 9
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                onClick: onToggle,
                "aria-label": isRecording ? "Stop recording" : "Start recording",
                className: `
          relative z-10 flex h-24 w-24 items-center justify-center
          rounded-full shadow-lg transition-all duration-300
          focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400/50
          ${isRecording ? "bg-red-600 hover:bg-red-700 scale-110" : "bg-red-500 hover:bg-red-600"}
        `,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    className: `
            block bg-white transition-all duration-300
            ${isRecording ? "h-7 w-7 rounded-sm" : "h-10 w-10 rounded-full"}
          `
                }, void 0, false, {
                    fileName: "[project]/Documents/GitHub/revive/frontend/app/components/RecordButton.tsx",
                    lineNumber: 55,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/Documents/GitHub/revive/frontend/app/components/RecordButton.tsx",
                lineNumber: 40,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/Documents/GitHub/revive/frontend/app/components/RecordButton.tsx",
        lineNumber: 34,
        columnNumber: 5
    }, this);
}
}),
"[project]/Documents/GitHub/revive/frontend/app/components/StatusLabel.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * StatusLabel Component
 *
 * A small text label that tells the user the current recording state.
 *
 * Props:
 *   - isRecording: whether a recording session is currently active.
 *
 * Used by: RecordPage (app/record/page.tsx)
 *
 * CSS: Uppercase, wide letter-spacing, small font at 50% foreground opacity
 *      to keep it subtle beneath the record button.
 */ __turbopack_context__.s([
    "default",
    ()=>StatusLabel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
;
function StatusLabel({ isRecording }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
        className: "text-sm font-medium uppercase tracking-widest text-foreground/50",
        children: isRecording ? "Recording…" : "Tap to record"
    }, void 0, false, {
        fileName: "[project]/Documents/GitHub/revive/frontend/app/components/StatusLabel.tsx",
        lineNumber: 27,
        columnNumber: 5
    }, this);
}
}),
"[project]/Documents/GitHub/revive/frontend/app/record/page.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>RecordPage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$app$2f$components$2f$Timer$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/app/components/Timer.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$app$2f$components$2f$RecordButton$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/app/components/RecordButton.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$app$2f$components$2f$StatusLabel$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Documents/GitHub/revive/frontend/app/components/StatusLabel.tsx [app-ssr] (ecmascript)");
/**
 * Record Page — /record
 *
 * Orchestrates the recording UI by composing three child components:
 *   - Timer        — displays elapsed time in MM:SS format.
 *   - RecordButton — the main record/stop toggle with a pulsing ring.
 *   - StatusLabel  — contextual hint ("Tap to record" / "Recording…").
 *
 * All recording state (isRecording, elapsed, timer interval) lives here
 * and is passed down via props.
 *
 * Child components: Timer, RecordButton, StatusLabel
 *   (all in app/components/)
 */ "use client";
;
;
;
;
;
function RecordPage() {
    /* ── state ─────────────────────────────────────────────── */ const [isRecording, setIsRecording] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [elapsed, setElapsed] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(0);
    const timerRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    /* ── timer logic ───────────────────────────────────────── */ /** startTimer — begins a 1-second interval that increments `elapsed`. */ const startTimer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        setElapsed(0);
        timerRef.current = setInterval(()=>{
            setElapsed((prev)=>prev + 1);
        }, 1000);
    }, []);
    /** stopTimer — clears the running interval. */ const stopTimer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);
    /* Clean up on unmount */ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        return ()=>stopTimer();
    }, [
        stopTimer
    ]);
    /* ── handlers ──────────────────────────────────────────── */ /**
   * toggleRecording — flips the recording state and starts/stops the timer.
   * This is where you'd hook up the MediaRecorder API in a future iteration.
   */ const toggleRecording = ()=>{
        if (isRecording) {
            stopTimer();
            setIsRecording(false);
        } else {
            startTimer();
            setIsRecording(true);
        }
    };
    /* ── render ────────────────────────────────────────────── */ return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex min-h-screen flex-col items-center justify-center gap-10 bg-background",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$app$2f$components$2f$Timer$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                elapsed: elapsed
            }, void 0, false, {
                fileName: "[project]/Documents/GitHub/revive/frontend/app/record/page.tsx",
                lineNumber: 70,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$app$2f$components$2f$RecordButton$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                isRecording: isRecording,
                onToggle: toggleRecording
            }, void 0, false, {
                fileName: "[project]/Documents/GitHub/revive/frontend/app/record/page.tsx",
                lineNumber: 71,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$Documents$2f$GitHub$2f$revive$2f$frontend$2f$app$2f$components$2f$StatusLabel$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                isRecording: isRecording
            }, void 0, false, {
                fileName: "[project]/Documents/GitHub/revive/frontend/app/record/page.tsx",
                lineNumber: 72,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/Documents/GitHub/revive/frontend/app/record/page.tsx",
        lineNumber: 69,
        columnNumber: 5
    }, this);
}
}),
"[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
;
else {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    else {
        if ("TURBOPACK compile-time truthy", 1) {
            if ("TURBOPACK compile-time truthy", 1) {
                module.exports = __turbopack_context__.r("[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)");
            } else //TURBOPACK unreachable
            ;
        } else //TURBOPACK unreachable
        ;
    }
} //# sourceMappingURL=module.compiled.js.map
}),
"[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactJsxDevRuntime; //# sourceMappingURL=react-jsx-dev-runtime.js.map
}),
"[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/Documents/GitHub/revive/frontend/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].React; //# sourceMappingURL=react.js.map
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__f196f689._.js.map