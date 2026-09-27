(function () {
  const assetTypes = ['Квартира', 'Дом', 'Территория или имущественный комплекс', 'Склад', 'Коммерческое помещение', 'Земельный участок', 'Автомобиль', 'Другое'];
  const usageStatuses = ['Личное использование', 'Используется в собственном бизнесе', 'Сдаётся в аренду', 'Планируется сдача в аренду', 'Не используется / свободно'];
  const periods = ['Месяц', 'Квартал', 'Год', 'Другой период'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function migrateAsset(asset) {
    if (!Array.isArray(asset.photos)) asset.photos = asset.photo ? [asset.photo] : [];
    if (!asset.currency) asset.currency = 'RUB';
    if (asset.initialRate === undefined) asset.initialRate = asset.currency === 'RUB' ? 1 : 0;
    if (asset.currentRate === undefined) asset.currentRate = asset.initialRate;
    if (!asset.rateMode) asset.rateMode = 'Ручной';
    if (asset.acquisition === undefined) asset.acquisition = asset.purchase || '';
    if (!asset.type) asset.type = asset.category || 'Другое';
    if (!asset.usage && asset.usageStatus && usageStatuses.indexOf(asset.usageStatus) >= 0) asset.usage = asset.usageStatus;
    if (!asset.usage) asset.usage = 'Личное использование';
    asset.usageStatus = asset.usage;
    if (!Array.isArray(asset.parts)) asset.parts = [];
    if (!asset.valueCurrency) asset.valueCurrency = asset.currency || 'RUB';
    if (!asset.ownershipStatus) asset.ownershipStatus = asset.status === 'Покупаю' ? 'Покупается' : 'В собственности';
    if (!Array.isArray(asset.statusHistory)) asset.statusHistory = [{ date: isoDate(today), value: asset.usageStatus }];
    if (!Array.isArray(asset.rateHistory)) asset.rateHistory = [];
    if (!asset.rent) asset.rent = { planned: false, periodicity: 'Месяц', currency: asset.currency || 'RUB', payments: [] };
    if (!Array.isArray(asset.rent.payments)) asset.rent.payments = [];
    if (asset.rent.planned === undefined) asset.rent.planned = false;
    if (!asset.rent.periodicity) asset.rent.periodicity = 'Месяц';
    if (!asset.rent.currency) asset.rent.currency = asset.currency || 'RUB';
    return asset;
  }

  function ensureRentalPayments(asset) {
    const rent = asset.rent;
    if (!rent || (asset.usage || asset.usageStatus) !== 'Сдаётся в аренду' || !num(rent.amount) || !rent.nextDate) return;
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
      photos: photos, plannedRent: get('usageStatus') === 'Сдаётся в аренду' || get('usageStatus') === 'Планируется сдача в аренду', rent: {
        planned: checked('plannedRent'), amount: num(get('rentAmount')), currency: get('rentCurrency') || get('currency') || 'RUB', periodicity: get('rentPeriodicity') || 'Месяц', startDate: get('rentStartDate') || '', comment: get('rentComment') || '',
        tenant: get('tenant') || '', nextDate: get('rentNextDate') || '', contractStart: get('contractStart') || '', contractEnd: get('contractEnd') || '', deposit: num(get('rentDeposit')), indexation: num(get('rentIndexation'))
      }
    };
  }

  function optionList(items, current) {
    return items.map(function (item) { return '<option ' + (item === current ? 'selected' : '') + '>' + item + '</option>'; }).join('');
  }

  function rentFields(asset) {
    const rent = asset.rent || {};
    const photos = JSON.stringify(asset.photos || []).replace(/"/g, '&quot;');
    const usage = asset.usage || asset.usageStatus || 'Личное использование';
    return '<div class="asset-extension-fields">' +
      '<div class="form-field purchase-only"><label>Валюта договора</label><select name="currency" data-currency-catalog="1"><option>' + esc(asset.currency || 'RUB') + '</option></select></div>' +
      '<div class="form-field fx-only"><label>Режим курса</label><select name="rateMode">' + optionList(['Ручной', 'Автоматический'], asset.rateMode || 'Ручной') + '</select></div>' +
      '<div class="form-field fx-only"><label>Курс при внесении</label><input name="initialRate" inputmode="decimal" value="' + (asset.initialRate || '') + '"></div>' +
      '<div class="form-field fx-only"><label>Текущий курс</label><input name="currentRate" inputmode="decimal" value="' + (asset.currentRate || '') + '"><button type="button" class="ghost-button rate-refresh">Обновить курс</button></div>' +
      '<div class="form-field usage-only"><label>Как используется объект?</label><select name="usageStatus">' + optionList(usageStatuses, usage) + '</select></div>' +
      '<div class="asset-photo-field"><label>Фотографии объекта</label><input id="asset-photos-input" type="file" accept="image/*" multiple><input name="photos" type="hidden" value="' + photos + '"><div class="asset-photo-list">' + (asset.photos || []).map(function (photo, index) { return '<div class="asset-photo-thumb"><img src="' + photo + '"><button type="button" data-photo-index="' + index + '">' + (index === 0 ? 'Главная' : 'Сделать главной') + '</button><button type="button" data-remove-photo="' + index + '">Удалить</button></div>'; }).join('') + '</div></div>' +
      '<div class="rental-fields"><div class="form-field rent-any"><label>Сумма аренды</label><input name="rentAmount" inputmode="decimal" value="' + (rent.amount || '') + '"></div>' +
      '<div class="form-field rent-any"><label>Дата начала дохода / очередного платежа</label><input name="rentNextDate" type="date" value="' + (rent.nextDate || rent.startDate || '') + '"></div>' +
      '<div class="form-field rent-live"><label>Валюта аренды</label><select name="rentCurrency" data-currency-catalog="1"><option>' + esc(rent.currency || asset.currency || 'RUB') + '</option></select></div>' +
      '<div class="form-field rent-live"><label>Периодичность</label><select name="rentPeriodicity">' + optionList(periods, rent.periodicity || 'Месяц') + '</select></div>' +
      '<div class="form-field rent-live"><label>Арендатор</label><input name="tenant" value="' + (rent.tenant || '') + '"></div>' +
      '<div class="form-field rent-live"><label>Дата начала договора</label><input name="contractStart" type="date" value="' + (rent.contractStart || '') + '"></div>' +
      '<div class="form-field rent-live"><label>Дата окончания договора</label><input name="contractEnd" type="date" value="' + (rent.contractEnd || '') + '"></div>' +
      '<div class="form-field rent-live"><label>Депозит</label><input name="rentDeposit" inputmode="decimal" value="' + (rent.deposit || '') + '"></div>' +
      '<div class="form-field rent-live"><label>Индексация аренды %</label><input name="rentIndexation" inputmode="decimal" value="' + (rent.indexation || '') + '"></div>' +
      '<div class="form-field rent-live"><label>Комментарий по аренде</label><input name="rentComment" value="' + (rent.comment || '') + '"></div></div>' +
      '<input name="assetExtensionReady" type="hidden" value="1"></div>';
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
      Array.from(photoInput.files).forEach(function (file) {
        const reader = new FileReader();
        reader.onload = function () {
          const place = function (src) { const thumb = document.createElement('div'); thumb.className = 'asset-photo-thumb'; thumb.innerHTML = '<img src="' + src + '"><button type="button">Сделать главной</button><button type="button">Удалить</button>'; extras.querySelector('.asset-photo-list').appendChild(thumb); updatePhotos(); };
          if (typeof compressImageUrl === 'function') compressImageUrl(reader.result).then(place);
          else place(reader.result);
        };
        reader.readAsDataURL(file);
      });
    });
    extras.addEventListener('click', function (event) { if (event.target.dataset.removePhoto !== undefined) { event.target.closest('.asset-photo-thumb').remove(); updatePhotos(); } if (event.target.dataset.photoIndex !== undefined) { const list = extras.querySelector('.asset-photo-list'); const selected = list.children[Number(event.target.dataset.photoIndex)]; if (selected) list.prepend(selected); updatePhotos(); } });
    extras.addEventListener('click', function (event) { const thumb = event.target.closest('.asset-photo-thumb'); if (!thumb) return; if (event.target.textContent.indexOf('Сделать главной') >= 0) { extras.querySelector('.asset-photo-list').prepend(thumb); updatePhotos(); } if (event.target.textContent === 'Удалить') { thumb.remove(); updatePhotos(); } });
    const rateRefresh = extras.querySelector('.rate-refresh');
    if (rateRefresh) rateRefresh.addEventListener('click', function () { const value = prompt('Введите текущий курс вручную', extras.querySelector('[name="currentRate"]').value || ''); if (value !== null) extras.querySelector('[name="currentRate"]').value = value.replace(',', '.'); });
    const usageField = extras.querySelector('[name="usageStatus"]');
    if (usageField) {
      usageField.addEventListener('change', function () { const renting = this.value === 'Сдаётся в аренду' || this.value === 'Планируется сдача в аренду'; extras.classList.toggle('rent-active', renting); });
      usageField.dispatchEvent(new Event('change'));
    }
    const submit = form.onsubmit;
    form.onsubmit = function (event) {
      const existing = id ? state.assets.find(function (item) { return item.id === id; }) : null;
      const keptPayments = existing && existing.rent && Array.isArray(existing.rent.payments) ? existing.rent.payments.map(function (payment) { return Object.assign({}, payment); }) : [];
      const result = submit(event);
      const name = form.elements.name && form.elements.name.value;
      const saved = state.assets.slice().reverse().find(function (item) { return item.name === name; });
      if (saved) {
        const extrasData = readAssetExtras(form);
        if (extrasData.type) saved.type = extrasData.type; if (extrasData.currency) saved.currency = extrasData.currency; if (extrasData.acquisition) saved.acquisition = extrasData.acquisition; saved.usage = extrasData.usageStatus || saved.usage || 'Личное использование'; saved.usageStatus = saved.usage; saved.photos = extrasData.photos; saved.photo = saved.photos[0] || ''; saved.rateMode = extrasData.rateMode || 'Ручной'; saved.initialRate = extrasData.initialRate || saved.initialRate || 1; saved.currentRate = extrasData.currentRate || saved.currentRate || saved.initialRate;
        if (!Array.isArray(saved.rateHistory)) saved.rateHistory = [];
        if (!saved.rateHistory.length || saved.rateHistory[saved.rateHistory.length - 1].rate !== saved.currentRate) saved.rateHistory.push({ date: isoDate(today), rate: saved.currentRate, rubValue: num(saved.value) * saved.currentRate / (saved.initialRate || 1) });
        if (!Array.isArray(saved.statusHistory)) saved.statusHistory = [];
        if (!saved.statusHistory.length || saved.statusHistory[saved.statusHistory.length - 1].value !== saved.usageStatus) saved.statusHistory.push({ date: isoDate(today), value: saved.usageStatus });
        saved.rent = Object.assign({}, existing && existing.rent ? existing.rent : {}, extrasData.rent, { planned: saved.usage === 'Планируется сдача в аренду' || saved.usage === 'Сдаётся в аренду', payments: keptPayments });
        ensureRentalPayments(saved); save(); render();
      }
      return result;
    };
  };

  function rentBucket(usage) {
    if (usage === 'Планируется сдача в аренду') return 'planned';
    if (usage === 'Не используется / свободно') return 'vacant';
    if (usage === 'Сдаётся в аренду') return 'rented';
    return '';
  }

  function rentPayStatus(payment) {
    if (!payment) return '';
    if (payment.status === 'Получено') return 'Получено';
    if (payment.date && daysFromNow(payment.date) < 0) return 'Просрочено';
    return 'Ожидается';
  }

  function periodLabel(value) {
    if (value === 'Квартал') return 'в квартал';
    if (value === 'Год') return 'в год';
    return 'в месяц';
  }

  function rentMoney(amount, currency) {
    if (typeof moneyOriginal === 'function') return moneyOriginal(amount, currency || 'RUB');
    return rub(amount);
  }

  function areaText(area) {
    const text = String(area || '').trim();
    if (!text) return '';
    return /м²|м2/i.test(text) ? text : text + ' м²';
  }

  function ensurePartRentPayments(part) {
    if (!part || part.usage !== 'Сдаётся в аренду' || !num(part.rentAmount)) return false;
    if (!Array.isArray(part.rentPayments)) part.rentPayments = [];
    const start = part.rentNext || part.rentStart;
    if (!start) return false;
    const count = part.rentPeriod === 'Год' ? 2 : part.rentPeriod === 'Квартал' ? 5 : 13;
    const existing = {};
    part.rentPayments.forEach(function (payment) { existing[payment.date] = true; });
    let date = new Date(start + 'T12:00:00');
    let added = false;
    for (let index = 0; index < count; index += 1) {
      const paymentDate = isoDate(date);
      if (!existing[paymentDate]) {
        part.rentPayments.push({ id: uid(), date: paymentDate, amount: num(part.rentAmount), currency: part.rentCurrency || 'RUB', status: 'Ожидается' });
        added = true;
      }
      if (part.rentPeriod === 'Год') date.setFullYear(date.getFullYear() + 1);
      else if (part.rentPeriod === 'Квартал') date.setMonth(date.getMonth() + 3);
      else date.setMonth(date.getMonth() + 1);
    }
    part.rentPayments.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    return added;
  }

  function rentUnits() {
    const units = [];
    let changed = false;
    state.assets.forEach(function (asset) {
      migrateAsset(asset);
      const assetBucket = rentBucket(asset.usage || asset.usageStatus || '');
      if (assetBucket) units.push({ bucket: assetBucket, asset: asset, part: null });
      (asset.parts || []).forEach(function (part) {
        const bucket = rentBucket(part.usage);
        if (!bucket) return;
        if (!Array.isArray(part.rentPayments)) part.rentPayments = [];
        if (bucket === 'rented' && ensurePartRentPayments(part)) changed = true;
        units.push({ bucket: bucket, asset: asset, part: part });
      });
    });
    if (changed) save();
    return units;
  }

  function unitAmount(unit) {
    if (unit.part) return num(unit.part.rentAmount);
    return num(unit.asset.rent && unit.asset.rent.amount);
  }

  function unitCurrency(unit) {
    if (unit.part) return unit.part.rentCurrency || 'RUB';
    return (unit.asset.rent && unit.asset.rent.currency) || unit.asset.currency || 'RUB';
  }

  function unitStart(unit) {
    if (unit.part) return unit.part.rentStart || '';
    const rent = unit.asset.rent || {};
    return rent.contractStart || rent.startDate || rent.nextDate || '';
  }

  function unitNext(unit) {
    if (unit.part) {
      const upcoming = (unit.part.rentPayments || []).filter(function (payment) { return payment.status !== 'Получено'; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })[0];
      return upcoming ? upcoming.date : (unit.part.rentNext || '');
    }
    const rent = unit.asset.rent || {};
    const upcoming = (rent.payments || []).filter(function (payment) { return payment.status !== 'Получено'; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })[0];
    return upcoming ? upcoming.date : (rent.nextDate || '');
  }

  function unitTenant(unit) {
    if (unit.part) return unit.part.tenant || '';
    return (unit.asset.rent && unit.asset.rent.tenant) || '';
  }

  function nextUnitPayment(unit) {
    const list = unit.part ? (unit.part.rentPayments || []) : ((unit.asset.rent && unit.asset.rent.payments) || []);
    return list.filter(function (payment) { return payment.status !== 'Получено'; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })[0] || null;
  }

  function rentCard(unit) {
    const part = unit.part;
    const place = part ? (part.name || 'Помещение') : 'Весь объект';
    const type = part ? (part.type || '') : (unit.asset.type || unit.asset.category || '');
    const area = part ? areaText(part.area) : '';
    const amount = unitAmount(unit);
    const period = part ? periodLabel(part.rentPeriod) : periodLabel(unit.asset.rent && unit.asset.rent.periodicity);
    const start = unitStart(unit);
    const tenant = unitTenant(unit);
    const next = unit.bucket === 'rented' ? nextUnitPayment(unit) : null;
    const statusText = unit.bucket === 'rented' ? 'Сдано' : unit.bucket === 'vacant' ? 'Свободно' : 'Планируется';
    const statusClass = unit.bucket === 'rented' ? 'tag-green' : unit.bucket === 'vacant' ? 'tag-blue' : 'tag-yellow';
    const partId = part ? part.id : '';
    const facts = '<div><span>Основной объект</span><strong>' + esc(unit.asset.name) + '</strong></div>' +
      '<div><span>Помещение</span><strong>' + esc(place) + '</strong></div>' +
      '<div><span>Тип</span><strong>' + esc(type || '—') + '</strong></div>' +
      (area ? '<div><span>Площадь</span><strong>' + esc(area) + '</strong></div>' : '') +
      '<div><span>' + (unit.bucket === 'rented' ? 'Аренда' : 'Планируемая аренда') + '</span><strong>' + (amount ? rentMoney(amount, unitCurrency(unit)) : '—') + '</strong><small>' + period + '</small></div>' +
      '<div><span>Дата начала</span><strong>' + (start ? dateText(start) : '—') + '</strong></div>' +
      (tenant ? '<div><span>Арендатор</span><strong>' + esc(tenant) + '</strong></div>' : '') +
      (next ? '<div><span>Следующий платёж</span><strong>' + dateText(next.date) + '</strong><small class="' + (rentPayStatus(next) === 'Просрочено' ? 'danger' : '') + '">' + rentPayStatus(next) + '</small></div>' : '');
    const action = unit.bucket === 'rented'
      ? '<button type="button" class="ghost-button" onclick="openRentLease(\'' + unit.asset.id + '\',\'' + partId + '\')">Условия</button>' + (next ? '<button type="button" class="primary-button" onclick="markUnitRentReceived(\'' + unit.asset.id + '\',\'' + partId + '\',\'' + next.id + '\')">Получено</button>' : '')
      : '<button type="button" class="primary-button" onclick="openRentLease(\'' + unit.asset.id + '\',\'' + partId + '\')">Сдать</button>';
    return '<article class="rent-row panel"><div class="rent-row-main">' + facts + '</div><span class="tag rent-status ' + statusClass + '">' + statusText + '</span><div class="rent-row-actions">' + action + '</div></article>';
  }

  function rentalsView() {
    const units = rentUnits();
    const blocks = [
      ['planned', 'Планируется к сдаче', 'Потенциальный доход. Эти суммы не входят в текущий доход, свободные деньги и капитал.'],
      ['vacant', 'Свободно / ищем арендатора', 'Помещения без действующего договора.'],
      ['rented', 'Сдано в аренду', 'Ожидаемые платежи появляются здесь и в календаре. Доход учитывается после отметки «Получено».']
    ];
    const body = blocks.map(function (block) {
      const rows = units.filter(function (unit) { return unit.bucket === block[0]; });
      return '<section class="rent-block"><div class="rent-block-head"><h3>' + block[1] + '</h3><span>' + rows.length + '</span></div><p>' + block[2] + '</p>' + (rows.length ? rows.map(rentCard).join('') : '<div class="rent-empty">Пока нет</div>') + '</section>';
    }).join('');
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">ДОХОД ОТ ИМУЩЕСТВА</p><h2>Аренда</h2><p>Те же объекты и помещения из раздела «Имущество». Повторно вводить их не нужно.</p></div></div>' + body + '</div>';
  }
  window.rentalsView = rentalsView;

  function updateRentCount() {
    const node = document.getElementById('rent-count');
    if (!node || typeof state === 'undefined') return;
    node.textContent = rentUnits().length;
  }

  window.openRentLease = function (assetId, partId) {
    const asset = state.assets.find(function (item) { return item.id === assetId; });
    if (!asset) return;
    const part = partId ? (asset.parts || []).find(function (item) { return item.id === partId; }) : null;
    if (partId && !part) return;
    const rent = part ? part : (asset.rent || {});
    const amount = part ? part.rentAmount : rent.amount;
    const currency = part ? (part.rentCurrency || 'RUB') : (rent.currency || asset.currency || 'RUB');
    const start = part ? (part.rentStart || '') : (rent.contractStart || rent.startDate || '');
    const end = part ? (part.rentEnd || '') : (rent.contractEnd || '');
    const period = part ? (part.rentPeriod || 'Месяц') : (rent.periodicity || 'Месяц');
    const next = part ? (part.rentNext || part.rentStart || '') : (rent.nextDate || '');
    const tenant = part ? (part.tenant || '') : (rent.tenant || '');
    const phone = part ? (part.rentPhone || '') : (rent.phone || '');
    const comment = part ? (part.comment || '') : (rent.comment || '');
    const currencyOptions = '<option selected>' + esc(currency || 'RUB') + '</option>';
    const periodOptions = periods.map(function (item) { return '<option ' + (item === period ? 'selected' : '') + '>' + item + '</option>'; }).join('');
    const field = function (label, html) { return '<div class="form-field"><label>' + label + '</label>' + html + '</div>'; };
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Сдано в аренду</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="rent-lease-form"><div class="modal-body"><div class="form-grid">' +
      field('ФИО или название арендатора', '<input name="tenant" value="' + esc(tenant) + '">') +
      field('Телефон или контакт', '<input name="phone" value="' + esc(phone) + '">') +
      field('Сумма аренды', '<input name="amount" inputmode="decimal" value="' + esc(amount || '') + '" required>') +
      field('Валюта', '<select name="currency" data-currency-catalog="1">' + currencyOptions + '</select>') +
      field('Дата начала аренды', '<input name="start" type="date" value="' + esc(start) + '">') +
      field('Дата окончания договора', '<input name="end" type="date" value="' + esc(end) + '">') +
      field('Периодичность платежа', '<select name="period">' + periodOptions + '</select>') +
      field('Дата следующего платежа', '<input name="next" type="date" value="' + esc(next) + '">') +
      field('Комментарий', '<input name="comment" value="' + esc(comment) + '">') +
      '</div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Сохранить</button></div></form></div></div>';
    document.getElementById('rent-lease-form').onsubmit = function (event) {
      event.preventDefault();
      const form = event.target;
      const leaseAmount = num(form.elements.amount.value);
      if (!(leaseAmount > 0)) { alert('Укажите сумму аренды.'); return; }
      if (part) {
        part.usage = 'Сдаётся в аренду';
        part.tenant = form.elements.tenant.value.trim();
        part.rentPhone = form.elements.phone.value.trim();
        part.rentAmount = leaseAmount;
        part.rentCurrency = form.elements.currency.value;
        part.rentStart = form.elements.start.value;
        part.rentEnd = form.elements.end.value;
        part.rentPeriod = form.elements.period.value;
        part.rentNext = form.elements.next.value || form.elements.start.value;
        part.comment = form.elements.comment.value.trim();
        ensurePartRentPayments(part);
      } else {
        asset.usage = 'Сдаётся в аренду';
        asset.usageStatus = asset.usage;
        asset.rent = Object.assign({}, asset.rent || {}, {
          tenant: form.elements.tenant.value.trim(),
          phone: form.elements.phone.value.trim(),
          amount: leaseAmount,
          currency: form.elements.currency.value,
          contractStart: form.elements.start.value,
          startDate: form.elements.start.value,
          contractEnd: form.elements.end.value,
          periodicity: form.elements.period.value,
          nextDate: form.elements.next.value || form.elements.start.value,
          comment: form.elements.comment.value.trim(),
          planned: true
        });
        ensureRentalPayments(asset);
      }
      save();
      closeModal();
      render();
    };
  };

  window.markUnitRentReceived = function (assetId, partId, paymentId) {
    const asset = state.assets.find(function (item) { return item.id === assetId; });
    if (!asset) return;
    if (partId) {
      const part = (asset.parts || []).find(function (item) { return item.id === partId; });
      const payment = part && (part.rentPayments || []).find(function (item) { return item.id === paymentId; });
      if (!payment) return;
      payment.status = 'Получено';
      payment.receivedAt = isoDate(today);
    } else if (asset.rent && Array.isArray(asset.rent.payments)) {
      const payment = asset.rent.payments.find(function (item) { return item.id === paymentId; });
      if (!payment) return;
      payment.status = 'Получено';
      payment.receivedAt = isoDate(today);
    } else return;
    save();
    render();
  };

  function rentalEvents() {
    const events = [];
    state.assets.forEach(function (asset) {
      migrateAsset(asset);
      const rent = asset.rent || {};
      if ((asset.usage || asset.usageStatus) === 'Сдаётся в аренду') {
        (rent.payments || []).forEach(function (payment) {
          const overdue = payment.status !== 'Получено' && daysFromNow(payment.date) < 0;
          events.push({ date: payment.date, title: 'Аренда — ' + asset.name, sub: asset.name + (rent.tenant ? ' · ' + rent.tenant : ''), amount: payment.amount, type: overdue ? 'rent-overdue' : 'rent', status: payment.status === 'Получено' ? 'Получено' : overdue ? 'Просрочено' : 'Ожидается', id: 'rent-' + asset.id + '-' + payment.id });
        });
      }
      (asset.parts || []).forEach(function (part) {
        if (part.usage !== 'Сдаётся в аренду') return;
        (part.rentPayments || []).forEach(function (payment) {
          const place = asset.name + ' / ' + (part.name || 'Помещение');
          const overdue = payment.status !== 'Получено' && daysFromNow(payment.date) < 0;
          events.push({ date: payment.date, title: 'Аренда — ' + place, sub: place, amount: payment.amount, type: overdue ? 'rent-overdue' : 'rent', status: payment.status === 'Получено' ? 'Получено' : overdue ? 'Просрочено' : 'Ожидается', id: 'rent-part-' + asset.id + '-' + part.id + '-' + payment.id });
        });
      });
    });
    return events;
  }
  const baseEventList = eventList;
  eventList = function () { return baseEventList().concat(rentalEvents()).sort(function (a, b) { return a.date.localeCompare(b.date); }); };

  function enhancedCalendar() {
    const y = calendarMonth.getFullYear(), m = calendarMonth.getMonth(), first = new Date(y, m, 1), last = new Date(y, m + 1, 0), start = (first.getDay() + 6) % 7, events = eventList();
    let cells = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(function (day) { return '<div class="calendar-day-name">' + day + '</div>'; }).join('');
    for (let i = 0; i < start; i += 1) cells += '<div class="calendar-cell muted"></div>';
    for (let day = 1; day <= last.getDate(); day += 1) { const date = isoDate(new Date(y, m, day)), dayEvents = events.filter(function (event) { return event.date === date; }), visible = dayEvents.slice(0, 3), hidden = dayEvents.slice(3), typeClass = function (event) { return event.type === 'payment' || event.type === 'end' || event.type === 'rent-overdue' ? 'tag-red' : 'tag-green'; }, eventHtml = function (event) { const rent = event.type === 'rent' || event.type === 'rent-overdue'; const label = event.type === 'end' ? 'Окончание вклада' : event.type === 'payment' ? 'Платёж' : rent ? 'Аренда' : 'Поступление'; return '<div class="calendar-event ' + typeClass(event) + '"><strong>' + label + '</strong><span>' + esc(event.sub || event.title) + '</span><b>' + (event.amount ? rub(event.amount) : '—') + '</b>' + (rent ? '<em>' + esc(event.status || '') + '</em>' : '') + '</div>'; }; cells += '<div class="calendar-cell ' + (date === isoDate(today) ? 'today-cell' : '') + '"><div class="day-number">' + day + '</div><div class="calendar-events">' + visible.map(eventHtml).join('') + '</div>' + (hidden.length ? '<div class="calendar-events calendar-events-extra">' + hidden.map(eventHtml).join('') + '</div><button class="calendar-more">＋ ещё ' + hidden.length + '</button>' : '') + '</div>'; }
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

  function monthlyRent(asset) {
    const rent = asset.rent || {};
    const amount = num(rent.amount);
    if (rent.periodicity === 'Квартал') return amount / 3;
    if (rent.periodicity === 'Год') return amount / 12;
    if (rent.periodicity === 'Месяц') return amount;
    return null;
  }
  const baseIncome = income;
  income = function () {
    const panel = state.assets.filter(function (asset) { return asset.rent && asset.rent.planned; }).map(function (asset) {
      const received = (asset.rent.payments || []).filter(function (payment) { return payment.status === 'Получено'; }).reduce(function (sum, payment) { return sum + num(payment.amount); }, 0);
      const monthly = monthlyRent(asset);
      const yearly = monthly == null ? null : monthly * 12;
      const value = typeof assetAmountRub === 'function' ? assetAmountRub(asset, asset.value) : num(asset.value) * num(asset.currentRate || asset.initialRate || 1) / (num(asset.initialRate) || 1);
      const yieldPct = yearly != null && value ? yearly / value * 100 : null;
      const shown = function (amount) { return amount == null ? '—' : rub(amount); };
      return '<tr><td>' + asset.name + '</td><td>' + (asset.usageStatus || '—') + '</td><td>' + rub(received) + '</td><td>' + shown(monthly) + '</td><td>' + shown(yearly) + '</td><td>' + (yieldPct == null ? '—' : yieldPct.toFixed(2).replace('.', ',') + '%') + '</td></tr>';
    }).join('');
    return baseIncome() + '<div class="panel property-analytics"><div class="panel-head"><div><p class="eyebrow">ИМУЩЕСТВО</p><h3>Доходность объектов</h3></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Объект</th><th>Статус</th><th>Аренда получена</th><th>В месяц</th><th>За год</th><th>Доходность</th></tr></thead><tbody>' + (panel || '<tr><td colspan="6"><div class="empty">Доходных объектов пока нет</div></td></tr>') + '</tbody></table></div></div>';
  };
  const baseHistory = history;
  history = function () {
    const statusRows = state.assets.flatMap(function (asset) { return (asset.statusHistory || []).map(function (entry) { return '<div class="stat-row"><span>' + dateText(entry.date) + ' · ' + asset.name + '</span><strong>' + entry.value + '</strong></div>'; }); }).join('');
    const rateRows = state.assets.flatMap(function (asset) { return (asset.rateHistory || []).map(function (entry) { return '<div class="stat-row"><span>' + dateText(entry.date) + ' · ' + asset.name + '</span><strong>' + entry.rate + '</strong></div>'; }).join(''); }).join('');
    return baseHistory() + '<div class="panel property-history"><h3>История имущества</h3><h4>Изменения статусов</h4>' + (statusRows || '<div class="empty">История статусов появится после изменений</div>') + '<h4>История курсов и переоценки</h4>' + (rateRows || '<div class="empty">История курсов появится для валютного имущества</div>') + '</div>';
  };

  const baseExpectedThisMonth = expectedThisMonth;
  expectedThisMonth = function () {
    let sum = baseExpectedThisMonth();
    state.assets.forEach(function (asset) {
      const rent = asset.rent || {};
      const liveRent = (asset.usage || asset.usageStatus) === 'Сдаётся в аренду';
      if (liveRent) {
        const plannedDate = rent.nextDate || rent.startDate || '';
        let plannedDateCovered = false;
        (rent.payments || []).forEach(function (payment) {
          if (payment.date === plannedDate) plannedDateCovered = true;
          if (payment.status !== 'Получено' && inCurrentMonth(payment.date)) sum += num(payment.amount);
        });
        if (!plannedDateCovered && inCurrentMonth(plannedDate) && num(rent.amount)) sum += num(rent.amount);
      }
      (asset.parts || []).forEach(function (part) {
        if (part.usage !== 'Сдаётся в аренду') return;
        (part.rentPayments || []).forEach(function (payment) {
          if (payment.status !== 'Получено' && inCurrentMonth(payment.date)) sum += num(payment.amount);
        });
      });
    });
    return sum;
  };
  function rentalSummary() {
    let depositReceived = 0;
    let rentReceived = 0;
    let depositExpected = 0;
    let rentExpected = 0;
    state.deposits.forEach(function (deposit) {
      if (deposit.closed) return;
      if (inCurrentMonth(deposit.nextDate)) depositReceived += num(deposit.received);
      if (deposit.status !== 'Получено' && inCurrentMonth(deposit.nextDate)) depositExpected += num(deposit.expected);
    });
    state.assets.forEach(function (asset) {
      const rent = asset.rent || {};
      const usage = asset.usage || asset.usageStatus || '';
      const liveRent = usage === 'Сдаётся в аренду';
      const payments = rent.payments || [];
      const plannedDate = rent.nextDate || rent.startDate || '';
      let plannedDateCovered = false;
      payments.forEach(function (payment) {
        if (payment.date === plannedDate) plannedDateCovered = true;
        if (payment.status === 'Получено') {
          if (inCurrentMonth(payment.receivedAt || payment.date)) rentReceived += num(payment.amount);
          return;
        }
        if (liveRent && inCurrentMonth(payment.date)) rentExpected += num(payment.amount);
      });
      if (liveRent && !plannedDateCovered && inCurrentMonth(plannedDate) && num(rent.amount)) rentExpected += num(rent.amount);
      (asset.parts || []).forEach(function (part) {
        (part.rentPayments || []).forEach(function (payment) {
          if (payment.status === 'Получено') {
            if (inCurrentMonth(payment.receivedAt || payment.date)) rentReceived += num(payment.amount);
            return;
          }
          if (part.usage === 'Сдаётся в аренду' && inCurrentMonth(payment.date)) rentExpected += num(payment.amount);
        });
      });
    });
    const receivedTotal = depositReceived + rentReceived;
    const expectedTotal = depositExpected + rentExpected;
    return '<section class="rental-summary panel"><div class="dash-panel-heading"><div><p class="eyebrow">ДОХОД ОТ КАПИТАЛА</p><h3>Текущие поступления</h3></div></div><div class="rental-summary-grid"><div><span>Доход получен в этом месяце</span><strong class="teal">' + rub(receivedTotal) + '</strong><small>Проценты по вкладам ' + rub(depositReceived) + ' · аренда ' + rub(rentReceived) + '</small></div><div><span>Ожидается в ' + monthInName() + '</span><strong class="orange">' + rub(expectedTotal) + '</strong><small>' + currentMonthRangeText() + ' · вклады ' + rub(depositExpected) + ' · аренда ' + rub(rentExpected) + '</small></div></div></section>';
  }
  function refreshRentalSummary() { if (typeof activeView === 'undefined' || activeView !== 'dashboard') return; const view = document.getElementById('app-view'); if (!view || view.querySelector('.rental-summary')) return; const shell = view.querySelector('.dashboard-shell'); if (shell) shell.insertAdjacentHTML('afterbegin', rentalSummary()); }
  window.refreshRentalSummary = refreshRentalSummary;
  setTimeout(refreshRentalSummary, 0);
  document.getElementById('main-nav').addEventListener('click', function () { setTimeout(refreshRentalSummary, 0); });
  document.querySelector('.top-actions').addEventListener('click', function () { setTimeout(refreshRentalSummary, 0); });

  const baseRender = render;
  render = function () {
    if (activeView === 'rentals') {
      document.getElementById('app-view').innerHTML = rentalsView();
      document.querySelectorAll('.nav-item').forEach(function (button) { button.classList.toggle('active', button.dataset.view === 'rentals'); });
      document.getElementById('page-title').textContent = 'Аренда';
      document.getElementById('deposit-count').textContent = state.deposits.filter(function (item) { return !item.closed; }).length;
      document.getElementById('debt-count').textContent = obligations().length;
      updateRentCount();
      document.getElementById('today-label').textContent = dateText(isoDate(today));
      return;
    }
    baseRender();
    updateRentCount();
  };
  updateRentCount();
}());
