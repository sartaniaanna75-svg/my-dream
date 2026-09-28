async function loadCabinetFromCloud() {
  window.cabinetCloudReady = false;
  window.cabinetCloudBaseline = null;
  var view = document.getElementById('app-view');
  if (view) view.innerHTML = '';
  var storageKey = 'finance-cabinet-v1';
  var preserved = localStorage.getItem(storageKey);

  function keepLocalCopy() {
    if (typeof preserved === 'string' && localStorage.getItem(storageKey) !== preserved) {
      localStorage.setItem(storageKey, preserved);
      window.cabinetCloudLocalRestored = true;
      console.error('Чтение кабинета из Supabase изменило локальную копию. Исходный finance-cabinet-v1 восстановлен.');
    }
  }

  function useLocal(message) {
    console.error(message);
    keepLocalCopy();
    window.cabinetCloudBaseline = null;
    window.cabinetCloudLoad = { source: 'localStorage', error: message };
    return window.cabinetCloudLoad;
  }

  if (!window.supabaseClient) return useLocal('Чтение кабинета из Supabase пропущено: клиент не готов. Показана локальная копия.');
  var sessionResult = await window.supabaseClient.auth.getSession();
  var user = sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
  if (!user || !user.id) return useLocal('Чтение кабинета из Supabase пропущено: нет сессии пользователя. Показана локальная копия.');

  var read = await window.supabaseClient.from('cabinets').select('user_id,schema_version,app_version,payload').eq('user_id', user.id);
  if (read.error) return useLocal('Чтение кабинета из Supabase не удалось: ' + read.error.message + '. Показана локальная копия.');
  var rows = read.data || [];
  if (rows.length !== 1) return useLocal('Чтение кабинета из Supabase не удалось: запись пользователя не найдена. Показана локальная копия.');
  var row = rows[0];
  var payload = row.payload;
  if (row.schema_version !== 1 || !payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.accounts) || !Array.isArray(payload.deposits) || !Array.isArray(payload.assets)) {
    return useLocal('Чтение кабинета из Supabase не удалось: payload повреждён. Показана локальная копия.');
  }

  var copy = JSON.parse(JSON.stringify(payload));
  state = typeof normalizeState === 'function' ? normalizeState(copy) : copy;
  if (typeof render === 'function') render();
  keepLocalCopy();
  window.cabinetCloudLoad = { source: 'supabase', userId: user.id, error: null };
  window.cabinetCloudBaseline = typeof window.cabinetCloudSerialize === 'function' ? window.cabinetCloudSerialize(state) : JSON.stringify(state);
  window.cabinetCloudReady = true;
  return window.cabinetCloudLoad;
}
window.loadCabinetFromCloud = loadCabinetFromCloud;
