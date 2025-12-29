/**
 * 游戏核心模块
 * 处理游戏初始化、事件绑定、游戏状态管理
 */

// 使用全局的 $ 函数 (定义在 utils.js)

// 游戏状态
const gameState = {
  plants: new Map(),
  zombies: new Map(),
  projectiles: new Map()
};

// 当前选中的实体和铲子模式
let selectedEntity = null;
let isShovelMode = false;
// 触摸容错：记录最后一次有效的高亮位置
let lastValidCell = null;

// 获取订单ID（用于恢复连接）
function getOderId() {
  let id = localStorage.getItem('pvz_oder_id');
  if (!id) {
    id = 'u_' + Date.now() + Math.random().toString(36).substr(2, 8);
    localStorage.setItem('pvz_oder_id', id);
  }
  return id;
}

// 日志函数
function log(msg) {
  $('action-log').innerHTML = `<div class="log-entry">${msg}</div>` + $('action-log').innerHTML;
  if ($('action-log').children.length > 12) $('action-log').lastChild.remove();
}

// 添加聊天消息
function addChatMessage(sender, message) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `<span class="sender">${sender}:</span> ${message}`;
  $('chat-messages').appendChild(el);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}

// 初始化游戏
function initGame(socket, data, myTeam, myName) {
  const { GameUI, GameMobile } = window;

  gameState.plants.clear();
  gameState.zombies.clear();
  gameState.projectiles.clear();

  const gameBoard = $('game-board');
  gameBoard.innerHTML = '';

  const cellHighlight = document.createElement('div');
  cellHighlight.className = 'cell-highlight';
  gameBoard.appendChild(cellHighlight);

  $('my-team-icon').textContent = myTeam === 'plants' ? '🌻' : '🧟';
  $('my-name-display').textContent = myName;
  $('sun-count').textContent = data.sunCount || 500;
  $('brain-count').textContent = data.brainCount || 500;
  $('wave-num').textContent = data.waveNumber || 1;
  $('sun-box').style.display = myTeam === 'plants' ? 'flex' : 'none';
  $('brain-box').style.display = myTeam === 'zombies' ? 'flex' : 'none';
  $('max-waves-display').textContent = data.maxWaves || 15;
  $('action-log').innerHTML = '';
  $('chat-messages').innerHTML = '';

  // Setup row selector for zombies
  const rowSelector = $('row-selector');
  rowSelector.innerHTML = '';

  // Create row highlight element
  const rowHighlight = document.createElement('div');
  rowHighlight.className = 'row-highlight';
  gameBoard.appendChild(rowHighlight);

  if (myTeam === 'zombies') {
    for (let r = 0; r < 5; r++) {
      const btn = document.createElement('div');
      btn.className = 'row-btn';
      btn.textContent = '←';
      // 鼠标事件
      btn.onmouseenter = () => {
        rowHighlight.style.display = 'block';
        rowHighlight.style.top = r * 109 + 'px';
      };
      btn.onmouseleave = () => {
        rowHighlight.style.display = 'none';
      };
      // 触摸事件
      btn.ontouchstart = (e) => {
        e.preventDefault();
        rowHighlight.style.display = 'block';
        rowHighlight.style.top = r * 109 + 'px';
        btn.classList.add('active');
      };
      btn.ontouchend = (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        if (selectedEntity && selectedEntity !== 'shovel') {
          socket.emit('spawnZombie', { type: selectedEntity, row: r });
          selectedEntity = null;
          document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
          rowSelector.classList.remove('active');
          rowHighlight.style.display = 'none';
        }
      };
      // 点击事件（桌面端）
      btn.onclick = () => {
        if (selectedEntity && selectedEntity !== 'shovel') {
          socket.emit('spawnZombie', { type: selectedEntity, row: r });
          selectedEntity = null;
          document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
          rowSelector.classList.remove('active');
          rowHighlight.style.display = 'none';
        }
      };
      rowSelector.appendChild(btn);
    }
  }

  // Render lawnmowers
  const lawnmowers = data.gameState && data.gameState.lawnmowers ? data.gameState.lawnmowers : data.lawnmowers || [true, true, true, true, true];
  for (let r = 0; r < 5; r++) {
    if (lawnmowers[r]) {
      const lm = document.createElement('div');
      lm.className = 'lawnmower';
      lm.id = `lawnmower-${r}`;
      lm.textContent = '🚜';
      lm.style.left = '-25px';
      lm.style.top = r * 109 + 30 + 'px';
      gameBoard.appendChild(lm);
    }
  }

  // Exit game button
  $('exit-game-btn').onclick = () => {
    if (confirm('确定投降？对方将获胜')) {
      socket.emit('leaveGame', true);
      window.GameLobby.showLobby();
    }
  };

  // Entity menu setup
  const entityMenu = $('entity-menu');
  if (myTeam === 'plants') {
    entityMenu.innerHTML = `
      <div class="entity-card plant-card" data-type="sunflower" data-cost="50"><div class="icon">🌻</div><div class="name">向日葵</div><div class="cost">50</div></div>
      <div class="entity-card plant-card" data-type="peashooter" data-cost="100"><div class="icon">🌱</div><div class="name">豌豆</div><div class="cost">100</div></div>
      <div class="entity-card plant-card" data-type="repeater" data-cost="200"><div class="icon">🌿</div><div class="name">双发</div><div class="cost">200</div></div>
      <div class="entity-card plant-card" data-type="snowpea" data-cost="175"><div class="icon">❄️</div><div class="name">寒冰</div><div class="cost">175</div></div>
      <div class="entity-card plant-card" data-type="torchwood" data-cost="75"><div class="icon">🔥</div><div class="name">火炬</div><div class="cost">75</div></div>
      <div class="entity-card plant-card" data-type="wallnut" data-cost="125"><div class="icon">🌰</div><div class="name">坚果</div><div class="cost">125</div></div>
      <div class="entity-card plant-card" data-type="tallnut" data-cost="150"><div class="icon">🥜</div><div class="name">高坚果</div><div class="cost">150</div></div>
      <div class="entity-card plant-card" data-type="chomper" data-cost="150"><div class="icon">🐊</div><div class="name">咬嘴</div><div class="cost">150</div></div>
      <div class="entity-card plant-card" data-type="potatomine" data-cost="25"><div class="icon">🥔</div><div class="name">土豆</div><div class="cost">25</div></div>
      <div class="entity-card plant-card" data-type="cherrybomb" data-cost="175"><div class="icon">🍒</div><div class="name">樱桃</div><div class="cost">175</div></div>
      <div class="entity-card shovel-card" data-type="shovel"><div class="icon">🔧</div><div class="name">铲</div><div class="cost">-</div></div>
    `;
  } else {
    entityMenu.innerHTML = `
      <div class="entity-card zombie-card" data-type="normal" data-cost="50"><div class="icon">🧟</div><div class="name">普通</div><div class="cost">50</div></div>
      <div class="entity-card zombie-card" data-type="cone" data-cost="100"><div class="icon">🧟‍♂️</div><div class="name">路障</div><div class="cost">100</div></div>
      <div class="entity-card zombie-card" data-type="bucket" data-cost="200"><div class="icon">🪣</div><div class="name">铁桶</div><div class="cost">200</div></div>
      <div class="entity-card zombie-card" data-type="polevaulter" data-cost="175"><div class="icon">🏃</div><div class="name">撑杆</div><div class="cost">175</div></div>
      <div class="entity-card zombie-card" data-type="flag" data-cost="75"><div class="icon">🎌</div><div class="name">旗子</div><div class="cost">75</div></div>
      <div class="entity-card zombie-card" data-type="newspaper" data-cost="125"><div class="icon">📰</div><div class="name">读报</div><div class="cost">125</div></div>
      <div class="entity-card zombie-card" data-type="football" data-cost="175"><div class="icon">🏈</div><div class="name">橄榄球</div><div class="cost">175</div></div>
    `;
  }

  // Entity card selection
  entityMenu.querySelectorAll('.entity-card').forEach((card) => {
    card.onclick = () => {
      const type = card.dataset.type;
      const cost = parseInt(card.dataset.cost);
      const resource = myTeam === 'plants' ? parseInt($('sun-count').textContent) : parseInt($('brain-count').textContent);
      if (type === 'shovel') {
        isShovelMode = !isShovelMode;
        selectedEntity = isShovelMode ? 'shovel' : null;
        document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
        if (isShovelMode) card.classList.add('selected');
        cellHighlight.classList.toggle('remove', isShovelMode);
        $('row-selector').classList.remove('active');
      } else if (resource >= cost && !card.classList.contains('on-cooldown')) {
        isShovelMode = false;
        cellHighlight.classList.remove('remove');
        selectedEntity = type;
        document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        if (myTeam === 'zombies') {
          $('row-selector').classList.add('active');
        } else {
          $('row-selector').classList.remove('active');
        }
      }
    };
  });

  // ========== 统一触摸/鼠标事件处理（支持缩放） ==========

  // 获取格子坐标的统一函数（考虑缩放）
  function getGridPosition(e) {
    const coords = GameMobile.getEventCoordinates(e);
    const rect = gameBoard.getBoundingClientRect();
    const scale = GameMobile.getGameScale();

    // 计算相对于游戏棋盘的坐标（考虑缩放后的单元格大小）
    const cellWidth = 110 * scale;
    const cellHeight = 109 * scale;

    const col = Math.floor((coords.clientX - rect.left) / cellWidth);
    const row = Math.floor((coords.clientY - rect.top) / cellHeight);

    return { col, row, isValid: col >= 0 && col < 9 && row >= 0 && row < 5 };
  }

  // 显示格子高亮
  function showCellHighlight(e) {
    if (!selectedEntity || (myTeam === 'zombies' && !isShovelMode)) {
      cellHighlight.style.display = 'none';
      return;
    }
    const { col, row, isValid } = getGridPosition(e);
    if (isValid) {
      cellHighlight.style.display = 'block';
      cellHighlight.style.left = col * 110 + 'px';
      cellHighlight.style.top = row * 109 + 'px';
      lastValidCell = { col, row };
    } else {
      cellHighlight.style.display = 'none';
    }
  }

  // 处理格子点击/触摸
  function handleCellAction(e) {
    if (e.target.classList.contains('sun-token') || e.target.classList.contains('brain-token')) return;
    if (!selectedEntity) return;

    let { col, row, isValid } = getGridPosition(e);

    // 触摸容错：如果当前位置无效但最近有有效位置，且是触摸结束事件，使用最近位置
    if (!isValid && e.type === 'touchend' && lastValidCell) {
      col = lastValidCell.col;
      row = lastValidCell.row;
      isValid = true;
      lastValidCell = null;
    }

    if (!isValid) return;

    if (isShovelMode) {
      socket.emit('removePlant', { col, row });
      selectedEntity = null;
      isShovelMode = false;
      document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
      cellHighlight.style.display = 'none';
      cellHighlight.classList.remove('remove');
    } else if (myTeam === 'plants') {
      socket.emit('placePlant', { type: selectedEntity, col, row });
      selectedEntity = null;
      document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
      cellHighlight.style.display = 'none';
      // 放置成功后重置 lastValidCell
      lastValidCell = null;
    }
  }

  // 取消选择
  function cancelSelection(e) {
    if (e) e.preventDefault();
    selectedEntity = null;
    isShovelMode = false;
    document.querySelectorAll('.entity-card').forEach((c) => c.classList.remove('selected'));
    cellHighlight.style.display = 'none';
    cellHighlight.classList.remove('remove');
    $('row-selector').classList.remove('active');
  }

  // 鼠标事件
  gameBoard.onmousemove = showCellHighlight;
  gameBoard.onclick = handleCellAction;
  gameBoard.oncontextmenu = cancelSelection;

  // 触摸事件
  gameBoard.addEventListener(
    'touchstart',
    (e) => {
      if (selectedEntity) e.preventDefault();
      showCellHighlight(e);
    },
    { passive: false }
  );

  gameBoard.addEventListener(
    'touchmove',
    (e) => {
      if (selectedEntity) e.preventDefault();
      showCellHighlight(e);
    },
    { passive: false }
  );

  gameBoard.addEventListener(
    'touchend',
    (e) => {
      if (selectedEntity) {
        e.preventDefault();
        handleCellAction(e);
      }
    },
    { passive: false }
  );

  setupGameEvents(socket, myTeam);
}

// 恢复游戏状态
function restoreGameState(gs) {
  const { GameUI } = window;
  if (!gs) return;
  gs.plants.forEach((p) => GameUI.renderPlant(gameState, { type: p.type, col: p.col, row: p.row, hp: p.hp, maxHp: p.maxHp, armed: p.armed }));
  gs.zombies.forEach((z) => {
    GameUI.renderZombie(gameState, { id: z.id, type: z.type, row: z.row, hp: z.hp, maxHp: z.maxHp });
    const zs = gameState.zombies.get(z.id);
    if (zs) {
      zs.el.style.left = z.x + 'px';
      zs.hpBar.style.left = z.x + 10 + 'px';
      if (z.slowed) zs.el.classList.add('slowed');
    }
  });
  $('sun-count').textContent = gs.sunCount;
  $('brain-count').textContent = gs.brainCount;
  $('wave-num').textContent = gs.waveNumber;
  GameUI.updateCardStates();
}

// 设置游戏事件监听
function setupGameEvents(socket, myTeam) {
  const { GameUI } = window;

  socket.off('plantPlaced').on('plantPlaced', (d) => {
    GameUI.renderPlant(gameState, d);
    if (myTeam === 'plants') {
      const card = document.querySelector(`.entity-card[data-type="${d.type}"]`);
      if (card) GameUI.startCardCooldown(card, 2500);
    }
    GameUI.updateCardStates();
    log(`🌱 ${d.type} 种植于 (${d.col},${d.row})`);
  });

  socket.off('plantRemoved').on('plantRemoved', (d) => {
    GameUI.removePlant(gameState, d.col, d.row);
    log(`🔧 植物被铲除 (${d.col},${d.row})`);
  });

  socket.off('plantHit').on('plantHit', (d) => {
    GameUI.updatePlantHp(gameState, d.col, d.row, d.hp);
    const p = gameState.plants.get(`${d.col},${d.row}`);
    if (p) {
      p.el.classList.add('hit');
      setTimeout(() => p.el.classList.remove('hit'), 100);
    }
  });

  socket.off('plantDied').on('plantDied', (d) => {
    GameUI.removePlant(gameState, d.col, d.row);
    log(`💀 植物死亡 (${d.col},${d.row})`);
  });

  socket.off('zombieSpawned').on('zombieSpawned', (d) => {
    GameUI.renderZombie(gameState, d);
    if (myTeam === 'zombies') {
      const card = document.querySelector(`.entity-card[data-type="${d.type}"]`);
      if (card) GameUI.startCardCooldown(card, 3000);
    }
    GameUI.updateCardStates();
    log(`🧟 ${d.type} 出现在第${d.row + 1}行`);
  });

  socket.off('zombieHit').on('zombieHit', (d) => {
    GameUI.updateZombieHp(gameState, d.id, d.hp);
    GameUI.highlightZombie(gameState, d.id);
    if (d.slowed) {
      const z = gameState.zombies.get(d.id);
      if (z) z.el.classList.add('slowed');
    }
  });

  socket.off('zombieDied').on('zombieDied', (d) => {
    GameUI.removeZombie(gameState, d.id);
    log(`💀 僵尸死亡`);
  });

  socket.off('shoot').on('shoot', (d) => {
    GameUI.renderProjectile(gameState, d);
  });

  socket.off('peaHit').on('peaHit', (d) => {
    GameUI.removeProjectile(gameState, d.peaId);
    if (d.zombieId) GameUI.highlightZombie(gameState, d.zombieId);
  });

  socket.off('peaMiss').on('peaMiss', (d) => {
    GameUI.removeProjectile(gameState, d.peaId);
  });

  socket.off('peaFire').on('peaFire', (d) => {
    const pea = gameState.projectiles.get(d.peaId);
    if (pea) {
      pea.className = 'projectile pea-fire';
    }
  });

  socket.off('chomperDigesting').on('chomperDigesting', (d) => {
    const p = gameState.plants.get(`${d.col},${d.row}`);
    if (p) {
      p.el.style.filter = 'brightness(0.6)';
      p.el.style.opacity = '0.7';
    }
    log('🐊 大嘴正在消化...');
  });

  socket.off('chomperReady').on('chomperReady', (d) => {
    const p = gameState.plants.get(`${d.col},${d.row}`);
    if (p) {
      p.el.style.filter = '';
      p.el.style.opacity = '1';
      GameUI.createFloatingText('✓', d.col * 110 + 45, d.row * 109 + 25, 'lime');
    }
  });

  socket.off('mineArmed').on('mineArmed', (d) => {
    const p = gameState.plants.get(`${d.col},${d.row}`);
    if (p) {
      p.el.style.opacity = '1';
      GameUI.createFloatingText('!', d.col * 110 + 45, d.row * 109 + 25, 'yellow');
    }
  });

  socket.off('mineExplode').on('mineExplode', (d) => {
    GameUI.createExplosion(d.col * 110 + 45, d.row * 109 + 45, '💥');
    GameUI.removePlant(gameState, d.col, d.row);
    log('💥 土豆爆炸!');
  });

  socket.off('cherryExplode').on('cherryExplode', (d) => {
    GameUI.createExplosion(d.col * 110 + 45, d.row * 109 + 45, '💥💥');
    GameUI.removePlant(gameState, d.col, d.row);
  });

  socket.off('plantSun').on('plantSun', (d) => GameUI.createSun(socket, d.col * 110 + 45, d.row * 109 + 45));
  socket.off('skySun').on('skySun', (d) => GameUI.createSun(socket, d.x, d.y));
  socket.off('skyBrain').on('skyBrain', (d) => GameUI.createBrain(socket, d.x, d.y));
  socket.off('zombieBrain').on('zombieBrain', (d) => GameUI.createBrain(socket, d.x, d.row * 109 + 45));

  socket.off('lawnmowerTrigger').on('lawnmowerTrigger', (d) => {
    const lm = $(`lawnmower-${d.row}`);
    if (lm) {
      lm.style.left = '1300px';
      log('🚜 割草机启动!');
      setTimeout(() => lm.remove(), 2000);
    }
  });

  socket.off('sunUpdate').on('sunUpdate', (d) => {
    $('sun-count').textContent = d.sunCount;
    GameUI.updateCardStates();
  });

  socket.off('brainUpdate').on('brainUpdate', (d) => {
    $('brain-count').textContent = d.brainCount;
    GameUI.updateCardStates();
  });

  socket.off('waveStart').on('waveStart', (d) => {
    $('wave-num').textContent = d.waveNumber;
    if (d.isFinalWave) {
      GameUI.showWaveBanner('最后一波!', d.zombieCount);
      log('⚠️ 最后一波! 坚持住!');
    } else {
      GameUI.showWaveBanner(d.waveNumber, d.zombieCount);
      log(`🌊 第${d.waveNumber}波 (${d.zombieCount}只)`);
    }
  });

  socket.off('gameUpdate').on('gameUpdate', (d) => {
    $('sun-count').textContent = d.sunCount;
    $('brain-count').textContent = d.brainCount;
    $('wave-num').textContent = d.waveNumber;
    GameUI.updateCardStates();

    // 获取服务器上存在的僵尸ID集合
    const serverZombieIds = new Set(d.zombies.map((z) => z.id));

    // 清理客户端上已经不存在于服务器的僵尸
    for (const [id] of gameState.zombies) {
      if (!serverZombieIds.has(id)) {
        GameUI.removeZombie(gameState, id);
      }
    }

    // 更新存在的僵尸位置
    d.zombies.forEach((z) => {
      const zs = gameState.zombies.get(z.id);
      if (zs) {
        zs.el.style.left = z.x + 'px';
        zs.hpBar.style.left = z.x + 10 + 'px';
        GameUI.updateZombieHp(gameState, z.id, z.hp);
        if (z.slowed) zs.el.classList.add('slowed');
      }
    });
  });

  socket.off('gameEnd').on('gameEnd', (d) => {
    const emoji = d.winner === 'plants' ? '🌻' : '🧟';
    const teamName = d.winner === 'plants' ? '植物' : '僵尸';
    const names = d.winnerNames || teamName;
    $('winner-text').textContent = `${emoji} ${names} 胜!`;
    $('game-end-modal').classList.add('active');
  });

  socket.off('gamePaused').on('gamePaused', (d) => {
    $('pause-overlay').classList.add('active');
  });

  socket.off('gameResumed').on('gameResumed', (d) => {
    $('pause-overlay').classList.remove('active');
  });
}

// 导出到全局
window.GameCore = {
  gameState,
  getOderId,
  log,
  addChatMessage,
  initGame,
  restoreGameState,
  setupGameEvents
};
