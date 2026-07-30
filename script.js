import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

        const video = document.getElementById("webcam");
        const canvas = document.getElementById("outputCanvas");
        const ctx = canvas.getContext("2d");

        const loaderOverlay = document.getElementById("loaderOverlay");
        const loaderText = document.getElementById("loaderText");

        const btnStart = document.getElementById("btnStart");
        const btnRecord = document.getElementById("btnRecord");
        const btnStopRecord = document.getElementById("btnStopRecord");
        const btnScreenshot = document.getElementById("btnScreenshot");
        const btnDownload = document.getElementById("btnDownload");
        const filtersContainer = document.getElementById("filtersContainer");
        const filterButtons = document.querySelectorAll(".filter-btn");

        const recBadge = document.getElementById("recBadge");
        const recTimer = document.getElementById("recTimer");
        const toast = document.getElementById("toast");
        const bgMusic = document.getElementById("bgMusic");

        bgMusic.addEventListener("ended", () => {
            if (isRecording) {
                stopRecording();
                showToast("Rekaman 15 detik selesai");
            }
        });

        let handLandmarker = null;
        let webcamRunning = false;
        let lastVideoTime = -1;
        let results = null;
        let rafId = null;
        let activeFilter = "none";
        let frozenFrame = null;
        let detectedGesture = "none";
        let autoCaptureStartTime = 0;
        let autoCaptureTriggered = false;

        // Filter button click listeners
        filterButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                filterButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                activeFilter = btn.dataset.filter;
                showToast(`Filter: ${btn.textContent.trim().split(" ")[1] || btn.textContent.trim()}`);
            });
        });

        // Recording state
        let mediaRecorder = null;
        let recordedChunks = [];
        let recordStartTime = 0;
        let recordInterval = null;
        let isRecording = false;
        let recordedVideoUrl = null;

        // ── Toast ────────────────────────────────────────────────────────
        let toastTimeout = null;
        function showToast(msg) {
            if (toastTimeout) {
                clearTimeout(toastTimeout);
            }
            toast.textContent = msg;
            toast.classList.add("show");
            toastTimeout = setTimeout(() => toast.classList.remove("show"), 4500);
        }

        // ── Init MediaPipe ───────────────────────────────────────────────
        async function initModel() {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
                );
                handLandmarker = await HandLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "./hand_landmarker.task",
                        delegate: "CPU"
                    },
                    runningMode: "VIDEO",
                    numHands: 2,
                    minHandDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                hideLoader();
                showToast("Model berhasil dimuat");
            } catch (e) {
                console.warn("Local model failed, trying CDN...", e);
                try {
                    const vision = await FilesetResolver.forVisionTasks(
                        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
                    );
                    handLandmarker = await HandLandmarker.createFromOptions(vision, {
                        baseOptions: {
                            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                            delegate: "CPU"
                        },
                        runningMode: "VIDEO",
                        numHands: 2,
                        minHandDetectionConfidence: 0.5,
                        minTrackingConfidence: 0.5
                    });
                    hideLoader();
                    showToast("Model dimuat dari CDN");
                } catch (e2) {
                    loaderText.textContent = "Gagal memuat model. Periksa koneksi internet.";
                    loaderText.style.color = "var(--accent)";
                }
            }
        }

        function hideLoader() {
            loaderOverlay.style.opacity = "0";
            setTimeout(() => loaderOverlay.style.display = "none", 300);
            btnStart.removeAttribute("disabled");
        }

        initModel();

        // ── Gesture Detection ────────────────────────────────────────────
        function fingerUp(tip, pip, lm) {
            return lm[tip].y < lm[pip].y;
        }

        function isPeace(lm) {
            return fingerUp(8, 6, lm) && fingerUp(12, 10, lm)
                && !fingerUp(16, 14, lm) && !fingerUp(20, 18, lm);
        }



        // 🖐️ Open Palm: all 4 fingers up + thumb extended
        function isOpenPalm(lm) {
            const thumbOut = lm[4].y < lm[3].y;
            return thumbOut && fingerUp(8, 6, lm) && fingerUp(12, 10, lm)
                && fingerUp(16, 14, lm) && fingerUp(20, 18, lm);
        }

        // 🤟 Rock Sign: thumb + index + pinky up, middle + ring down
        function isRock(lm) {
            const thumbOut = lm[4].y < lm[3].y;
            return thumbOut && fingerUp(8, 6, lm) && !fingerUp(12, 10, lm)
                && !fingerUp(16, 14, lm) && fingerUp(20, 18, lm);
        }

        // 🤙 Shaka / Call Me: thumb + pinky up, index + middle + ring down
        function isShaka(lm) {
            const thumbOut = lm[4].y < lm[3].y;
            return thumbOut && !fingerUp(8, 6, lm) && !fingerUp(12, 10, lm)
                && !fingerUp(16, 14, lm) && fingerUp(20, 18, lm);
        }

        // ── Camera Toggle ────────────────────────────────────────────────
        btnStart.addEventListener("click", async () => {
            if (!handLandmarker) return;

            if (webcamRunning) {
                webcamRunning = false;
                video.srcObject?.getTracks().forEach(t => t.stop());
                cancelAnimationFrame(rafId);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                btnStart.textContent = 'Mulai Kamera';
                btnRecord.style.display = "none";
                btnStopRecord.style.display = "none";
                btnScreenshot.style.display = "none";
                btnDownload.style.display = "none";
                filtersContainer.style.display = "none";
                if (isRecording) stopRecording();
                showToast("Kamera dihentikan");
            } else {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
                        audio: false
                    });
                    video.srcObject = stream;
                    video.addEventListener("loadedmetadata", () => {
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        webcamRunning = true;
                        lastVideoTime = -1;
                        btnStart.textContent = 'Stop Kamera';
                        btnRecord.style.display = "inline-flex";
                        btnScreenshot.style.display = "inline-flex";
                        filtersContainer.style.display = "flex";
                        rafId = requestAnimationFrame(processFrame);
                        showToast("Kamera aktif");
                    });
                } catch (err) {
                    showToast("Gagal mengakses kamera");
                }
            }
        });

        // ── Frame Processing Loop ────────────────────────────────────────
        function processFrame() {
            if (!webcamRunning) return;

            const now = performance.now();

            // Detect hands
            try {
                if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
                    lastVideoTime = video.currentTime;
                    results = handLandmarker.detectForVideo(video, now);
                }
            } catch (err) {
                console.error("Detection error:", err);
            }

            // Detect gestures (priority order)
            let gesture = "none";
            if (results?.landmarks) {
                for (const lm of results.landmarks) {
                    if (isPeace(lm)) { gesture = "peace"; break; }

                    if (isRock(lm)) { gesture = "rock"; break; }
                    if (isOpenPalm(lm)) { gesture = "palm"; break; }
                    if (isShaka(lm)) { gesture = "shaka"; break; }
                }
            }

            // Auto Capture Timer for Peace Gesture
            if (gesture === "peace") {
                if (autoCaptureStartTime === 0) {
                    autoCaptureStartTime = now;
                    autoCaptureTriggered = false;
                } else if (!autoCaptureTriggered && (now - autoCaptureStartTime > 2500)) {
                    autoCaptureTriggered = true;
                    showToast("📸 Auto-Capture!");
                    btnScreenshot.click();
                }
            } else {
                autoCaptureStartTime = 0;
                autoCaptureTriggered = false;
            }

            // Show toast on gesture change
            if (gesture !== detectedGesture) {
                detectedGesture = gesture;
                const gestureNames = {
                    peace: "✌️ Peace → Blur & Auto-Capture",

                    palm: "🖐️ Open Palm → Freeze",
                    rock: "🤟 Rock → Glitch",
                    shaka: "🤙 Shaka → Cinematic Vignette"
                };
                if (gestureNames[gesture]) showToast(gestureNames[gesture]);
            }

            // ── Freeze Frame: save current frame and keep showing it ──
            if (gesture === "palm") {
                if (!frozenFrame) {
                    // Capture the current frame once
                    ctx.save();
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1);
                    ctx.filter = "none";
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                    frozenFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);
                }
                // Keep drawing the frozen frame
                ctx.putImageData(frozenFrame, 0, 0);

                // Draw "FROZEN" label
                ctx.save();
                ctx.font = "bold 18px Inter";
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.textAlign = "center";
                ctx.fillText("⏸ FROZEN", canvas.width / 2, 36);
                ctx.restore();

                rafId = requestAnimationFrame(processFrame);
                return; // Skip all other rendering
            } else {
                frozenFrame = null;
            }

            // Draw frame
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);

            // Compute CSS filters dynamically
            let filterString = "none";
            if (activeFilter === "warm") {
                filterString = "brightness(1.05) contrast(0.96) sepia(0.2) saturate(1.15)";
            } else if (activeFilter === "vintage") {
                filterString = "sepia(0.35) contrast(0.88) brightness(1.04) saturate(0.85)";
            } else if (activeFilter === "cool") {
                filterString = "hue-rotate(-12deg) saturate(1.1) contrast(1.03)";
            } else if (activeFilter === "mono") {
                filterString = "grayscale(1) contrast(1.12) brightness(0.94)";
            } else if (activeFilter === "sakura") {
                filterString = "brightness(1.08) contrast(0.95) saturate(1.12)";
            } else if (activeFilter === "aden") {
                filterString = "brightness(1.1) contrast(0.9) saturate(0.85) hue-rotate(-10deg)";
            } else if (activeFilter === "lark") {
                filterString = "brightness(1.08) contrast(1.05) saturate(1.25)";
            } else if (activeFilter === "cyber") {
                filterString = "brightness(1.0) contrast(1.1) saturate(1.2) hue-rotate(15deg)";
            }

            // ✌️ Peace → Blur
            if (gesture === "peace") {
                if (filterString === "none") {
                    filterString = "blur(25px)";
                } else {
                    filterString += " blur(25px)";
                }
            }

            ctx.filter = filterString;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Reset filter for custom overlays
            ctx.filter = "none";

            // Apply professional color blend overlays for cute filters
            if (activeFilter === "sakura") {
                ctx.fillStyle = "rgba(255, 174, 185, 0.13)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else if (activeFilter === "aden") {
                ctx.globalCompositeOperation = "soft-light";
                ctx.fillStyle = "rgba(230, 190, 255, 0.25)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-over";
            } else if (activeFilter === "lark") {
                ctx.globalCompositeOperation = "soft-light";
                ctx.fillStyle = "rgba(240, 255, 200, 0.18)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-over";
            } else if (activeFilter === "cyber") {
                ctx.globalCompositeOperation = "overlay";
                ctx.fillStyle = "rgba(139, 92, 246, 0.15)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-over";
            } else if (activeFilter === "warm") {
                ctx.globalCompositeOperation = "soft-light";
                ctx.fillStyle = "rgba(255, 180, 100, 0.2)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-over";
            }

            ctx.restore();

            // ── Post-processing gesture effects (after ctx.restore) ──


            // 🤟 Rock → Glitch / RGB Split
            if (gesture === "rock") {
                const shift = 8 + Math.floor(Math.random() * 6);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const copy = new Uint8ClampedArray(imgData.data);
                const w = canvas.width, h = canvas.height;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = (y * w + x) * 4;
                        // Shift red channel to the right
                        const srcR = (y * w + Math.min(x + shift, w - 1)) * 4;
                        imgData.data[i] = copy[srcR];
                        // Shift blue channel to the left
                        const srcB = (y * w + Math.max(x - shift, 0)) * 4;
                        imgData.data[i + 2] = copy[srcB + 2];
                    }
                }
                ctx.putImageData(imgData, 0, 0);

                // Random scanlines for extra glitch feel
                if (Math.random() > 0.5) {
                    const sliceY = Math.floor(Math.random() * h);
                    const sliceH = 2 + Math.floor(Math.random() * 8);
                    const sliceShift = -20 + Math.floor(Math.random() * 40);
                    const slice = ctx.getImageData(0, sliceY, w, sliceH);
                    ctx.putImageData(slice, sliceShift, sliceY);
                }
            }

            // 🤙 Shaka → Cinematic Vignette & Grayscale
            if (gesture === "shaka") {
                // Apply grayscale with contrast boost
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const d = imgData.data;
                for (let i = 0; i < d.length; i += 4) {
                    const avg = (d[i] + d[i+1] + d[i+2]) / 3;
                    const contrast = ((avg / 255) - 0.5) * 1.5 + 0.5;
                    const val = Math.max(0, Math.min(255, contrast * 255));
                    d[i] = val;
                    d[i+1] = val;
                    d[i+2] = val;
                }
                ctx.putImageData(imgData, 0, 0);

                // Draw heavy cinematic vignette
                ctx.save();
                const gradient = ctx.createRadialGradient(
                    canvas.width / 2, canvas.height / 2, canvas.height / 3,
                    canvas.width / 2, canvas.height / 2, canvas.width / 1.2
                );
                gradient.addColorStop(0, "rgba(0,0,0,0)");
                gradient.addColorStop(1, "rgba(0,0,0,0.85)");
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
            }

            rafId = requestAnimationFrame(processFrame);
        }

        // ── Capture ──────────────────────────────────────────────────────
        btnScreenshot.addEventListener("click", () => {
            if (!webcamRunning) return;
            canvas.style.opacity = "0.3";
            setTimeout(() => canvas.style.opacity = "1", 100);

            const link = document.createElement("a");
            const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
            link.href = canvas.toDataURL("image/png");
            link.download = `capture_${ts}.png`;
            link.click();
            showToast("Capture disimpan");
        });

        // ── Countdown function before recording ──────────────────────────
        const countdownOverlay = document.getElementById("countdownOverlay");
        const countdownNumber = document.getElementById("countdownNumber");

        function runCountdown(callback) {
            let count = 3;
            countdownOverlay.style.display = "flex";
            countdownNumber.textContent = count;

            function triggerTick() {
                countdownNumber.classList.remove("tick-animation");
                void countdownNumber.offsetWidth; // Force reflow
                countdownNumber.classList.add("tick-animation");
            }

            triggerTick();

            const timer = setInterval(() => {
                count--;
                if (count > 0) {
                    countdownNumber.textContent = count;
                    triggerTick();
                } else {
                    clearInterval(timer);
                    countdownOverlay.style.display = "none";
                    callback();
                }
            }, 1000);
        }

        // ── Recording ────────────────────────────────────────────────────
        btnRecord.addEventListener("click", () => {
            if (!webcamRunning) return;

            // Disable buttons during countdown
            btnStart.disabled = true;
            btnScreenshot.disabled = true;
            btnRecord.disabled = true;

            runCountdown(() => {
                recordedChunks = [];
                
                // Play music immediately after countdown
                bgMusic.currentTime = 0;
                bgMusic.play().catch(e => console.log("Music play blocked", e));

                const stream = canvas.captureStream(30);
                let opts = { mimeType: "video/webm;codecs=vp9" };
                if (!MediaRecorder.isTypeSupported(opts.mimeType)) {
                    opts = { mimeType: "video/webm;codecs=vp8" };
                    if (!MediaRecorder.isTypeSupported(opts.mimeType)) {
                        opts = { mimeType: "video/webm" };
                    }
                }

                try {
                    mediaRecorder = new MediaRecorder(stream, opts);
                } catch (e) {
                    showToast("Recording tidak didukung browser ini");
                    btnStart.disabled = false;
                    btnScreenshot.disabled = false;
                    btnRecord.disabled = false;
                    return;
                }

                mediaRecorder.ondataavailable = e => {
                    if (e.data?.size > 0) recordedChunks.push(e.data);
                };

                mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunks, { type: "video/webm" });
                    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
                    recordedVideoUrl = URL.createObjectURL(blob);
                    btnDownload.style.display = "inline-flex";

                    // Re-enable buttons after stop
                    btnStart.disabled = false;
                    btnScreenshot.disabled = false;
                    btnRecord.disabled = false;
                    showToast("Rekaman selesai");
                };

                mediaRecorder.start();
                isRecording = true;
                recordStartTime = Date.now();

                btnRecord.style.display = "none";
                btnStopRecord.style.display = "inline-flex";
                btnDownload.style.display = "none";
                recBadge.style.display = "flex";

                tickTimer();
                recordInterval = setInterval(tickTimer, 1000);
                showToast("Merekam...");
            });
        });

        function tickTimer() {
            const s = Math.floor((Date.now() - recordStartTime) / 1000);
            recTimer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        }

        function stopRecording() {
            if (!isRecording) return;
            
            bgMusic.pause();
            bgMusic.currentTime = 0;
            
            mediaRecorder.stop();
            isRecording = false;
            clearInterval(recordInterval);
            recBadge.style.display = "none";
            btnStopRecord.style.display = "none";
            btnRecord.style.display = "inline-flex";
        }

        btnStopRecord.addEventListener("click", stopRecording);

        btnDownload.addEventListener("click", () => {
            if (!recordedVideoUrl) return;
            const link = document.createElement("a");
            const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
            link.href = recordedVideoUrl;
            link.download = `recording_${ts}.webm`;
            link.click();
            showToast("Video diunduh");
        });