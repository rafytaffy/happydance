/**
 * app.js is the orchestrator of the Happy Dance Silhouette Visualizer.
 * It manages camera streams, starts the audio engine on user interaction,
 * coordinates the render loop, and handles settings UI bindings.
 */

document.addEventListener('DOMContentLoaded', () => {
  const webcam = document.getElementById('webcam');
  const canvas = document.getElementById('renderCanvas');
  const startBtn = document.getElementById('startBtn');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const cameraSelect = document.getElementById('cameraSelect');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const paletteSelect = document.getElementById('paletteSelect');
  const volumeSlider = document.getElementById('volumeSlider');
  const clapSensitivitySlider = document.getElementById('clapSensitivitySlider');
  const screamSensitivitySlider = document.getElementById('screamSensitivitySlider');
  const audioFill = document.getElementById('audioFill');
  const micStatus = document.getElementById('micStatus');
  const debugToggle = document.getElementById('debugToggle');
  const debugPanel = document.getElementById('debugPanel');
  const videoDebugCanvas = document.getElementById('videoDebugCanvas');
  const maskDebugCanvas = document.getElementById('maskDebugCanvas');
  const fpsHud = document.getElementById('fpsHud');
  const latencyHud = document.getElementById('latencyHud');
  const soundAlert = document.getElementById('soundAlert');
  const alertText = document.getElementById('alertText');

  // Engines
  let segmentationEngine = null;
  let physicsEngine = null;
  let audioEngine = null;

  // State
  let stream = null;
  let animationFrameId = null;
  let processingFrame = false;
  let lastTime = performance.now();
  let frameCount = 0;
  let fps = 60;
  let latency = 0;
  let isCameraActive = false;

  // Debug offscreen context
  const videoDebugCtx = videoDebugCanvas.getContext('2d');

  // Initialize UI controls
  function initUI() {
    // Settings Toggle
    settingsToggle.addEventListener('click', () => {
      settingsPanel.classList.toggle('hidden');
    });

    // Close panel if clicked outside on canvas
    canvas.addEventListener('click', () => {
      if (!settingsPanel.classList.contains('hidden')) {
        settingsPanel.classList.add('hidden');
      }
    });

    // Mode selection
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        physicsEngine.setMode(mode);
      });
    });

    // Palette change
    paletteSelect.addEventListener('change', (e) => {
      physicsEngine.setPalette(e.target.value);
    });

    // Debug View
    debugToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        debugPanel.style.display = 'flex';
      } else {
        debugPanel.style.display = 'none';
      }
    });

    // Audio Sliders
    clapSensitivitySlider.addEventListener('input', (e) => {
      if (audioEngine) audioEngine.setClapSensitivity(Number(e.target.value));
    });

    screamSensitivitySlider.addEventListener('input', (e) => {
      if (audioEngine) audioEngine.setScreamSensitivity(Number(e.target.value));
    });

    // Camera Switcher
    cameraSelect.addEventListener('change', (e) => {
      startCamera(e.target.value);
    });
  }

  // Enumerate cameras
  async function loadCameraDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      
      cameraSelect.innerHTML = '';
      
      if (videoDevices.length === 0) {
        const opt = document.createElement('option');
        opt.text = "No cameras found";
        cameraSelect.add(opt);
        return;
      }

      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        // Clean up label or make a default
        option.text = device.label || `Camera ${index + 1} (${device.deviceId.slice(0, 5)}...)`;
        cameraSelect.add(option);
      });
      
      // Select the first device
      cameraSelect.value = videoDevices[0].deviceId;
    } catch (err) {
      console.error("Error listing cameras:", err);
    }
  }

  // Start Camera Stream
  async function startCamera(deviceId = null) {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 }
      }
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      webcam.srcObject = stream;
      await new Promise((resolve) => {
        webcam.onloadedmetadata = () => {
          webcam.play();
          resolve();
        };
      });

      isCameraActive = true;
      console.log("Webcam started successfully!");
      
      // Update camera labels if they were blank (permission now granted)
      const currentDevices = Array.from(cameraSelect.options);
      if (currentDevices.length > 0 && currentDevices[0].text.startsWith('Camera')) {
        await loadCameraDevices();
        if (deviceId) {
          cameraSelect.value = deviceId;
        }
      }
    } catch (err) {
      alert("Could not access camera. Please check camera permissions in your settings.");
      console.error("Camera access error:", err);
    }
  }

  // Trigger brief alert on claps/screams
  function showSoundAlert(text) {
    alertText.innerText = text;
    soundAlert.classList.add('show');
    setTimeout(() => {
      soundAlert.classList.remove('show');
    }, 1200);
  }

  // App initialization flow (Triggered by user gesture)
  async function startApp() {
    startBtn.innerHTML = '<span class="loader"></span> Loading...';
    startBtn.disabled = true;

    try {
      // 1. Initialise Web Audio API
      audioEngine = new AudioEngine();
      await audioEngine.start();
      
      // Configure audio sensitivity values from UI
      audioEngine.setClapSensitivity(Number(clapSensitivitySlider.value));
      audioEngine.setScreamSensitivity(Number(screamSensitivitySlider.value));
      
      micStatus.classList.add('active');

      // Bind Audio events to visual explosions
      audioEngine.onClapCallback = () => {
        physicsEngine.triggerClapFirework();
        showSoundAlert("👏 CLAP DETECTED! 🎆");
      };

      audioEngine.onScreamCallback = () => {
        physicsEngine.triggerScreamShow();
        showSoundAlert("😮 scream detected! 💥");
      };

      audioEngine.onVolumeChangeCallback = (rms) => {
        // Update volume bar HUD
        const pct = Math.min(100, rms * 350);
        audioFill.style.width = `${pct}%`;
      };

      // 2. Start Camera Feed
      await startCamera(cameraSelect.value);

      // 3. Initialize Segmentation Engine
      segmentationEngine = new SegmentationEngine({
        modelSelection: 1, // Landscape (faster, ideal for iPad & webcam)
        mirror: true
      });
      await segmentationEngine.init();

      // 4. Initialize Visual/Physics Canvas Engine
      physicsEngine = new PhysicsEngine(canvas);
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      // 5. Hide splash screen
      welcomeScreen.classList.add('hidden');

      // 6. Start processing loops
      startLoops();

    } catch (err) {
      alert("App startup failed. Make sure camera and microphone permissions are granted.");
      console.error(err);
      startBtn.innerHTML = 'Try Again';
      startBtn.disabled = false;
    }
  }

  // Keep Canvas full screen
  function resizeCanvas() {
    if (physicsEngine) {
      physicsEngine.resize(window.innerWidth, window.innerHeight);
    }
  }

  // Start concurrent logic loops
  function startLoops() {
    // Loop 1: Camera Processing Loop (asynchronously feeds MediaPipe)
    async function processCamera() {
      if (isCameraActive && webcam.readyState >= 2 && !processingFrame) {
        processingFrame = true;
        const start = performance.now();
        
        await segmentationEngine.sendFrame(webcam);
        
        latency = Math.round(performance.now() - start);
        processingFrame = false;
      }
      setTimeout(processCamera, 1000 / 30); // Cap camera processing at 30 FPS to conserve CPU
    }
    processCamera();

    // Loop 2: Render Loop (runs at full screen refresh rate e.g. 60 FPS)
    function render(time) {
      // Update FPS counter
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        fps = Math.round((frameCount * 1000) / (now - lastTime));
        fpsHud.innerText = `FPS: ${fps}`;
        latencyHud.innerText = `Latency: ${latency}ms`;
        frameCount = 0;
        lastTime = now;
      }

      // Update microphone analysers
      if (audioEngine) {
        audioEngine.update();
      }

      // Physics logic and canvas drawing
      if (physicsEngine && segmentationEngine) {
        physicsEngine.update(segmentationEngine, time);
        physicsEngine.draw();

        // Render debug overlays if active
        if (debugToggle.checked) {
          drawDebugCanvases();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    }
    animationFrameId = requestAnimationFrame(render);
  }

  // Draw small debug canvas inputs in bottom-left corner
  function drawDebugCanvases() {
    // 1. Raw camera feed (mirrored)
    videoDebugCtx.save();
    videoDebugCtx.translate(videoDebugCanvas.width, 0);
    videoDebugCtx.scale(-1, 1);
    videoDebugCtx.drawImage(webcam, 0, 0, videoDebugCanvas.width, videoDebugCanvas.height);
    videoDebugCtx.restore();

    // 2. Downsampled segmentation mask (already mirrored in segmentation.js)
    if (segmentationEngine && segmentationEngine.maskData) {
      const maskCtx = maskDebugCanvas.getContext('2d');
      // Create image data object and copy the mask bytes
      const imgData = maskCtx.createImageData(maskDebugCanvas.width, maskDebugCanvas.height);
      imgData.data.set(segmentationEngine.maskData);
      maskCtx.putImageData(imgData, 0, 0);
    }
  }

  // Set up camera list immediately
  navigator.mediaDevices.getUserMedia({ video: true })
    .then(async (testStream) => {
      // Granted! Release stream and populate list
      testStream.getTracks().forEach(t => t.stop());
      await loadCameraDevices();
    })
    .catch(err => {
      console.warn("Initial camera permissions check rejected:", err);
      loadCameraDevices(); // Populate defaults anyway
    });

  // Wire buttons
  startBtn.addEventListener('click', startApp);
  initUI();
});
