/**
 * 游戏 UI 渲染模块
 * 处理植物、僵尸、投射物、特效的渲染和更新
 */

// 图标映射
const plantIcons = {
  sunflower: '🌻',
  peashooter: '🌱',
  repeater: '🌿',
  snowpea: '❄️',
  torchwood: '🔥',
  wallnut: '🌰',
  tallnut: '🥜',
  chomper: '🐊',
  potatomine: '🥔',
  cherrybomb: '🍒'
};

const zombieIcons = {
  normal: '🧟',
  cone: '🧟‍♂️',
  bucket: '🪣',
  polevaulter: '🏃',
  flag: '🎌',
  newspaper: '📰',
  football: '🏈',
  brain: '🧠'
};

// 使用全局的 $ 函数 (定义在 utils.js)

// 创建血条
function createHealthBar(x, y) {
  const bar = document.createElement('div');
  bar.className = 'health-bar';
  bar.style.left = x + 'px';
  bar.style.top = y + 'px';
  bar.innerHTML = '<div class="health-bar-fill" style="width:100%"></div>';
  return bar;
}

// 卡片冷却效果
function startCardCooldown(card, durationMs) {
  let overlay = card.querySelector('.cooldown-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'cooldown-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);pointer-events:none;';
    card.style.position = 'relative';
    card.appendChild(overlay);
  }
  overlay.style.display = 'block';
  card.classList.add('on-cooldown');
  const startTime = Date.now();
  const tick = () => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(100, (elapsed / durationMs) * 100);
    overlay.style.height = 100 - pct + '%';
    if (elapsed < durationMs) {
      requestAnimationFrame(tick);
    } else {
      overlay.style.display = 'none';
      card.classList.remove('on-cooldown');
    }
  };
  tick();
}

// 更新卡片状态（是否可用）
function updateCardStates() {
  const sun = parseInt($('sun-count').textContent);
  const brain = parseInt($('brain-count').textContent);
  document.querySelectorAll('.entity-card.plant-card').forEach((c) => {
    const onCd = c.classList.contains('on-cooldown');
    c.classList.toggle('disabled', sun < parseInt(c.dataset.cost) || onCd);
  });
  document.querySelectorAll('.entity-card.zombie-card').forEach((c) => {
    const onCd = c.classList.contains('on-cooldown');
    c.classList.toggle('disabled', brain < parseInt(c.dataset.cost) || onCd);
  });
}

// 渲染植物
function renderPlant(gameState, d) {
  const key = `${d.col},${d.row}`;
  if (gameState.plants.has(key)) return;
  const el = document.createElement('div');
  el.className = 'entity plant';
  el.textContent = plantIcons[d.type] || '🌱';
  el.style.left = d.col * 110 + 20 + 'px';
  el.style.top = d.row * 109 + 15 + 'px';
  if (d.type === 'potatomine' && !d.armed) el.style.opacity = '0.5';
  $('game-board').appendChild(el);
  const hpBar = createHealthBar(d.col * 110 + 35, d.row * 109 + 5);
  $('game-board').appendChild(hpBar);
  gameState.plants.set(key, { el, hpBar, hp: d.hp, maxHp: d.maxHp || d.hp });
}

// 更新植物血量
function updatePlantHp(gameState, col, row, hp) {
  const p = gameState.plants.get(`${col},${row}`);
  if (p) {
    p.hp = hp;
    const pct = Math.max(0, (hp / p.maxHp) * 100);
    p.hpBar.querySelector('.health-bar-fill').style.width = pct + '%';
    p.hpBar.querySelector('.health-bar-fill').style.background = pct < 30 ? '#ff5252' : pct < 60 ? 'orange' : '#4caf50';
  }
}

// 移除植物
function removePlant(gameState, col, row) {
  const key = `${col},${row}`;
  const p = gameState.plants.get(key);
  if (p) {
    p.el.remove();
    p.hpBar.remove();
    gameState.plants.delete(key);
  }
}

// 渲染僵尸
function renderZombie(gameState, d) {
  if (gameState.zombies.has(d.id)) return;
  const el = document.createElement('div');
  el.className = 'entity zombie';
  el.textContent = zombieIcons[d.type] || '🧟';
  el.style.left = '990px';
  el.style.top = d.row * 109 + 8 + 'px';
  $('game-board').appendChild(el);
  const hpBar = createHealthBar(990 + 10, d.row * 109 + 2);
  $('game-board').appendChild(hpBar);
  gameState.zombies.set(d.id, { el, hpBar, hp: d.hp, maxHp: d.maxHp || d.hp, row: d.row });
}

// 更新僵尸血量
function updateZombieHp(gameState, id, hp) {
  const z = gameState.zombies.get(id);
  if (z) {
    z.hp = hp;
    const pct = Math.max(0, (hp / z.maxHp) * 100);
    z.hpBar.querySelector('.health-bar-fill').style.width = pct + '%';
    z.hpBar.querySelector('.health-bar-fill').style.background = pct < 30 ? '#ff5252' : pct < 60 ? 'orange' : '#4caf50';
  }
}

// 高亮僵尸（受击效果）
function highlightZombie(gameState, id) {
  const z = gameState.zombies.get(id);
  if (z) {
    z.el.classList.add('hit');
    setTimeout(() => z.el.classList.remove('hit'), 100);
  }
}

// 移除僵尸
function removeZombie(gameState, id) {
  const z = gameState.zombies.get(id);
  if (z) {
    z.el.remove();
    z.hpBar.remove();
    gameState.zombies.delete(id);
  }
}

// 渲染投射物
function renderProjectile(gameState, d) {
  const pea = document.createElement('div');
  pea.className = `projectile pea-${d.type}`;
  pea.id = d.id;
  pea.dataset.peaId = d.id;
  pea.style.left = d.x + 'px';
  pea.style.top = d.y + 'px';
  $('game-board').appendChild(pea);
  gameState.projectiles.set(d.id, pea);
  let x = d.x;
  const int = setInterval(() => {
    x += 10;
    pea.style.left = x + 'px';
    if (x > 1000 || !pea.parentElement) clearInterval(int);
  }, 16);
  setTimeout(() => {
    clearInterval(int);
    if (pea.parentElement) pea.remove();
    gameState.projectiles.delete(d.id);
  }, 1300);
}

// 移除投射物
function removeProjectile(gameState, id) {
  const pea = gameState.projectiles.get(id);
  if (pea) {
    pea.remove();
    gameState.projectiles.delete(id);
  }
}

// 创建阳光
function createSun(socket, x, y) {
  const sun = document.createElement('div');
  sun.className = 'sun-token';
  sun.textContent = '☀️';
  sun.style.left = x + 'px';
  sun.style.top = y + 'px';
  $('game-board').appendChild(sun);
  sun.onclick = (e) => {
    e.stopPropagation();
    socket.emit('collectSun', { amount: 25 });
    createFloatingText('+25', x, y, '#FFD700');
    sun.remove();
  };
  setTimeout(() => {
    if (sun.parentElement) sun.remove();
  }, 6500);
}

// 创建脑子
function createBrain(socket, x, y) {
  const brain = document.createElement('div');
  brain.className = 'brain-token';
  brain.textContent = '🧠';
  brain.style.left = x + 'px';
  brain.style.top = y + 'px';
  $('game-board').appendChild(brain);
  brain.onclick = (e) => {
    e.stopPropagation();
    socket.emit('collectBrain', { amount: 25 });
    createFloatingText('+25', x, y, '#E91E63');
    brain.remove();
  };
  setTimeout(() => {
    if (brain.parentElement) brain.remove();
  }, 6500);
}

// 创建浮动文字
function createFloatingText(text, x, y, color) {
  const ft = document.createElement('div');
  ft.className = 'floating-text';
  ft.textContent = text;
  ft.style.left = x + 'px';
  ft.style.top = y + 'px';
  ft.style.color = color;
  $('game-board').appendChild(ft);
  setTimeout(() => ft.remove(), 450);
}

// 创建爆炸效果
function createExplosion(x, y, emoji) {
  const exp = document.createElement('div');
  exp.className = 'explosion';
  exp.textContent = emoji;
  exp.style.left = x - 22 + 'px';
  exp.style.top = y - 22 + 'px';
  $('game-board').appendChild(exp);
  setTimeout(() => exp.remove(), 280);
}

// 显示波次横幅
function showWaveBanner(num, count) {
  const banner = document.createElement('div');
  banner.className = 'wave-banner';
  banner.innerHTML = `🌊 第${num}波 <span style="font-size:13px;opacity:0.8;">(${count}只)</span>`;
  $('game-board').appendChild(banner);
  setTimeout(() => banner.remove(), 1500);
}

// 导出到全局
window.GameUI = {
  plantIcons,
  zombieIcons,
  createHealthBar,
  startCardCooldown,
  updateCardStates,
  renderPlant,
  updatePlantHp,
  removePlant,
  renderZombie,
  updateZombieHp,
  highlightZombie,
  removeZombie,
  renderProjectile,
  removeProjectile,
  createSun,
  createBrain,
  createFloatingText,
  createExplosion,
  showWaveBanner
};
