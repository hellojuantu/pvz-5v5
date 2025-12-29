/**
 * 移动端支持模块
 * 处理触摸事件、屏幕缩放和方向检测
 */

// 游戏原始尺寸
const GAME_WIDTH = 990;
const GAME_HEIGHT = 610;

// 当前缩放比例（供触摸事件使用）
let currentGameScale = 1;

// 检测设备类型
const isMobileDevice = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const isLandscape = () => window.innerWidth > window.innerHeight;

// 获取触摸/鼠标坐标的统一函数
function getEventCoordinates(e) {
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  return {
    clientX: touch ? touch.clientX : e.clientX,
    clientY: touch ? touch.clientY : e.clientY
  };
}

// 获取游戏区域的缩放比例
function getGameScale() {
  return currentGameScale;
}

// 获取顶栏高度（游戏内部使用，根据缩放后高度确定）
function getTopBarHeight() {
  // 移动端横屏时顶栏固定 50px
  if (window.innerHeight <= 500 && isLandscape()) return 50;
  return 65;
}

// 动态调整游戏容器大小 - 完美适配屏幕
function resizeGame() {
  const container = document.getElementById('game-container');
  const wrapper = document.getElementById('main-wrapper');
  if (!container) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 仅在横屏模式进行缩放
  if (viewportWidth > viewportHeight) {
    // 计算最佳缩放比例（保持宽高比，完全填满屏幕）
    const scaleX = viewportWidth / GAME_WIDTH;
    const scaleY = viewportHeight / GAME_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    currentGameScale = scale;

    // 隐藏 main-wrapper 的默认布局
    if (wrapper) {
      wrapper.style.position = 'fixed';
      wrapper.style.inset = '0';
      wrapper.style.display = 'block';
      wrapper.style.overflow = 'hidden';
    }

    // 使用固定定位和 transform 实现完美居中
    container.style.position = 'fixed';
    container.style.left = '50%';
    container.style.top = '50%';
    container.style.transform = `translate(-50%, -50%) scale(${scale})`;
    container.style.transformOrigin = 'center center';
    container.style.width = GAME_WIDTH + 'px';
    container.style.height = GAME_HEIGHT + 'px';
    container.style.margin = '0';
  } else {
    // 竖屏时重置样式（由 CSS 媒体查询处理显示横屏提示）
    currentGameScale = 1;
    if (wrapper) {
      wrapper.style.position = '';
      wrapper.style.inset = '';
      wrapper.style.display = '';
      wrapper.style.overflow = '';
    }
    container.style.position = '';
    container.style.left = '';
    container.style.top = '';
    container.style.transform = '';
    container.style.width = '';
    container.style.height = '';
    container.style.margin = '';
  }
}

// 尝试锁定屏幕方向为横屏
async function tryLockOrientation() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) {
    // 部分设备不支持，静默失败
    console.log('屏幕方向锁定不支持');
  }
}

// 全屏切换
function toggleFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const request = elem.requestFullscreen || elem.webkitRequestFullscreen;
    if (request) {
      request
        .call(elem)
        .then(() => {
          tryLockOrientation();
          setTimeout(resizeGame, 100);
        })
        .catch((err) => console.log('全屏失败:', err));
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
}

// 移动端面板处理
function setupMobilePanel(socket) {
  const panelBtn = document.getElementById('mobile-panel-btn');
  const panel = document.getElementById('mobile-panel');
  const closeBtn = document.getElementById('mobile-panel-close');
  const chatInputMobile = document.getElementById('chat-input-mobile');

  if (panelBtn) {
    panelBtn.onclick = () => panel?.classList.add('active');
  }
  if (closeBtn) {
    closeBtn.onclick = () => panel?.classList.remove('active');
  }
  if (panel) {
    panel.onclick = (e) => {
      if (e.target === panel) panel.classList.remove('active');
    };
  }
  if (chatInputMobile) {
    chatInputMobile.onkeydown = (e) => {
      if (e.key === 'Enter' && chatInputMobile.value.trim()) {
        socket.emit('chat', { message: chatInputMobile.value.trim() });
        chatInputMobile.value = '';
      }
    };
  }
}

// 同步日志和聊天到移动端面板
function syncToMobilePanel(type) {
  const mobileEl = document.getElementById(type === 'log' ? 'action-log-mobile' : 'chat-messages-mobile');
  const desktopEl = document.getElementById(type === 'log' ? 'action-log' : 'chat-messages');
  if (mobileEl && desktopEl) {
    mobileEl.innerHTML = desktopEl.innerHTML;
  }
}

// 防抖函数
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 初始化移动端支持
function initMobileSupport(socket) {
  setupMobilePanel(socket);

  // 监听窗口大小变化和方向变化
  const debouncedResize = debounce(resizeGame, 100);
  window.addEventListener('resize', debouncedResize);
  window.addEventListener('orientationchange', () => {
    setTimeout(resizeGame, 200);
  });

  // 监听全屏状态变化
  document.addEventListener('fullscreenchange', () => {
    setTimeout(resizeGame, 100);
  });
  document.addEventListener('webkitfullscreenchange', () => {
    setTimeout(resizeGame, 100);
  });

  // 初始调用一次
  resizeGame();
}

// 导出到全局
window.GameMobile = {
  GAME_WIDTH,
  GAME_HEIGHT,
  getEventCoordinates,
  getGameScale,
  getTopBarHeight,
  resizeGame,
  toggleFullscreen,
  syncToMobilePanel,
  initMobileSupport,
  isMobileDevice,
  isTouchDevice,
  isLandscape
};
