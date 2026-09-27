function cabinetCloudSections(data) {
  var assets = Array.isArray(data && data.assets) ? data.assets : [];
  var rentPayments = 0;
  var rentHistory = 0;
  var parts = 0;
  var purchasePayments = 0;
  assets.forEach(function (asset) {
    parts += Array.isArray(asset.parts) ? asset.parts.length : 0;
    purchasePayments += Array.isArray(asset.payments) ? asset.payments.length : 0;
    if (asset.rent && Array.isArray(asset.rent.payments)) rentPayments += asset.rent.payments.length;
    if (Array.isArray(asset.rentHistory)) rentHistory += asset.rentHistory.length;
    (asset.parts || []).forEach(function (part) {
      if (Array.isArray(part.rentPayments)) rentPayments += part.rentPayments.length;
      if (Array.isArray(part.rentHistory)) rentHistory += part.rentHistory.length;
    });
  });
  return {
    accounts: Array.isArray(data && data.accounts) ? data.accounts.length : 0,
    deposits: Array.isArray(data && data.deposits) ? data.deposits.length : 0,
    assets: assets.length,
    assetNames: assets.map(function (asset) { return asset && asset.name; }),
    safes: Array.isArray(data && data.safes) ? data.safes.length : 0,
    debts: Array.isArray(data && data.debts) ? data.debts.length : 0,
    purchasePayments: purchasePayments,
    parts: parts,
    rentPayments: rentPayments,
    rentHistory: rentHistory,
    history: Array.isArray(data && data.history) ? data.history.length : 0,
    transactions: Array.isArray(data && data.transactions) ? data.transactions.length : 0,
    currencies: Array.isArray(data && data.currencyCatalog) ? data.currencyCatalog.length : 0,
    fxKeys: data && data.fx && typeof data.fx === 'object' ? Object.keys(data.fx).sort() : []
  };
}

function cabinetCloudDiff(local, cloud, path, out, limit) {
  if (out.length >= limit) return;
  if (Object.is(local, cloud)) return;
  var localArray = Array.isArray(local);
  var cloudArray = Array.isArray(cloud);
  var localObject = local && typeof local === 'object' && !localArray;
  var cloudObject = cloud && typeof cloud === 'object' && !cloudArray;
  if (localArray !== cloudArray || localObject !== cloudObject) {
    out.push(path || 'корень');
    return;
  }
  if (localArray) {
    if (local.length !== cloud.length) out.push((path || 'корень') + '.length');
    var count = Math.max(local.length, cloud.length);
    for (var index = 0; index < count; index += 1) cabinetCloudDiff(local[index], cloud[index], (path || 'корень') + '[' + index + ']', out, limit);
    return;
  }
  if (localObject) {
    var keys = {};
    Object.keys(local).forEach(function (key) { keys[key] = true; });
    Object.keys(cloud).forEach(function (key) { keys[key] = true; });
    Object.keys(keys).sort().forEach(function (key) {
      cabinetCloudDiff(local[key], cloud[key], path ? path + '.' + key : key, out, limit);
    });
    return;
  }
  out.push(path || 'корень');
}

async function compareCabinetCloudCopy() {
  var storageKey = 'finance-cabinet-v1';
  if (!window.supabaseClient) return { ok: false, read: false, error: 'Подключение к Supabase не готово.' };
  var sessionResult = await window.supabaseClient.auth.getSession();
  var user = sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
  if (!user || !user.id) return { ok: false, read: false, error: 'Пользователь не авторизован.' };
  var before = localStorage.getItem(storageKey);
  if (typeof before !== 'string' || !before) return { ok: false, read: false, error: 'В localStorage нет кабинета.' };
  var local;
  try { local = JSON.parse(before); } catch (error) { return { ok: false, read: false, error: 'Кабинет в localStorage не является JSON.' }; }
  var read = await window.supabaseClient.from('cabinets').select('id,user_id,schema_version,app_version,payload').eq('user_id', user.id);
  var after = localStorage.getItem(storageKey);
  if (read.error) return { ok: false, read: false, error: read.error.message, localUnchanged: before === after };
  var rows = read.data || [];
  if (rows.length !== 1) return { ok: false, read: true, error: 'Ожидалась одна запись кабинета.', count: rows.length, localUnchanged: before === after };
  var row = rows[0];
  var differences = [];
  cabinetCloudDiff(local, row.payload, '', differences, 30);
  return {
    ok: true,
    read: true,
    equal: differences.length === 0,
    differences: differences,
    userId: row.user_id,
    schemaVersion: row.schema_version,
    appVersion: row.app_version,
    local: cabinetCloudSections(local),
    cloud: cabinetCloudSections(row.payload),
    localUnchanged: before === after,
    count: rows.length
  };
}
window.compareCabinetCloudCopy = compareCabinetCloudCopy;
