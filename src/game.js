(function () {
  'use strict';

  /**
   * 두들 점프 - 졸라맨 버전 (Canvas)
   * 모바일 최적화: 반응형 스케일, 터치 스크롤 방지, 기울기(틸트) 조작 토글
   */

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById('gameCanvas');
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext('2d');

  // 논리 해상도(게임 좌표계)
  const LOGICAL_WIDTH = canvas.width;  // 480
  const LOGICAL_HEIGHT = canvas.height; // 720

  // 고해상도 디스플레이 내부 픽셀 스케일 (렌더링 품질)
  const devicePixelRatioSafe = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = LOGICAL_WIDTH + 'px';
  canvas.style.height = LOGICAL_HEIGHT + 'px';
  canvas.width = Math.floor(LOGICAL_WIDTH * devicePixelRatioSafe);
  canvas.height = Math.floor(LOGICAL_HEIGHT * devicePixelRatioSafe);
  ctx.scale(devicePixelRatioSafe, devicePixelRatioSafe);

  // 뷰포트에 맞춰 CSS 사이즈로 캔버스를 스케일(논리 좌표 유지)
  function fitCanvasToViewport() {
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    const targetAspect = LOGICAL_WIDTH / LOGICAL_HEIGHT;
    const viewportAspect = vw / vh;

    let cssWidth, cssHeight;
    if (viewportAspect > targetAspect) {
      // 화면이 더 넓음 → 높이에 맞추고 좌우 레터박스
      cssHeight = vh;
      cssWidth = Math.round(vh * targetAspect);
    } else {
      // 화면이 더 길거나 같음 → 너비에 맞추고 상하 레터박스
      cssWidth = vw;
      cssHeight = Math.round(vw / targetAspect);
    }
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
  }
  window.addEventListener('resize', fitCanvasToViewport);
  window.addEventListener('orientationchange', () => setTimeout(fitCanvasToViewport, 50));
  fitCanvasToViewport();

  // 게임 상수
  const GAME_WIDTH = LOGICAL_WIDTH;
  const GAME_HEIGHT = LOGICAL_HEIGHT;
  const GRAVITY = 0.4;
  const HORIZONTAL_ACCEL = 0.6;
  const HORIZONTAL_FRICTION = 0.85;
  const MAX_HORIZONTAL_SPEED = 6.0;
  const JUMP_SPEED = 11.5;
  const PLAYER_WIDTH = 24;
  const PLAYER_HEIGHT = 36;
  const CAMERA_RAISE_THRESHOLD = GAME_HEIGHT * 0.45;
  const PLATFORM_MIN_WIDTH = 60;
  const PLATFORM_MAX_WIDTH = 110;
  const PLATFORM_HEIGHT = 12;
  const PLATFORM_VERTICAL_GAP_MIN = 60;
  const PLATFORM_VERTICAL_GAP_MAX = 110;
  const MOVING_PLATFORM_CHANCE = 0.18; // 18%

  // UI: 틸트 토글 버튼 위치(논리 좌표)
  const TILT_BTN = { x: GAME_WIDTH - 128, y: 8, w: 120, h: 28 };

  // 게임 상태
  const STATE_MENU = 'menu';
  const STATE_PLAY = 'play';
  const STATE_GAMEOVER = 'gameover';

  /** @typedef {{x:number,y:number,width:number,height:number, type:'static'|'moving', vx:number}} Platform */

  /** 입력 상태 */
  const input = {
    left: false,
    right: false,
    startPressed: false,
    restartPressed: false,
    overlayLeftActive: false,
    overlayRightActive: false,
  };

  // 터치 스크롤 방지
  ['touchstart','touchmove','touchend','touchcancel'].forEach(type => {
    canvas.addEventListener(type, (e) => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  });

  /** 유틸 */
  function randomRange(min, max) { return Math.random() * (max - min) + min; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  // 포인터 좌표 → 논리 좌표 변환
  function toLogicalPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_WIDTH / rect.width;
    const scaleY = GAME_HEIGHT / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    return { x, y };
  }

  /** 플레이어 */
  class Player {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.width = PLAYER_WIDTH;
      this.height = PLAYER_HEIGHT;
      this.facing = 1; // 1: 우, -1: 좌
      this.highestY = y;
    }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }

    update() {
      // 좌우 가속/마찰
      if (input.left && !input.right) {
        this.vx -= HORIZONTAL_ACCEL;
        this.facing = -1;
      } else if (input.right && !input.left) {
        this.vx += HORIZONTAL_ACCEL;
        this.facing = 1;
      } else {
        this.vx *= HORIZONTAL_FRICTION;
      }
      this.vx = clamp(this.vx, -MAX_HORIZONTAL_SPEED, MAX_HORIZONTAL_SPEED);

      // 중력
      this.vy += GRAVITY;

      // 이동
      this.x += this.vx;
      this.y += this.vy;

      // 좌우 래핑
      if (this.right < 0) {
        this.x = GAME_WIDTH;
      } else if (this.left > GAME_WIDTH) {
        this.x = -this.width;
      }

      if (this.y < this.highestY) this.highestY = this.y;
    }

    bounce() { this.vy = -JUMP_SPEED; }

    draw(ctx, cameraY) {
      const screenX = Math.floor(this.x);
      const screenY = Math.floor(this.y - cameraY);

      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 2;

      const headRadius = 8;
      const headCenterX = screenX + this.width / 2;
      const headCenterY = screenY + 10;

      ctx.beginPath();
      ctx.arc(headCenterX, headCenterY, headRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const bodyTopY = headCenterY + headRadius;
      const bodyBottomY = screenY + this.height - 8;
      ctx.beginPath();
      ctx.moveTo(headCenterX, bodyTopY);
      ctx.lineTo(headCenterX, bodyBottomY);
      ctx.stroke();

      const armY = bodyTopY + 8;
      const armLength = 14;
      ctx.beginPath();
      ctx.moveTo(headCenterX, armY);
      ctx.lineTo(headCenterX + armLength * this.facing, armY - 4);
      ctx.moveTo(headCenterX, armY);
      ctx.lineTo(headCenterX - armLength * this.facing, armY + 2);
      ctx.stroke();

      const legY = bodyBottomY;
      const legLength = 14;
      ctx.beginPath();
      ctx.moveTo(headCenterX, legY);
      ctx.lineTo(headCenterX - 8, legY + legLength);
      ctx.moveTo(headCenterX, legY);
      ctx.lineTo(headCenterX + 8, legY + legLength - 2);
      ctx.stroke();
    }
  }

  /** 플랫폼 관리자 */
  class PlatformManager {
    constructor() {
      /** @type {Platform[]} */
      this.platforms = [];
      this.highestPlatformY = GAME_HEIGHT;
    }
    reset() { this.platforms.length = 0; this.highestPlatformY = GAME_HEIGHT; }

    spawnInitial() {
      let currentY = GAME_HEIGHT - 20;
      this.platforms.push({ x: GAME_WIDTH / 2 - 50, y: currentY, width: 100, height: PLATFORM_HEIGHT, type: 'static', vx: 0 });
      currentY -= 90;
      for (let i = 0; i < 8; i++) {
        const width = randomRange(PLATFORM_MIN_WIDTH, PLATFORM_MAX_WIDTH);
        const x = randomRange(10, GAME_WIDTH - width - 10);
        this.platforms.push({ x, y: currentY, width, height: PLATFORM_HEIGHT, type: Math.random() < MOVING_PLATFORM_CHANCE ? 'moving' : 'static', vx: Math.random() < 0.5 ? 1.2 : -1.2 });
        currentY -= randomRange(PLATFORM_VERTICAL_GAP_MIN, PLATFORM_VERTICAL_GAP_MAX);
      }
      this.highestPlatformY = Math.min(this.highestPlatformY, currentY);
    }

    maybeGenerateAbove(cameraY) {
      const targetTopY = cameraY - 600;
      while (this.highestPlatformY > targetTopY) {
        const width = randomRange(PLATFORM_MIN_WIDTH, PLATFORM_MAX_WIDTH);
        const x = randomRange(10, GAME_WIDTH - width - 10);
        const gap = randomRange(PLATFORM_VERTICAL_GAP_MIN, PLATFORM_VERTICAL_GAP_MAX);
        const newY = this.highestPlatformY - gap;
        this.platforms.push({ x, y: newY, width, height: PLATFORM_HEIGHT, type: Math.random() < MOVING_PLATFORM_CHANCE ? 'moving' : 'static', vx: Math.random() < 0.5 ? 1.2 : -1.2 });
        this.highestPlatformY = newY;
      }
    }

    update() {
      for (const p of this.platforms) {
        if (p.type === 'moving') {
          p.x += p.vx;
          if (p.x < 0) { p.x = 0; p.vx *= -1; }
          else if (p.x + p.width > GAME_WIDTH) { p.x = GAME_WIDTH - p.width; p.vx *= -1; }
        }
      }
    }

    cullBelow(cameraY) {
      const cutoff = cameraY + GAME_HEIGHT + 200;
      this.platforms = this.platforms.filter(p => p.y < cutoff);
    }

    draw(ctx, cameraY) {
      for (const p of this.platforms) {
        const sx = Math.floor(p.x);
        const sy = Math.floor(p.y - cameraY);
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.type === 'moving' ? '#0a7' : '#333';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + p.width, sy);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.beginPath();
        ctx.moveTo(sx, sy + 3);
        ctx.lineTo(sx + p.width, sy + 3);
        ctx.stroke();
      }
    }
  }

  /** 게임 */
  class Game {
    constructor() {
      this.state = STATE_MENU;
      this.player = new Player(GAME_WIDTH / 2 - PLAYER_WIDTH / 2, GAME_HEIGHT - 120);
      this.platforms = new PlatformManager();
      this.platforms.spawnInitial();

      this.cameraY = 0;
      this.maxCameraY = 0;
      this.score = 0;

      // 틸트 제어
      this.tiltEnabled = false;
      this.tiltGamma = 0; // -90..90(왼/오)
      this.tiltDeadzone = 6; // 기울기 데드존

      this.lastTime = performance.now();
      this.accumulator = 0;
      this.fixedDt = 1000 / 60;

      this.bindInputs();
      requestAnimationFrame(this.loop.bind(this));
    }

    bindInputs() {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
        if (this.state === STATE_MENU && (e.code === 'Space' || e.code === 'Enter')) input.startPressed = true;
        if (this.state === STATE_GAMEOVER && (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space')) input.restartPressed = true;
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
      });

      const setPointer = (clientX, active) => {
        if (!active) { input.left = false; input.right = false; return; }
        if (this.tiltEnabled) return; // 틸트 사용 시 터치 반화면 입력은 무시
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        input.left = x < rect.width / 2;
        input.right = x >= rect.width / 2;
      };
      canvas.addEventListener('mousedown', (e) => setPointer(e.clientX, true));
      window.addEventListener('mouseup', () => setPointer(0, false));
      canvas.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length > 0) setPointer(e.touches[0].clientX, true);
      }, { passive: false });
      window.addEventListener('touchend', () => setPointer(0, false), { passive: false });

      // 클릭/탭: 시작/재시작/틸트 토글
      canvas.addEventListener('click', (e) => {
        const { x, y } = toLogicalPoint(e.clientX, e.clientY);
        if (x >= TILT_BTN.x && x <= TILT_BTN.x + TILT_BTN.w && y >= TILT_BTN.y && y <= TILT_BTN.y + TILT_BTN.h) {
          this.toggleTilt();
          return;
        }
        if (this.state === STATE_MENU) input.startPressed = true;
        else if (this.state === STATE_GAMEOVER) input.restartPressed = true;
      });

      // 디바이스 오리엔테이션(틸트)
      const onOrientation = (ev) => {
        if (typeof ev.gamma === 'number') {
          this.tiltGamma = clamp(ev.gamma, -90, 90);
        }
      };
      window.addEventListener('deviceorientation', onOrientation);

      this.requestTiltPermission = async () => {
        try {
          if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const res = await DeviceOrientationEvent.requestPermission();
            return res === 'granted';
          }
          // 안드로이드 등은 권한 요청 불필요
          return true;
        } catch (_) { return false; }
      };

      // 온스크린 버튼(모바일)
      const btnLeft = document.getElementById('btnLeft');
      const btnRight = document.getElementById('btnRight');
      const setOverlay = (side, active) => {
        if (side === 'left') { input.overlayLeftActive = !!active; }
        if (side === 'right') { input.overlayRightActive = !!active; }
      };
      const bindBtn = (el, side) => {
        if (!el) return;
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); setOverlay(side, true); el.setPointerCapture(e.pointerId); });
        el.addEventListener('pointerup', () => setOverlay(side, false));
        el.addEventListener('pointercancel', () => setOverlay(side, false));
        el.addEventListener('pointerleave', () => setOverlay(side, false));
      };
      bindBtn(btnLeft, 'left');
      bindBtn(btnRight, 'right');
    }

    async toggleTilt() {
      if (!this.tiltEnabled) {
        const granted = await this.requestTiltPermission();
        if (!granted) return; // 권한 거부 시 유지
      }
      this.tiltEnabled = !this.tiltEnabled;
      if (!this.tiltEnabled) { input.left = false; input.right = false; }
    }

    reset() {
      this.state = STATE_PLAY;
      this.player = new Player(GAME_WIDTH / 2 - PLAYER_WIDTH / 2, GAME_HEIGHT - 120);
      this.platforms.reset();
      this.platforms.spawnInitial();
      this.cameraY = 0;
      this.maxCameraY = 0;
      this.score = 0;
      input.startPressed = false;
      input.restartPressed = false;
    }

    applyTiltToInput() {
      // 온스크린 버튼이 우선
      if (input.overlayLeftActive || input.overlayRightActive) {
        input.left = input.overlayLeftActive;
        input.right = input.overlayRightActive;
        return;
      }
      if (!this.tiltEnabled) return;
      const g = this.tiltGamma || 0;
      const dz = this.tiltDeadzone;
      if (g > dz) { input.left = false; input.right = true; }
      else if (g < -dz) { input.left = true; input.right = false; }
      else { input.left = false; input.right = false; }
    }

    update() {
      if (this.state === STATE_MENU) {
        if (input.startPressed) this.reset();
        return;
      }
      if (this.state === STATE_GAMEOVER) {
        if (input.restartPressed) this.reset();
        return;
      }

      // 틸트 입력 반영
      this.applyTiltToInput();

      this.player.update();
      this.platforms.update();

      // 충돌(내려올 때)
      if (this.player.vy > 0) {
        for (const p of this.platforms.platforms) {
          const wasAbove = (this.player.bottom - this.player.vy) <= p.y;
          const nowOverlapsY = this.player.bottom >= p.y && this.player.bottom <= p.y + PLATFORM_HEIGHT + 8;
          const overlapsX = this.player.right > p.x && this.player.left < (p.x + p.width);
          if (wasAbove && nowOverlapsY && overlapsX) {
            this.player.y = p.y - this.player.height;
            this.player.bounce();
            break;
          }
        }
      }

      const playerScreenY = this.player.y - this.cameraY;
      if (playerScreenY < CAMERA_RAISE_THRESHOLD) {
        const delta = CAMERA_RAISE_THRESHOLD - playerScreenY;
        this.cameraY -= delta;
        if (this.cameraY < this.maxCameraY) this.maxCameraY = this.cameraY;
      }

      this.platforms.maybeGenerateAbove(this.cameraY);
      this.platforms.cullBelow(this.cameraY);

      this.score = Math.max(this.score, Math.floor(-this.maxCameraY));

      if (this.player.y - this.cameraY > GAME_HEIGHT + 40) {
        this.state = STATE_GAMEOVER;
      }
    }

    loop(now) {
      const elapsed = now - this.lastTime;
      this.lastTime = now;
      this.accumulator += elapsed;
      while (this.accumulator >= this.fixedDt) {
        this.update();
        this.accumulator -= this.fixedDt;
      }
      this.render();
      requestAnimationFrame(this.loop.bind(this));
    }

    renderBackground() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.lineWidth = 1;
      for (let y = 0; y < GAME_HEIGHT; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y + (Math.sin((y + this.cameraY) * 0.01) * 1));
        ctx.lineTo(GAME_WIDTH, y);
        ctx.stroke();
      }
    }

    renderUI() {
      // 점수
      ctx.fillStyle = '#111';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`점수: ${this.score}`, 12, 10);

      // 틸트 토글 버튼
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#111';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.rect(TILT_BTN.x, TILT_BTN.y, TILT_BTN.w, TILT_BTN.h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.tiltEnabled ? '기울임: 켜짐' : '기울임: 꺼짐', TILT_BTN.x + TILT_BTN.w / 2, TILT_BTN.y + TILT_BTN.h / 2);

      if (this.state === STATE_MENU) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(40, 160, GAME_WIDTH - 80, GAME_HEIGHT - 320);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.strokeRect(40, 160, GAME_WIDTH - 80, GAME_HEIGHT - 320);

        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px system-ui, sans-serif';
        ctx.fillText('두들 점프 - 졸라맨', GAME_WIDTH / 2, 220);
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillText('좌/우 화살표·A/D 또는 화면 좌/우 터치', GAME_WIDTH / 2, 270);
        ctx.fillText('기울임 조작은 우상단 버튼으로 켜세요', GAME_WIDTH / 2, 300);
        ctx.fillText('시작: Space/Enter/화면 탭', GAME_WIDTH / 2, 330);
      }

      if (this.state === STATE_GAMEOVER) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 32px system-ui, sans-serif';
        ctx.fillText('게임 오버', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40);
        ctx.font = '18px system-ui, sans-serif';
        ctx.fillText(`최고 높이: ${this.score}`, GAME_WIDTH / 2, GAME_HEIGHT / 2);
        ctx.fillText('다시 시작: R / Enter / Space / 탭', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 36);
      }
    }

    render() {
      this.renderBackground();
      this.platforms.draw(ctx, this.cameraY);
      this.player.draw(ctx, this.cameraY);
      this.renderUI();
    }
  }

  // 게임 시작
  const game = new Game();

})(); 