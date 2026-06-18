/**
 * physics.js contains particle systems and renderers for different interactive modes:
 * 1. Pebble Wall (grid of capsules that scale/color/rotate)
 * 2. Bubble Flow (bubbles spawning inside the silhouette and drifting up)
 * 3. Gravity Sand (physics particles falling and colliding with the silhouette)
 * 
 * It also manages the fireworks particle explosion system.
 */

// Global Color Palettes mapping depth (0 = near/large, 1 = far/small)
const PALETTES = {
  rainbow: (depth, pctY = 0) => {
    // Shift the vertical color stops based on distance (depth)
    // 0 = close (warmer, shifts up), 1 = far (cooler, shifts down)
    const shiftedY = Math.max(0, Math.min(1.0, pctY - (1.0 - depth) * 0.45));
    
    // Smooth interpolation between exact stops matching the physical art:
    // shiftedY = 1.0 (bottom): Solid cyan/blue (hue 195)
    // shiftedY = 0.75 (middle-bottom): Teal/cyan (hue 165)
    // shiftedY = 0.55 (middle): Vibrant Green (hue 115)
    // shiftedY = 0.40 (middle-top): Gold/Yellow (hue 55)
    // shiftedY = 0.22 (top-middle): Orange (hue 28)
    // shiftedY = 0.0 (top): Solid Red (hue 0)
    let hue = 0;
    if (shiftedY < 0.22) {
      hue = (shiftedY / 0.22) * 28;
    } else if (shiftedY < 0.40) {
      hue = 28 + ((shiftedY - 0.22) / 0.18) * 27;
    } else if (shiftedY < 0.55) {
      hue = 55 + ((shiftedY - 0.40) / 0.15) * 60;
    } else if (shiftedY < 0.75) {
      hue = 115 + ((shiftedY - 0.55) / 0.20) * 50;
    } else {
      hue = 165 + ((shiftedY - 0.75) / 0.25) * 30;
    }
    
    return `hsla(${Math.floor(hue)}, 95%, 52%, 1)`;
  },
  neon: (depth, pctY = 0) => {
    const hues = [330, 280, 190, 220]; 
    const idx = Math.floor((depth * 3 + pctY) % hues.length);
    const hue = hues[idx];
    return `hsla(${hue}, 100%, 60%, 1)`;
  },
  sunset: (depth, pctY = 0) => {
    const hue = Math.floor(depth * 60 + 330 + pctY * 30) % 360; 
    return `hsla(${hue}, 100%, 55%, 1)`;
  },
  ocean: (depth, pctY = 0) => {
    const hue = Math.floor(depth * 100 + 150 + pctY * 50); 
    return `hsla(${hue}, 90%, 50%, 1)`;
  }
};

// 1. Pebble Grid Particle
class Pebble {
  constructor(x, y, colWidth, rowHeight) {
    // 1:1 up to 4:1 aspect ratio. Let's make some long/oblong and some round.
    // 35% are elongated (1.5 to 3.8 aspect ratio), 65% are rounder (0.9 to 1.4)
    this.aspectRatio = Math.random() < 0.35 ? (Math.random() * 2.3 + 1.5) : (Math.random() * 0.5 + 0.9);
    
    // Sizing factor
    this.sizeMultiplier = Math.random() * 0.16 + 0.94; // 0.94 to 1.10
    
    // NO position jitter to keep grid spacing perfectly uniform and minimize gaps
    this.jitterX = 0;
    this.jitterY = 0;
    
    this.x = x;
    this.y = y;
    
    // 2x larger grid cell means colWidth is 2x larger.
    // Make baseW slightly larger than cell width to ensure they touch tightly
    this.baseW = colWidth * 1.14; 
    this.w = 0;
    this.h = 0;
    
    // Full 360-degree rotation jitter so elongated stones lie in all organic directions (horizontal, vertical, diagonal)
    this.rotationJitter = Math.random() * Math.PI * 2;
    this.rotation = this.rotationJitter;
    this.targetRotation = this.rotation;
    
    this.scale = 0;
    this.targetScale = 0;
    this.color = 'rgba(0,0,0,0)';
    
    // Float offset
    this.offsetX = 0;
    this.offsetY = 0;
    this.floatSeed = Math.random() * 100;
    this.shake = 0;

    // Precalculate organic asymmetric stone vertices (5 to 7 points)
    // Irregular control points create wavy, natural, non-straight edges
    const numPoints = Math.floor(Math.random() * 3) + 5; // 5 to 7 vertices
    this.points = [];
    const baseR = this.baseW * this.sizeMultiplier / 2;
    const aspectY = this.aspectRatio;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      
      // Radius variance (0.80 to 1.20) creates natural indentations, bumps, and asymmetrical facets
      const r = (Math.random() * 0.40 + 0.80);
      const px = Math.cos(angle) * baseR * r;
      const py = Math.sin(angle) * baseR * aspectY * r;
      this.points.push({ x: px, y: py });
    }
  }

  update(normX, normY, segEngine, currentPalette, time, globalShake) {
    const isGround = normY > 0.82; // Bottom 18% is floor pile
    const isSilhouette = segEngine.isInsideSilhouette(normX, normY);
    
    if (isSilhouette || isGround) {
      let depth = 0.5; // Default for ground
      if (isSilhouette) {
        const blob = segEngine.getBlobAt(normX, normY);
        if (blob) {
          depth = blob.depth;
        }
      } else {
        // Ground depth fades from front to back
        depth = 0.7 - (normY - 0.82) * 2;
      }

      this.targetScale = 1.03; // Nest tightly together
      this.color = PALETTES[currentPalette](depth, normY);
      
      // Floating/organic wave animation
      this.offsetX = Math.sin(time * 0.0022 + this.floatSeed) * 2.2;
      this.offsetY = Math.cos(time * 0.0016 + this.floatSeed) * 2.2;
      
      if (isGround) {
        // Flat/horizontal alignment for floor pebbles
        this.targetRotation = Math.PI / 2 + (Math.random() - 0.5) * 0.15;
      } else if (isSilhouette) {
        // Keeps their random rotated angles to look like a jumble of hand-packed stones
        this.targetRotation = this.rotationJitter;
      }
    } else {
      this.targetScale = 0.0;
      this.offsetX = 0;
      this.offsetY = 0;
    }

    // Smooth scaling and rotation
    this.scale += (this.targetScale - this.scale) * 0.12;
    this.rotation += (this.targetRotation - this.rotation) * 0.08;
    
    // Scale widths and heights according to physical constants
    this.w = this.baseW * this.sizeMultiplier * this.scale;
    this.h = this.baseW * this.sizeMultiplier * this.aspectRatio * this.scale;

    // Handle sound shake
    this.shake = globalShake * (Math.random() - 0.5) * 8;
  }

  draw(ctx) {
    if (this.scale < 0.01) return;

    ctx.save();
    ctx.translate(this.x + this.offsetX + this.shake, this.y + this.offsetY + this.shake);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale, this.scale);

    // Draw solid organic pebble using precalculated irregular path
    ctx.fillStyle = this.color;
    ctx.beginPath();
    const len = this.points.length;
    let xc = (this.points[0].x + this.points[len - 1].x) / 2;
    let yc = (this.points[0].y + this.points[len - 1].y) / 2;
    ctx.moveTo(xc, yc);
    
    for (let i = 0; i < len; i++) {
      const p1 = this.points[i];
      const p2 = this.points[(i + 1) % len];
      xc = (p1.x + p2.x) / 2;
      yc = (p1.y + p2.y) / 2;
      ctx.quadraticCurveTo(p1.x, p1.y, xc, yc);
    }
    ctx.fill();

    // Draw physical thin dark border to separate geometries
    ctx.strokeStyle = 'rgba(5, 5, 8, 0.52)';
    ctx.lineWidth = 1.8 / Math.max(0.1, this.scale);
    ctx.stroke();

    // High premium styling: soft organic reflection glow inside
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    const glowR = this.baseW * 0.25;
    ctx.ellipse(-this.baseW/6, -this.baseW/6, glowR, glowR/1.5, Math.PI/4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// 2. Bubble Particle
class Bubble {
  constructor(canvasWidth, canvasHeight) {
    this.canvasW = canvasWidth;
    this.canvasH = canvasHeight;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.radius = 0;
    this.maxRadius = Math.random() * 14 + 6;
    this.color = '';
    this.opacity = 0;
    this.targetOpacity = 0.8;
    this.life = 0.0;
    this.decay = Math.random() * 0.005 + 0.002;
    
    // Wave drift
    this.driftSeed = Math.random() * 100;
  }

  spawn(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 1.5;
    this.vy = -(Math.random() * 2 + 1); // Float upwards
    this.radius = 1;
    this.color = color;
    this.life = 1.0;
    this.opacity = 0;
  }

  update(segEngine, currentPalette, time) {
    this.x += this.vx;
    this.y += this.vy;

    // Horizontal drift wave
    this.x += Math.sin(time * 0.005 + this.driftSeed) * 0.5;

    // Grow bubble
    this.radius += (this.maxRadius - this.radius) * 0.1;

    // Fade in
    this.opacity += (this.targetOpacity - this.opacity) * 0.1;

    const normX = this.x / this.canvasW;
    const normY = this.y / this.canvasH;

    // Check if still inside silhouette, if not, pop/decay faster
    const isSilhouette = segEngine.isInsideSilhouette(normX, normY);
    if (!isSilhouette && normY < 0.82) {
      this.vy *= 0.95; // Slow down upwards speed
      this.life -= this.decay * 3; // decay much faster outside body
    } else {
      this.life -= this.decay;
    }
  }

  draw(ctx) {
    if (this.life <= 0) return;
    
    ctx.save();
    ctx.globalAlpha = this.life * this.opacity;
    
    // Glowing gradient bubble
    const grad = ctx.createRadialGradient(
      this.x - this.radius * 0.3, this.y - this.radius * 0.3, this.radius * 0.1,
      this.x, this.y, this.radius
    );
    
    // Parse HSL from color string to make transparent highlight versions
    const colorMatch = this.color.match(/hsla\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    let borderCol = this.color;
    if (colorMatch) {
      borderCol = `hsla(${colorMatch[1]}, ${colorMatch[2]}, 85%, 0.8)`;
    }

    grad.addColorStop(0, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.3, this.color);
    grad.addColorStop(1, 'rgba(0,0,0,0.1)');

    ctx.fillStyle = grad;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

// 3. Physical Sand Particle
class Sand {
  constructor(canvasWidth, canvasHeight) {
    this.canvasW = canvasWidth;
    this.canvasH = canvasHeight;
    this.reset();
  }

  reset() {
    this.x = Math.random() * this.canvasW;
    this.y = -10 - Math.random() * 50;
    this.vx = (Math.random() - 0.5) * 1.0;
    this.vy = Math.random() * 1.5 + 1.0;
    this.radius = Math.random() * 4 + 3; // capsule radius
    this.h = this.radius * 2.2; // vertical height
    this.color = 'hsla(200, 100%, 50%, 1)';
    this.life = 1.0;
    this.active = false;
  }

  spawn() {
    this.reset();
    this.active = true;
  }

  update(segEngine, currentPalette) {
    if (!this.active) return;

    // Apply gravity
    this.vy += 0.22; // gravity acceleration
    this.vy = Math.min(this.vy, 10); // cap terminal velocity

    this.x += this.vx;
    this.y += this.vy;

    const normX = this.x / this.canvasW;
    const normY = this.y / this.canvasH;

    // Check collision with screen boundaries
    if (this.y > this.canvasH * 0.85) {
      // Bottom ground layer collision
      this.y = this.canvasH * 0.85;
      this.vy = -this.vy * 0.15; // bounce slightly
      this.vx = (Math.random() - 0.5) * 2; // slip sideways
      
      const blob = segEngine.getBlobAt(normX, normY);
      const depth = blob ? blob.depth : 0.6;
      this.color = PALETTES[currentPalette](depth, normY);
      
      // Gradually decay/expire to avoid memory build up of static sand
      this.life -= 0.005;
      if (this.life <= 0) {
        this.active = false;
      }
      return;
    }

    if (this.x < 0 || this.x > this.canvasW) {
      this.active = false;
      return;
    }

    // Check collision with silhouette
    if (segEngine.isInsideSilhouette(normX, normY)) {
      const blob = segEngine.getBlobAt(normX, normY);
      const depth = blob ? blob.depth : 0.5;
      this.color = PALETTES[currentPalette](depth, normY);

      // Simple slide-off physics:
      // Sample mask slightly to the left and right to find slope direction
      const step = 0.012; // ~8 pixels in 640 width
      const insideLeft = segEngine.isInsideSilhouette(normX - step, normY);
      const insideRight = segEngine.isInsideSilhouette(normX + step, normY);
      
      // If inside body, push particle upwards to sit on the boundary
      let pushCount = 0;
      while (segEngine.isInsideSilhouette(this.x / this.canvasW, this.y / this.canvasH) && pushCount < 8) {
        this.y -= 2.0; // push up
        pushCount++;
      }

      this.vy = 0.5; // Slow down vertical descent to simulate sliding
      
      if (insideLeft && !insideRight) {
        // Slope goes down to the right
        this.vx += 0.8;
      } else if (!insideLeft && insideRight) {
        // Slope goes down to the left
        this.vx -= 0.8;
      } else {
        // Flat area (e.g. shoulders or head), slide off randomly
        this.vx += (Math.random() - 0.5) * 1.5;
      }

      // Cap horizontal slide speed
      this.vx = Math.max(-4, Math.min(4, this.vx));
    } else {
      // Damping in air
      this.vx *= 0.98;
    }
  }

  draw(ctx) {
    if (!this.active || this.life <= 0) return;
    
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    
    ctx.beginPath();
    // Draw sand as small pebbles/ellipses
    ctx.ellipse(this.x, this.y, this.radius, this.h / 2, this.vx * 0.15, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
}

// 4. Spark Particle (for fireworks)
class Spark {
  constructor() {
    this.active = false;
  }

  spawn(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    
    // Explosion velocity
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    
    this.gravity = 0.15;
    this.friction = 0.95;
    this.radius = Math.random() * 3 + 2;
    this.alpha = 1.0;
    this.decay = Math.random() * 0.03 + 0.015;
    this.active = true;
  }

  update() {
    if (!this.active) return;
    
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.vy += this.gravity;
    
    this.x += this.vx;
    this.y += this.vy;
    
    this.alpha -= this.decay;
    if (this.alpha <= 0) {
      this.active = false;
    }
  }

  draw(ctx) {
    if (!this.active) return;
    
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// 5. Firework Rocket
class FireworkRocket {
  constructor(sparkPool) {
    this.sparkPool = sparkPool;
    this.active = false;
  }

  spawn(targetX, targetY) {
    this.x = Math.random() * targetX;
    this.y = targetY + 20;
    
    // Shoot upwards to a random height
    this.tx = targetX * 0.2 + Math.random() * targetX * 0.6;
    this.ty = targetY * 0.15 + Math.random() * targetY * 0.45;
    
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = Math.random() * 5 + 9;
    
    this.vx = (dx / distance) * speed;
    this.vy = (dy / distance) * speed;
    
    // Dynamic neon color
    const hue = Math.floor(Math.random() * 360);
    this.color = `hsla(${hue}, 100%, 60%, 1)`;
    this.active = true;
  }

  update() {
    if (!this.active) return;
    
    this.x += this.vx;
    this.y += this.vy;
    
    // Check if reached apex or peak height
    if (this.vy >= 0 || this.y <= this.ty) {
      this.explode();
      this.active = false;
    }
  }

  explode() {
    const sparkCount = 45;
    let spawned = 0;
    
    for (let i = 0; i < this.sparkPool.length; i++) {
      if (!this.sparkPool[i].active) {
        this.sparkPool[i].spawn(this.x, this.y, this.color);
        spawned++;
        if (spawned >= sparkCount) break;
      }
    }
  }

  draw(ctx) {
    if (!this.active) return;
    
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    
    // Rocket trail
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

// 6. Complete Physics / Render Coordinator
class PhysicsEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;

    // Interactive modes
    this.currentMode = 'pebbles'; // 'pebbles', 'bubbles', 'sand'
    this.palette = 'rainbow'; // 'rainbow', 'neon', 'sunset', 'ocean'

    // Grid details for Pebble Mode - adjusted for 2x larger organic pebbles
    this.cols = 25;
    this.rows = 16;
    this.pebbles = [];

    // Bubble Pool
    this.maxBubbles = 400;
    this.bubbles = [];
    this.bubbleSpawnTimer = 0;

    // Sand Pool
    this.maxSand = 800;
    this.sandPool = [];

    // Firework & Spark Pools
    this.sparks = Array.from({ length: 600 }, () => new Spark());
    this.rockets = Array.from({ length: 15 }, () => new FireworkRocket(this.sparks));

    // Global sound reactivity multipliers
    this.globalShake = 0;

    this.init();
  }

  init() {
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    
    // 1. Setup Pebble Grid
    this.pebbles = [];
    const colWidth = this.width / this.cols;
    const rowHeight = colWidth * 0.866; // Perfect hexagonal vertical step to eliminate rows/stripes
    this.rows = Math.ceil(this.height / rowHeight) + 1;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        // Hexagonal staggered alignment looks more packed and physical
        const staggerX = (r % 2 === 0) ? colWidth * 0.5 : 0;
        const px = c * colWidth + colWidth * 0.5 + staggerX;
        const py = r * rowHeight + rowHeight * 0.5;
        this.pebbles.push(new Pebble(px, py, colWidth, rowHeight));
      }
    }

    // 2. Setup Bubble list
    this.bubbles = Array.from({ length: this.maxBubbles }, () => new Bubble(this.width, this.height));

    // 3. Setup Sand list
    this.sandPool = Array.from({ length: this.maxSand }, () => new Sand(this.width, this.height));
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.init();
  }

  setMode(mode) {
    this.currentMode = mode;
  }

  setPalette(palette) {
    this.palette = palette;
  }

  triggerClapFirework() {
    // Launch a rocket immediately
    for (const rocket of this.rockets) {
      if (!rocket.active) {
        rocket.spawn(this.width, this.height);
        break;
      }
    }
    // Shake display briefly
    this.globalShake = 4.0;
  }

  triggerScreamShow() {
    // Launch multiple rockets in sequence
    let count = 0;
    const launch = () => {
      if (count < 5) {
        for (const rocket of this.rockets) {
          if (!rocket.active) {
            rocket.spawn(this.width, this.height);
            break;
          }
        }
        count++;
        setTimeout(launch, 150 + Math.random() * 150);
      }
    };
    launch();
    this.globalShake = 10.0; // Violent shaking
  }

  update(segEngine, time) {
    // Decelerate sound shake
    this.globalShake *= 0.88;
    if (this.globalShake < 0.1) this.globalShake = 0;

    // 1. Update Rockets and Sparks (Always active overlay)
    for (const rocket of this.rockets) rocket.update();
    for (const spark of this.sparks) spark.update();

    // 2. Mode specific updates
    if (this.currentMode === 'pebbles') {
      const len = this.pebbles.length;
      for (let i = 0; i < len; i++) {
        const p = this.pebbles[i];
        const normX = p.x / this.width;
        const normY = p.y / this.height;
        p.update(normX, normY, segEngine, this.palette, time, this.globalShake);
      }
    } 
    else if (this.currentMode === 'bubbles') {
      // Spawn bubbles inside active blobs
      this.bubbleSpawnTimer += 1;
      if (this.bubbleSpawnTimer > 1 && segEngine.activeBlobs.length > 0) {
        this.bubbleSpawnTimer = 0;
        
        // Find an available inactive bubble in pool
        const inactiveBubble = this.bubbles.find(b => b.life <= 0);
        if (inactiveBubble) {
          // Select a random active blob
          const randBlob = segEngine.activeBlobs[Math.floor(Math.random() * segEngine.activeBlobs.length)];
          
          // Pick a random grid pixel in the blob
          if (randBlob.area > 0) {
            const w = segEngine.maskWidth;
            const h = segEngine.maskHeight;
            
            // Search coordinates inside blob's bounding box
            const bx = randBlob.minX + Math.floor(Math.random() * (randBlob.maxX - randBlob.minX + 1));
            const by = randBlob.minY + Math.floor(Math.random() * (randBlob.maxY - randBlob.minY + 1));
            
            const idx = (by * w + bx) * 4;
            // Validate it's inside mask
            if (segEngine.maskData && segEngine.maskData[idx] > 120) {
              const screenX = (bx / w) * this.width;
              const screenY = (by / h) * this.height;
              
              const color = PALETTES[this.palette](randBlob.depth, by / h);
              inactiveBubble.spawn(screenX, screenY, color);
            }
          }
        }
      }

      // Update bubble list
      for (const bubble of this.bubbles) {
        if (bubble.life > 0) {
          bubble.update(segEngine, this.palette, time);
        }
      }
    } 
    else if (this.currentMode === 'sand') {
      // Spawn falling sand particles
      const spawnCount = 6;
      let spawned = 0;
      for (const sand of this.sandPool) {
        if (!sand.active) {
          sand.spawn();
          spawned++;
          if (spawned >= spawnCount) break;
        }
      }

      // Update sand particles
      for (const sand of this.sandPool) {
        sand.update(segEngine, this.palette);
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    
    // Clear screen with high trails in sand mode, clean black in others
    if (this.currentMode === 'sand') {
      ctx.fillStyle = 'rgba(5, 5, 8, 0.22)'; // Motion trails for sand
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Shake canvas effect
    ctx.save();
    if (this.globalShake > 0) {
      const sx = (Math.random() - 0.5) * this.globalShake * 4;
      const sy = (Math.random() - 0.5) * this.globalShake * 4;
      ctx.translate(sx, sy);
    }

    // 1. Draw mode-specific elements
    if (this.currentMode === 'pebbles') {
      const len = this.pebbles.length;
      for (let i = 0; i < len; i++) {
        this.pebbles[i].draw(ctx);
      }
    } 
    else if (this.currentMode === 'bubbles') {
      // Draw ground pile in bubble mode as well to make layout gorgeous
      ctx.fillStyle = 'rgba(15, 15, 25, 0.4)';
      ctx.fillRect(0, this.height * 0.85, this.width, this.height * 0.15);

      for (const bubble of this.bubbles) {
        bubble.draw(ctx);
      }
    } 
    else if (this.currentMode === 'sand') {
      for (const sand of this.sandPool) {
        sand.draw(ctx);
      }
    }

    // 2. Draw Fireworks overlay
    for (const rocket of this.rockets) rocket.draw(ctx);
    for (const spark of this.sparks) spark.draw(ctx);

    ctx.restore();
  }
}

window.PhysicsEngine = PhysicsEngine;
window.PALETTES = PALETTES;
