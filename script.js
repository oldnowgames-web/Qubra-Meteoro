(() => {
  'use strict';

  // ---------- Configuração ----------
  const CFG = {
    lives: 5,
    gapMin: 0.5,      // intervalo mínimo entre meteoros (s)
    gapMax: 2,        // intervalo máximo entre meteoros (s)
    life: 1.5,        // tempo que o meteoro fica parado (s)
    levelEvery: 20,   // a cada quantos segundos fica mais rápido
    ramp: 0.85        // cada nível multiplica os tempos por este valor
  };
  const STORE = 'quebra-meteoro:v1';

  const $ = (s) => document.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);

  const ui = {
    stage: $('#stage'), hud: $('#hud'), field: $('#field'), toast: $('#toast'),
    who: $('#who'), level: $('#level'), hearts: $('#hearts'), score: $('#score'), bar: $('#levelbar'),
    mute: $('#mute'), quit: $('#quit'),
    menu: $('#menu'), over: $('#over'),
    form: $('#addForm'), name: $('#nameInput'), hint: $('#hint'), chips: $('#chips'), play: $('#play'),
    rankMenu: $('#rankMenu'), rankOver: $('#rankOver'), clear: $('#clear'),
    result: $('#result'), again: $('#again'), change: $('#change')
  };

  // ---------- Jogadores e placar (localStorage) ----------
  let store = readStore();
  let current = store.players.find((p) => p.name === store.last) || null;

  function readStore() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d && Array.isArray(d.players)) {
        return {
          players: d.players
            .filter((p) => p && typeof p.name === 'string')
            .map((p) => ({ name: p.name, best: Number(p.best) || 0, last: p.last == null ? null : Number(p.last), games: Number(p.games) || 0 })),
          last: d.last || null
        };
      }
    } catch (e) { /* sem armazenamento: segue sem salvar */ }
    return { players: [], last: null };
  }

  function writeStore() {
    try {
      store.last = current ? current.name : null;
      localStorage.setItem(STORE, JSON.stringify(store));
    } catch (e) { /* ignora */ }
  }

  function renderRanking(box, highlight) {
    box.replaceChildren();
    if (!store.players.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Ainda não há jogadores. Adicione um nome para começar.';
      box.append(p);
      return;
    }
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>#</th><th>Jogador</th><th>Melhor</th><th>Última</th><th>Partidas</th></tr></thead>';
    const body = document.createElement('tbody');
    [...store.players]
      .sort((a, b) => b.best - a.best || a.name.localeCompare(b.name))
      .forEach((p, i) => {
        const tr = document.createElement('tr');
        if (p === highlight) tr.className = 'me';
        [i + 1, p.name, p.best, p.last == null ? '–' : p.last, p.games].forEach((v) => {
          const td = document.createElement('td');
          td.textContent = v;
          tr.append(td);
        });
        body.append(tr);
      });
    table.append(body);
    box.append(table);
  }

  function renderMenu() {
    ui.hint.hidden = store.players.length > 0;
    ui.chips.replaceChildren(...store.players.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p.name;
      b.setAttribute('aria-pressed', String(p === current));
      b.addEventListener('click', () => { current = p; writeStore(); renderMenu(); });
      return b;
    }));
    ui.play.disabled = !current;
    ui.play.textContent = current ? 'Jogar como ' + current.name : 'Jogar';
    ui.clear.hidden = !store.players.length;
    renderRanking(ui.rankMenu, current);
  }

  function show(which) {
    ui.menu.hidden = which !== 'menu';
    ui.over.hidden = which !== 'over';
    ui.hud.hidden = which === 'menu';
  }

  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = ui.name.value.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!name) return;
    let p = store.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) {
      p = { name, best: 0, last: null, games: 0 };
      store.players.push(p);
    }
    current = p;
    ui.name.value = '';
    writeStore();
    renderMenu();
  });

  ui.clear.addEventListener('click', () => {
    if (!confirm('Apagar todos os jogadores e o placar?')) return;
    store = { players: [], last: null };
    current = null;
    writeStore();
    renderMenu();
  });

  // ---------- Som ----------
  let ac = null;
  let muted = false;

  function ensureAudio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function tone(from, to, dur, type, vol) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  }

  function sfx(kind) {
    if (kind === 'break') { tone(320, 60, 0.22, 'sawtooth', 0.14); tone(900, 300, 0.1, 'square', 0.05); }
    else { tone(200, 70, 0.4, 'triangle', 0.2); }
  }

  ui.mute.addEventListener('click', () => {
    muted = !muted;
    ui.mute.textContent = muted ? 'Som desligado' : 'Som ligado';
  });

  // ---------- Jogo ----------
  let g = null;
  let raf = 0;
  let lastTs = 0;
  let toastTimer = 0;

  const ramp = () => Math.pow(CFG.ramp, g.level);
  const lifeNow = () => Math.max(0.6, CFG.life * ramp());
  const gapNow = () => rand(CFG.gapMin, CFG.gapMax) * Math.max(0.35, ramp());

  function start() {
    if (!current) return;
    ui.field.replaceChildren();
    g = { t: 0, lives: CFG.lives, score: 0, level: 0, meteors: [], spawnIn: 0.7, running: true };
    show('game');
    ui.who.textContent = current.name;
    updateHud();
    ensureAudio();
    lastTs = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function updateHud() {
    ui.score.textContent = g.score;
    ui.level.textContent = 'Nível ' + (g.level + 1);
    ui.hearts.setAttribute('aria-label', 'Vidas: ' + g.lives);
    ui.hearts.innerHTML = Array.from({ length: CFG.lives }, (_, i) =>
      '<span class="heart' + (i < g.lives ? '' : ' lost') + '">♥</span>').join('');
  }

  function say(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1200);
  }

  function frame(now) {
    if (!g || !g.running) return;
    const dt = Math.min((now - lastTs) / 1000, 0.1);
    lastTs = now;
    g.t += dt;

    const level = Math.floor(g.t / CFG.levelEvery);
    if (level !== g.level) {
      g.level = level;
      updateHud();
      say('Mais rápido!');
    }
    ui.bar.style.transform = 'scaleX(' + ((g.t % CFG.levelEvery) / CFG.levelEvery) + ')';

    g.spawnIn -= dt;
    if (g.spawnIn <= 0) {
      spawn();
      g.spawnIn = gapNow();
    }

    for (const m of g.meteors.slice()) {
      m.age += dt;
      const used = Math.min(m.age / m.life, 1);
      m.ring.style.strokeDashoffset = String(used * 100);
      if (used > 0.65) m.el.classList.add('low');
      if (m.age >= m.life) miss(m);
      if (!g.running) return;
    }
    raf = requestAnimationFrame(frame);
  }

  function rockMarkup() {
    const n = 11;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = rand(29, 38);
      pts.push((50 + Math.cos(a) * r).toFixed(1) + ',' + (50 + Math.sin(a) * r).toFixed(1));
    }
    let craters = '';
    for (let i = 0; i < 3; i++) {
      craters += '<circle cx="' + (50 + rand(-16, 16)).toFixed(1) + '" cy="' + (50 + rand(-16, 16)).toFixed(1) + '" r="' + rand(3, 7).toFixed(1) + '"/>';
    }
    return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="ring" cx="50" cy="50" r="47" pathLength="100"/>' +
      '<polygon class="rock" points="' + pts.join(' ') + '"/>' +
      '<g class="craters">' + craters + '</g></svg>';
  }

  function spawn() {
    const w = ui.field.clientWidth;
    const h = ui.field.clientHeight;
    const size = Math.min(130, Math.max(54, Math.min(w, h) * 0.15)) * rand(0.85, 1.2);
    let x = 0, y = 0, ok = false;
    for (let i = 0; i < 14 && !ok; i++) {
      x = rand(6, Math.max(7, w - size - 6));
      y = rand(6, Math.max(7, h - size - 6));
      ok = g.meteors.every((m) => Math.hypot(m.x - x, m.y - y) > (m.size + size) / 2 + 8);
    }
    if (!ok) return;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'meteor';
    el.setAttribute('aria-label', 'Meteoro');
    el.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px;';
    el.innerHTML = rockMarkup();

    const m = { el, ring: el.querySelector('.ring'), x, y, size, age: 0, life: lifeNow(), dead: false };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); hit(m); });
    el.addEventListener('click', (e) => { if (e.detail === 0) hit(m); }); // teclado
    g.meteors.push(m);
    ui.field.append(el);
  }

  const CLIPS = [
    'polygon(50% 0, 100% 100%, 0 100%)',
    'polygon(0 0, 100% 30%, 60% 100%)',
    'polygon(20% 0, 100% 50%, 0 90%)'
  ];

  function hit(m) {
    if (!g || !g.running || m.dead) return;
    m.dead = true;
    g.meteors = g.meteors.filter((x) => x !== m);
    const cx = m.x + m.size / 2;
    const cy = m.y + m.size / 2;
    m.el.remove();
    burst(cx, cy, m.size);

    const bonus = Math.round(5 * (1 - m.age / m.life));
    const pts = 10 + g.level * 2 + bonus;
    g.score += pts;
    popup(cx, cy, '+' + pts);
    sfx('break');
    updateHud();
  }

  function burst(cx, cy, size) {
    const wave = document.createElement('div');
    wave.className = 'wave';
    wave.style.cssText = 'left:' + (cx - size / 2) + 'px;top:' + (cy - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px;';
    wave.addEventListener('animationend', () => wave.remove());
    ui.field.append(wave);

    const count = 9;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      const sz = size * rand(0.18, 0.32);
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const dist = size * rand(0.6, 1.3);
      s.className = 'shard';
      s.style.cssText = 'left:' + (cx - sz / 2) + 'px;top:' + (cy - sz / 2) + 'px;width:' + sz + 'px;height:' + sz + 'px;' +
        '--dx:' + (Math.cos(a) * dist) + 'px;--dy:' + (Math.sin(a) * dist) + 'px;--rot:' + rand(-260, 260) + 'deg;' +
        'clip-path:' + CLIPS[i % CLIPS.length] + ';';
      s.addEventListener('animationend', () => s.remove());
      ui.field.append(s);
    }
  }

  function popup(cx, cy, text) {
    const p = document.createElement('div');
    p.className = 'pop';
    p.textContent = text;
    p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;';
    p.addEventListener('animationend', () => p.remove());
    ui.field.append(p);
  }

  function miss(m) {
    if (m.dead) return;
    m.dead = true;
    g.meteors = g.meteors.filter((x) => x !== m);
    m.el.classList.add('gone');
    setTimeout(() => m.el.remove(), 300);

    g.lives -= 1;
    updateHud();
    sfx('miss');
    ui.stage.classList.remove('hurt');
    void ui.stage.offsetWidth;
    ui.stage.classList.add('hurt');

    if (g.lives <= 0) endGame();
  }

  function endGame() {
    g.running = false;
    cancelAnimationFrame(raf);
    g.meteors.forEach((m) => {
      m.dead = true;
      m.el.classList.add('gone');
      setTimeout(() => m.el.remove(), 300);
    });
    g.meteors = [];

    const score = g.score;
    const player = current;
    const record = score > player.best;
    player.last = score;
    player.games += 1;
    if (record) player.best = score;
    writeStore();

    setTimeout(() => {
      if (g.running) return; // uma nova partida já começou
      ui.result.textContent = record && score > 0
        ? player.name + ', novo recorde: ' + score + ' pontos!'
        : player.name + ', você fez ' + score + ' pontos. Seu recorde é ' + player.best + '.';
      renderRanking(ui.rankOver, player);
      show('over');
    }, 700);
  }

  function quit() {
    if (g) g.running = false;
    cancelAnimationFrame(raf);
    ui.field.replaceChildren();
    renderMenu();
    show('menu');
  }

  ui.play.addEventListener('click', start);
  ui.again.addEventListener('click', start);
  ui.quit.addEventListener('click', quit);
  ui.change.addEventListener('click', () => { renderMenu(); show('menu'); });

  renderMenu();
  show('menu');
})();