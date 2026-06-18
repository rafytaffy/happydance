/**
 * SegmentationEngine handles MediaPipe Selfie Segmentation,
 * downsamples the output mask, and performs connected-component
 * blob analysis to identify individual people and estimate their depth.
 */

class BlobAnalyzer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.parent = new Int32Array(width * height);
    this.blobMap = new Map(); // Cache of last analyzed blobs
  }

  find(i) {
    let root = i;
    while (this.parent[root] >= 0) {
      root = this.parent[root];
    }
    let curr = i;
    while (curr !== root) {
      let next = this.parent[curr];
      this.parent[curr] = root;
      curr = next;
    }
    return root;
  }

  union(i, j) {
    let rootI = this.find(i);
    let rootJ = this.find(j);
    if (rootI !== rootJ) {
      let sizeI = -this.parent[rootI];
      let sizeJ = -this.parent[rootJ];
      if (sizeI < sizeJ) {
        this.parent[rootI] = rootJ;
        this.parent[rootJ] = -(sizeI + sizeJ);
      } else {
        this.parent[rootJ] = rootI;
        this.parent[rootI] = -(sizeI + sizeJ);
      }
    }
  }

  analyze(maskData, threshold = 120) {
    const w = this.width;
    const h = this.height;

    // Reset parents
    for (let i = 0; i < w * h; i++) {
      // In SelfieSegmentation mask, the person is in the alpha channel or RGB channels
      // Usually red channel is easiest
      if (maskData[i * 4] > threshold) {
        this.parent[i] = -1; // Active, size 1
      } else {
        this.parent[i] = -2; // Background
      }
    }

    // Pass 1: Union adjacent active pixels (4-way connectivity)
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const idx = rowOffset + x;
        if (this.parent[idx] === -2) continue;

        // Check right
        if (x + 1 < w && this.parent[idx + 1] !== -2) {
          this.union(idx, idx + 1);
        }
        // Check down
        if (y + 1 < h && this.parent[idx + w] !== -2) {
          this.union(idx, idx + w);
        }
      }
    }

    // Pass 2: Group by root
    const blobs = new Map();
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const idx = rowOffset + x;
        if (this.parent[idx] === -2) continue;

        const root = this.find(idx);
        let blob = blobs.get(root);
        if (!blob) {
          blob = {
            id: root,
            minX: x,
            maxX: x,
            minY: y,
            maxY: y,
            sumX: 0,
            sumY: 0,
            area: 0,
            points: []
          };
          blobs.set(root, blob);
        }

        blob.minX = Math.min(blob.minX, x);
        blob.maxX = Math.max(blob.maxX, x);
        blob.minY = Math.min(blob.minY, y);
        blob.maxY = Math.max(blob.maxY, y);
        blob.sumX += x;
        blob.sumY += y;
        blob.area++;
      }
    }

    // Filter noise, calculate centers, and estimate depths
    const minArea = 12; // ignore small spots
    const filteredBlobs = [];
    this.blobMap.clear();

    for (const [root, blob] of blobs.entries()) {
      if (blob.area >= minArea) {
        blob.centerX = blob.sumX / blob.area;
        blob.centerY = blob.sumY / blob.area;

        // Depth calculation:
        // A single person filling the screen area (normalized) -> areaRatio close to 0.4
        // A person far away -> areaRatio close to 0.01
        const areaRatio = blob.area / (w * h);
        
        // Depth is mapped from 0.0 (very close) to 1.0 (very far)
        // Adjust formula coefficients to suit typical webcams
        // Using an inverse scale so larger area = smaller distance
        const rawDepth = 1.0 - Math.min(1.0, Math.sqrt(areaRatio * 6.5));
        blob.depth = Math.max(0.0, Math.min(1.0, rawDepth));

        filteredBlobs.push(blob);
        this.blobMap.set(root, blob);
      }
    }

    return filteredBlobs;
  }

  getBlobForPixelIndex(idx) {
    if (this.parent[idx] === -2) return null;
    const root = this.find(idx);
    return this.blobMap.get(root) || null;
  }
}

class SegmentationEngine {
  constructor(options = {}) {
    this.modelSelection = options.modelSelection !== undefined ? options.modelSelection : 1; // Default 1 (Landscape, faster)
    this.maskWidth = 160;
    this.maskHeight = 120;

    // Canvas elements for downsampling
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    this.offscreenCanvas.width = this.maskWidth;
    this.offscreenCanvas.height = this.maskHeight;

    // Mirroring setting
    this.mirror = options.mirror !== undefined ? options.mirror : true;

    // Blob analysis
    this.blobAnalyzer = new BlobAnalyzer(this.maskWidth, this.maskHeight);
    
    // State
    this.activeBlobs = [];
    this.maskData = null; // Uint8ClampedArray of mask pixels
    this.isLoaded = false;
    this.selfieSegmentation = null;
    this.onResultsCallback = null;

    // Smooth depth values per blob ID across frames
    this.smoothedDepths = new Map();
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        if (typeof SelfieSegmentation === 'undefined') {
          reject(new Error("MediaPipe SelfieSegmentation script not loaded. Make sure the script tag is present."));
          return;
        }

        this.selfieSegmentation = new SelfieSegmentation({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
          }
        });

        this.selfieSegmentation.setOptions({
          modelSelection: this.modelSelection
        });

        this.selfieSegmentation.onResults((results) => {
          this.processResults(results);
          if (this.onResultsCallback) {
            this.onResultsCallback(results);
          }
        });

        this.isLoaded = true;
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  setModelSelection(modelIndex) {
    this.modelSelection = modelIndex;
    if (this.selfieSegmentation) {
      this.selfieSegmentation.setOptions({
        modelSelection: modelIndex
      });
    }
  }

  setOnResults(callback) {
    this.onResultsCallback = callback;
  }

  async sendFrame(videoElement) {
    if (!this.isLoaded || !this.selfieSegmentation) return;
    await this.selfieSegmentation.send({ image: videoElement });
  }

  processResults(results) {
    const ctx = this.offscreenCtx;
    const w = this.maskWidth;
    const h = this.maskHeight;

    ctx.clearRect(0, 0, w, h);

    if (results.segmentationMask) {
      ctx.save();
      if (this.mirror) {
        // Mirror the segmentation mask so it matches the mirrored video view
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(results.segmentationMask, 0, 0, w, h);
      ctx.restore();

      const imgData = ctx.getImageData(0, 0, w, h);
      this.maskData = imgData.data;

      // Extract blobs
      const rawBlobs = this.blobAnalyzer.analyze(this.maskData);

      // Smooth blob depths to avoid color jitter
      // We will match current blobs with previous blobs by position/proximity
      this.activeBlobs = this.matchAndSmoothBlobs(rawBlobs);
    } else {
      this.maskData = null;
      this.activeBlobs = [];
    }
  }

  matchAndSmoothBlobs(newBlobs) {
    const kSmoothFactor = 0.15; // lower is smoother, higher is more responsive
    const nextSmoothedDepths = new Map();

    const smoothed = newBlobs.map(blob => {
      let matchedDepth = blob.depth;
      let closestDist = Infinity;
      let matchedId = null;

      // Find nearest blob from last frame to borrow ID / smoothed depth
      for (const [lastId, lastDepth] of this.smoothedDepths.entries()) {
        // Decode last center coordinate from map key (e.g. "x,y")
        const [lastX, lastY] = lastId.split(',').map(Number);
        const dx = blob.centerX - lastX;
        const dy = blob.centerY - lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If centers are close (within 25% of mask size), match them
        if (dist < 40 && dist < closestDist) {
          closestDist = dist;
          matchedDepth = lastDepth;
          matchedId = lastId;
        }
      }

      // Smooth current depth with historical depth
      const smoothedDepth = matchedDepth + kSmoothFactor * (blob.depth - matchedDepth);
      
      // Store in next frames history under the new center coordinate
      const nextKey = `${Math.round(blob.centerX)},${Math.round(blob.centerY)}`;
      nextSmoothedDepths.set(nextKey, smoothedDepth);

      return {
        ...blob,
        depth: smoothedDepth
      };
    });

    this.smoothedDepths = nextSmoothedDepths;
    return smoothed;
  }

  /**
   * Helper to check if a screen coordinate is inside a silhouette
   * @param {number} normX - Normalized X coordinate (0.0 to 1.0)
   * @param {number} normY - Normalized Y coordinate (0.0 to 1.0)
   * @returns {boolean} true if inside silhouette
   */
  isInsideSilhouette(normX, normY) {
    if (!this.maskData) return false;
    
    const mx = Math.max(0, Math.min(this.maskWidth - 1, Math.floor(normX * this.maskWidth)));
    const my = Math.max(0, Math.min(this.maskHeight - 1, Math.floor(normY * this.maskHeight)));
    
    const idx = (my * this.maskWidth + mx) * 4;
    return this.maskData[idx] > 120;
  }

  /**
   * Get blob details for a normalized screen coordinate
   * @param {number} normX - Normalized X (0.0 to 1.0)
   * @param {number} normY - Normalized Y (0.0 to 1.0)
   * @returns {Object|null} Blob object or null
   */
  getBlobAt(normX, normY) {
    if (!this.maskData) return null;

    const mx = Math.max(0, Math.min(this.maskWidth - 1, Math.floor(normX * this.maskWidth)));
    const my = Math.max(0, Math.min(this.maskHeight - 1, Math.floor(normY * this.maskHeight)));
    
    const idx = my * this.maskWidth + mx;
    return this.blobAnalyzer.getBlobForPixelIndex(idx);
  }

  /**
   * Detects the outline/edges of the silhouette in normalized coordinates
   * Useful for physics boundaries
   */
  isEdge(normX, normY) {
    if (!this.maskData) return false;

    const mx = Math.max(1, Math.min(this.maskWidth - 2, Math.floor(normX * this.maskWidth)));
    const my = Math.max(1, Math.min(this.maskHeight - 2, Math.floor(normY * this.maskHeight)));

    const idx = (my * this.maskWidth + mx) * 4;
    const isCenterActive = this.maskData[idx] > 120;
    
    if (!isCenterActive) return false;

    // Check neighbors: if any neighbor is inactive, it's an edge
    const w = this.maskWidth;
    const offsets = [-4, 4, -w*4, w*4];
    for (const offset of offsets) {
      if (this.maskData[idx + offset] <= 120) {
        return true;
      }
    }
    return false;
  }
}
window.SegmentationEngine = SegmentationEngine;
