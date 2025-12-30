/**
 * 游戏主入口
 * 初始化所有模块并设置连接
 */

(function () {
  // 使用全局的 $ 函数 (定义在 utils.js)
  const { GameMobile, GameUI, GameLobby, GameCore } = window;

  // 初始化 Socket 连接
  const socket = io(window.BACKEND_URL || undefined, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
  });

  // 切换侧边栏折叠
  window.toggleBox = (type) => {
    const c = $(type === 'log' ? 'action-log' : 'chat-messages');
    const t = $(type + '-toggle');
    c.classList.toggle('collapsed');
    t.textContent = c.classList.contains('collapsed') ? '+' : '−';
  };

  // 编辑名字（全局函数）
  window.editName = () => GameLobby.editName();
  window.openRoom = GameLobby.openRoom;

  // 连接成功
  socket.on('connect', () => {
    // Note: Don't hide overlay yet. Wait for state restore.

    socket.emit('restore', { oderId: GameCore.getOderId(), name: GameLobby.getMyName() }, (res) => {
      // Hide overlay only after we know what to show
      $('loading-overlay').style.display = 'none';

      if (res.restored) {
        GameLobby.setMyTeam(res.team);
        if (res.state === 'playing') {
          $('welcome-screen').style.display = 'none';
          $('lobby').style.display = 'none';
          $('main-wrapper').style.display = 'flex';
          GameCore.initGame(socket, res, res.team, GameLobby.getMyName());
          GameCore.restoreGameState(res.gameState);
          if (res.chatHistory) res.chatHistory.forEach((m) => GameCore.addChatMessage(m.sender, m.message));
        } else if (res.state === 'waiting') {
          GameLobby.showLobby();
          GameLobby.showWaitingRoom(res.mode, res.playerList);
        } else {
          GameLobby.showLobby();
        }
      } else if (GameLobby.getMyName()) {
        GameLobby.showLobby();
      } else {
        $('welcome-screen').style.display = 'flex';
      }
    });
  });

  // 断开连接
  socket.on('disconnect', () => {
    $('reconnecting').classList.add('active');
  });

  // 重连成功
  socket.on('connect', () => {
    $('reconnecting').classList.remove('active');
  });

  // 欢迎页面
  $('enter-btn').onclick = () => {
    const name = $('name-input').value.trim();
    if (!name) return alert('请输入名字');
    GameLobby.setMyName(name);
    localStorage.setItem('pvz_name', name);
    socket.emit('setName', name);
    $('welcome-screen').style.display = 'none';
    GameLobby.showLobby();
  };

  // Return to Lobby after Game
  $('restart-game-btn').onclick = () => {
    socket.emit('leaveRoom');
    $('game-end-modal').classList.remove('active');
    $('game-end-modal').style.display = 'none'; // Ensure hidden
    $('main-wrapper').style.display = 'none';
    GameLobby.showLobby();
  };

  $('name-input').onkeydown = (e) => {
    if (e.key === 'Enter') $('enter-btn').click();
  };

  // 聊天输入
  $('chat-input').onkeydown = (e) => {
    if (e.key === 'Enter' && $('chat-input').value.trim()) {
      socket.emit('chat', { message: $('chat-input').value.trim() });
      $('chat-input').value = '';
    }
  };

  socket.on('chat', (msg) => GameCore.addChatMessage(msg.sender, msg.message));

  // 游戏开始
  socket.on('gameStart', (data) => {
    $('lobby').style.display = 'none';
    $('main-wrapper').style.display = 'flex';
    GameCore.initGame(socket, data, GameLobby.getMyTeam(), GameLobby.getMyName());
  });

  // 初始化大厅事件
  GameLobby.initLobbyEvents(socket);

  // 初始化移动端支持
  GameMobile.initMobileSupport(socket);

  // 如果有保存的名字，预填充
  if (GameLobby.getMyName()) {
    $('name-input').value = GameLobby.getMyName();
  }
})();
