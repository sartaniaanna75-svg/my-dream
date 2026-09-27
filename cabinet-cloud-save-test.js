async function saveCabinetStateToCloud() {
  var storageKey = 'finance-cabinet-v1';
  var preserved = localStorage.getItem(storageKey);

  function localUntouched() {
    return localStorage.getItem(storageKey) === preserved;
  }

  if (!window.cabinetCloudReady || !window.cabinetCloudLoad || window.cabinetCloudLoad.source !== 'supabase' || window.cabinetCloudLoad.error) {
    return { ok: false, error: 'Кабинет пользователя ещё не загружен из Supabase. Локальная копия не записывается.', localUnchanged: localUntouched() };
  }
  if (!window.supabaseClient) return { ok: false, error: 'Подключение к Supabase не готово.', localUnchanged: localUntouched() };
  var sessionResult = await window.supabaseClient.auth.getSession();
  var user = sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
  if (!user || !user.id) return { ok: false, error: 'Пользователь не авторизован.', localUnchanged: localUntouched() };
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.accounts) || !Array.isArray(state.deposits) || !Array.isArray(state.assets)) {
    return { ok: false, error: 'Текущее состояние кабинета неполное.', localUnchanged: localUntouched() };
  }

  var copy = JSON.parse(JSON.stringify(state));
  if (typeof window.cabinetCloudSerialize === 'function') window.cabinetCloudPendingBaseline = window.cabinetCloudSerialize(copy);
  var write = await window.supabaseClient.from('cabinets').upsert({
    user_id: user.id,
    payload: copy,
    schema_version: 1,
    app_version: 'finance-cabinet-v1'
  }, { onConflict: 'user_id' });
  var localUnchanged = localUntouched();
  if (write.error) return { ok: false, error: write.error.message, localUnchanged: localUnchanged };
  if (window.cabinetCloudPendingBaseline) window.cabinetCloudBaseline = window.cabinetCloudPendingBaseline;
  return { ok: true, userId: user.id, localUnchanged: localUnchanged };
}
window.saveCabinetStateToCloud = saveCabinetStateToCloud;
