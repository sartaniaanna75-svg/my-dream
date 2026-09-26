(function () {
  const assetTypes = ['Квартира', 'Дом', 'Коммерческое помещение', 'Здание', 'Земля', 'Автомобиль', 'Другое'];
  const usageStatuses = ['Оплачиваю', 'Использую в своём бизнесе', 'Планирую сдавать', 'Свободно / ищу арендатора', 'Сдаётся в аренду', 'Продано / выбыло'];
  const currencies = ['RUB', 'USD', 'EUR'];
  const periods = ['Месяц', 'Квартал', 'Год', 'Другой период'];

  function migrateAsset(asset) {
    if (!Array.isArray(asset.photos)) asset.photos = asset.photo ? [asset.photo] : [];
    if (!asset.currency) asset.currency = 'RUB';
    if (asset.initialRate === undefined) asset.initialRate = asset.currency === 'RUB' ? 1 : 0;
    if (asset.currentRate === undefined) asset.currentRate = asset.initialRate;
    if (!asset.rateMode) asset.rateMode = 'Ручной';
    if (asset.acquisition === undefined) asset.acquisition = asset.purchase || '';
    if (!asset.type) asset.type = asset.category || 'Другое';
    if (!asset.usageStatus) asset.usageStatus = asset.status === 'В собственности' ? 'Свободно / ищу арендатора' : 'Оплачиваю';
    if (!Array.isArray(asset.statusHistory)) asset.statusHistory = [{ date: isoDate(today), value: asset.usageStatus }];
    if (!Array.isArray(asset.rateHistory)) asset.rateHistory = [];
    if (!asset.rent) asset.rent = { planned: false, periodicity: 'Месяц', currency: asset.currency || 'RUB', payments: [] };
    if (!Array.isArray(asset.rent.payments)) asset.rent.payments = [];
    if (asset.rent.planned === undefined) asset.rent.planned = false;
    if (!asset.rent.periodicity) asset.rent.periodicity = 'Месяц';
    if (!asset.rent.currency) asset.rent.currency = asset.currency || 'RUB';
    ensureRentalPayments(asset);
    return asset;
  }

  function ensureRentalPayments(asset) {
    const rent = asset.rent;
    if (!rent || asset.usageStatus !== 'Сдаётся в аренду' || !num(rent.amount) || !rent.nextDate) return;
    const count = rent.periodicity === 'Год' ? 2 : rent.periodicity === 'Квартал' ? 5 : 13;
    const existing = new Set(rent.payments.map(function (payment) { return payment.date; }));
    let date = new Date(rent.nextDate + 'T12:00:00');
    for (let i = 0; i < count; i += 1) {
      const paymentDate = isoDate(date);
      if (!existing.has(paymentDate)) rent.payments.push({ id: uid(), date: paymentDate, amount: num(rent.amount), status: 'Ожидается' });
      if (rent.periodicity === 'Год') date.setFullYear(date.getFullYear() + 1);
      else if (rent.periodicity === 'Квартал') date.setMonth(date.getMonth() + 3);
      else date.setMonth(date.getMonth() + 1);
    }
    rent.payments.sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  state.assets.forEach(migrateAsset);
  save();

  function readAssetExtras(form) {
    const get = function (name) { const field = form.elements[name]; return field ? field.value : ''; };
    const checked = function (name) { const field = form.elements[name]; return !!(field && field.checked); };
    let photos = [];
    try { photos = JSON.parse(get('photos') || '[]'); } catch (_) { photos = []; }
    return {
      type: get('type') || 'Другое', owner: get('owner') || '', currency: get('currency') || 'RUB', acquisition: get('acquisition') || get('purchase') || '', usageStatus: get('usageStatus') || 'Оплачиваю', initialRate: num(get('initialRate')), currentRate: num(get('currentRate')), rateMode: get('rateMode') || 'Ручной',
      photos: photos, plannedRent: checked('plannedRent'), rent: {
        planned: checked('plannedRent'), amount: num(get('rentAmount')), currency: get('rentCurrency') || get('currency') || 'RUB', periodicity: get('rentPeriodicity') || 'Месяц', startDate: get('rentStartDate') || '', comment: get('rentComment') || '',
        tenant: get('tenant') || '', nextDate: get('rentNextDate') || '', contractStart: get('contractStart') || '', contractEnd: get('contractEnd') || '', deposit: num(get('rentDeposit')), indexation: num(get('rentIndexation')), payments: []
      }
    };
  }

  function rentFields(asset) {
    const rent = asset.rent || {};
    const photos = JSON.stringify(asset.photos || []).replace(/"/g, '&quot;');
    return '<div class="asset-extension-fields"><div class="form-field"><label>Тип объекта</label><select name="type">' + assetTypes.map(function (type) { return '<option ' + (asset.type === type ? 'selected' : '') + '>' + type + '</option>'; }).join('') + '</select></div><div class="form-field"><label>Валюта стоимости</label><select name="currency">' + currencies.map(function (currency) { return '<option ' + ((asset.currency || 'RUB') === currency ? 'selected' : '') + '>' + currency + '</option>'; }).join('') + '</select></div><div class="form-field"><label>Режим курса</label><select name="rateMode"><option ' + (asset.rateMode === 'Ручной' ? 'selected' : '') + '>Ручной</option><option ' + (asset.rateMode === 'Автоматический' ? 'selected' : '') + '>Автоматический</option></select></div><div class="form-field"><label>Курс при внесении</label><input name="initialRate" inputmode="decimal" value="' + (asset.initialRate || '') + '"></div><div class="form-field"><label>Текущий курс</label><input name="currentRate" inputmode="decimal" value="' + (asset.currentRate || '') + '"><button type="button" class="ghost-button rate-refresh">Обновить курс</button></div><div class="form-field"><label>Дата приобретения</label><input name="acquisition" type="date" value="' + (asset.acquisition || asset.purchase || '') + '"></div><div class="form-field"><label>Статус использования</label><select name="usageStatus">' + usageStatuses.map(function (status) { return '<option ' + (asset.usageStatus === status ? 'selected' : '') + '>' + status + '</option>'; }).join('') + '</select></div><div class="asset-photo-field"><label>📎 Фотографии объекта</label><input id="asset-photos-input" type="file" accept="image/*" multiple><input name="photos" type="hidden" value="' + photos + '"><div class="asset-photo-list">' + (asset.photos || []).map(function (photo, index) { return '<div class="asset-photo-thumb"><img src="' + photo + '"><button type="button" data-photo-index="' + index + '">' + (index === 0 ? 'Главная' : 'Сделать главной') + '</button><button type="button" data-remove-photo="' + index + '">Удалить</button></div>'; }).join('') + '</div></div><div class="rent-toggle"><label><input name="plannedRent" type="checkbox" ' + (asset.rent && asset.rent.planned ? 'checked' : '') + '> Планируется сдача в аренду</label></div><div class="rental-fields"><div class="form-field"><label>Планируемая / фактическая сумма аренды</label><input name="rentAmount" inputmode="decimal" value="' + (rent.amount || '') + '"></div><div class="form-field"><label>Валюта аренды</label><select name="rentCurrency">' + currencies.map(function (currency) { return '<option ' + ((rent.currency || asset.currency || 'RUB') === currency ? 'selected' : '') + '>' + currency + '</option>'; }).join('') + '</select></div><div class="form-field"><label>Периодичность</label><select name="rentPeriodicity">' + periods.map(function (period) { return '<option ' + ((rent.periodicity || 'Месяц') === period ? 'selected' : '') + '>' + period + '</option>'; }).join('') + '</select></div><div class="form-field"><label>Ориентировочная дата начала / очередного платежа</label><input name="rentNextDate" type="date" value="' + (rent.nextDate || rent.startDate || '') + '"></div><div class="form-field"><label>Комментарий по аренде</label><input name="rentComment" value="' + (rent.comment || '') + '"></div><div class="form-field"><label>Арендатор</label><input name="tenant" value="' + (rent.tenant || '') + '"></div><div class="form-field"><label>Дата начала договора</label><input name="contractStart" type="date" value="' + (rent.contractStart || '') + '"></div><div class="form-field"><label>Дата окончания договора</label><input name="contractEnd" type="date" value="' + (rent.contractEnd || '') + '"></div><div class="form-field"><label>Депозит</label><input name="rentDeposit" inputmode="decimal" value="' + (rent.deposit || '') + '"></div><div class="form-field"><label>Индексация аренды %</label><input name="rentIndexation" inputmode="decimal" value="' + (rent.indexation || '') + '"></div></div><input name="assetExtensionReady" type="hidden" value="1"></div>';
  }

  const originalOpenForm = window.openForm;
  window.openForm = function (type, id) {
    originalOpenForm(type, id);
    if (type !== 'asset') return;
    const form = document.getElementById('record-form');
    const asset = state.assets.find(function (item) { return item.id === id; }) || {};
    const grid = form && form.querySelector('.form-grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', rentFields(migrateAsset(asset)));
    const extras = grid.querySelector('.asset-extension-fields');
    const photoInput = extras.querySelector('#asset-photos-input');
    const hiddenPhotos = extras.querySelector('[name="photos"]');
    const updatePhotos = function () { hiddenPhotos.value = JSON.stringify(Array.from(extras.querySelectorAll('.asset-photo-thumb img')).map(function (img) { return img.src; })); };
    photoInput.addEventListener('change', function () {
      Array.from(photoInput.files).forEach(function (file) { const reader = new FileReader(); reader.onload = function () { const thumb = document.createElement('div'); thumb.className = 'asset-photo-thumb'; thumb.innerHTML = '<img src="' + reader.result + '"><button type="button">Сделать главной</button><button type="button">Удалить</button>'; extras.querySelector('.asset-photo-list').appendChild(thumb); updatePhotos(); }; reader.readAsDataURL(file); });
    });
    extras.addEventListener('click', function (event) { if (event.target.dataset.removePhoto !== undefined) { event.target.closest('.asset-photo-thumb').remove(); updatePhotos(); } if (event.target.dataset.photoIndex !== undefined) { const list = extras.querySelector('.asset-photo-list'); const selected = list.children[Number(event.target.dataset.photoIndex)]; if (selected) list.prepend(selected); updatePhotos(); } });
    extras.addEventListener('click', function (event) { const thumb = event.target.closest('.asset-photo-thumb'); if (!thumb) return; if (event.target.textContent.indexOf('Сделать главной') >= 0) { extras.querySelector('.asset-photo-list').prepend(thumb); updatePhotos(); } if (event.target.textContent === 'Удалить') { thumb.remove(); updatePhotos(); } });
    extras.querySelector('.rate-refresh').addEventListener('click', function () { const value = prompt('Введите текущий курс вручную', extras.querySelector('[name="currentRate"]').value || ''); if (value !== null) extras.querySelector('[name="currentRate"]').value = value.replace(',', '.'); });
    extras.querySelector('[name="plannedRent"]').addEventListener('change', function () { extras.classList.toggle('rent-active', this.checked || extras.querySelector('[name="usageStatus"]').value === 'Сдаётся в аренду'); });
    extras.querySelector('[name="usageStatus"]').addEventListener('change', function () { extras.classList.toggle('rent-active', this.value === 'Сдаётся в аренду' || extras.querySelector('[name="plannedRent"]').checked); });
    extras.querySelector('[name="usageStatus"]').dispatchEvent(new Event('change'));
    const submit = form.onsubmit;
    form.onsubmit = function (event) {
      const before = state.assets.length;
      const result = submit(event);
      const name = form.elements.name && form.elements.name.value;
      const saved = state.assets.slice().reverse().find(function (item) { return item.name === name; });
      if (saved) {
        const extrasData = readAssetExtras(form);
        saved.type = extrasData.type; saved.currency = extrasData.currency; saved.acquisition = extrasData.acquisition; saved.usageStatus = extrasData.usageStatus; saved.photos = extrasData.photos; saved.photo = saved.photos[0] || ''; saved.rateMode = extrasData.rateMode || 'Ручной'; saved.initialRate = extrasData.initialRate || saved.initialRate || 1; saved.currentRate = extrasData.currentRate || saved.currentRate || saved.initialRate;
        if (!Array.isArray(saved.rateHistory)) saved.rateHistory = [];
        if (!saved.rateHistory.length || saved.rateHistory[saved.rateHistory.length - 1].rate !== saved.currentRate) saved.rateHistory.push({ date: isoDate(today), rate: saved.currentRate, rubValue: num(saved.value) * saved.currentRate / (saved.initialRate || 1) });
        if (!Array.isArray(saved.statusHistory)) saved.statusHistory = [];
        if (!saved.statusHistory.length || saved.statusHistory[saved.statusHistory.length - 1].value !== saved.usageStatus) saved.statusHistory.push({ date: isoDate(today), value: saved.usageStatus });
        saved.rent = Object.assign(saved.rent || {}, extrasData.rent, { planned: extrasData.plannedRent || saved.usageStatus === 'Сдаётся в аренду' });
        ensureRentalPayments(saved); save(); render();
      }
      return result;
    };
  };

  function rentalEvents() {
    const events = [];
    state.assets.forEach(function (asset) { migrateAsset(asset); const rent = asset.rent || {}; (rent.payments || []).forEach(function (payment) { const overdue = payment.status !== 'Получено' && daysFromNow(payment.date) < 0; events.push({ date: payment.date, title: overdue ? 'Аренда не получена — ' + asset.name : 'Аренда — ' + asset.name, sub: rent.tenant || asset.owner || asset.name, amount: payment.amount, type: overdue ? 'rent-overdue' : 'income', status: payment.status === 'Получено' ? 'Получено' : overdue ? 'Просрочено' : 'Ожидается', id: 'rent-' + asset.id + '-' + payment.id }); }); });
    return events;
  }
  const baseEventList = eventList;
  eventList = function () { return baseEventList().concat(rentalEvents()).sort(function (a, b) { return a.date.localeCompare(b.date); }); };

  function enhancedCalendar() {
    const y = calendarMonth.getFullYear(), m = calendarMonth.getMonth(), first = new Date(y, m, 1), last = new Date(y, m + 1, 0), start = (first.getDay() + 6) % 7, events = eventList();
    let cells = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(function (day) { return '<div class="calendar-day-name">' + day + '</div>'; }).join('');
    for (let i = 0; i < start; i += 1) cells += '<div class="calendar-cell muted"></div>';
    for (let day = 1; day <= last.getDate(); day += 1) { const date = isoDate(new Date(y, m, day)), dayEvents = events.filter(function (event) { return event.date === date; }), visible = dayEvents.slice(0, 3), hidden = dayEvents.slice(3), typeClass = function (event) { return event.type === 'payment' || event.type === 'end' || event.type === 'rent-overdue' ? 'tag-red' : 'tag-green'; }, eventHtml = function (event) { return '<div class="calendar-event ' + typeClass(event) + '"><strong>' + (event.type === 'end' ? 'Окончание вклада' : event.type === 'rent-overdue' ? 'Аренда не получена' : event.type === 'payment' ? 'Платёж' : 'Поступление') + '</strong><span>' + (event.sub || event.title) + '</span><b>' + (event.amount ? rub(event.amount) : '—') + '</b></div>'; }; cells += '<div class="calendar-cell ' + (date === isoDate(today) ? 'today-cell' : '') + '"><div class="day-number">' + day + '</div><div class="calendar-events">' + visible.map(eventHtml).join('') + '</div>' + (hidden.length ? '<div class="calendar-events calendar-events-extra">' + hidden.map(eventHtml).join('') + '</div><button class="calendar-more">＋ ещё ' + hidden.length + '</button>' : '') + '</div>'; }
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">ПЛАНИРОВАНИЕ</p><h2>Финансовый календарь</h2><p>Зелёным — поступления аренды и процентов · красным — платежи и просрочки</p></div><button class="primary-button" onclick="openForm(\'debt\')">＋ Добавить событие</button></div><div class="panel"><div class="panel-head"><div class="calendar-controls"><button onclick="changeMonth(-1)">←</button><div class="calendar-title">' + calendarMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) + '</div><button onclick="changeMonth(1)">→</button></div><span>' + events.length + ' событий</span></div><div class="calendar-grid">' + cells + '</div></div></div>';
  }
  calendar = enhancedCalendar;

  function markRentalReceived(assetId, paymentId) {
    const asset = state.assets.find(function (item) { return item.id === assetId; });
    const payment = asset && asset.rent && asset.rent.payments.find(function (item) { return item.id === paymentId; });
    if (payment) { payment.status = 'Получено'; payment.receivedAt = isoDate(today); save(); render(); }
  }
  window.markRentalReceived = markRentalReceived;

  const baseCompactCard = window.compactObligationCard;
  if (typeof baseCompactCard === 'function') {
    compactObligationCard = function (item) {
      let html = baseCompactCard(item);
      if (item.asset && item.asset.photos && item.asset.photos[0]) html = html.replace('<article class="obligation-card', '<article class="obligation-card"><img class="obligation-property-photo" src="' + item.asset.photos[0] + '" alt="Фото объекта">');
      if (item.kind !== 'asset' || !item.asset || !item.asset.rent || !item.asset.rent.planned) return html;
      const nextRent = (item.asset.rent.payments || []).find(function (payment) { return payment.status !== 'Получено'; });
      if (!nextRent) return html;
      const rentBlock = '<div class="rental-income-line"><span>Аренда ожидается</span><strong>+' + rub(nextRent.amount) + '</strong><small>' + dateText(nextRent.date) + '</small><button class="ghost-button" onclick="markRentalReceived(\'' + item.asset.id + '\',\'' + nextRent.id + '\')">Получено</button></div>';
      return html.replace('</article>', rentBlock + '</article>');
    };
  }

  function enhancedAssets() {
    const rows = state.assets.map(function (asset) { migrateAsset(asset); const value = asset.currency === 'RUB' ? num(asset.value) : num(asset.value) * num(asset.currentRate || asset.initialRate || 1) / (num(asset.initialRate) || 1); return '<tr><td><strong>' + asset.name + '</strong><br><span class="muted">' + asset.type + ' · ' + (asset.description || '') + '</span></td><td>' + asset.currency + ' ' + rub(asset.price) + '</td><td>' + rub(assetPaid(asset)) + '<br><span class="muted">осталось ' + rub(assetRemaining(asset)) + '</span></td><td><strong>' + rub(value) + '</strong><br><span class="muted">' + (asset.usageStatus || 'Оплачиваю') + '</span></td><td>' + (asset.owner || '—') + '</td><td>' + actions('asset', asset.id) + '</td></tr>'; }).join('');
    return listView('asset', 'Имущество', 'Оценочная стоимость и доходный потенциал', 'Добавить объект', ['Объект', 'Стоимость', 'Оплачено', 'Стоимость сегодня', 'Оформлено на', ''], rows);
  }
  assets = enhancedAssets;

  const baseIncome = income;
  income = function () {
    const panel = state.assets.filter(function (asset) { return asset.rent && asset.rent.planned; }).map(function (asset) { const received = (asset.rent.payments || []).filter(function (payment) { return payment.status === 'Получено'; }).reduce(function (sum, payment) { return sum + num(payment.amount); }, 0); const value = num(asset.value) * num(asset.currentRate || asset.initialRate || 1) / (num(asset.initialRate) || 1); return '<tr><td>' + asset.name + '</td><td>' + (asset.usageStatus || '—') + '</td><td>' + rub(received) + '</td><td>' + rub(received * 12) + '</td><td>' + rub(received / 12) + '</td><td>' + (value ? (received * 12 / value * 100).toFixed(2).replace('.', ',') + '%' : '—') + '</td></tr>'; }).join('');
    return baseIncome() + '<div class="panel property-analytics"><div class="panel-head"><div><p class="eyebrow">ИМУЩЕСТВО</p><h3>Доходность объектов</h3></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Объект</th><th>Статус</th><th>Аренда получена</th><th>За год</th><th>Среднее / месяц</th><th>Фактическая доходность</th></tr></thead><tbody>' + (panel || '<tr><td colspan="6"><div class="empty">Доходных объектов пока нет</div></td></tr>') + '</tbody></table></div></div>';
  };
  const baseHistory = history;
  history = function () {
    const statusRows = state.assets.flatMap(function (asset) { return (asset.statusHistory || []).map(function (entry) { return '<div class="stat-row"><span>' + dateText(entry.date) + ' · ' + asset.name + '</span><strong>' + entry.value + '</strong></div>'; }); }).join('');
    const rateRows = state.assets.flatMap(function (asset) { return (asset.rateHistory || []).map(function (entry) { return '<div class="stat-row"><span>' + dateText(entry.date) + ' · ' + asset.name + '</span><strong>' + entry.rate + '</strong></div>'; }).join(''); }).join('');
    return baseHistory() + '<div class="panel property-history"><h3>История имущества</h3><h4>Изменения статусов</h4>' + (statusRows || '<div class="empty">История статусов появится после изменений</div>') + '<h4>История курсов и переоценки</h4>' + (rateRows || '<div class="empty">История курсов появится для валютного имущества</div>') + '</div>';
  };

  function rentalSummary() {
    const monthlyExpected = state.assets.reduce(function (sum, asset) { return sum + (asset.rent && asset.rent.planned ? num(asset.rent.amount) : 0); }, 0);
    const monthlyReceived = state.assets.reduce(function (sum, asset) { return sum + (asset.rent ? asset.rent.payments.filter(function (payment) { return payment.status === 'Получено' && payment.receivedAt && payment.receivedAt.slice(0, 7) === isoDate(today).slice(0, 7); }).reduce(function (part, payment) { return part + num(payment.amount); }, 0) : 0); }, 0);
    const depositIncome = state.deposits.reduce(function (sum, deposit) { return sum + num(deposit.received); }, 0);
    return '<section class="rental-summary panel"><div class="dash-panel-heading"><div><p class="eyebrow">ДОХОД ОТ КАПИТАЛА</p><h3>Фактический и потенциальный доход</h3></div></div><div class="rental-summary-grid"><div><span>Проценты по вкладам</span><strong>' + rub(depositIncome) + '</strong></div><div><span>Аренда получена</span><strong class="teal">' + rub(monthlyReceived) + '</strong></div><div><span>Аренда ожидается</span><strong class="orange">' + rub(monthlyExpected) + '</strong></div><div><span>Потенциальный доход / месяц</span><strong>' + rub(monthlyExpected) + '</strong></div></div></section>';
  }
  function refreshRentalSummary() { if (typeof activeView === 'undefined' || activeView !== 'dashboard') return; const view = document.getElementById('app-view'); if (!view || view.querySelector('.rental-summary')) return; const shell = view.querySelector('.dashboard-shell'); if (shell) shell.insertAdjacentHTML('afterbegin', rentalSummary()); }
  setTimeout(refreshRentalSummary, 0);
  document.getElementById('main-nav').addEventListener('click', function () { setTimeout(refreshRentalSummary, 0); });
  document.querySelector('.top-actions').addEventListener('click', function () { setTimeout(refreshRentalSummary, 0); });
}());
