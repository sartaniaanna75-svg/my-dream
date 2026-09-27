(function () {
  var form = document.getElementById('auth-form');
  var errorEl = document.getElementById('auth-error');
  var button = form ? form.querySelector('button') : null;

  var logoutButton = document.getElementById('auth-logout');
  var menuButton = document.getElementById('auth-menu-button');
  var menuPanel = document.getElementById('auth-menu-panel');

  function setMenuOpen(open) {
    if (!menuButton || !menuPanel) return;
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuPanel.hidden = !open;
  }

  function showCabinet() {
    document.body.classList.add('auth-ready');
  }

  function hideCabinet() {
    document.body.classList.remove('auth-ready');
    var view = document.getElementById('app-view');
    if (view) view.innerHTML = '';
  }

  function showError(text) {
    if (errorEl) errorEl.textContent = text || '';
  }

  function authMessage(error) {
    var text = String(error && error.message || '');
    if (/invalid login credentials/i.test(text)) return 'Неверный email или пароль.';
    if (/email not confirmed/i.test(text)) return 'Email ещё не подтверждён. При создании пользователя в Supabase включите Auto Confirm.';
    if (/failed to fetch|network/i.test(text)) return 'Нет соединения с Supabase.';
    return 'Не удалось войти. Проверьте email и пароль.';
  }

  async function openCabinet() {
    try {
      if (typeof window.loadCabinetFromCloud === 'function') await window.loadCabinetFromCloud();
    } catch (error) {
      console.error('Чтение кабинета из Supabase не удалось. Показана локальная копия.', error);
    }
    showCabinet();
  }

  async function leaveCabinet() {
    if (logoutButton) logoutButton.disabled = true;
    var wasReady = window.cabinetCloudReady;
    var wasBaseline = window.cabinetCloudBaseline;
    window.cabinetCloudReady = false;
    window.cabinetCloudBaseline = null;
    try {
      if (!window.supabaseClient) {
        hideCabinet();
        return;
      }
      var result = await window.supabaseClient.auth.signOut({ scope: 'local' });
      if (result && result.error) {
        window.cabinetCloudReady = wasReady;
        window.cabinetCloudBaseline = wasBaseline;
        console.error('Выход из Supabase не выполнен.', result.error);
        return;
      }
      if (form) form.password.value = '';
      showError('');
      hideCabinet();
    } finally {
      if (logoutButton) logoutButton.disabled = false;
    }
  }

  if (menuButton) {
    menuButton.addEventListener('click', function (event) {
      event.stopPropagation();
      setMenuOpen(menuPanel.hidden);
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', function (event) {
      event.stopPropagation();
      setMenuOpen(false);
      leaveCabinet();
    });
  }

  document.addEventListener('click', function (event) {
    if (!menuPanel || menuPanel.hidden) return;
    if (event.target.closest && event.target.closest('.auth-menu')) return;
    setMenuOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setMenuOpen(false);
  });

  async function enterIfSession() {
    if (!window.supabaseClient) {
      showError('Подключение к Supabase не готово.');
      return;
    }
    var result = await window.supabaseClient.auth.getSession();
    if (result.data && result.data.session) await openCabinet();
  }

  if (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!window.supabaseClient) {
        showError('Подключение к Supabase не готово.');
        return;
      }
      showError('');
      if (button) button.disabled = true;
      var result = await window.supabaseClient.auth.signInWithPassword({
        email: String(form.email.value || '').trim(),
        password: String(form.password.value || '')
      });
      if (button) button.disabled = false;
      if (result.error || !result.data || !result.data.session) {
        showError(authMessage(result.error));
        return;
      }
      await openCabinet();
    });
  }

  enterIfSession();
})();
