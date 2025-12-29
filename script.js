document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const gameBoard = document.getElementById('game-board');
  const sunCountEl = document.getElementById('sun-count');
  const waveNumberEl = document.getElementById('wave-number');
  const waveProgressBar = document.getElementById('wave-progress-bar');
  const startScreen = document.getElementById('start-screen');
  const startBtn = document.getElementById('start-btn');
  const continueBtn = document.getElementById('continue-btn');
  const pauseMenu = document.getElementById('pause-menu');
  const pauseBtn = document.getElementById('pause-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const pauseRestartBtn = document.getElementById('pause-restart-btn');
  const pauseQuitBtn = document.getElementById('pause-quit-btn');
  const restartBtn = document.getElementById('restart-game-btn');
  const homeBtn = document.getElementById('home-btn');
  const leaderboardBtn = document.getElementById('leaderboard-btn');
  const leaderboardModal = document.getElementById('leaderboard-modal');
  const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn');
  const leaderboardList = document.getElementById('leaderboard-list');

  // Constants
  const CELL_SIZE = 110;
  const GRID_OFFSET_X = 20;
  const GRID_OFFSET_Y = 0;
  const GRID_COLS = 9;
  const GRID_ROWS = 5;

  // Game State
  let sunCount = 200;
  let waveNumber = 0;
  let zombiesKilledInWave = 0;
  let maxZombiesInWave = 5;

  let selectedPlant = null;
  let grid = Array(GRID_COLS)
    .fill()
    .map(() => Array(GRID_ROWS).fill(null));
  let plants = [];
  let zombies = [];

  let waveTimeout = null;
  let sunInterval = null;
  let gameActive = false;
  let gamePaused = false;
  let autoSaveInterval = null;
  let gameStartTime = null;

  // Plant Metadata
  const plantTypes = {
    peashooter: { cost: 100, hp: 150 },
    sunflower: { cost: 50, hp: 150 },
    wallnut: { cost: 50, hp: 600 },
    snowpea: { cost: 175, hp: 150 },
    cherrybomb: { cost: 150, hp: 1000 },
    chomper: { cost: 150, hp: 200 },
    potatomine: { cost: 25, hp: 100 },
    shovel: { cost: 0, hp: 0 }
  };

  // Zombie Metadata
  const zombieTypes = {
    normal: { hp: 180, speed: 0.35 },
    cone: { hp: 400, speed: 0.3 },
    bucket: { hp: 700, speed: 0.25 }
  };

  // ========== INITIALIZATION ==========
  function init() {
    checkForSave();
    setupEventListeners();
  }

  function checkForSave() {
    const save = localStorage.getItem('pvz_save_auto');
    if (save) {
      continueBtn.style.display = 'flex';
    }
  }

  function setupEventListeners() {
    startBtn.addEventListener('click', () => startNewGame());
    continueBtn.addEventListener('click', () => continueGame());
    pauseBtn.addEventListener('click', togglePause);
    resumeBtn.addEventListener('click', togglePause);
    pauseRestartBtn.addEventListener('click', () => {
      togglePause();
      startNewGame();
    });
    pauseQuitBtn.addEventListener('click', () => {
      togglePause();
      showStartScreen();
    });
    restartBtn.addEventListener('click', () => {
      hideModal('game-over-modal');
      startNewGame();
    });
    homeBtn.addEventListener('click', () => {
      hideModal('game-over-modal');
      showStartScreen();
    });
    leaderboardBtn.addEventListener('click', showLeaderboard);
    closeLeaderboardBtn.addEventListener('click', () => hideModal('leaderboard-modal'));

    // ESC to pause
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && gameActive && !gamePaused) {
        togglePause();
      }
    });

    // Plant selection
    document.querySelectorAll('.plant-card').forEach((card) => {
      card.addEventListener('click', () => {
        if (!gameActive || gamePaused || card.classList.contains('disabled')) return;
        selectedPlant = card.dataset.plant;
        document.querySelectorAll('.plant-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        gameBoard.style.cursor = 'crosshair';
      });
    });

    // Game board events
    const cellHighlight = document.createElement('div');
    cellHighlight.className = 'cell-highlight';
    gameBoard.appendChild(cellHighlight);

    gameBoard.addEventListener('mousemove', (e) => {
      if (!selectedPlant || !gameActive || gamePaused) {
        cellHighlight.style.display = 'none';
        return;
      }
      const rect = gameBoard.getBoundingClientRect();
      const { col, row } = pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
      if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
        cellHighlight.style.display = 'block';
        cellHighlight.style.left = col * CELL_SIZE + GRID_OFFSET_X + 'px';
        cellHighlight.style.top = row * CELL_SIZE + GRID_OFFSET_Y + 'px';
      } else {
        cellHighlight.style.display = 'none';
      }
    });

    gameBoard.addEventListener('click', handleBoardClick);
    gameBoard.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      deselectPlant();
    });
  }

  // ========== GAME FLOW ==========
  function startNewGame() {
    localStorage.removeItem('pvz_save_auto');
    resetGameState();
    hideStartScreen();
    gameActive = true;
    gameStartTime = Date.now();
    createFloatingText('准备迎战!', '400px', '200px', '#FFD700');
    setTimeout(startWave, 3000);
    sunInterval = setInterval(() => {
      if (gameActive && !gamePaused) createSun();
    }, 10000);
    setTimeout(() => {
      if (gameActive) createSun();
    }, 2000);
    autoSaveInterval = setInterval(autoSave, 30000);
  }

  function continueGame() {
    const data = localStorage.getItem('pvz_save_auto');
    if (!data) return;

    resetGameState();
    hideStartScreen();

    const state = JSON.parse(data);
    sunCount = state.sun;
    waveNumber = state.wave;
    updateUI();

    state.plants.forEach((p) => spawnPlant(p.type, p.col, p.row, p.hp));
    state.zombies.forEach((z) => spawnZombie(z.row, z.type, z.left, z.hp));

    gameActive = true;
    gameStartTime = Date.now() - (state.elapsed || 0);
    createFloatingText('游戏已恢复!', '400px', '200px', 'lime');
    setTimeout(startWave, 3000);
    sunInterval = setInterval(() => {
      if (gameActive && !gamePaused) createSun();
    }, 10000);
    autoSaveInterval = setInterval(autoSave, 30000);
  }

  function resetGameState() {
    gameActive = false;
    gamePaused = false;
    clearAllIntervals();

    plants.forEach((p) => killEntity(p));
    zombies.forEach((z) => killEntity(z));
    plants = [];
    zombies = [];
    grid = Array(GRID_COLS)
      .fill()
      .map(() => Array(GRID_ROWS).fill(null));

    document.querySelectorAll('.sun-token, .floating-text, .health-bar-container, .projectile').forEach((el) => el.remove());

    sunCount = 200;
    waveNumber = 0;
    zombiesKilledInWave = 0;
    updateUI();
  }

  function clearAllIntervals() {
    if (waveTimeout) clearTimeout(waveTimeout);
    if (sunInterval) clearInterval(sunInterval);
    if (autoSaveInterval) clearInterval(autoSaveInterval);
  }

  // ========== PAUSE ==========
  function togglePause() {
    if (!gameActive) return;
    gamePaused = !gamePaused;
    if (gamePaused) {
      pauseMenu.classList.add('active');
    } else {
      pauseMenu.classList.remove('active');
    }
  }

  // ========== UI ==========
  function updateUI() {
    sunCount = Math.min(sunCount, 9999); // Cap at 9999
    sunCountEl.textContent = sunCount;
    waveNumberEl.textContent = waveNumber;
    document.querySelectorAll('.plant-card').forEach((card) => {
      const cost = parseInt(card.dataset.cost);
      card.classList.toggle('disabled', sunCount < cost);
    });
    // Update wave progress
    const progress = maxZombiesInWave > 0 ? (zombiesKilledInWave / maxZombiesInWave) * 100 : 0;
    waveProgressBar.style.width = progress + '%';
  }

  function showStartScreen() {
    checkForSave();
    startScreen.style.display = 'flex';
  }

  function hideStartScreen() {
    startScreen.style.display = 'none';
  }

  function hideModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  function createFloatingText(text, left, top, color = 'white') {
    const ft = document.createElement('div');
    ft.textContent = text;
    ft.className = 'floating-text';
    ft.style.left = left;
    ft.style.top = top;
    ft.style.color = color;
    gameBoard.appendChild(ft);
    setTimeout(() => ft.remove(), 1000);
  }

  function deselectPlant() {
    selectedPlant = null;
    gameBoard.style.cursor = 'default';
    document.querySelectorAll('.plant-card').forEach((c) => c.classList.remove('selected'));
  }

  // ========== COORDINATES ==========
  function pixelToGrid(x, y) {
    return {
      col: Math.floor((x - GRID_OFFSET_X) / CELL_SIZE),
      row: Math.floor((y - GRID_OFFSET_Y) / CELL_SIZE)
    };
  }

  function gridToPixel(col, row) {
    return {
      x: col * CELL_SIZE + GRID_OFFSET_X + (CELL_SIZE - 80) / 2,
      y: row * CELL_SIZE + GRID_OFFSET_Y + (CELL_SIZE - 80) / 2
    };
  }

  // ========== GAME BOARD CLICK ==========
  function handleBoardClick(e) {
    if (e.target.classList.contains('sun-token')) return;
    if (!gameActive || gamePaused) return;

    const rect = gameBoard.getBoundingClientRect();
    const { col, row } = pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;

    // Shovel mode
    if (selectedPlant === 'shovel') {
      if (grid[col][row]) {
        const plant = grid[col][row];
        const refund = Math.floor(plantTypes[plant.type].cost * 0.25);
        sunCount += refund;
        createFloatingText(`+${refund}`, col * CELL_SIZE + 50 + 'px', row * CELL_SIZE + 30 + 'px', 'yellow');
        killPlant(plant);
        updateUI();
      }
      deselectPlant();
      return;
    }

    if (!selectedPlant) return;

    if (grid[col][row]) {
      createFloatingText('已有植物!', col * CELL_SIZE + 50 + 'px', row * CELL_SIZE + 50 + 'px', 'red');
      return;
    }

    const type = plantTypes[selectedPlant];
    if (!type || sunCount < type.cost) {
      createFloatingText('阳光不足!', col * CELL_SIZE + 50 + 'px', row * CELL_SIZE + 50 + 'px', 'red');
      return;
    }

    spawnPlant(selectedPlant, col, row);
    sunCount -= type.cost;
    updateUI();
    deselectPlant();
  }

  // ========== SUN ==========
  function createSun(x = null, y = null) {
    if (!gameActive || gamePaused) return;
    const sun = document.createElement('div');
    sun.className = 'sun-token';
    sun.textContent = '☀️';
    sun.style.left = (x !== null ? x : Math.random() * 800 + 100) + 'px';
    sun.style.top = (y !== null ? y - 30 : 30) + 'px';
    gameBoard.appendChild(sun);

    sun.onclick = (e) => {
      e.stopPropagation();
      if (gamePaused) return;
      sunCount += 25;
      updateUI();
      createFloatingText('+25', sun.style.left, sun.style.top, '#FFD700');
      sun.style.transition = 'all 0.3s';
      sun.style.opacity = '0';
      sun.style.transform = 'scale(1.5)';
      setTimeout(() => sun.remove(), 300);
    };

    setTimeout(() => {
      if (sun.parentElement) {
        sun.style.opacity = 0;
        setTimeout(() => sun.remove(), 500);
      }
    }, 8000);
  }

  // ========== PLANTS ==========
  function spawnPlant(type, col, row, loadedHp = null) {
    const stats = plantTypes[type];
    if (!stats) return;

    const plant = document.createElement('div');
    plant.className = `entity plant plant-${type}`;
    const icons = { peashooter: '🌱', sunflower: '🌻', wallnut: '🌰', snowpea: '❄️', cherrybomb: '🍒', chomper: '🐊', potatomine: '🥔' };
    plant.textContent = icons[type] || '🌱';

    const pos = gridToPixel(col, row);
    plant.style.left = pos.x + 'px';
    plant.style.top = pos.y + 'px';
    gameBoard.appendChild(plant);

    let hpBar = null;
    if (type !== 'cherrybomb' && type !== 'potatomine') {
      hpBar = addHealthBar(stats.hp, loadedHp || stats.hp);
      updateHealthBarPosition(hpBar, pos.x, pos.y);
    }

    const plantObj = {
      type,
      element: plant,
      col,
      row,
      hp: loadedHp || stats.hp,
      maxHp: stats.hp,
      hpBar,
      intervals: [],
      armed: type !== 'potatomine',
      chomperCooldown: false
    };
    plants.push(plantObj);
    grid[col][row] = plantObj;

    // Plant behaviors
    if (type === 'sunflower') {
      const int = setInterval(() => {
        if (gameActive && !gamePaused) createSun(pos.x + 40, pos.y);
      }, 8000);
      plantObj.intervals.push(int);
    } else if (type === 'peashooter' || type === 'snowpea') {
      const peaType = type === 'snowpea' ? 'pea-ice' : 'pea-normal';
      const int = setInterval(() => {
        if (gameActive && !gamePaused) checkAndShoot(plantObj, peaType);
      }, 1200);
      plantObj.intervals.push(int);
    } else if (type === 'chomper') {
      const int = setInterval(() => {
        if (!gameActive || gamePaused || plantObj.chomperCooldown) return;
        const target = zombies.find((z) => z.row === plantObj.row && Math.abs(z.left - plant.offsetLeft) < 80 && z.hp > 0);
        if (target) {
          createFloatingText('嗷呜!', pos.x + 'px', pos.y + 'px', 'lime');
          killZombie(target);
          plantObj.chomperCooldown = true;
          plant.style.filter = 'saturate(0.5)';
          setTimeout(() => {
            plantObj.chomperCooldown = false;
            plant.style.filter = '';
          }, 25000);
        }
      }, 500);
      plantObj.intervals.push(int);
    } else if (type === 'potatomine') {
      plant.style.opacity = '0.5';
      setTimeout(() => {
        if (plant.parentElement) {
          plantObj.armed = true;
          plant.style.opacity = '1';
          createFloatingText('已武装!', pos.x + 'px', pos.y + 'px', 'yellow');
        }
      }, 12000);
      const int = setInterval(() => {
        if (!gameActive || gamePaused || !plantObj.armed) return;
        const target = zombies.find((z) => z.row === plantObj.row && Math.abs(z.left - plant.offsetLeft) < 60 && z.hp > 0);
        if (target) {
          createFloatingText('💥', pos.x + 'px', pos.y + 'px', 'orange');
          zombies
            .filter((z) => z.row === plantObj.row && Math.abs(z.left - pos.x) < 120)
            .forEach((z) => {
              z.hp = 0;
              killZombie(z);
            });
          killPlant(plantObj);
        }
      }, 100);
      plantObj.intervals.push(int);
    } else if (type === 'cherrybomb') {
      setTimeout(() => {
        if (!gameActive) return;
        createFloatingText('💥💥💥', pos.x + 'px', pos.y + 'px', 'red');
        zombies
          .filter((z) => Math.hypot(z.left - pos.x, z.top - pos.y) < 180)
          .forEach((z) => {
            z.hp = 0;
            killZombie(z);
          });
        killPlant(plantObj);
      }, 1200);
    }
  }

  function checkAndShoot(plant, peaType) {
    if (!plant.element.parentElement) return;
    if (zombies.some((z) => z.row === plant.row && z.left > plant.element.offsetLeft)) {
      shootPea(plant.element.offsetLeft + 60, plant.element.offsetTop + 30, plant.row, peaType);
    }
  }

  function shootPea(x, y, row, typeClass) {
    const pea = document.createElement('div');
    pea.className = `entity projectile ${typeClass}`;
    pea.style.left = x + 'px';
    pea.style.top = y + 'px';
    gameBoard.appendChild(pea);

    let currentX = x;
    const interval = setInterval(() => {
      if (!gameActive) {
        clearInterval(interval);
        pea.remove();
        return;
      }
      if (gamePaused) return;
      currentX += 10;
      pea.style.left = currentX + 'px';

      const hit = zombies.find((z) => z.row === row && Math.abs(z.left - currentX) < 50 && z.hp > 0);
      if (hit) {
        hit.hp -= 30;
        if (typeClass === 'pea-ice' && !hit.frozen) {
          hit.frozen = true;
          hit.speed *= 0.5;
          hit.element.style.filter = 'brightness(1.3) hue-rotate(180deg)';
        }
        updateHealthBar(hit.hpBar, hit.hp);
        if (hit.hp <= 0) killZombie(hit);
        clearInterval(interval);
        pea.remove();
      }
      if (currentX > 1200) {
        clearInterval(interval);
        pea.remove();
      }
    }, 16);
  }

  function killPlant(plant) {
    plant.intervals.forEach(clearInterval);
    if (plant.element?.parentElement) plant.element.remove();
    if (plant.hpBar?.bar?.parentElement) plant.hpBar.bar.remove();
    if (grid[plant.col]?.[plant.row] === plant) grid[plant.col][plant.row] = null;
    const idx = plants.indexOf(plant);
    if (idx !== -1) plants.splice(idx, 1);
  }

  // ========== ZOMBIES ==========
  function startWave() {
    if (!gameActive) return;
    waveNumber++;
    zombiesKilledInWave = 0;
    maxZombiesInWave = 3 + waveNumber * 2;
    updateUI();

    createFloatingText(`第 ${waveNumber} 波!`, '400px', '200px', '#FFD700');
    autoSave();

    let spawned = 0;
    const spawnInt = setInterval(
      () => {
        if (!gameActive) {
          clearInterval(spawnInt);
          return;
        }
        if (gamePaused) return;
        const row = Math.floor(Math.random() * GRID_ROWS);
        let type = 'normal';
        if (waveNumber > 2) {
          const r = Math.random();
          if (r > 0.85) type = 'bucket';
          else if (r > 0.6) type = 'cone';
        }
        spawnZombie(row, type);
        spawned++;
        if (spawned >= maxZombiesInWave) clearInterval(spawnInt);
      },
      Math.max(800, 4000 - waveNumber * 200)
    );

    waveTimeout = setTimeout(startWave, 25000 + waveNumber * 2000);
  }

  function spawnZombie(row, type, startX = 1100, loadedHp = null) {
    const stats = zombieTypes[type];
    if (!stats) return;

    const zombie = document.createElement('div');
    zombie.className = `entity zombie zombie-${type}`;
    zombie.textContent = type === 'bucket' ? '🧟' : type === 'cone' ? '🧟‍♂️' : '🧟';

    const topY = row * CELL_SIZE + GRID_OFFSET_Y + (CELL_SIZE - 100) / 2;
    zombie.style.left = startX + 'px';
    zombie.style.top = topY + 'px';
    gameBoard.appendChild(zombie);

    const hpBar = addHealthBar(stats.hp, loadedHp || stats.hp);
    updateHealthBarPosition(hpBar, startX, topY);

    const zombieObj = {
      type,
      element: zombie,
      row,
      left: startX,
      top: topY,
      hp: loadedHp || stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      hpBar,
      eating: false,
      frozen: false,
      intervals: []
    };
    zombies.push(zombieObj);

    const moveInt = setInterval(() => {
      if (!gameActive) return;
      if (gamePaused) return;

      const target = plants.find((p) => p.row === row && p.element.offsetLeft + 70 > zombieObj.left && p.element.offsetLeft < zombieObj.left + 50);

      if (target) {
        if (!zombieObj.eating) {
          zombieObj.eating = true;
          const eatInt = setInterval(() => {
            if (!gameActive || gamePaused || !target.element?.parentElement) {
              clearInterval(eatInt);
              zombieObj.eating = false;
              return;
            }
            target.hp -= 25;
            updateHealthBar(target.hpBar, target.hp);
            if (target.hp <= 0) {
              killPlant(target);
              clearInterval(eatInt);
              zombieObj.eating = false;
            }
          }, 800);
          zombieObj.intervals.push(eatInt);
        }
      } else {
        zombieObj.eating = false;
        zombieObj.left -= zombieObj.speed;
        zombie.style.left = zombieObj.left + 'px';
        updateHealthBarPosition(zombieObj.hpBar, zombieObj.left, zombieObj.top);
        if (zombieObj.left < -50) gameOver();
      }
    }, 16);
    zombieObj.intervals.push(moveInt);
  }

  function killZombie(zombie) {
    zombie.intervals.forEach(clearInterval);
    if (zombie.element?.parentElement) zombie.element.remove();
    if (zombie.hpBar?.bar?.parentElement) zombie.hpBar.bar.remove();
    const idx = zombies.indexOf(zombie);
    if (idx !== -1) zombies.splice(idx, 1);
    zombiesKilledInWave++;
    updateUI();
  }

  function killEntity(entity) {
    entity.intervals?.forEach(clearInterval);
    entity.element?.remove();
    entity.hpBar?.bar?.remove();
  }

  // ========== HEALTH BARS ==========
  function addHealthBar(max, current) {
    const container = document.createElement('div');
    container.className = 'health-bar-container';
    gameBoard.appendChild(container);
    const fill = document.createElement('div');
    fill.className = 'health-bar-fill';
    container.appendChild(fill);
    const hb = { bar: container, inner: fill, maxHp: max };
    updateHealthBar(hb, current);
    return hb;
  }

  function updateHealthBarPosition(hb, x, y) {
    if (hb?.bar) {
      hb.bar.style.left = x + 15 + 'px';
      hb.bar.style.top = y - 8 + 'px';
    }
  }

  function updateHealthBar(hb, current) {
    if (!hb?.inner) return;
    const pct = Math.max(0, (current / hb.maxHp) * 100);
    hb.inner.style.width = pct + '%';
    hb.inner.style.background = pct < 30 ? '#ff5252' : pct < 60 ? 'orange' : '#4caf50';
  }

  // ========== GAME OVER ==========
  function gameOver() {
    gameActive = false;
    clearAllIntervals();

    createFloatingText('僵尸吃掉了你的脑子!', '250px', '200px', 'red');
    document.getElementById('wave-display').textContent = waveNumber;
    document.getElementById('game-over-modal').classList.add('active');

    // Save to leaderboard
    saveToLeaderboard();

    // Clear auto save
    localStorage.removeItem('pvz_save_auto');
  }

  // ========== SAVE/LOAD ==========
  function autoSave() {
    if (!gameActive || gamePaused) return;
    const state = {
      sun: sunCount,
      wave: waveNumber,
      elapsed: Date.now() - gameStartTime,
      plants: plants.map((p) => ({ type: p.type, col: p.col, row: p.row, hp: p.hp })),
      zombies: zombies.map((z) => ({ type: z.type, row: z.row, left: z.left, hp: z.hp }))
    };
    localStorage.setItem('pvz_save_auto', JSON.stringify(state));
  }

  // ========== LEADERBOARD ==========
  function saveToLeaderboard() {
    const leaderboard = JSON.parse(localStorage.getItem('pvz_leaderboard') || '[]');
    const entry = {
      waves: waveNumber,
      date: new Date().toLocaleDateString('zh-CN'),
      time: Math.floor((Date.now() - gameStartTime) / 1000)
    };
    leaderboard.push(entry);
    leaderboard.sort((a, b) => b.waves - a.waves);
    localStorage.setItem('pvz_leaderboard', JSON.stringify(leaderboard.slice(0, 10)));
  }

  function showLeaderboard() {
    const leaderboard = JSON.parse(localStorage.getItem('pvz_leaderboard') || '[]');
    if (leaderboard.length === 0) {
      leaderboardList.innerHTML = '<div class="leaderboard-empty">暂无记录</div>';
    } else {
      leaderboardList.innerHTML = leaderboard
        .map((entry, i) => {
          const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
          return `
                    <div class="leaderboard-item">
                        <div class="leaderboard-rank ${rankClass}">${medal}</div>
                        <div class="leaderboard-info">
                            <div class="leaderboard-waves">第 ${entry.waves} 波</div>
                            <div class="leaderboard-date">${entry.date}</div>
                        </div>
                    </div>
                `;
        })
        .join('');
    }
    leaderboardModal.classList.add('active');
  }

  // Initialize
  init();
});
