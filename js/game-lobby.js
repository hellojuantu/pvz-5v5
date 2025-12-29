/**
 * 游戏大厅模块
 * 处理房间列表、创建房间、加入房间、等待室等功能
 */

// 使用全局的 $ 函数 (定义在 utils.js)

// 大厅状态
let selectedMode = 2;
let currentRoomId = null;
let myName = localStorage.getItem('pvz_name') || '';
let myTeam = null;
let _socket = null; // 模块级 socket 引用

// 显示大厅
function showLobby() {
  $('lobby').style.display = 'block';
  $('main-wrapper').style.display = 'none';
  $('waiting-room').style.display = 'none';
  $('create-section').style.display = 'block';
  $('display-name').textContent = myName;
  refreshRooms();
}

// 刷新房间列表
function refreshRooms() {
  if (_socket) {
    _socket.emit('listRooms');
    _socket.emit('getLeaderboard');
  }
}

// 渲染房间列表
function renderRoomList(rooms) {
  $('room-list').innerHTML =
    rooms.length === 0
      ? '<div class="no-rooms">无房间</div>'
      : rooms
          .map(
            (r) =>
              `<div class="room-card" onclick="GameLobby.openRoom('${r.id}',${r.mode},${r.plants},${r.zombies})"><div class="room-header"><span class="room-name">${r.hostName}</span><span class="room-mode">${r.mode}v${r.mode}</span></div><div class="room-players">🌻${r.plants} 🧟${r.zombies}</div></div>`
          )
          .join('');
}

// 渲染排行榜
function renderLeaderboard(data) {
  if (!data || data.length === 0) {
    $('leaderboard-list').innerHTML = '<div class="no-rooms">无记录</div>';
    return;
  }
  $('leaderboard-list').innerHTML = data
    .map((g) => {
      const d = new Date(g.date);
      const time = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      const plantNames = g.plantPlayers || 'AI';
      const zombieNames = g.zombiePlayers || 'AI';
      const winnerNames = g.winner === 'plants' ? plantNames : zombieNames;
      return `<div class="lb-item"><span class="lb-winner ${g.winner}">${g.winner === 'plants' ? '🌻' : '🧟'}${winnerNames}胜</span><span class="lb-info">第${g.waveNumber}波 ${g.mode}v${g.mode} ${time}</span></div>`;
    })
    .join('');
}

// 打开房间选择阵营
function openRoom(id, mode, plants, zombies) {
  currentRoomId = id;
  openTeamModal(mode, plants, zombies);
}

// 打开阵营选择模态框
function openTeamModal(mode, plants, zombies) {
  $('modal-plants-count').textContent = `${plants}/${mode}`;
  $('modal-zombies-count').textContent = `${zombies}/${mode}`;
  $('team-modal').classList.add('active');
}

// 加入队伍
function joinTeam(team, callback) {
  _socket.emit('joinRoom', { roomId: currentRoomId, team }, (res) => {
    if (res.success) {
      myTeam = team;
      $('team-modal').classList.remove('active');
      showWaitingRoom(res.mode, res.playerList);
      if (callback) callback(res);
    } else {
      alert(res.error);
    }
  });
}

// 显示等待室
function showWaitingRoom(mode, list) {
  $('create-section').style.display = 'none';
  $('waiting-room').style.display = 'block';
  updateSlots(mode, list);
}

// 更新玩家槽位
function updateSlots(mode, list) {
  $('plant-slots').innerHTML = Array(mode)
    .fill()
    .map((_, i) => {
      const p = list.plants[i];
      return `<div class="player-slot ${p ? (p.isBot ? 'bot' : '') : 'empty'}">${p ? (p.isBot ? '🤖' : '👤') + p.name : '等待'}</div>`;
    })
    .join('');
  $('zombie-slots').innerHTML = Array(mode)
    .fill()
    .map((_, i) => {
      const p = list.zombies[i];
      return `<div class="player-slot ${p ? (p.isBot ? 'bot' : '') : 'empty'}">${p ? (p.isBot ? '🤖' : '👤') + p.name : '等待'}</div>`;
    })
    .join('');
}

// 编辑名字
function editName() {
  const name = prompt('输入新名字 (留空清除):', myName);
  if (name !== null) {
    myName = name.trim() || '玩家';
    localStorage.setItem('pvz_name', myName);
    $('display-name').textContent = myName;
    _socket.emit('setName', myName);
  }
}

// 初始化大厅事件
function initLobbyEvents(socket) {
  _socket = socket; // 保存 socket 引用

  // 模式选择
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMode = parseInt(btn.dataset.mode);
    };
  });

  // 刷新按钮
  $('refresh-btn').onclick = () => refreshRooms();

  // 创建房间
  $('create-btn').onclick = () => {
    const maxWaves = parseInt($('max-waves').value) || 15;
    _socket.emit('createRoom', { mode: selectedMode, maxWaves }, (res) => {
      if (res.success) {
        currentRoomId = res.roomId;
        openTeamModal(res.mode, 0, 0);
      }
    });
  };

  // 关闭模态框
  $('modal-close').onclick = () => $('team-modal').classList.remove('active');

  // 选择阵营
  $('select-plants').onclick = () => joinTeam('plants');
  $('select-zombies').onclick = () => joinTeam('zombies');

  // 添加机器人
  $('add-plant-bot').onclick = () => _socket.emit('addBot', { team: 'plants' }, () => {});
  $('add-zombie-bot').onclick = () => _socket.emit('addBot', { team: 'zombies' }, () => {});

  // 离开房间
  $('leave-btn').onclick = () => {
    _socket.emit('leaveRoom');
    $('waiting-room').style.display = 'none';
    $('create-section').style.display = 'block';
    refreshRooms();
  };

  // Socket 事件
  _socket.on('roomList', renderRoomList);
  _socket.on('leaderboard', renderLeaderboard);
  _socket.on('playerUpdate', (data) => updateSlots(data.info.mode, data.playerList));
}

// Getter/Setter
function getMyName() {
  return myName;
}
function setMyName(name) {
  myName = name;
}
function getMyTeam() {
  return myTeam;
}
function setMyTeam(team) {
  myTeam = team;
}
function getCurrentRoomId() {
  return currentRoomId;
}
function getSelectedMode() {
  return selectedMode;
}

// 导出到全局
window.GameLobby = {
  showLobby,
  refreshRooms,
  renderRoomList,
  renderLeaderboard,
  openRoom,
  openTeamModal,
  joinTeam,
  showWaitingRoom,
  updateSlots,
  editName,
  initLobbyEvents,
  getMyName,
  setMyName,
  getMyTeam,
  setMyTeam,
  getCurrentRoomId,
  getSelectedMode
};
