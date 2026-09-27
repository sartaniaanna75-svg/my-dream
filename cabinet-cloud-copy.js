async function saveCabinetCloudCopy() {
  return { ok: false, error: 'Локальная копия не записывается поверх кабинета в Supabase.', localUnchanged: true };
}
window.saveCabinetCloudCopy = saveCabinetCloudCopy;
