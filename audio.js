/**
 * audio.js handles microphone capture, Web Audio API analysis,
 * and real-time detection of claps and screams/yells.
 */

class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.dataArray = null;
    
    // State
    this.isMuted = false;
    this.isActive = false;
    
    // Callbacks
    this.onClapCallback = null;
    this.onScreamCallback = null;
    this.onVolumeChangeCallback = null; // For HUD bars

    // Detection Parameters (configurable)
    this.clapSensitivity = 5.0; // Crest factor multiplier
    this.screamThreshold = 0.28; // RMS level for screaming
    
    // History buffers for dynamic noise floor estimation
    this.historyLength = 90; // ~1.5 seconds at 60fps
    this.rmsHistory = [];
    this.lastClapTime = 0;
    this.lastScreamTime = 0;

    // Scream state tracking
    this.screamFrameCount = 0;
    this.screamRequiredFrames = 15; // Must scream for at least ~250ms
  }

  async start() {
    try {
      // AudioContext compatibility
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Web Audio API is not supported in this browser.");
      }

      this.audioContext = new AudioCtx();
      
      // Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false, // Turn off changes that filter out claps
          noiseSuppression: false, 
          autoGainControl: false 
        }
      });

      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      
      // Fast Fourier Transform size
      this.analyser.fftSize = 512;
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      this.microphone.connect(this.analyser);
      this.isActive = true;
      
      // Reset buffers
      this.rmsHistory = Array(this.historyLength).fill(0.01);
      
      // Resume AudioContext if suspended (browser security policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log("Audio Engine started successfully!");
      return true;
    } catch (err) {
      console.warn("Could not start Audio Engine: ", err.message);
      this.isActive = false;
      throw err;
    }
  }

  stop() {
    if (this.microphone && this.microphone.mediaStream) {
      this.microphone.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.isActive = false;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  setClapSensitivity(value) {
    // Sliders: map 1-10 to sensitive values
    // Lower slider value = less sensitive (requires higher spike factor)
    // Map 1-10 to crest factors 8.0 down to 2.5
    this.clapSensitivity = 8.5 - (value * 0.6);
  }

  setScreamSensitivity(value) {
    // Slider: map 1-10 to RMS threshold levels 0.50 down to 0.12
    this.screamThreshold = 0.55 - (value * 0.043);
  }

  update() {
    if (!this.isActive || this.isMuted || !this.analyser) return 0;

    this.analyser.getByteTimeDomainData(this.dataArray);
    
    // 1. Calculate RMS Volume (Root Mean Square)
    let sum = 0;
    const len = this.dataArray.length;
    for (let i = 0; i < len; i++) {
      const val = (this.dataArray[i] - 128) / 128; // Normalize to -1.0 to 1.0
      sum += val * val;
    }
    const rms = Math.sqrt(sum / len);

    // 2. Manage Volume History
    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > this.historyLength) {
      this.rmsHistory.shift();
    }

    // Calculate dynamic average noise floor
    let historySum = 0;
    for (const hVal of this.rmsHistory) {
      historySum += hVal;
    }
    const avgRms = historySum / this.rmsHistory.length;

    // Trigger visual callback for overlay HUD
    if (this.onVolumeChangeCallback) {
      this.onVolumeChangeCallback(rms);
    }

    const now = Date.now();

    // 3. Clap Detection
    // Conditions:
    // A. Sudden spike: current RMS is much larger than average history.
    // B. Minimum amplitude threshold (ignore silent clicks).
    // C. Debounced (must be at least 350ms since last clap).
    const isSpike = rms > avgRms * this.clapSensitivity;
    const isBigEnough = rms > 0.08;
    const isDebouncedClap = (now - this.lastClapTime) > 350;

    if (isSpike && isBigEnough && isDebouncedClap) {
      this.lastClapTime = now;
      console.log("CLAP DETECTED! Volume:", rms.toFixed(3), "Baseline:", avgRms.toFixed(3));
      
      // Flush history to prevent double triggers in immediate frames
      this.rmsHistory.fill(rms * 0.8);
      
      if (this.onClapCallback) {
        this.onClapCallback();
      }
      return rms;
    }

    // 4. Scream/Yell Detection
    // Conditions:
    // A. RMS exceeds scream threshold continuously for N frames.
    // B. Debounced (at least 1.8 seconds since last scream sequence).
    if (rms > this.screamThreshold) {
      this.screamFrameCount++;
      const isDebouncedScream = (now - this.lastScreamTime) > 1800;

      if (this.screamFrameCount >= this.screamRequiredFrames && isDebouncedScream) {
        this.lastScreamTime = now;
        this.screamFrameCount = 0;
        console.log("SCREAM DETECTED! Volume:", rms.toFixed(3));
        
        if (this.onScreamCallback) {
          this.onScreamCallback();
        }
      }
    } else {
      // Decay frame count if sound drops
      this.screamFrameCount = Math.max(0, this.screamFrameCount - 1);
    }

    return rms;
  }
}

window.AudioEngine = AudioEngine;
