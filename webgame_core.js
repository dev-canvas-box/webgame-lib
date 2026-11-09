/**
 * ============================================================================
 * WebGame Core Library (v1.1.0)
 * ============================================================================
 * ブラウザゲーム高速開発・トークン節約・バグ根絶のための軽量自律型ツールボックス。
 * 外部依存ゼロ（Vanilla JS）/ 2D Canvas & Three.js 3D 両対応。
 * 
 * - Engine & Loop   : 固定タイムステップ（1/60s）、可変タイムスケール、タブ復帰時クランプ
 * - Memory & Pool   : SwapPopPool（GCフリー高速スワップ削除）
 * - Input & Control : Tick同期エッジ検出、画面外飛び出し防止クランプ、右クリック遮断
 * - Audio Engine    : DynamicsCompressorNode接続、プロシージャル即時シンセ、ピッチゆらぎ
 * - Game Feel & FX  : Trauma二乗シェイク、独立駆動ヒットストップ、Squash&Stretch、Vキートグル
 * - Math & Physics  : Vec2ベクトル計算、イージング、非対称当たり判定
 * - UI & Sandbox    : Phase 0用リアルタイムTweak UI自動生成、標準ポーズ/リトライ
 * - Storage & Safe  : 名前空間隔離・破損修復・シークレットモード耐性 (WebGame.Storage)
 * ============================================================================
 */

(function (global) {
  'use strict';

  const WebGame = {
    version: '1.1.0'
  };

  /* --------------------------------------------------------------------------
   * 1. Engine & Game Loop (Fixed Timestep 1/60s)
   * -------------------------------------------------------------------------- */
  WebGame.Loop = class {
    constructor(options = {}) {
      this.fixedDt = options.fixedDt || (1 / 60);
      this.maxSubSteps = options.maxSubSteps || 5;
      this.onUpdate = options.update || (() => {});
      this.onRender = options.render || (() => {});
      
      this.accumulator = 0;
      this.lastTime = 0;
      this.timeScale = 1.0;
      this.isRunning = false;
      this.rafId = null;

      this._tick = this._tick.bind(this);
    }

    start() {
      if (this.isRunning) return;
      this.isRunning = true;
      this.lastTime = performance.now();
      this.accumulator = 0;
      this.rafId = requestAnimationFrame(this._tick);
    }

    stop() {
      this.isRunning = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    _tick(currentTime) {
      if (!this.isRunning) return;

      let frameTime = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;

      if (frameTime > 0.1) frameTime = 0.1;

      this.accumulator += frameTime * this.timeScale;

      let subSteps = 0;
      while (this.accumulator >= this.fixedDt && subSteps < this.maxSubSteps) {
        WebGame.Juice._update(this.fixedDt);
        this.onUpdate(this.fixedDt);
        WebGame.Input.clearTickEdges();
        this.accumulator -= this.fixedDt;
        subSteps++;
      }

      const alpha = this.accumulator / this.fixedDt;
      this.onRender(alpha);

      this.rafId = requestAnimationFrame(this._tick);
    }
  };

  /* --------------------------------------------------------------------------
   * 2. Memory & Performance (SwapPopPool)
   * -------------------------------------------------------------------------- */
  WebGame.Pool = class {
    constructor(factoryFn, initialCapacity = 64) {
      this.factory = factoryFn;
      this.items = [];
      this.count = 0;

      for (let i = 0; i < initialCapacity; i++) {
        this.items.push(this.factory());
      }
    }

    obtain() {
      if (this.count >= this.items.length) {
        this.items.push(this.factory());
      }
      const item = this.items[this.count];
      this.count++;
      return item;
    }

    releaseAt(index) {
      if (index < 0 || index >= this.count) return;
      this.count--;
      const temp = this.items[index];
      this.items[index] = this.items[this.count];
      this.items[this.count] = temp;
    }

    clear() {
      this.count = 0;
    }

    forEach(callback) {
      for (let i = this.count - 1; i >= 0; i--) {
        const keep = callback(this.items[i], i);
        if (keep === false) {
          this.releaseAt(i);
        }
      }
    }
  };

  /* --------------------------------------------------------------------------
   * 3. Input & Ergonomics (Keyboard, Mouse, Touch)
   * -------------------------------------------------------------------------- */
  WebGame.Input = {
    keysDown: {},
    keysJustPressed: {},
    keysJustReleased: {},

    mouse: {
      x: 0,
      y: 0,
      normalizedX: 0,
      normalizedY: 0,
      down: false,
      justPressed: false,
      justReleased: false,
      rightDown: false,
      rightJustPressed: false
    },

    init(targetElement = window) {
      window.addEventListener('keydown', (e) => {
        if (!this.keysDown[e.code]) {
          this.keysJustPressed[e.code] = true;
        }
        this.keysDown[e.code] = true;

        if (e.code === 'KeyV' && !e.repeat) {
          WebGame.Juice.toggleShakeAccessibility();
        }
      });

      window.addEventListener('keyup', (e) => {
        this.keysDown[e.code] = false;
        this.keysJustReleased[e.code] = true;
      });

      const updateMousePos = (clientX, clientY) => {
        const rect = (targetElement === window) 
          ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
          : targetElement.getBoundingClientRect();

        this.mouse.x = clientX - rect.left;
        this.mouse.y = clientY - rect.top;

        this.mouse.normalizedX = Math.max(-1, Math.min(1, ((this.mouse.x / rect.width) - 0.5) * 2));
        this.mouse.normalizedY = Math.max(-1, Math.min(1, ((this.mouse.y / rect.height) - 0.5) * 2));
      };

      window.addEventListener('mousemove', (e) => updateMousePos(e.clientX, e.clientY));

      window.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          if (!this.mouse.down) this.mouse.justPressed = true;
          this.mouse.down = true;
        } else if (e.button === 2) {
          if (!this.mouse.rightDown) this.mouse.rightJustPressed = true;
          this.mouse.rightDown = true;
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
          this.mouse.down = false;
          this.mouse.justReleased = true;
        } else if (e.button === 2) {
          this.mouse.rightDown = false;
        }
      });

      window.addEventListener('contextmenu', (e) => e.preventDefault());

      window.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
          updateMousePos(e.touches[0].clientX, e.touches[0].clientY);
          if (!this.mouse.down) this.mouse.justPressed = true;
          this.mouse.down = true;
        }
      }, { passive: false });

      window.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
          updateMousePos(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      window.addEventListener('touchend', () => {
        this.mouse.down = false;
        this.mouse.justReleased = true;
      });
    },

    isDown(code) {
      return !!this.keysDown[code];
    },

    justPressed(code) {
      return !!this.keysJustPressed[code];
    },

    justReleased(code) {
      return !!this.keysJustReleased[code];
    },

    clearTickEdges() {
      this.keysJustPressed = {};
      this.keysJustReleased = {};
      this.mouse.justPressed = false;
      this.mouse.justReleased = false;
      this.mouse.rightJustPressed = false;
    }
  };

  /* --------------------------------------------------------------------------
   * 4. Audio Engine (Master Compressor & Procedural Synth)
   * -------------------------------------------------------------------------- */
  WebGame.Audio = {
    ctx: null,
    compressor: null,
    lastPlayTimes: {},
    isMuted: false,

    init() {
      if (this.ctx) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(10, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

      this.compressor.connect(this.ctx.destination);

      const unlock = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    },

    toggleMute() {
      this.isMuted = !this.isMuted;
      return this.isMuted;
    },

    playTone({ freq = 440, type = 'sine', duration = 0.1, endFreq = null, gain = 0.2, tag = 'sfx' }) {
      if (this.isMuted) return;
      this.init();
      if (!this.ctx || this.ctx.state === 'suspended') return;

      const now = performance.now();
      if (this.lastPlayTimes[tag] && (now - this.lastPlayTimes[tag] < 35)) {
        return;
      }
      this.lastPlayTimes[tag] = now;

      const pitchOffset = 1.0 + (Math.random() * 0.12 - 0.06);
      const startF = freq * pitchOffset;
      const endF = (endFreq !== null ? endFreq : freq) * pitchOffset;

      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(startF, this.ctx.currentTime);
      if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(10, endF), this.ctx.currentTime + duration);
      }

      gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gainNode);
      gainNode.connect(this.compressor);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    },

    hit() {
      this.playTone({ freq: 220, endFreq: 60, type: 'triangle', duration: 0.08, gain: 0.35, tag: 'hit' });
    },
    jump() {
      this.playTone({ freq: 160, endFreq: 480, type: 'sine', duration: 0.12, gain: 0.25, tag: 'jump' });
    },
    coin() {
      this.playTone({ freq: 880, endFreq: 1760, type: 'sine', duration: 0.15, gain: 0.2, tag: 'coin' });
    },
    explode() {
      this.playTone({ freq: 110, endFreq: 30, type: 'sawtooth', duration: 0.3, gain: 0.4, tag: 'explode' });
    },
    heartbeat() {
      this.playTone({ freq: 65, endFreq: 35, type: 'triangle', duration: 0.14, gain: 0.45, tag: 'heartbeat' });
    }
  };

  /* --------------------------------------------------------------------------
   * 5. Game Feel & Juice (Trauma Shake, Hitstop, Squash & Stretch)
   * -------------------------------------------------------------------------- */
  WebGame.Juice = {
    trauma: 0,
    maxOffset: 14,
    traumaDecay: 0.88,
    shakeMultiplier: 1.0,

    shakeX: 0,
    shakeY: 0,

    hitstopTimer: 0,
    flashAlpha: 0,

    addShake(amount = 0.5) {
      this.trauma = Math.min(1.0, this.trauma + amount);
    },

    hitstop(duration = 0.06) {
      this.hitstopTimer = Math.max(this.hitstopTimer, duration);
    },

    flash(alpha = 0.35) {
      this.flashAlpha = Math.min(0.35, alpha);
    },

    toggleShakeAccessibility() {
      if (this.shakeMultiplier === 1.0) this.shakeMultiplier = 0.3;
      else if (this.shakeMultiplier === 0.3) this.shakeMultiplier = 0.0;
      else this.shakeMultiplier = 1.0;
      return this.shakeMultiplier;
    },

    _update(dt) {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= dt;
      }

      if (this.flashAlpha > 0) {
        this.flashAlpha = Math.max(0, this.flashAlpha - dt * 4.0);
      }

      if (this.trauma > 0) {
        const shakePower = Math.pow(this.trauma, 2) * this.shakeMultiplier;
        this.shakeX = (Math.random() * 2 - 1) * this.maxOffset * shakePower;
        this.shakeY = (Math.random() * 2 - 1) * this.maxOffset * shakePower;
        this.trauma = Math.max(0, this.trauma - (1.0 - this.traumaDecay));
      } else {
        this.shakeX = 0;
        this.shakeY = 0;
      }
    },

    getSquashScale(factor = 0.8) {
      const scaleY = factor;
      const scaleX = 1.0 / Math.sqrt(scaleY);
      return { x: scaleX, y: scaleY };
    }
  };

  /* --------------------------------------------------------------------------
   * 6. Math & Collision Helpers
   * -------------------------------------------------------------------------- */
  WebGame.Math = {
    clamp(val, min, max) {
      return Math.max(min, Math.min(max, val));
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    dist(x1, y1, x2, y2) {
      return Math.hypot(x2 - x1, y2 - y1);
    },

    circleHit(c1, c2, hurtboxRatio = 0.75) {
      const r1 = c1.radius * hurtboxRatio;
      const r2 = c2.radius * hurtboxRatio;
      return this.dist(c1.x, c1.y, c2.x, c2.y) < (r1 + r2);
    }
  };

  /* --------------------------------------------------------------------------
   * 7. Phase 0 Tweak UI (リアルタイム調整スライダー自動マウント)
   * -------------------------------------------------------------------------- */
  WebGame.createTweakUI = function(config, onChange = () => {}) {
    const container = document.createElement('div');
    container.id = 'webgame-tweak-ui';
    Object.assign(container.style, {
      position: 'absolute',
      top: '12px',
      right: '12px',
      background: 'rgba(8, 14, 28, 0.90)',
      border: '1px solid #00f0ff',
      borderRadius: '8px',
      padding: '12px 16px',
      color: '#e0f7ff',
      fontFamily: 'monospace',
      fontSize: '12px',
      zIndex: '9999',
      boxShadow: '0 4px 16px rgba(0,0,0,0.8)'
    });

    const title = document.createElement('div');
    title.innerHTML = '<b>⚙️ TWEAK UI (Phase 0)</b>';
    title.style.marginBottom = '10px';
    title.style.color = '#00f0ff';
    container.appendChild(title);

    ['mousedown', 'mousemove', 'keydown', 'touchstart'].forEach(evt => {
      container.addEventListener(evt, e => e.stopPropagation());
    });

    Object.keys(config).forEach(key => {
      const item = config[key];
      if (typeof item !== 'object' || item.val === undefined) return;

      const row = document.createElement('div');
      row.style.marginBottom = '6px';

      const label = document.createElement('div');
      label.textContent = `${key}: ${item.val}`;

      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min !== undefined ? item.min : 0;
      input.max = item.max !== undefined ? item.max : 1;
      input.step = item.step !== undefined ? item.step : 0.01;
      input.value = item.val;
      input.style.width = '140px';

      input.addEventListener('input', (e) => {
        item.val = parseFloat(e.target.value);
        label.textContent = `${key}: ${item.val}`;
        onChange(key, item.val);
      });

      row.appendChild(label);
      row.appendChild(input);
      container.appendChild(row);
    });

    document.body.appendChild(container);
    return container;
  };

  /* --------------------------------------------------------------------------
   * 8. Safe Storage & State Persistence (Namespace & Secret Mode Fallback)
   * -------------------------------------------------------------------------- */
  WebGame.Storage = {
    _memoryFallback: {},

    _getKey(gameId, key) {
      return `${gameId}_${key}`;
    },

    save(gameId, key, value) {
      const fullKey = this._getKey(gameId, key);
      const jsonStr = JSON.stringify(value);
      this._memoryFallback[fullKey] = jsonStr;

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(fullKey, jsonStr);
        }
      } catch (e) {
        console.warn('[WebGame.Storage] localStorage write failed, using memory fallback:', e);
      }
    },

    load(gameId, key, defaultValue = null) {
      const fullKey = this._getKey(gameId, key);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const item = window.localStorage.getItem(fullKey);
          if (item !== null) {
            return JSON.parse(item);
          }
        }
      } catch (e) {
        console.warn('[WebGame.Storage] localStorage read/parse failed, using default/memory:', e);
      }

      if (this._memoryFallback[fullKey] !== undefined) {
        try {
          return JSON.parse(this._memoryFallback[fullKey]);
        } catch (e) {
          return defaultValue;
        }
      }

      return defaultValue;
    }
  };

  global.WebGame = Object.freeze(WebGame);

})(typeof window !== 'undefined' ? window : this);
