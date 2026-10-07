'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // 설정값 (논리 해상도 400x640 기준, 단위는 px와 초)
  // ---------------------------------------------------------------------------
  const W = 400;
  const H = 640;
  const STEP = 1 / 120;
  const GRAVITY = 1800;
  const JUMP_V = -900; // 최고 점프 높이 = 900² / (2·1800) = 225px
  const SPRING_V = -1500;
  const MAX_VX = 380;
  const BULLET_V = -950;
  const PLAYER_W = 46;
  const PLAYER_H = 46;
  const PLAT_W = 60;
  const PLAT_H = 14;
  const SPRING = { w: 18, h: 14 };
  const FLY = {
    propeller: { v: -700, dur: 2.5, w: 26, h: 19 },
    jetpack: { v: -1100, dur: 3.2, w: 26, h: 32 },
  };
  const BEST_KEY = 'doojump.best';
  const MUTE_KEY = 'doojump.muted';

  const INK = '#2f3a12';
  const BODY = '#d4dd48';
  const BELLY = '#7fa82e';
  const PLAT_COLORS = {
    green: ['#7ccf3e', '#3d7a1a'],
    blue: ['#5ab6ef', '#1d6aa6'],
    brown: ['#b5814b', '#6b4119'],
    white: ['#ffffff', '#8f9aa5'],
  };

  // ---------------------------------------------------------------------------
  // 유틸
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;

  // 화면 좌우가 이어져 있으므로 x를 ±W 만큼 옮긴 경우까지 겹침 검사
  function spanHit(l, r, a, b) {
    for (const s of [0, W, -W]) {
      if (l + s < b && r + s > a) return true;
    }
    return false;
  }

  function rectsHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ay < by + bh && ay + ah > by && spanHit(ax, ax + aw, bx, bx + bw);
  }

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)은 무시
    }
  }

  const fmt = (n) => n.toLocaleString('ko-KR');

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const wrap = $('game');
  const canvas = $('screen');
  const ctx = canvas.getContext('2d');
  const ui = {
    start: $('start'),
    over: $('over'),
    pause: $('pause'),
    startBtn: $('start-btn'),
    retryBtn: $('retry-btn'),
    resumeBtn: $('resume-btn'),
    pauseBtn: $('pause-btn'),
    muteBtn: $('mute-btn'),
    bestStart: $('best-start'),
    finalScore: $('final-score'),
    finalBest: $('final-best'),
    newRecord: $('new-record'),
  };
  const show = (el, on) => el.classList.toggle('hidden', !on);

  let scale = 1;
  let dpr = 1;

  function resize() {
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    dpr = window.devicePixelRatio || 1;
    wrap.style.width = `${W * scale}px`;
    wrap.style.height = `${H * scale}px`;
    wrap.style.setProperty('--s', String(scale));
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }

  // ---------------------------------------------------------------------------
  // 효과음 (Web Audio로 직접 합성)
  // ---------------------------------------------------------------------------
  let actx = null;
  let muted = load(MUTE_KEY, '0') === '1';

  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        actx = new AC();
      } catch {
        return;
      }
    }
    if (actx.state === 'suspended') actx.resume();
  }

  function tone(f0, f1, dur, type, vol) {
    if (muted || state !== 'playing' || !actx || actx.state !== 'running') return;
    const t = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const sfx = {
    jump: () => tone(330, 660, 0.12, 'square', 0.04),
    spring: () => tone(260, 1300, 0.3, 'triangle', 0.08),
    shoot: () => tone(1100, 500, 0.07, 'square', 0.03),
    crack: () => tone(180, 70, 0.18, 'sawtooth', 0.06),
    poof: () => tone(700, 1200, 0.08, 'sine', 0.04),
    stomp: () => tone(500, 120, 0.2, 'square', 0.06),
    fly: () => tone(200, 600, 0.5, 'sawtooth', 0.04),
    die: () => tone(600, 80, 0.7, 'sawtooth', 0.06),
    hole: () => tone(900, 40, 0.9, 'sine', 0.08),
    fall: () => tone(700, 100, 0.6, 'triangle', 0.06),
  };

  function updateMuteButton() {
    ui.muteBtn.textContent = muted ? '🔇' : '🔊';
    ui.muteBtn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  }

  function toggleMute() {
    muted = !muted;
    save(MUTE_KEY, muted ? '1' : '0');
    updateMuteButton();
    ensureAudio();
  }

  // ---------------------------------------------------------------------------
  // 입력
  // ---------------------------------------------------------------------------
  const keys = new Set();
  const pointers = new Map(); // pointerId -> 방향(-1 또는 1)
  let wantShoot = false;
  let tiltActive = false;
  let tiltValue = 0;
  let tiltAsked = false;
  const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function getAxis() {
    if (state !== 'playing') return 0;
    let a = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) a -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) a += 1;
    if (a !== 0) return a;
    if (tiltActive) return Math.abs(tiltValue) < 2 ? 0 : clamp(tiltValue / 22, -1, 1);
    for (const side of pointers.values()) a += side;
    return clamp(a, -1, 1);
  }

  // iOS는 사용자 제스처 안에서 기울기 권한을 요청해야 함
  function requestTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (tiltAsked || !DOE || typeof DOE.requestPermission !== 'function') return;
    tiltAsked = true;
    DOE.requestPermission().catch(() => {});
  }

  window.addEventListener('deviceorientation', (e) => {
    if (!coarsePointer || e.gamma == null) return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let v = e.gamma;
    if (angle === 90) v = e.beta;
    else if (angle === -90 || angle === 270) v = -e.beta;
    tiltValue = v;
    tiltActive = true;
  });

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter'].includes(code)) {
      e.preventDefault();
    }
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (state === 'menu' || state === 'over') startGame();
      else if (state === 'paused') togglePause();
      return;
    }
    if (code === 'KeyP' || code === 'Escape') {
      togglePause();
      return;
    }
    if (code === 'KeyM') {
      toggleMute();
      return;
    }
    if (!e.repeat && state === 'playing' && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) {
      wantShoot = true;
    }
    keys.add(code);
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));

  window.addEventListener('blur', () => {
    keys.clear();
    pointers.clear();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    ensureAudio();
    const r = canvas.getBoundingClientRect();
    const lx = (e.clientX - r.left) / r.width;
    const ly = (e.clientY - r.top) / r.height;
    // 마우스 클릭, 기울기 조작 중의 탭, 화면 위쪽 탭은 쏘기
    if (e.pointerType === 'mouse' || tiltActive || ly < 0.33) {
      wantShoot = true;
      return;
    }
    pointers.set(e.pointerId, lx < 0.5 ? -1 : 1);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const r = canvas.getBoundingClientRect();
    pointers.set(e.pointerId, (e.clientX - r.left) / r.width < 0.5 ? -1 : 1);
  });

  const releasePointer = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', releasePointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // 게임 상태
  // ---------------------------------------------------------------------------
  let state = 'menu'; // menu | playing | paused | over
  let best = parseInt(load(BEST_KEY, '0'), 10) || 0;
  let player;
  let platforms;
  let hazards;
  let bullets;
  let particles;
  let camY; // 화면 맨 위의 월드 y좌표 (위로 갈수록 작아짐)
  let startY;
  let maxHeight;
  let chainY; // 마지막으로 만든 "밟을 수 있는" 발판의 y
  let nextHazardY;
  let time;

  const heightAt = (y) => startY - y;
  const difficultyAt = (y) => clamp(heightAt(y) / 25000, 0, 1);
  const score = () => Math.floor(maxHeight);

  function reset() {
    platforms = [];
    hazards = [];
    bullets = [];
    particles = [];
    camY = 0;
    time = 0;
    const baseY = H - 40;
    startY = baseY - PLAYER_H;
    maxHeight = 0;
    player = {
      x: W / 2 - PLAYER_W / 2,
      y: startY,
      vx: 0,
      vy: JUMP_V,
      face: 1,
      shootT: 0,
      cooldown: 0,
      fly: null,
      mode: 'normal', // normal | dead | sucked
      suck: null,
    };
    addPlatform('green', W / 2 - PLAT_W / 2, baseY);
    chainY = baseY;
    nextHazardY = startY - 1500 - rand(0, 800);
    generate();
  }

  // ---------------------------------------------------------------------------
  // 레벨 생성
  // ---------------------------------------------------------------------------
  function addPlatform(type, x, y) {
    const pl = { type, x, y, vx: 0, vy: 0, item: null, broken: false, gone: false, fade: 1, rot: 0, split: 0 };
    platforms.push(pl);
    return pl;
  }

  function hazardBox(hz) {
    if (hz.kind === 'hole') return { x: hz.x - hz.r, y: hz.y - hz.r, w: hz.r * 2, h: hz.r * 2 };
    // 몬스터는 좌우로 15px씩 흔들리므로 그 범위까지 포함
    return { x: hz.baseX - 15, y: hz.baseY, w: hz.w + 30, h: hz.h };
  }

  // 발판이 장애물 근처(위아래 110px, 좌우 24px 여유)에 놓이는지
  function nearHazard(x, y, w) {
    for (const hz of hazards) {
      const b = hazardBox(hz);
      if (Math.abs(b.y + b.h / 2 - y) < 110 && x < b.x + b.w + 24 && x + w > b.x - 24) return true;
    }
    return false;
  }

  function pickX(y) {
    let x = rand(0, W - PLAT_W);
    for (let i = 0; i < 12 && nearHazard(x, y, PLAT_W); i++) x = rand(0, W - PLAT_W);
    return x;
  }

  function spawnHazard(y) {
    const hole = heightAt(y) > 5000 && Math.random() < 0.3;
    const w = hole ? 64 : 90;
    const clash = (x) =>
      platforms.some((pl) => Math.abs(pl.y - y) < 110 && x < pl.x + PLAT_W + 24 && x + w > pl.x - 24);
    let x = rand(0, W - w);
    for (let i = 0; i < 12 && clash(x); i++) x = rand(0, W - w);
    if (clash(x)) return false;
    if (hole) {
      hazards.push({ kind: 'hole', x: x + 32, y, r: 32, spin: 0 });
    } else {
      const top = y - 22;
      hazards.push({
        kind: 'monster', x: x + 15, y: top, baseX: x + 15, baseY: top, w: 60, h: 44,
        phase: rand(0, Math.PI * 2), alive: true, vx: 0, vy: 0, rot: 0,
      });
    }
    return true;
  }

  // 화면 위쪽까지 발판을 미리 만들어 둠. 연속된 "밟을 수 있는" 발판 사이 간격은
  // 최대 180px로 제한해서 최고 점프 높이(225px) 안에 항상 다음 발판이 있게 함
  function generate() {
    while (chainY > camY - 120) {
      const d = difficultyAt(chainY);
      const h = heightAt(chainY);
      const gap = rand(35 + 45 * d, 75 + 105 * d);
      const prevY = chainY;
      chainY -= gap;

      if (h > 1500 && chainY < nextHazardY && spawnHazard(chainY)) {
        nextHazardY = chainY - rand(1200, 2200) * (1 - 0.45 * d);
      }

      // 갈색 발판은 함정이라 경로 계산에서 빠지고, 두 발판 사이에 끼워 넣음
      if (h > 500 && gap > 55 && Math.random() < 0.12 + 0.2 * d) {
        const by = prevY - gap / 2;
        addPlatform('brown', pickX(by), by);
      }

      const r = Math.random();
      const pBlue = h > 800 ? 0.08 + 0.32 * d : 0;
      const pWhite = h > 2500 ? 0.05 + 0.2 * d : 0;
      const type = r < pBlue ? 'blue' : r < pBlue + pWhite ? 'white' : 'green';
      const pl = addPlatform(type, pickX(chainY), chainY);
      if (type === 'blue') pl.vx = (Math.random() < 0.5 ? -1 : 1) * (50 + 110 * d);

      if (type !== 'white' && h > 200) {
        const ir = Math.random();
        let it = null;
        if (h > 2500 && ir < 0.008) it = 'jetpack';
        else if (h > 800 && ir < 0.025) it = 'propeller';
        else if (ir < 0.07) it = 'spring';
        if (it) {
          const iw = it === 'spring' ? SPRING.w : FLY[it].w;
          pl.item = { type: it, ox: rand(4, PLAT_W - iw - 4), t: 0 };
        }
      }
    }
  }

  function cleanup() {
    const limit = camY + H + 80;
    platforms = platforms.filter((pl) => pl.y < limit && !(pl.gone && pl.fade <= 0));
    hazards = hazards.filter((hz) => (hz.kind === 'hole' ? hz.y - hz.r : hz.y) < limit);
    bullets = bullets.filter((b) => !b.dead && b.y > camY - 40);
    particles = particles.filter((pt) => pt.life > 0 && pt.y < limit);
  }

  // ---------------------------------------------------------------------------
  // 업데이트
  // ---------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    updatePlatforms(dt);
    updateHazards(dt);
    updatePlayer(dt);
    updateBullets(dt);
    updateParticles(dt);
    generate();
    cleanup();
  }

  function updatePlatforms(dt) {
    for (const pl of platforms) {
      if (pl.vx) {
        pl.x += pl.vx * dt;
        if (pl.x < 0) {
          pl.x = 0;
          pl.vx = -pl.vx;
        } else if (pl.x > W - PLAT_W) {
          pl.x = W - PLAT_W;
          pl.vx = -pl.vx;
        }
      }
      if (pl.broken) {
        pl.vy += GRAVITY * dt;
        pl.y += pl.vy * dt;
        pl.rot += dt * 1.5;
        pl.split += dt * 30;
      }
      if (pl.gone) pl.fade -= dt * 4;
      if (pl.item && pl.item.t > 0) pl.item.t -= dt;
    }
  }

  function updateHazards(dt) {
    for (const hz of hazards) {
      if (hz.kind === 'hole') {
        hz.spin += dt * 2;
      } else if (hz.alive) {
        hz.x = hz.baseX + Math.sin(time * 2 + hz.phase) * 15;
        hz.y = hz.baseY + Math.sin(time * 5 + hz.phase) * 3;
      } else {
        hz.vy += GRAVITY * dt;
        hz.y += hz.vy * dt;
        hz.x += hz.vx * dt;
        hz.rot += dt * 6;
      }
    }
  }

  function updatePlayer(dt) {
    const p = player;
    p.shootT = Math.max(0, p.shootT - dt);
    p.cooldown = Math.max(0, p.cooldown - dt);

    if (p.mode === 'sucked') {
      p.suck.t += dt;
      if (p.suck.t >= 0.8) gameOver();
      return;
    }

    if (p.mode === 'normal') {
      const axis = getAxis();
      p.vx += (axis * MAX_VX - p.vx) * Math.min(1, 12 * dt);
      if (axis > 0.1) p.face = 1;
      else if (axis < -0.1) p.face = -1;
      if (wantShoot) shoot();
    } else {
      p.vx *= Math.max(0, 1 - 3 * dt);
    }
    wantShoot = false;

    if (p.fly) {
      const def = FLY[p.fly.type];
      p.fly.t += dt;
      p.vy = def.v;
      if (p.fly.t >= def.dur) {
        // 다 쓴 아이템은 떨어뜨림
        particles.push({
          kind: 'item', type: p.fly.type, x: p.x + PLAYER_W / 2, y: p.y + 12,
          vx: -p.face * 120, vy: -200, rot: 0, vr: -p.face * 6, life: 3,
        });
        p.fly = null;
      }
    } else {
      p.vy += GRAVITY * dt;
    }

    const prevBottom = p.y + PLAYER_H;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const cx = p.x + PLAYER_W / 2;
    if (cx < 0) p.x += W;
    else if (cx > W) p.x -= W;

    if (p.mode === 'dead') {
      if (p.y > camY + H + 60) gameOver();
      return;
    }

    if (!p.fly && p.vy > 0) land(prevBottom);
    pickUp();
    hitHazards(prevBottom);
    if (p.mode !== 'normal') return;

    if (p.y < camY + H * 0.4) camY = p.y - H * 0.4;
    maxHeight = Math.max(maxHeight, startY - p.y);

    if (p.y > camY + H) {
      sfx.fall();
      gameOver();
    }
  }

  function land(prevBottom) {
    const p = player;
    const bottom = p.y + PLAYER_H;
    const fl = p.x + 12;
    const fr = p.x + PLAYER_W - 12;

    // 스프링이 발판보다 위에 있으므로 먼저 검사
    for (const pl of platforms) {
      const it = pl.item;
      if (!it || it.type !== 'spring' || pl.gone || pl.broken) continue;
      const sx = pl.x + it.ox;
      const sy = pl.y - SPRING.h;
      if (prevBottom <= sy + 1 && bottom >= sy && spanHit(fl, fr, sx, sx + SPRING.w)) {
        p.y = sy - PLAYER_H;
        p.vy = SPRING_V;
        it.t = 0.25;
        sfx.spring();
        return;
      }
    }

    for (const pl of platforms) {
      if (pl.gone || pl.broken) continue;
      if (prevBottom <= pl.y + 1 && bottom >= pl.y && spanHit(fl, fr, pl.x, pl.x + PLAT_W)) {
        if (pl.type === 'brown') {
          pl.broken = true;
          sfx.crack();
          continue;
        }
        p.y = pl.y - PLAYER_H;
        p.vy = JUMP_V;
        if (pl.type === 'white') {
          pl.gone = true;
          sfx.poof();
        } else {
          sfx.jump();
        }
        return;
      }
    }
  }

  function pickUp() {
    const p = player;
    if (p.fly) return;
    for (const pl of platforms) {
      const it = pl.item;
      if (!it || it.type === 'spring' || pl.broken) continue;
      const def = FLY[it.type];
      if (rectsHit(p.x + 6, p.y, PLAYER_W - 12, PLAYER_H, pl.x + it.ox, pl.y - def.h, def.w, def.h)) {
        pl.item = null;
        p.fly = { type: it.type, t: 0 };
        sfx.fly();
        return;
      }
    }
  }

  function killMonster(m, vx) {
    m.alive = false;
    m.vy = -250;
    m.vx = vx;
    particles.push({ kind: 'puff', x: m.x + m.w / 2, y: m.y + m.h / 2, vx: 0, vy: 0, life: 0.4 });
  }

  function hitHazards(prevBottom) {
    const p = player;
    for (const hz of hazards) {
      if (hz.kind === 'monster') {
        if (!hz.alive) continue;
        if (!rectsHit(p.x + 8, p.y + 6, PLAYER_W - 16, PLAYER_H - 6, hz.x + 6, hz.y + 6, hz.w - 12, hz.h - 10)) {
          continue;
        }
        if (p.fly) {
          // 비행 중에는 무적, 부딪힌 몬스터는 튕겨 나감
          killMonster(hz, p.vx * 0.5);
          sfx.stomp();
        } else if (p.vy > 0 && prevBottom <= hz.y + 18) {
          killMonster(hz, 0);
          p.vy = JUMP_V;
          sfx.stomp();
        } else {
          p.mode = 'dead';
          p.vy = Math.max(0, p.vy) * 0.3;
          sfx.die();
          return;
        }
      } else if (!p.fly) {
        let dx = p.x + PLAYER_W / 2 - hz.x;
        if (dx > W / 2) dx -= W;
        else if (dx < -W / 2) dx += W;
        const dy = p.y + PLAYER_H / 2 - hz.y;
        if (dx * dx + dy * dy < (hz.r + 8) ** 2) {
          p.mode = 'sucked';
          p.suck = { t: 0, x0: hz.x + dx, y0: hz.y + dy, hz };
          sfx.hole();
          return;
        }
      }
    }
  }

  function shoot() {
    const p = player;
    if (p.fly || p.cooldown > 0) return;
    bullets.push({ x: p.x + PLAYER_W / 2, y: p.y - 12, dead: false });
    p.shootT = 0.3;
    p.cooldown = 0.12;
    sfx.shoot();
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      b.y += BULLET_V * dt;
      for (const hz of hazards) {
        if (hz.kind !== 'monster' || !hz.alive) continue;
        if (b.x > hz.x && b.x < hz.x + hz.w && b.y > hz.y && b.y < hz.y + hz.h) {
          killMonster(hz, 0);
          sfx.stomp();
          b.dead = true;
          break;
        }
      }
    }
  }

  function updateParticles(dt) {
    for (const pt of particles) {
      pt.life -= dt;
      if (pt.kind === 'item') {
        pt.vy += GRAVITY * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.rot += pt.vr * dt;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 그리기
  // ---------------------------------------------------------------------------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fillStroke(fill, line, width) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function render() {
    const k = scale * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawPaper();

    ctx.save();
    ctx.translate(0, -camY);
    for (const pl of platforms) drawPlatform(pl);
    for (const hz of hazards) {
      if (hz.kind === 'hole') drawHole(hz);
      else drawMonster(hz);
    }
    for (const b of bullets) drawBullet(b);
    for (const pt of particles) drawParticle(pt);
    drawPlayer();
    ctx.restore();

    if (state !== 'menu') drawHud();
  }

  function drawPaper() {
    ctx.fillStyle = '#f7f3e8';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(110, 150, 200, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const off = ((-camY % 20) + 20) % 20;
    for (let y = off; y < H; y += 20) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    for (let x = 0; x <= W; x += 20) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    ctx.stroke();
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(247, 243, 232, 0.88)';
    ctx.fillRect(0, 0, W, 42);
    ctx.strokeStyle = 'rgba(47, 58, 18, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 42);
    ctx.lineTo(W, 42);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = 'bold 22px "Segoe UI", "Malgun Gothic", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(fmt(score()), 12, 22);

    const f = player.fly;
    if (f) {
      const left = 1 - f.t / FLY[f.type].dur;
      ctx.fillStyle = 'rgba(47, 58, 18, 0.2)';
      ctx.fillRect(12, 48, 80, 6);
      ctx.fillStyle = f.type === 'jetpack' ? '#e5533d' : '#3c8de0';
      ctx.fillRect(12, 48, 80 * clamp(left, 0, 1), 6);
    }
  }

  function drawPlatform(pl) {
    const [fill, line] = PLAT_COLORS[pl.type];
    ctx.save();
    if (pl.gone) ctx.globalAlpha = Math.max(0, pl.fade);
    if (pl.broken) {
      const hw = PLAT_W / 2;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(pl.x + hw + side * (hw / 2 + pl.split), pl.y + PLAT_H / 2);
        ctx.rotate(side * pl.rot);
        rr(-hw / 2, -PLAT_H / 2, hw, PLAT_H, 4);
        fillStroke(fill, line, 2);
        ctx.restore();
      }
    } else {
      rr(pl.x, pl.y, PLAT_W, PLAT_H, 6);
      fillStroke(fill, line, 2);
      ctx.strokeStyle = pl.type === 'white' ? 'rgba(143, 154, 165, 0.5)' : 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(pl.x + 8, pl.y + 4.5);
      ctx.lineTo(pl.x + PLAT_W - 8, pl.y + 4.5);
      ctx.stroke();
      if (pl.type === 'brown') {
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pl.x + 30, pl.y + 1);
        ctx.lineTo(pl.x + 27, pl.y + 6);
        ctx.lineTo(pl.x + 33, pl.y + 9);
        ctx.lineTo(pl.x + 30, pl.y + PLAT_H - 1);
        ctx.stroke();
      }
      if (pl.item) drawItem(pl.item.type, pl.x + pl.item.ox, pl.y, pl.item.t > 0);
    }
    ctx.restore();
  }

  // (x, baseY) = 아이템이 놓인 왼쪽 아래 지점
  function drawItem(type, x, baseY, squashed) {
    if (type === 'spring') drawSpring(x, baseY, squashed);
    else if (type === 'propeller') drawPropeller(x + FLY.propeller.w / 2, baseY, 0.6);
    else drawJetpack(x, baseY - FLY.jetpack.h, false);
  }

  function drawSpring(x, baseY, squashed) {
    const h = squashed ? 7 : SPRING.h;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const yy = baseY - ((h - 3) * i) / 4;
      const xx = x + (i % 2 ? SPRING.w - 3 : 3);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    rr(x, baseY - h - 1, SPRING.w, 4, 2);
    fillStroke('#c4c9cf', '#555', 1.5);
  }

  function drawPropeller(cx, bottomY, spin) {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, bottomY - 10);
    ctx.lineTo(cx, bottomY - 15);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, bottomY - 16, 14 * Math.abs(Math.cos(spin)) + 2, 3, 0, 0, Math.PI * 2);
    fillStroke('#f2c230', '#333', 1.5);
    ctx.beginPath();
    ctx.arc(cx, bottomY, 11, Math.PI, 0);
    ctx.closePath();
    fillStroke('#3c8de0', '#1d4f86', 2);
  }

  function drawJetpack(x, y, flames) {
    for (const ox of [0, 14]) {
      if (flames) {
        const len = 14 + Math.random() * 12;
        ctx.beginPath();
        ctx.moveTo(x + ox + 1, y + 31);
        ctx.lineTo(x + ox + 11, y + 31);
        ctx.lineTo(x + ox + 6, y + 31 + len);
        ctx.closePath();
        ctx.fillStyle = '#ff9f2e';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + ox + 3.5, y + 31);
        ctx.lineTo(x + ox + 8.5, y + 31);
        ctx.lineTo(x + ox + 6, y + 31 + len * 0.6);
        ctx.closePath();
        ctx.fillStyle = '#fff27a';
        ctx.fill();
      }
      rr(x + ox + 3, y + 26, 6, 5, 1);
      fillStroke('#666', '#4a4f57', 1.5);
      rr(x + ox, y + 4, 12, 24, 5);
      fillStroke('#c9ced6', '#4a4f57', 2);
      rr(x + ox + 1, y, 10, 7, 3);
      fillStroke('#e5533d', '#8a2a1c', 1.5);
    }
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(x + 12, y + 12, 2, 8);
  }

  function drawMonster(m) {
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    const t = time * 10 + m.phase;
    ctx.save();
    ctx.translate(cx, cy);
    if (!m.alive) ctx.rotate(m.rot);

    // 날개
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 28, -4 + Math.sin(t) * 4, 10, 5, side * 0.5, 0, Math.PI * 2);
      fillStroke('#a98be8', '#2e1f66', 2);
    }
    // 뿔
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 14 - 5, -14);
      ctx.lineTo(side * 16, -27);
      ctx.lineTo(side * 14 + 5, -14);
      ctx.closePath();
      fillStroke('#f4d35e', '#2e1f66', 2);
    }
    // 몸통
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 21, 0, 0, Math.PI * 2);
    fillStroke('#7a5bd6', '#2e1f66', 2.5);
    // 눈
    let lx = 0;
    let ly = 0;
    if (m.alive) {
      const dx = player.x + PLAYER_W / 2 - cx;
      const dy = player.y + PLAYER_H / 2 - cy;
      const dist = Math.hypot(dx, dy) || 1;
      lx = (dx / dist) * 2.5;
      ly = (dy / dist) * 2.5;
    }
    for (const side of [-1, 1]) {
      const ex = side * 9;
      ctx.beginPath();
      ctx.arc(ex, -5, 7, 0, Math.PI * 2);
      fillStroke('#fff', '#2e1f66', 2);
      if (m.alive) {
        ctx.beginPath();
        ctx.arc(ex + lx, -5 + ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex - 3, -8);
        ctx.lineTo(ex + 3, -2);
        ctx.moveTo(ex + 3, -8);
        ctx.lineTo(ex - 3, -2);
        ctx.stroke();
      }
    }
    // 입과 이빨
    ctx.beginPath();
    ctx.arc(0, 6, 10, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#2e1f66';
    ctx.fill();
    ctx.fillStyle = '#fff';
    for (const tx of [-5, 3]) {
      ctx.beginPath();
      ctx.moveTo(tx, 6);
      ctx.lineTo(tx + 2, 10);
      ctx.lineTo(tx + 4, 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHole(hz) {
    const g = ctx.createRadialGradient(hz.x, hz.y, 2, hz.x, hz.y, hz.r + 12);
    g.addColorStop(0, '#000');
    g.addColorStop(0.55, '#140a26');
    g.addColorStop(0.8, 'rgba(60, 30, 110, 0.6)');
    g.addColorStop(1, 'rgba(60, 30, 110, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, hz.r + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 140, 255, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = hz.spin * (1 + i * 0.3) + i * 2;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r * (0.45 + 0.22 * i), a, a + 2.2);
      ctx.stroke();
    }
  }

  function drawBullet(b) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    fillStroke('#7fa82e', INK, 1.5);
  }

  function drawParticle(pt) {
    if (pt.kind === 'item') {
      const def = FLY[pt.type];
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rot);
      drawItem(pt.type, -def.w / 2, def.h / 2, false);
      ctx.restore();
    } else if (pt.kind === 'puff') {
      const k = 1 - pt.life / 0.4;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.strokeStyle = '#7a5bd6';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r1 = 18 + k * 22;
        const r2 = r1 + 8;
        ctx.beginPath();
        ctx.moveTo(pt.x + Math.cos(a) * r1, pt.y + Math.sin(a) * r1);
        ctx.lineTo(pt.x + Math.cos(a) * r2, pt.y + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPlayer() {
    const p = player;
    if (p.mode === 'sucked') {
      const k = Math.min(1, p.suck.t / 0.8);
      const { hz } = p.suck;
      ctx.save();
      ctx.translate(lerp(p.suck.x0, hz.x, k), lerp(p.suck.y0, hz.y, k));
      ctx.rotate(k * 12);
      ctx.scale(1 - k, 1 - k);
      drawDoodler(p);
      ctx.restore();
      return;
    }
    const cx = p.x + PLAYER_W / 2;
    const cy = p.y + PLAYER_H / 2;
    // 화면 끝을 넘어가는 중이면 반대편에도 그림
    for (const s of [0, -W, W]) {
      if (s !== 0 && (cx + s + PLAYER_W / 2 < 0 || cx + s - PLAYER_W / 2 > W)) continue;
      ctx.save();
      ctx.translate(cx + s, cy);
      drawDoodler(p);
      ctx.restore();
    }
  }

  function bodyPath() {
    ctx.beginPath();
    ctx.moveTo(-15, 13);
    ctx.lineTo(-15, -4);
    ctx.arc(0, -4, 15, Math.PI, 0);
    ctx.lineTo(15, 13);
    ctx.closePath();
  }

  // 원점 = 캐릭터 중심, 오른쪽을 보는 모습으로 그리고 필요하면 좌우 반전
  function drawDoodler(p) {
    const up = p.shootT > 0 && !p.fly;
    ctx.save();
    if (!up) ctx.scale(p.face, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (p.fly && p.fly.type === 'jetpack') drawJetpack(-27, -16, true);

    // 다리
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const lx of [-10, -4, 2, 8]) {
      ctx.moveTo(lx, 12);
      ctx.lineTo(lx, 20);
      ctx.lineTo(lx + 3, 20);
    }
    ctx.stroke();

    // 코 (몸통 뒤에 그려서 붙어 있는 부분이 가려지게 함)
    if (up) {
      rr(-5, -34, 10, 22, 4);
      fillStroke(BODY, INK, 2.5);
      ctx.beginPath();
      ctx.ellipse(0, -34, 5, 2.2, 0, 0, Math.PI * 2);
      fillStroke(BODY, INK, 2);
    } else {
      rr(6, -14, 21, 10, 4);
      fillStroke(BODY, INK, 2.5);
      ctx.beginPath();
      ctx.ellipse(27, -9, 2.2, 5, 0, 0, Math.PI * 2);
      fillStroke(BODY, INK, 2);
    }

    // 몸통과 줄무늬 바지
    bodyPath();
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = BELLY;
    ctx.fillRect(-16, 3, 32, 11);
    ctx.strokeStyle = 'rgba(47, 58, 18, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let sx = -12; sx <= 12; sx += 6) {
      ctx.moveTo(sx, 3);
      ctx.lineTo(sx, 14);
    }
    ctx.stroke();
    ctx.restore();
    bodyPath();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-15, 3);
    ctx.lineTo(15, 3);
    ctx.lineWidth = 2;
    ctx.stroke();

    // 눈
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    if (p.mode === 'dead') {
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (const ex of [1, 8]) {
        ctx.moveTo(ex - 2.5, -12.5);
        ctx.lineTo(ex + 2.5, -7.5);
        ctx.moveTo(ex + 2.5, -12.5);
        ctx.lineTo(ex - 2.5, -7.5);
      }
      ctx.stroke();
    } else {
      const eyes = up ? [[-5, -8], [5, -8]] : [[1, -10], [8, -10]];
      for (const [ex, ey] of eyes) {
        ctx.beginPath();
        ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (p.fly && p.fly.type === 'propeller') drawPropeller(0, -17, time * 30);
    ctx.restore();

    // 기절한 별
    if (p.mode === 'dead') {
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 3;
        drawStar(Math.cos(a) * 15, -26 + Math.sin(a) * 4, 4.5);
      }
    }
  }

  function drawStar(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr2 = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
    }
    ctx.closePath();
    fillStroke('#ffd23f', '#8a6d00', 1);
  }

  // ---------------------------------------------------------------------------
  // 화면 전환
  // ---------------------------------------------------------------------------
  function startGame() {
    if (state === 'playing') return;
    ensureAudio();
    requestTilt();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    reset();
    state = 'playing';
    wantShoot = false;
    pointers.clear();
    show(ui.start, false);
    show(ui.over, false);
    show(ui.pause, false);
    show(ui.pauseBtn, true);
  }

  function gameOver() {
    if (state === 'menu') {
      // 시작 화면의 데모 캐릭터는 그냥 다시 시작
      reset();
      return;
    }
    if (state !== 'playing') return;
    state = 'over';
    const s = score();
    const isNew = s > best;
    if (isNew) {
      best = s;
      save(BEST_KEY, best);
    }
    ui.finalScore.textContent = fmt(s);
    ui.finalBest.textContent = fmt(best);
    ui.bestStart.textContent = fmt(best);
    show(ui.newRecord, isNew);
    show(ui.over, true);
    show(ui.pauseBtn, false);
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      keys.clear();
      pointers.clear();
      show(ui.pause, true);
    } else if (state === 'paused') {
      state = 'playing';
      show(ui.pause, false);
    }
  }

  ui.startBtn.addEventListener('click', startGame);
  ui.retryBtn.addEventListener('click', startGame);
  ui.resumeBtn.addEventListener('click', togglePause);
  ui.pauseBtn.addEventListener('click', () => {
    ui.pauseBtn.blur();
    togglePause();
  });
  ui.muteBtn.addEventListener('click', () => {
    ui.muteBtn.blur();
    toggleMute();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause();
  });
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------------------
  // 메인 루프 (고정 시간 단계)
  // ---------------------------------------------------------------------------
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (state === 'playing' || state === 'menu') {
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
        if (state !== 'playing' && state !== 'menu') {
          acc = 0;
          break;
        }
      }
    } else {
      acc = 0;
    }
    render();
    requestAnimationFrame(frame);
  }

  resize();
  updateMuteButton();
  ui.bestStart.textContent = fmt(best);
  reset();
  requestAnimationFrame(frame);
})();
