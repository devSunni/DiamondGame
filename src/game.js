(function () {
  'use strict';

  /**
   * 두들 점프 - 졸라맨 버전 (Canvas)
   * - 좌/우: 이동 (A/D도 가능)
   * - 화면 밖 좌/우로 나가면 반대편으로 래핑
   * - 플랫폼 밟으면 점프
   * - 위로 올라갈수록 점수 증가
   * - 떨어지면 게임오버, R로 재시작
   */

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById('gameCanvas');
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext('2d');

  // 고해상도 디스플레이 스케일링
  const devicePixelRatioSafe = Math.min(window.devicePixelRatio || 1, 2);
  const baseWidth = canvas.width;
  const baseHeight = canvas.height;
  canvas.style.width = baseWidth + 'px';
  canvas.style.height = baseHeight + 'px';
  canvas.width = Math.floor(baseWidth * devicePixelRatioSafe);
  canvas.height = Math.floor(baseHeight * devicePixelRatioSafe);
  ctx.scale(devicePixelRatioSafe, devicePixelRatioSafe);

  // 게임 상수
  const GAME_WIDTH = baseWidth;
  const GAME_HEIGHT = baseHeight;
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
  };

  /** 유틸: 난수 범위 */
  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  /** 유틸: 선형 보간 */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
      this.highestY = y; // 가장 위로 간 지점 (작을수록 위)
    }

    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }

    update(dt) {
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

      // 최고 높이 갱신 (위로 갈수록 y 작아짐)
      if (this.y < this.highestY) {
        this.highestY = this.y;
      }
    }

    bounce() {
      this.vy = -JUMP_SPEED;
    }

    draw(ctx, cameraY) {
      const screenX = Math.floor(this.x);
      const screenY = Math.floor(this.y - cameraY);

      // 졸라맨 그리기
      // 머리
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

      // 몸통
      const bodyTopY = headCenterY + headRadius;
      const bodyBottomY = screenY + this.height - 8;
      ctx.beginPath();
      ctx.moveTo(headCenterX, bodyTopY);
      ctx.lineTo(headCenterX, bodyBottomY);
      ctx.stroke();

      // 팔
      const armY = bodyTopY + 8;
      const armLength = 14;
      ctx.beginPath();
      ctx.moveTo(headCenterX, armY);
      ctx.lineTo(headCenterX + armLength * this.facing, armY - 4);
      ctx.moveTo(headCenterX, armY);
      ctx.lineTo(headCenterX - armLength * this.facing, armY + 2);
      ctx.stroke();

      // 다리
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
      this.highestPlatformY = GAME_HEIGHT; // 가장 위(작은 y) 위치 기록
    }

    reset() {
      this.platforms.length = 0;
      this.highestPlatformY = GAME_HEIGHT;
    }

    spawnInitial(playerY) {
      // 바닥 가까이에 몇 개 생성
      let currentY = GAME_HEIGHT - 20;
      // 시작 발판
      this.platforms.push({
        x: GAME_WIDTH / 2 - 50,
        y: currentY,
        width: 100,
        height: PLATFORM_HEIGHT,
        type: 'static',
        vx: 0,
      });
      currentY -= 90;
      for (let i = 0; i < 8; i++) {
        const width = randomRange(PLATFORM_MIN_WIDTH, PLATFORM_MAX_WIDTH);
        const x = randomRange(10, GAME_WIDTH - width - 10);
        this.platforms.push({
          x,
          y: currentY,
          width,
          height: PLATFORM_HEIGHT,
          type: Math.random() < MOVING_PLATFORM_CHANCE ? 'moving' : 'static',
          vx: Math.random() < 0.5 ? 1.2 : -1.2,
        });
        currentY -= randomRange(PLATFORM_VERTICAL_GAP_MIN, PLATFORM_VERTICAL_GAP_MAX);
      }
      this.highestPlatformY = Math.min(this.highestPlatformY, currentY);
    }

    maybeGenerateAbove(cameraY) {
      // 카메라 위쪽으로 일정 버퍼까지 발판 채우기
      const targetTopY = cameraY - 600;
      while (this.highestPlatformY > targetTopY) {
        const width = randomRange(PLATFORM_MIN_WIDTH, PLATFORM_MAX_WIDTH);
        const x = randomRange(10, GAME_WIDTH - width - 10);
        const gap = randomRange(PLATFORM_VERTICAL_GAP_MIN, PLATFORM_VERTICAL_GAP_MAX);
        const newY = this.highestPlatformY - gap;
        this.platforms.push({
          x,
          y: newY,
          width,
          height: PLATFORM_HEIGHT,
          type: Math.random() < MOVING_PLATFORM_CHANCE ? 'moving' : 'static',
          vx: Math.random() < 0.5 ? 1.2 : -1.2,
        });
        this.highestPlatformY = newY;
      }
    }

    update(dt) {
      // 움직이는 플랫폼 이동 및 벽 반사
      for (const p of this.platforms) {
        if (p.type === 'moving') {
          p.x += p.vx;
          if (p.x < 0) {
            p.x = 0;
            p.vx *= -1;
          } else if (p.x + p.width > GAME_WIDTH) {
            p.x = GAME_WIDTH - p.width;
            p.vx *= -1;
          }
        }
      }
    }

    cullBelow(cameraY) {
      // 화면 아래로 많이 내려간 발판 제거
      const cutoff = cameraY + GAME_HEIGHT + 200;
      this.platforms = this.platforms.filter(p => p.y < cutoff);
    }

    draw(ctx, cameraY) {
      for (const p of this.platforms) {
        const sx = Math.floor(p.x);
        const sy = Math.floor(p.y - cameraY);
        ctx.lineWidth = 2;
        if (p.type === 'moving') {
          ctx.strokeStyle = '#0a7';
        } else {
          ctx.strokeStyle = '#333';
        }
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + p.width, sy);
        ctx.stroke();
        // 두께 표현
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
      this.platforms.spawnInitial(this.player.y);

      this.cameraY = 0; // 월드→스크린 변환용 오프셋
      this.maxCameraY = 0; // 가장 위로 간 카메라 값(점수 계산)
      this.score = 0;

      this.lastTime = performance.now();
      this.accumulator = 0;
      this.fixedDt = 1000 / 60; // 60 FPS 고정 스텝

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

      // 마우스/터치: 좌/우 반 화면
      const setPointer = (clientX, active) => {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        input.left = active && x < rect.width / 2;
        input.right = active && x >= rect.width / 2;
      };
      canvas.addEventListener('mousedown', (e) => setPointer(e.clientX, true));
      window.addEventListener('mouseup', () => { input.left = false; input.right = false; });
      canvas.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length > 0) setPointer(e.touches[0].clientX, true);
      }, { passive: true });
      window.addEventListener('touchend', () => { input.left = false; input.right = false; }, { passive: true });
    }

    reset() {
      this.state = STATE_PLAY;
      this.player = new Player(GAME_WIDTH / 2 - PLAYER_WIDTH / 2, GAME_HEIGHT - 120);
      this.platforms.reset();
      this.platforms.spawnInitial(this.player.y);
      this.cameraY = 0;
      this.maxCameraY = 0;
      this.score = 0;
      input.startPressed = false;
      input.restartPressed = false;
    }

    update(dtMs) {
      if (this.state === STATE_MENU) {
        if (input.startPressed) {
          this.reset();
        }
        return;
      }

      if (this.state === STATE_GAMEOVER) {
        if (input.restartPressed) {
          this.reset();
        }
        return;
      }

      // 플레이 상태
      this.player.update(dtMs);
      this.platforms.update(dtMs);

      // 충돌: 플레이어가 내려올 때만 체크
      if (this.player.vy > 0) {
        for (const p of this.platforms.platforms) {
          const wasAbove = (this.player.bottom - this.player.vy) <= p.y; // 이전 프레임에서의 바닥 위치 추정
          const nowOverlapsY = this.player.bottom >= p.y && this.player.bottom <= p.y + PLATFORM_HEIGHT + 8;
          const overlapsX = this.player.right > p.x && this.player.left < (p.x + p.width);
          if (wasAbove && nowOverlapsY && overlapsX) {
            this.player.y = p.y - this.player.height; // 발판 위에 스냅
            this.player.bounce();
            break;
          }
        }
      }

      // 카메라 올리기: 플레이어가 화면 상단 임계값보다 위로 가면 카메라 상승
      const playerScreenY = this.player.y - this.cameraY;
      if (playerScreenY < CAMERA_RAISE_THRESHOLD) {
        const delta = CAMERA_RAISE_THRESHOLD - playerScreenY;
        this.cameraY -= delta;
        if (this.cameraY < this.maxCameraY) {
          this.maxCameraY = this.cameraY;
        }
      }

      // 발판 생성/제거
      this.platforms.maybeGenerateAbove(this.cameraY);
      this.platforms.cullBelow(this.cameraY);

      // 점수: 올라간 높이(음수)를 양수로 환산
      this.score = Math.max(this.score, Math.floor(-this.maxCameraY));

      // 게임오버: 화면 아래로 떨어짐
      if (this.player.y - this.cameraY > GAME_HEIGHT + 40) {
        this.state = STATE_GAMEOVER;
      }
    }

    loop(now) {
      const elapsed = now - this.lastTime;
      this.lastTime = now;
      this.accumulator += elapsed;

      while (this.accumulator >= this.fixedDt) {
        this.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }

      this.render();
      requestAnimationFrame(this.loop.bind(this));
    }

    renderBackground() {
      // 연한 종이 질감 느낌의 배경 라인
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
      ctx.fillStyle = '#111';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`점수: ${this.score}`, 12, 10);

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
        ctx.fillText('좌/우 화살표 또는 A/D 키로 이동', GAME_WIDTH / 2, 270);
        ctx.fillText('플랫폼을 밟아 위로 올라가세요!', GAME_WIDTH / 2, 300);
        ctx.fillText('시작하려면 Space/Enter 또는 캔버스를 클릭', GAME_WIDTH / 2, 330);

        // 클릭으로 시작
        canvas.onclick = () => { input.startPressed = true; };
      } else if (this.state === STATE_GAMEOVER) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 32px system-ui, sans-serif';
        ctx.fillText('게임 오버', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40);
        ctx.font = '18px system-ui, sans-serif';
        ctx.fillText(`최고 높이: ${this.score}`, GAME_WIDTH / 2, GAME_HEIGHT / 2);
        ctx.fillText('다시 시작: R / Enter / Space', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 36);

        canvas.onclick = () => { input.restartPressed = true; };
      } else {
        canvas.onclick = null;
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