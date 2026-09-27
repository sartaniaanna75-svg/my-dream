(function () {
  var waitMs = 700;
  var timer = null;
  var running = false;
  var pending = false;
  window.cabinetCloudReady = false;
  window.cabinetCloudBaseline = null;

  function serializeCabinet(value) {
    if (Array.isArray(value)) return '[' + value.map(serializeCabinet).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + serializeCabinet(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  window.cabinetCloudSerialize = serializeCabinet;

  function loadedFromCloud() {
    return window.cabinetCloudReady === true && window.cabinetCloudLoad && window.cabinetCloudLoad.source === 'supabase' && !window.cabinetCloudLoad.error;
  }

  function unchangedSinceLoad() {
    return typeof window.cabinetCloudBaseline === 'string' && serializeCabinet(state) === window.cabinetCloudBaseline;
  }

  function scheduleCabinetCloudSave() {
    if (!loadedFromCloud() || typeof window.saveCabinetStateToCloud !== 'function' || unchangedSinceLoad()) return;
    clearTimeout(timer);
    timer = setTimeout(flushCabinetCloudSave, waitMs);
  }

  async function flushCabinetCloudSave() {
    if (!loadedFromCloud() || typeof window.saveCabinetStateToCloud !== 'function' || unchangedSinceLoad()) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      var result = await window.saveCabinetStateToCloud();
      if (!result || result.ok !== true) console.error('Автосохранение кабинета в Supabase не выполнено.', result && result.error);
      else if (!unchangedSinceLoad()) scheduleCabinetCloudSave();
    } catch (error) {
      console.error('Автосохранение кабинета в Supabase не выполнено. Данные кабинета на экране сохранены.', error);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        scheduleCabinetCloudSave();
      }
    }
  }

  var baseSave = save;
  save = function () {
    baseSave();
    scheduleCabinetCloudSave();
  };
})();
