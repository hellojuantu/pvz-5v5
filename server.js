const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname)));

const rooms = new Map();
const sessions = new Map();
const DATA_FILE = path.join(__dirname, 'game_data.json');

let persistedData = { sessions: {}, leaderboard: [], roomStates: {} };
try {
  if (fs.existsSync(DATA_FILE)) persistedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {}
Object.entries(persistedData.sessions || {}).forEach(([k, v]) => sessions.set(k, v));

function saveData() {
  const sessObj = {};
  sessions.forEach((v, k) => {
    sessObj[k] = v;
  });
  const roomStates = {};
  rooms.forEach((room, id) => {
    if (room.state === 'playing' || room.state === 'paused') {
      roomStates[id] = {
        id: room.id,
        mode: room.mode,
        hostName: room.hostName,
        maxWaves: room.maxWaves,
        sunCount: room.sunCount,
        brainCount: room.brainCount,
        waveNumber: room.waveNumber,
        state: room.state,
        grid: room.grid.map((col) => col.map((cell) => (cell ? { type: cell.type } : null))),
        plants: room.plants.map((p) => ({ type: p.type, col: p.col, row: p.row, hp: p.hp, maxHp: p.maxHp, armed: p.armed, cooldown: !!p.cooldown })),
        zombies: room.zombies.map((z) => ({
          id: z.id,
          type: z.type,
          row: z.row,
          x: z.x,
          hp: z.hp,
          maxHp: z.maxHp,
          speed: z.speed,
          slowed: z.slowed
        })),
        plantPlayers: room.plantPlayers.map((p) => ({ id: p.id, oderId: p.oderId, name: p.name, isBot: p.isBot })),
        zombiePlayers: room.zombiePlayers.map((p) => ({ id: p.id, oderId: p.oderId, name: p.name, isBot: p.isBot })),
        chatHistory: room.chatHistory.slice(-20)
      };
    }
  });
  persistedData.sessions = sessObj;
  persistedData.roomStates = roomStates;
  fs.writeFileSync(DATA_FILE, JSON.stringify(persistedData, null, 2));
}

setInterval(saveData, 5000);

setInterval(() => {
  // Cleanup empty rooms
  rooms.forEach((room, id) => {
    const realPlayers = [...room.plantPlayers, ...room.zombiePlayers].filter((p) => !p.isBot && p.socket?.connected);
    if (realPlayers.length === 0 && room.state !== 'playing' && room.state !== 'paused') {
      console.log(`[Cleanup] Room ${id}`);
      room.stopLoops();
      rooms.delete(id);
      delete persistedData.roomStates[id];
    }
  });

  // Cleanup orphan roomStates (no sessions reference them)
  Object.keys(persistedData.roomStates || {}).forEach((roomId) => {
    const hasSession = [...sessions.values()].some((s) => s.roomId === roomId);
    const hasActiveRoom = rooms.has(roomId);
    if (!hasSession && !hasActiveRoom) {
      console.log(`[Cleanup] Orphan roomState ${roomId}`);
      delete persistedData.roomStates[roomId];
    }
  });
}, 30000);

const CELL_SIZE = 110,
  GRID_COLS = 9,
  GRID_ROWS = 5;
const MAX_WAVES_DEFAULT = 15;

const PLANT_STATS = {
  sunflower: { hp: 150, cost: 50, sunInterval: 10000, recharge: 5000 },
  peashooter: { hp: 150, cost: 100, shootInterval: 1400, damage: 25, recharge: 5000 },
  repeater: { hp: 150, cost: 200, shootInterval: 1400, damage: 25, double: true, recharge: 5000 },
  snowpea: { hp: 150, cost: 175, shootInterval: 1400, damage: 20, slows: true, recharge: 5000 },
  wallnut: { hp: 800, cost: 75, recharge: 20000 },
  tallnut: { hp: 1200, cost: 125, blockJump: true, recharge: 20000 },
  chomper: { hp: 200, cost: 150, eatCooldown: 30000, recharge: 5000 },
  torchwood: { hp: 300, cost: 175, fireBoost: true, recharge: 5000 },
  potatomine: { hp: 100, cost: 25, armTime: 15000, damage: 1200, recharge: 20000 },
  cherrybomb: { hp: 1000, cost: 175, explodeTime: 1500, radius: 150, recharge: 35000 }
};

const ZOMBIE_STATS = {
  normal: { hp: 200, speed: 0.3, damage: 30, cost: 50, recharge: 2000 },
  cone: { hp: 500, speed: 0.28, damage: 30, cost: 100, recharge: 3000 },
  bucket: { hp: 900, speed: 0.22, damage: 30, cost: 175, recharge: 5000 },
  flag: { hp: 180, speed: 0.45, damage: 35, cost: 75, recharge: 2500 },
  newspaper: { hp: 300, speed: 0.25, damage: 25, cost: 80, recharge: 3000 },
  polevaulter: { hp: 350, speed: 0.4, damage: 30, cost: 125, canJump: true, recharge: 4000 },
  football: { hp: 1200, speed: 0.38, damage: 45, cost: 275, recharge: 10000 },
  brain: { hp: 25, speed: 0.18, damage: 0, cost: 50, brainInterval: 6000, recharge: 3000 }
};

class GameRoom {
  constructor(id, mode, hostId, hostName, maxWaves = MAX_WAVES_DEFAULT) {
    this.id = id;
    this.mode = mode;
    this.maxWaves = maxWaves;
    this.hostId = hostId;
    this.hostName = hostName;
    this.plantPlayers = [];
    this.zombiePlayers = [];
    this.state = 'waiting';
    this.chatHistory = [];

    this.grid = Array(GRID_COLS)
      .fill()
      .map(() => Array(GRID_ROWS).fill(null));
    this.plants = [];
    this.zombies = [];
    this.projectiles = [];

    this.sunCount = 500;
    this.brainCount = 500;
    this.waveNumber = 0;

    // Cooldown tracking for cards
    this.plantCooldowns = {}; // { type: endTime }
    this.zombieCooldowns = {}; // { type: endTime }

    this.gameLoop = null;
    this.sunLoop = null;
    this.brainLoop = null;
    this.waveLoop = null;
  }

  restoreFrom(saved) {
    this.sunCount = saved.sunCount;
    this.brainCount = saved.brainCount;
    this.waveNumber = saved.waveNumber;
    this.maxWaves = saved.maxWaves || MAX_WAVES_DEFAULT;
    this.chatHistory = saved.chatHistory || [];
    this.state = saved.state || 'playing';
    this.grid = saved.grid.map((col) => col.map((cell) => (cell ? { type: cell.type } : null)));
    this.plants = saved.plants.map((p) => ({ ...p }));
    this.zombies = saved.zombies.map((z) => ({ ...z }));
    this.plants.forEach((p) => {
      this.grid[p.col][p.row] = p;
    });
  }

  addPlayer(playerId, socket, team, name, oderId) {
    const teamArray = team === 'plants' ? this.plantPlayers : this.zombiePlayers;
    if (teamArray.length >= this.mode) return null;
    const player = { id: playerId, oderId, socket, name, isBot: false };
    teamArray.push(player);
    return player;
  }

  addBot(team) {
    const teamArray = team === 'plants' ? this.plantPlayers : this.zombiePlayers;
    if (teamArray.length >= this.mode) return null;
    const bot = {
      id: 'bot_' + Date.now() + Math.random().toString(36).substr(2, 4),
      name: ['小明AI', '小红AI', '小刚AI'][Math.floor(Math.random() * 3)],
      isBot: true,
      socket: null
    };
    teamArray.push(bot);
    return bot;
  }

  findPlayerByOderId(oderId) {
    return [...this.plantPlayers, ...this.zombiePlayers].find((p) => p.oderId === oderId);
  }

  removePlayer(playerId, forceLeave = false) {
    const wasPlaying = this.state === 'playing';
    this.plantPlayers = this.plantPlayers.filter((p) => p.id !== playerId);
    this.zombiePlayers = this.zombiePlayers.filter((p) => p.id !== playerId);

    // If game was playing and a real player left, pause the game
    if (wasPlaying && !forceLeave) {
      const realPlayers = [...this.plantPlayers, ...this.zombiePlayers].filter((p) => !p.isBot && p.socket?.connected);
      if (
        realPlayers.length <
        this.plantPlayers.length +
          this.zombiePlayers.length -
          this.plantPlayers.filter((p) => p.isBot).length -
          this.zombiePlayers.filter((p) => p.isBot).length
      ) {
        this.pauseGame('玩家离开');
      }
    }
  }

  isFull() {
    return this.plantPlayers.length >= this.mode && this.zombiePlayers.length >= this.mode;
  }
  getInfo() {
    return {
      id: this.id,
      mode: this.mode,
      maxWaves: this.maxWaves,
      hostName: this.hostName,
      plants: this.plantPlayers.length,
      zombies: this.zombiePlayers.length,
      state: this.state
    };
  }
  getPlayerList() {
    return {
      plants: this.plantPlayers.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
      zombies: this.zombiePlayers.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot }))
    };
  }
  getGameState() {
    return {
      sunCount: this.sunCount,
      brainCount: this.brainCount,
      waveNumber: this.waveNumber,
      maxWaves: this.maxWaves,
      plants: this.plants.map((p) => ({ type: p.type, col: p.col, row: p.row, hp: p.hp, maxHp: p.maxHp, armed: p.armed })),
      zombies: this.zombies.map((z) => ({ id: z.id, type: z.type, row: z.row, x: z.x, hp: z.hp, maxHp: z.maxHp, slowed: z.slowed }))
    };
  }

  broadcastTo(team, event, data) {
    (team === 'plants' ? this.plantPlayers : this.zombiePlayers).forEach((p) => {
      if (p.socket?.connected) p.socket.emit(event, data);
    });
  }
  broadcast(event, data) {
    [...this.plantPlayers, ...this.zombiePlayers].forEach((p) => {
      if (p.socket?.connected) p.socket.emit(event, data);
    });
  }
  sendChat(senderName, message) {
    const chatMsg = { sender: senderName, message, time: Date.now() };
    this.chatHistory.push(chatMsg);
    if (this.chatHistory.length > 50) this.chatHistory.shift();
    this.broadcast('chat', chatMsg);
  }

  stopLoops() {
    clearInterval(this.gameLoop);
    clearInterval(this.sunLoop);
    clearInterval(this.brainLoop);
    clearInterval(this.waveLoop);
    this.gameLoop = null;
    this.sunLoop = null;
    this.brainLoop = null;
    this.waveLoop = null;
  }

  pauseGame(reason) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.stopLoops();
    this.broadcast('gamePaused', { reason });
    this.broadcast('chat', { sender: '系统', message: `游戏暂停: ${reason}`, time: Date.now() });
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.broadcast('gameResumed', {});
    this.broadcast('chat', { sender: '系统', message: '游戏继续!', time: Date.now() });
    this.startLoops();
  }

  startLoops() {
    this.gameLoop = setInterval(() => this.update(), 16);
    this.sunLoop = setInterval(() => {
      if (this.state === 'playing') this.broadcastTo('plants', 'skySun', { x: Math.random() * 700 + 80, y: 40 });
    }, 10000);
    this.brainLoop = setInterval(() => {
      if (this.state === 'playing') this.broadcastTo('zombies', 'skyBrain', { x: Math.random() * 700 + 80, y: 40 });
    }, 10000);
    // Auto wave loop - free waves every 45 seconds (zombies can also buy extra waves)
    this.waveLoop = setInterval(() => {
      if (this.state === 'playing') this.autoWave();
    }, 45000);
  }

  startGame() {
    this.state = 'playing';
    this.waveNumber = 0;
    this.broadcast('gameStart', { playerList: this.getPlayerList(), mode: this.mode, maxWaves: this.maxWaves, ...this.getGameState() });
    this.startLoops();
    // First auto wave after 15 seconds
    setTimeout(() => {
      if (this.state === 'playing') this.autoWave();
    }, 15000);
    this.startBotAI();
  }

  // Free auto wave - scales with wave number
  autoWave() {
    if (this.waveNumber >= this.maxWaves) {
      // Don't end game here - wait for all zombies to be killed
      return;
    }

    this.waveNumber++;
    const isFinalWave = this.waveNumber === this.maxWaves;
    // Wave N = N zombies (wave 1 = 1, wave 2 = 2, wave 10 = 10, max 15)
    const baseCount = Math.min(this.waveNumber, 15);
    this.broadcast('waveStart', { waveNumber: this.waveNumber, maxWaves: this.maxWaves, zombieCount: baseCount, auto: true, isFinalWave });

    for (let i = 0; i < baseCount; i++) {
      setTimeout(() => {
        if (this.state !== 'playing') return;
        const row = Math.floor(Math.random() * GRID_ROWS);
        let types;
        // Difficulty progression
        if (this.waveNumber <= 3) types = ['normal', 'normal', 'cone'];
        else if (this.waveNumber <= 6) types = ['normal', 'cone', 'cone', 'bucket'];
        else if (this.waveNumber <= 9) types = ['cone', 'bucket', 'bucket', 'flag'];
        else if (this.waveNumber <= 12) types = ['cone', 'bucket', 'bucket', 'football', 'polevaulter'];
        else types = ['bucket', 'bucket', 'football', 'football', 'polevaulter'];
        this.spawnZombie(types[Math.floor(Math.random() * types.length)], row, '🌊自动');
      }, i * 600); // Faster spawning
    }
  }

  // Wave costs 200 brains to summon
  buyWave(byName) {
    if (this.state !== 'playing') return false;
    if (this.brainCount < 800) return false;
    if (this.waveNumber >= this.maxWaves) {
      this.endGame('plants');
      return false;
    }

    this.brainCount -= 800;
    this.waveNumber++;
    const baseCount = Math.min(2 + Math.floor(this.waveNumber / 3), 6);
    this.broadcast('waveStart', {
      waveNumber: this.waveNumber,
      maxWaves: this.maxWaves,
      zombieCount: baseCount,
      brainCount: this.brainCount,
      by: byName
    });

    for (let i = 0; i < baseCount; i++) {
      setTimeout(() => {
        if (this.state !== 'playing') return;
        const row = Math.floor(Math.random() * GRID_ROWS);
        let types;
        if (this.waveNumber <= 2) types = ['normal'];
        else if (this.waveNumber <= 4) types = ['normal', 'normal', 'cone'];
        else if (this.waveNumber <= 6) types = ['normal', 'cone', 'cone', 'bucket'];
        else types = ['normal', 'cone', 'bucket', 'flag', 'newspaper'];
        if (this.waveNumber >= 8 && Math.random() < 0.2) types.push('football');
        this.spawnZombie(types[Math.floor(Math.random() * types.length)], row, '🌊');
      }, i * 1000);
    }
    return true;
  }

  update() {
    if (this.state !== 'playing') return;

    this.plants.forEach((plant) => {
      if (plant.hp <= 0) return;

      if (plant.type === 'sunflower') {
        plant.sunTimer = (plant.sunTimer || 0) + 16;
        if (plant.sunTimer >= PLANT_STATS.sunflower.sunInterval) {
          plant.sunTimer = 0;
          this.broadcastTo('plants', 'plantSun', { col: plant.col, row: plant.row });
        }
      }

      if (plant.type === 'peashooter' || plant.type === 'snowpea' || plant.type === 'repeater') {
        plant.shootTimer = (plant.shootTimer || 0) + 16;
        const stats = PLANT_STATS[plant.type];
        if (plant.shootTimer >= stats.shootInterval) {
          if (this.zombies.some((z) => z.row === plant.row && z.x > plant.col * CELL_SIZE && z.hp > 0)) {
            plant.shootTimer = 0;
            const peaType = plant.type === 'snowpea' ? 'ice' : 'normal';
            const pea = {
              id: 'p_' + Date.now() + Math.random().toString(36).substr(2, 4),
              x: plant.col * CELL_SIZE + 80,
              y: plant.row * CELL_SIZE + 40,
              row: plant.row,
              damage: stats.damage,
              slows: plant.type === 'snowpea',
              type: peaType
            };
            this.projectiles.push(pea);
            this.broadcast('shoot', { id: pea.id, x: pea.x, y: pea.y, row: pea.row, type: peaType });
            // Repeater shoots second pea
            if (plant.type === 'repeater') {
              setTimeout(() => {
                if (this.state !== 'playing' || plant.hp <= 0) return;
                const pea2 = {
                  id: 'p_' + Date.now() + Math.random().toString(36).substr(2, 4),
                  x: plant.col * CELL_SIZE + 80,
                  y: plant.row * CELL_SIZE + 40,
                  row: plant.row,
                  damage: stats.damage,
                  slows: false,
                  type: 'normal'
                };
                this.projectiles.push(pea2);
                this.broadcast('shoot', { id: pea2.id, x: pea2.x, y: pea2.y, row: pea2.row, type: 'normal' });
              }, 150);
            }
          }
        }
      }

      if (plant.type === 'chomper' && !plant.cooldown) {
        const nearby = this.zombies.find((z) => z.row === plant.row && Math.abs(z.x - plant.col * CELL_SIZE) < 80 && z.hp > 0);
        if (nearby) {
          nearby.hp = 0;
          plant.cooldown = true;
          this.broadcast('chomperEat', { col: plant.col, row: plant.row, zombieId: nearby.id });
          setTimeout(() => {
            plant.cooldown = false;
            this.broadcast('chomperReady', { col: plant.col, row: plant.row });
          }, PLANT_STATS.chomper.eatCooldown);
        }
      }

      // Torchwood doesn't need update logic - it works passively when peas pass through
      if (plant.type === 'potatomine' && plant.armed) {
        const nearby = this.zombies.find((z) => z.row === plant.row && Math.abs(z.x - plant.col * CELL_SIZE) < 80 && z.hp > 0);
        if (nearby) {
          this.zombies.forEach((z) => {
            if (z.row === plant.row && Math.abs(z.x - plant.col * CELL_SIZE) < 150) z.hp -= PLANT_STATS.potatomine.damage;
          });
          plant.hp = 0;
          this.grid[plant.col][plant.row] = null;
          this.broadcast('mineExplode', { col: plant.col, row: plant.row });
        }
      }
    });

    this.zombies.forEach((zombie) => {
      if (zombie.hp <= 0) return;

      if (zombie.type === 'brain') {
        zombie.brainTimer = (zombie.brainTimer || 0) + 16;
        // Brain production speeds up with wave: wave 1 = 6s, wave 10 = 3s, wave 15 = 2s
        const brainInterval = Math.max(2000, 6000 - this.waveNumber * 300);
        if (zombie.brainTimer >= brainInterval) {
          zombie.brainTimer = 0;
          this.broadcastTo('zombies', 'zombieBrain', { id: zombie.id, x: zombie.x, row: zombie.row });
        }
      }

      const targetPlant = this.plants.find(
        (p) => p.row === zombie.row && p.hp > 0 && p.col * CELL_SIZE + 70 > zombie.x && p.col * CELL_SIZE < zombie.x + 40
      );

      // Pole vaulter jump logic
      if (zombie.type === 'polevaulter' && zombie.canJump && targetPlant) {
        // Check if blocked by tallnut
        if (targetPlant.type === 'tallnut') {
          zombie.canJump = false; // Lost pole, can't jump anymore
        } else {
          // Jump over the plant
          zombie.canJump = false;
          zombie.x = targetPlant.col * CELL_SIZE - 50; // Land behind the plant
          this.broadcast('zombieJump', { id: zombie.id, fromX: zombie.x + CELL_SIZE, toX: zombie.x });
        }
      }

      if (targetPlant && ZOMBIE_STATS[zombie.type].damage > 0 && !zombie.canJump) {
        zombie.eatTimer = (zombie.eatTimer || 0) + 16;
        if (zombie.eatTimer >= 800) {
          zombie.eatTimer = 0;
          targetPlant.hp -= ZOMBIE_STATS[zombie.type].damage;
          this.broadcast('plantDamage', { col: targetPlant.col, row: targetPlant.row, hp: targetPlant.hp });
          if (targetPlant.hp <= 0) {
            this.grid[targetPlant.col][targetPlant.row] = null;
            this.broadcast('plantDie', { col: targetPlant.col, row: targetPlant.row });
          }
        }
      } else if (!targetPlant || zombie.canJump) {
        zombie.x -= zombie.speed;
        if (zombie.x < -30) this.endGame('zombies');
      }
    });

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pea = this.projectiles[i];
      pea.x += 10;

      // Check if pea passes through torchwood - becomes fireball with 2x damage
      if (!pea.fire) {
        const torch = this.plants.find(
          (p) => p.type === 'torchwood' && p.row === pea.row && p.hp > 0 && Math.abs(p.col * CELL_SIZE + 50 - pea.x) < 30
        );
        if (torch) {
          pea.fire = true;
          pea.damage *= 2;
          pea.slows = false; // Fire melts ice
          this.broadcast('peaFire', { peaId: pea.id });
        }
      }

      const hit = this.zombies.find((z) => z.row === pea.row && Math.abs(z.x - pea.x) < 40 && z.hp > 0);
      if (hit) {
        hit.hp -= pea.damage;
        if (pea.slows && !hit.slowed) {
          hit.slowed = true;
          hit.speed *= 0.5;
        }
        this.broadcast('peaHit', { peaId: pea.id, zombieId: hit.id, zombieHp: hit.hp, slowed: pea.slows, fire: pea.fire });
        this.projectiles.splice(i, 1);
      } else if (pea.x > 1100) {
        this.broadcast('peaMiss', { peaId: pea.id });
        this.projectiles.splice(i, 1);
      }
    }

    const deadZombies = this.zombies.filter((z) => z.hp <= 0);
    deadZombies.forEach((z) => this.broadcast('zombieDie', { id: z.id }));
    this.plants = this.plants.filter((p) => p.hp > 0);
    this.zombies = this.zombies.filter((z) => z.hp > 0);
    this.grid = Array(GRID_COLS)
      .fill()
      .map(() => Array(GRID_ROWS).fill(null));
    this.plants.forEach((p) => {
      this.grid[p.col][p.row] = p;
    });

    // Plant victory: final wave reached and no zombies left
    if (this.waveNumber >= this.maxWaves && this.zombies.length === 0) {
      this.endGame('plants');
      return;
    }

    if (!this.lastBroadcast || Date.now() - this.lastBroadcast > 50) {
      this.lastBroadcast = Date.now();
      this.broadcast('gameUpdate', {
        zombies: this.zombies.map((z) => ({ id: z.id, x: z.x, hp: z.hp, slowed: z.slowed })),
        plants: this.plants.map((p) => ({ col: p.col, row: p.row, hp: p.hp })),
        sunCount: this.sunCount,
        brainCount: this.brainCount,
        waveNumber: this.waveNumber
      });
    }
  }

  placePlant(type, col, row, byName) {
    if (this.state !== 'playing' || col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS || this.grid[col][row]) return false;
    const stats = PLANT_STATS[type];
    if (!stats || this.sunCount < stats.cost) return false;
    // Check cooldown
    if (this.plantCooldowns[type] && Date.now() < this.plantCooldowns[type]) return false;
    this.sunCount -= stats.cost;
    // Set cooldown
    this.plantCooldowns[type] = Date.now() + stats.recharge;
    const plant = { type, col, row, hp: stats.hp, maxHp: stats.hp, armed: false, cooldown: false };
    this.plants.push(plant);
    this.grid[col][row] = plant;
    this.broadcast('plantPlaced', {
      type,
      col,
      row,
      hp: plant.hp,
      maxHp: plant.maxHp,
      by: byName,
      sunCount: this.sunCount,
      rechargeMs: stats.recharge
    });
    if (type === 'potatomine')
      setTimeout(() => {
        if (plant.hp > 0) {
          plant.armed = true;
          this.broadcast('mineArmed', { col, row });
        }
      }, PLANT_STATS.potatomine.armTime);
    if (type === 'cherrybomb')
      setTimeout(() => {
        if (plant.hp > 0) {
          const cx = col * CELL_SIZE + 50,
            cy = row * CELL_SIZE + 50;
          this.zombies.forEach((z) => {
            if (Math.hypot(z.x - cx, z.row * CELL_SIZE - cy) < PLANT_STATS.cherrybomb.radius) z.hp = 0;
          });
          plant.hp = 0;
          this.grid[col][row] = null;
          this.broadcast('cherryExplode', { col, row });
        }
      }, PLANT_STATS.cherrybomb.explodeTime);
    return true;
  }

  removePlant(col, row, byName) {
    if (this.state !== 'playing' || col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
    const plant = this.grid[col][row];
    if (!plant) return false;
    const stats = PLANT_STATS[plant.type];
    if (stats) this.sunCount = Math.min(9999, this.sunCount + Math.floor(stats.cost * 0.25));
    plant.hp = 0;
    this.grid[col][row] = null;
    this.broadcast('plantRemoved', { col, row, by: byName, sunCount: this.sunCount });
    return true;
  }

  spawnZombie(type, row, byName) {
    if (this.state !== 'playing' || row < 0 || row >= GRID_ROWS) return false;
    const stats = ZOMBIE_STATS[type];
    if (!stats) return false;
    const isAutoWave = byName.startsWith('🌊');
    if (!isAutoWave) {
      // Check cooldown (skip for auto waves)
      if (this.zombieCooldowns[type] && Date.now() < this.zombieCooldowns[type]) return false;
      if (this.brainCount < stats.cost) return false;
      this.brainCount -= stats.cost;
      // Set cooldown
      this.zombieCooldowns[type] = Date.now() + stats.recharge;
    }
    const zombie = {
      id: 'z_' + Date.now() + Math.random().toString(36).substr(2, 4),
      type,
      row,
      x: 1000,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      slowed: false
    };
    if (type === 'polevaulter') zombie.canJump = true;
    this.zombies.push(zombie);
    this.broadcast('zombieSpawned', {
      id: zombie.id,
      type,
      row,
      hp: zombie.hp,
      maxHp: zombie.maxHp,
      by: byName,
      brainCount: this.brainCount,
      rechargeMs: isAutoWave ? 0 : stats.recharge
    });
    return true;
  }

  collectSun(amount) {
    this.sunCount = Math.min(9999, this.sunCount + amount);
    this.broadcast('sunUpdate', { sunCount: this.sunCount });
  }
  collectBrain(amount) {
    this.brainCount = Math.min(9999, this.brainCount + amount);
    this.broadcast('brainUpdate', { brainCount: this.brainCount });
  }

  endGame(winner) {
    this.state = 'ended';
    this.stopLoops();
    // Get player names for leaderboard
    const plantNames =
      this.plantPlayers
        .filter((p) => !p.isBot)
        .map((p) => p.name)
        .join(', ') || 'AI';
    const zombieNames =
      this.zombiePlayers
        .filter((p) => !p.isBot)
        .map((p) => p.name)
        .join(', ') || 'AI';
    persistedData.leaderboard.push({
      date: new Date().toISOString(),
      winner,
      waveNumber: this.waveNumber,
      mode: this.mode,
      plantPlayers: plantNames,
      zombiePlayers: zombieNames
    });
    persistedData.leaderboard = persistedData.leaderboard.slice(-50);
    [...this.plantPlayers, ...this.zombiePlayers].forEach((p) => {
      if (p.oderId) sessions.delete(p.oderId);
    });
    delete persistedData.roomStates[this.id];
    saveData();
    this.broadcast('gameEnd', { winner, waveNumber: this.waveNumber });
  }

  // Smarter AI
  startBotAI() {
    this.plantPlayers
      .filter((p) => p.isBot)
      .forEach((bot) => {
        // Bot collects sun more often
        setInterval(() => {
          if (this.state !== 'playing') return;
          this.collectSun(25);
        }, 3000);

        setInterval(
          () => {
            if (this.state !== 'playing') return;

            // Count current plants
            const sunflowers = this.plants.filter((p) => p.type === 'sunflower').length;
            const shooters = this.plants.filter((p) => p.type === 'peashooter' || p.type === 'snowpea').length;
            const wallnuts = this.plants.filter((p) => p.type === 'wallnut').length;

            // Phase 1: Build sunflower economy (first 2 columns, all 5 rows)
            if (sunflowers < 5 && this.sunCount >= 50) {
              for (let row = 0; row < 5; row++) {
                if (!this.grid[0][row]) {
                  this.placePlant('sunflower', 0, row, bot.name);
                  return;
                }
              }
            }

            // Phase 2: Place shooters in all 5 rows (columns 2-3)
            if (shooters < 10 && this.sunCount >= 100) {
              for (let row = 0; row < 5; row++) {
                const hasShooter = this.plants.some((p) => p.row === row && (p.type === 'peashooter' || p.type === 'snowpea'));
                if (!hasShooter) {
                  for (let col = 2; col <= 3; col++) {
                    if (!this.grid[col][row]) {
                      const type = this.sunCount >= 175 && Math.random() > 0.4 ? 'snowpea' : 'peashooter';
                      this.placePlant(type, col, row, bot.name);
                      return;
                    }
                  }
                }
              }
            }

            // Phase 3: More sunflowers in column 1
            if (sunflowers < 10 && this.sunCount >= 50) {
              for (let row = 0; row < 5; row++) {
                if (!this.grid[1][row]) {
                  this.placePlant('sunflower', 1, row, bot.name);
                  return;
                }
              }
            }

            // Phase 4: Build defensive wall (column 4-5)
            if (wallnuts < 5 && this.sunCount >= 75) {
              for (let row = 0; row < 5; row++) {
                const hasWall = this.plants.some((p) => p.row === row && p.type === 'wallnut');
                if (!hasWall) {
                  for (let col = 4; col <= 5; col++) {
                    if (!this.grid[col][row]) {
                      this.placePlant('wallnut', col, row, bot.name);
                      return;
                    }
                  }
                }
              }
            }

            // Phase 5: Add more shooters behind wall
            if (this.sunCount >= 175) {
              for (let row = 0; row < 5; row++) {
                const shooterCount = this.plants.filter((p) => p.row === row && (p.type === 'peashooter' || p.type === 'snowpea')).length;
                if (shooterCount < 3) {
                  for (let col = 2; col <= 4; col++) {
                    if (!this.grid[col][row]) {
                      this.placePlant('snowpea', col, row, bot.name);
                      return;
                    }
                  }
                }
              }
            }

            // Emergency: Place potato mine if zombie very close
            for (let row = 0; row < 5; row++) {
              const closeZombie = this.zombies.find((z) => z.row === row && z.x < 300 && z.hp > 0);
              if (closeZombie && this.sunCount >= 25) {
                for (let col = 5; col <= 7; col++) {
                  if (!this.grid[col][row]) {
                    this.placePlant('potatomine', col, row, bot.name);
                    return;
                  }
                }
              }
            }
          },
          1500 + Math.random() * 1500
        );
      });

    this.zombiePlayers
      .filter((p) => p.isBot)
      .forEach((bot) => {
        // Bot collects brains very frequently
        setInterval(() => {
          if (this.state !== 'playing') return;
          this.collectBrain(50); // More brains per collection
        }, 2000); // Faster collection

        setInterval(
          () => {
            if (this.state !== 'playing') return;

            // ALWAYS buy wave when have enough brains - TOP priority
            if (this.brainCount >= 200) {
              if (this.waveNumber < this.maxWaves) {
                this.buyWave(bot.name);
              }
              return;
            }

            // Spawn brain zombie if low on resources - need to build up brains
            if (this.brainCount < 150) {
              if (this.brainCount >= 75) {
                this.spawnZombie('brain', Math.floor(Math.random() * 5), bot.name);
              }
              return; // Don't spawn other zombies when saving for wave
            }

            // Analyze row defenses for all 5 rows
            const rowData = [];
            for (let row = 0; row < 5; row++) {
              const plants = this.plants.filter((p) => p.row === row);
              const zombies = this.zombies.filter((z) => z.row === row && z.hp > 0);
              const hasWallnut = plants.some((p) => p.type === 'wallnut');
              const shooterCount = plants.filter((p) => p.type === 'peashooter' || p.type === 'snowpea').length;
              rowData.push({ row, plantCount: plants.length, zombieCount: zombies.length, hasWallnut, shooterCount });
            }

            // Sort rows by weakness (fewer plants, fewer zombies already there)
            rowData.sort((a, b) => a.plantCount + a.zombieCount - (b.plantCount + b.zombieCount));
            const targetRow = rowData[0].row;

            // Smart zombie selection based on situation
            let type = 'cone'; // Default to cone
            const target = rowData[0];

            if (target.hasWallnut && this.brainCount >= 275) {
              type = 'football';
            } else if (target.shooterCount >= 2 && this.brainCount >= 175) {
              type = 'bucket';
            }

            if (this.brainCount >= ZOMBIE_STATS[type].cost) {
              this.spawnZombie(type, targetRow, bot.name);
            }
          },
          1500 + Math.random() * 1500
        );
      });
  }
}

Object.entries(persistedData.roomStates || {}).forEach(([id, saved]) => {
  console.log(`[Restore] Room ${id}`);
  const room = new GameRoom(id, saved.mode, null, saved.hostName, saved.maxWaves);
  room.restoreFrom(saved);
  saved.plantPlayers.forEach((p) => {
    room.plantPlayers.push({ ...p, socket: null });
  });
  saved.zombiePlayers.forEach((p) => {
    room.zombiePlayers.push({ ...p, socket: null });
  });
  rooms.set(id, room);
  if (room.state === 'playing') room.startLoops();
});

io.on('connection', (socket) => {
  let currentRoom = null,
    playerName = '玩家',
    currentTeam = null,
    oderId = null;

  socket.on('restore', ({ oderId: oid, name }, callback) => {
    oderId = oid;
    playerName = name || '玩家';
    const sess = sessions.get(oid);
    if (sess && sess.roomId) {
      const room = rooms.get(sess.roomId);
      if (room) {
        const player = room.findPlayerByOderId(oid);
        if (player) {
          player.socket = socket;
          player.id = socket.id;
          player.name = playerName;
          currentRoom = room;
          currentTeam = room.plantPlayers.includes(player) ? 'plants' : 'zombies';

          // Resume if was paused and now have players
          if (room.state === 'paused') {
            const realPlayers = [...room.plantPlayers, ...room.zombiePlayers].filter((p) => !p.isBot && p.socket?.connected);
            if (realPlayers.length > 0) room.resumeGame();
          }

          callback({
            restored: true,
            roomId: room.id,
            team: currentTeam,
            mode: room.mode,
            maxWaves: room.maxWaves,
            state: room.state,
            playerList: room.getPlayerList(),
            gameState: room.getGameState(),
            chatHistory: room.chatHistory.slice(-20)
          });
          console.log(`[Restore] ${playerName} -> ${room.id}`);
          return;
        }
      }
    }
    callback({ restored: false });
  });

  socket.on('setName', (name) => {
    playerName = name || '玩家';
    if (currentRoom) {
      const player = currentRoom.findPlayerByOderId(oderId);
      if (player) player.name = playerName;
    }
  });
  socket.on('listRooms', () => {
    const list = [];
    rooms.forEach((room) => {
      if (room.state === 'waiting' || room.state === 'paused') list.push(room.getInfo());
    });
    socket.emit('roomList', list);
  });
  socket.on('getLeaderboard', () => {
    socket.emit('leaderboard', persistedData.leaderboard.slice(-20).reverse());
  });

  socket.on('createRoom', ({ mode, maxWaves }, callback) => {
    const roomId = 'R' + Date.now().toString(36).toUpperCase();
    const room = new GameRoom(roomId, mode, socket.id, playerName, maxWaves || MAX_WAVES_DEFAULT);
    rooms.set(roomId, room);
    callback({ success: true, roomId, mode, maxWaves: room.maxWaves });
  });

  socket.on('joinRoom', ({ roomId, team }, callback) => {
    const room = rooms.get(roomId);
    if (!room) return callback({ success: false, error: '房间不存在' });
    if (room.state !== 'waiting' && room.state !== 'paused') return callback({ success: false, error: '无法加入' });
    const player = room.addPlayer(socket.id, socket, team, playerName, oderId);
    if (!player) return callback({ success: false, error: '队伍已满' });
    currentRoom = room;
    currentTeam = team;
    sessions.set(oderId, { roomId, team, name: playerName });
    saveData();
    callback({
      success: true,
      team,
      mode: room.mode,
      maxWaves: room.maxWaves,
      state: room.state,
      playerList: room.getPlayerList(),
      gameState: room.getGameState()
    });
    room.broadcast('playerUpdate', { playerList: room.getPlayerList(), info: room.getInfo() });

    if (room.state === 'paused') room.resumeGame();
    else if (room.isFull()) room.startGame();
  });

  socket.on('addBot', ({ team }, callback) => {
    if (!currentRoom) return callback({ success: false });
    const bot = currentRoom.addBot(team);
    if (!bot) return callback({ success: false, error: '队伍已满' });
    currentRoom.broadcast('playerUpdate', { playerList: currentRoom.getPlayerList(), info: currentRoom.getInfo() });
    callback({ success: true });
    if (currentRoom.isFull() && currentRoom.state === 'waiting') currentRoom.startGame();
  });
  socket.on('placePlant', ({ type, col, row }) => {
    if (currentRoom && currentTeam === 'plants') currentRoom.placePlant(type, col, row, playerName);
  });
  socket.on('removePlant', ({ col, row }) => {
    if (currentRoom && currentTeam === 'plants') currentRoom.removePlant(col, row, playerName);
  });
  socket.on('spawnZombie', ({ type, row }) => {
    if (currentRoom && currentTeam === 'zombies') currentRoom.spawnZombie(type, row, playerName);
  });
  socket.on('buyWave', () => {
    if (currentRoom && currentTeam === 'zombies') currentRoom.buyWave(playerName);
  });
  socket.on('collectSun', ({ amount }) => {
    if (currentRoom && currentTeam === 'plants') currentRoom.collectSun(amount || 25);
  });
  socket.on('collectBrain', ({ amount }) => {
    if (currentRoom && currentTeam === 'zombies') currentRoom.collectBrain(amount || 25);
  });
  socket.on('chat', ({ message }) => {
    if (currentRoom && message && message.trim()) currentRoom.sendChat(playerName, message.trim().substring(0, 100));
  });

  socket.on('leaveGame', (forceLeave) => {
    if (currentRoom) {
      // Remove player from room's persisted player list
      const room = currentRoom;
      room.plantPlayers = room.plantPlayers.filter((p) => p.oderId !== oderId);
      room.zombiePlayers = room.zombiePlayers.filter((p) => p.oderId !== oderId);
      room.broadcast('playerUpdate', { playerList: room.getPlayerList(), info: room.getInfo() });

      // If no real players left, end the game
      const realPlayers = [...room.plantPlayers, ...room.zombiePlayers].filter((p) => !p.isBot);
      if (realPlayers.length === 0 && (room.state === 'playing' || room.state === 'paused')) {
        room.stopLoops();
        room.state = 'ended';
        rooms.delete(room.id);
        delete persistedData.roomStates[room.id];
      }
      currentRoom = null;
      currentTeam = null;
    }
    if (oderId) {
      sessions.delete(oderId);
      saveData();
    }
  });

  socket.on('leaveRoom', () => {
    if (currentRoom) {
      currentRoom.removePlayer(socket.id, true);
      currentRoom.broadcast('playerUpdate', { playerList: currentRoom.getPlayerList(), info: currentRoom.getInfo() });
      if (currentRoom.plantPlayers.length === 0 && currentRoom.zombiePlayers.length === 0) {
        currentRoom.stopLoops();
        rooms.delete(currentRoom.id);
        delete persistedData.roomStates[currentRoom.id];
      }
      currentRoom = null;
    }
    if (oderId) {
      sessions.delete(oderId);
      saveData();
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnect] ${playerName}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🌻 PvZ Multiplayer - Complete Edition 🧟                    ║
║  http://localhost:${PORT}/multiplayer.html                       ║
║  🎯 最大波数 | ⏸️ 暂停系统 | 🧠 智能AI | 🔄 断线续玩          ║
╚══════════════════════════════════════════════════════════════╝
    `);
});
