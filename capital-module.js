(function () {
  const currencies = ['RUB', 'USD', 'EUR'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function ensureCapitalState() {
    let changed = false;
    if (!state.fx || typeof state.fx !== 'object' || Array.isArray(state.fx)) {
      state.fx = { mode: 'Ручной', USD: '', EUR: '', updated: '', rateDate: '', source: '' };
      changed = true;
    } else {
      if (!state.fx.mode) { state.fx.mode = 'Ручной'; changed = true; }
      if (state.fx.USD == null) { state.fx.USD = ''; changed = true; }
      if (state.fx.EUR == null) { state.fx.EUR = ''; changed = true; }
      if (state.fx.updated == null) { state.fx.updated = ''; changed = true; }
      if (state.fx.rateDate == null) { state.fx.rateDate = ''; changed = true; }
      if (state.fx.source == null) { state.fx.source = ''; changed = true; }
    }
    if (!Array.isArray(state.safes)) {
      state.safes = [];
      changed = true;
    }
    state.safes.forEach(function (safe) {
      if (!safe.id) { safe.id = uid(); changed = true; }
      if (!safe.name) { safe.name = 'Сейф'; changed = true; }
      if (currencies.indexOf(safe.currency) < 0) { safe.currency = 'RUB'; changed = true; }
      if (safe.comment == null) { safe.comment = ''; changed = true; }
      if (!Array.isArray(safe.operations)) { safe.operations = []; changed = true; }
      safe.operations.forEach(function (op) {
        if (!op.id) { op.id = uid(); changed = true; }
        if (op.direction !== 'in' && op.direction !== 'out') { op.direction = 'in'; changed = true; }
        if (!op.currency) { op.currency = safe.currency; changed = true; }
        if (op.comment == null) { op.comment = ''; changed = true; }
        if (!op.date) { op.date = isoDate(today); changed = true; }
      });
    });
    if (changed) save();
  }

  function liveRate(currency, asset) {
    if (!currency || currency === 'RUB') return 1;
    const cabinet = num(state.fx && state.fx[currency]);
    if (cabinet > 0) return cabinet;
    if (asset && num(asset.currentRate) > 0) return num(asset.currentRate);
    return 0;
  }

  function assetAmountRub(asset, amount) {
    const currency = (asset && asset.currency) || 'RUB';
    const n = num(amount);
    if (currency === 'RUB') return n;
    const rate = liveRate(currency, asset);
    if (!rate) return n;
    return n * rate;
  }
  window.assetAmountRub = assetAmountRub;

  function toRub(amount, currency, asset) {
    if (!currency || currency === 'RUB') return num(amount);
    const rate = liveRate(currency, asset);
    if (!rate) return null;
    return num(amount) * rate;
  }

  function moneyOriginal(amount, currency) {
    const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(num(amount));
    if (currency === 'USD') return '$' + formatted;
    if (currency === 'EUR') return '€' + formatted;
    return rub(amount);
  }
  window.moneyOriginal = moneyOriginal;

  function rubApprox(amount, currency, asset) {
    if (!currency || currency === 'RUB') return rub(amount);
    const value = toRub(amount, currency, asset);
    if (value == null) return 'курс не задан';
    return '≈ ' + rub(value);
  }
  window.rubApprox = rubApprox;

  function rateLabel(currency, asset) {
    if (!currency || currency === 'RUB') return '1,00 ₽';
    const rate = liveRate(currency, asset);
    if (!rate) return 'не задан';
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate) + ' ₽';
  }

  function rateInput(value) {
    if (value === '' || value == null) return '';
    const n = num(value);
    if (!n) return '';
    return String(n).replace('.', ',');
  }

  function safeBalance(safe) {
    return (safe.operations || []).reduce(function (sum, op) {
      const amount = Math.abs(num(op.amount));
      return sum + (op.direction === 'out' ? -amount : amount);
    }, 0);
  }

  function safeUpdated(safe) {
    const dates = (safe.operations || []).map(function (op) { return op.date; }).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : '';
  }

  function currencyTotals() {
    const grouped = {};
    (state.safes || []).forEach(function (safe) {
      const currency = safe.currency || 'RUB';
      grouped[currency] = (grouped[currency] || 0) + safeBalance(safe);
    });
    return grouped;
  }

  function safeTotalRub() {
    let known = true;
    let total = 0;
    (state.safes || []).forEach(function (safe) {
      const rubles = toRub(safeBalance(safe), safe.currency);
      if (rubles == null) known = false;
      else total += rubles;
    });
    return { total: total, known: known };
  }

  function obligationRemainingRub(item) {
    if (item && item.kind === 'asset' && item.asset && item.asset.currency && item.asset.currency !== 'RUB') return assetAmountRub(item.asset, item.remaining);
    return num(item && item.remaining);
  }
  window.obligationRemainingRub = obligationRemainingRub;

  function actualRubSpent(asset) {
    const currency = (asset && asset.currency) || 'RUB';
    const base = asset.paidBase === undefined ? num(asset.paid) : num(asset.paidBase);
    let total = 0;
    let known = true;
    if (currency === 'RUB') total += base;
    else if (asset.paidRub != null && asset.paidRub !== '') total += num(asset.paidRub);
    else if (base > 0) known = false;
    assetPayments(asset).filter(function (payment) { return payment.status === 'Оплачено'; }).forEach(function (payment) {
      const paymentCurrency = payment.currency || currency;
      if (paymentCurrency === 'RUB') total += num(payment.amount);
      else if (payment.rubActual != null && payment.rubActual !== '') total += num(payment.rubActual);
      else known = false;
    });
    return { total: total, known: known };
  }

  function actualSpentText(asset) {
    const spent = actualRubSpent(asset);
    if ((asset.currency || 'RUB') === 'RUB') return rub(spent.total);
    if (!spent.known && spent.total <= 0) return 'не указано';
    if (!spent.known) return rub(spent.total) + ' · есть платежи без суммы в ₽';
    return rub(spent.total);
  }
  window.actualSpentText = actualSpentText;

  const baseTotals = totals;
  totals = function () {
    ensureCapitalState();
    const current = baseTotals();
    const assetsRub = state.assets.reduce(function (sum, asset) { return sum + assetAmountRub(asset, asset.value); }, 0);
    const debtsRub = obligations().reduce(function (sum, item) { return sum + obligationRemainingRub(item); }, 0);
    const safeRub = safeTotalRub();
    const assetDelta = assetsRub - current.assets;
    const debtDelta = debtsRub - current.debts;
    current.assets = assetsRub;
    current.debts = debtsRub;
    current.safe = safeRub.total;
    current.net = current.net + assetDelta - debtDelta + safeRub.total;
    return current;
  };

  function totalsLine() {
    const grouped = currencyTotals();
    const parts = Object.keys(grouped).map(function (currency) {
      return '<strong>' + moneyOriginal(grouped[currency], currency) + '</strong>';
    });
    const rubles = safeTotalRub();
    const foreignMissing = !rubles.known && (state.safes || []).some(function (safe) { return safe.currency !== 'RUB' && !liveRate(safe.currency); });
    let rubText = '≈ ' + rub(rubles.total);
    if (!state.safes.length) rubText = rub(0);
    else if (foreignMissing && rubles.total === 0) rubText = 'курс не задан';
    else if (!rubles.known) rubText += ' · для части сейфов курс не задан';
    return { parts: parts.length ? parts.join(' · ') : '<strong>' + rub(0) + '</strong>', rubText: rubText };
  }

  const sidebarBottom = document.querySelector('.sidebar-bottom');
  if (sidebarBottom) sidebarBottom.addEventListener('click', function (event) {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

  const nav = document.getElementById('main-nav');
  const assetButton = nav && nav.querySelector('[data-view="assets"]');
  if (nav && assetButton && !nav.querySelector('[data-view="safe"]')) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'safe';
    button.type = 'button';
    button.innerHTML = '<span>◉</span> Сейф';
    assetButton.before(button);
  }

  function safeCard(safe) {
    const balance = safeBalance(safe);
    const updated = safeUpdated(safe);
    const history = (safe.operations || []).map(function (op, index) { return { op: op, index: index }; }).sort(function (a, b) {
      return (b.op.date || '').localeCompare(a.op.date || '') || b.index - a.index;
    });
    const rows = history.map(function (entry) {
      const op = entry.op;
      const sign = op.direction === 'out' ? '−' : '+';
      const tone = op.direction === 'out' ? 'danger' : 'positive';
      return '<div class="safe-op"><div><strong class="' + tone + '">' + sign + ' ' + moneyOriginal(Math.abs(num(op.amount)), op.currency || safe.currency) + '</strong><span>' + dateText(op.date) + (op.comment ? ' · ' + esc(op.comment) : '') + '</span></div><button type="button" class="ghost-button" onclick="removeSafeOperation(\'' + safe.id + '\',\'' + op.id + '\')">Удалить</button></div>';
    }).join('');
    return '<article class="safe-card panel"><div class="safe-card-head"><div><p class="eyebrow">' + esc(safe.currency) + '</p><h3>' + esc(safe.name) + '</h3><span>' + (safe.comment ? esc(safe.comment) : 'Без комментария') + '</span></div><div class="safe-balance"><small>В сейфе</small><strong>' + moneyOriginal(balance, safe.currency) + '</strong><em>По текущему курсу: ' + rubApprox(balance, safe.currency) + '</em></div></div><div class="safe-meta"><span>Текущий курс <b>' + rateLabel(safe.currency) + '</b></span><span>Обновлено <b>' + (updated ? dateText(updated) : '—') + '</b></span></div><div class="button-row"><button class="primary-button" type="button" onclick="openSafeOperation(\'' + safe.id + '\',\'in\')">+ Положить деньги</button><button class="ghost-button" type="button" onclick="openSafeOperation(\'' + safe.id + '\',\'out\')">− Забрать деньги</button><button class="ghost-button" type="button" onclick="openSafeForm(\'' + safe.id + '\')">Изменить</button><button class="ghost-button" type="button" onclick="removeSafe(\'' + safe.id + '\')">Удалить</button></div><div class="safe-history"><h4>История операций</h4>' + (rows || '<div class="empty">Операций пока нет</div>') + '</div></article>';
  }

  function safeView() {
    const line = totalsLine();
    const cards = (state.safes || []).map(safeCard).join('');
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">НАЛИЧНЫЕ</p><h2>Сейф</h2><p>Деньги, которые физически находятся у вас. Остаток меняется только операциями.</p></div><button class="primary-button" type="button" onclick="openSafeForm()">＋ Добавить сейф</button></div><section class="panel safe-total"><div><span>В сейфе</span>' + line.parts + '</div><div><span>По текущему курсу</span><strong>' + line.rubText + '</strong></div></section>' + (cards || '<div class="panel empty">Сейфов пока нет. Добавьте первый, например «Основной сейф» или «Дом».</div>') + '</div>';
  }

  function modalShell(title, body, submitLabel, onSubmit) {
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>' + title + '</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="safe-form"><div class="modal-body"><div class="form-grid">' + body + '</div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">' + submitLabel + '</button></div></form></div></div>';
    document.getElementById('safe-form').onsubmit = function (event) {
      event.preventDefault();
      onSubmit(event.target);
    };
  }

  function field(label, html) {
    return '<div class="form-field"><label>' + label + '</label>' + html + '</div>';
  }

  window.openSafeForm = function (id) {
    ensureCapitalState();
    const safe = state.safes.find(function (item) { return item.id === id; }) || { name: '', currency: 'USD', comment: '', operations: [] };
    const locked = (safe.operations || []).length > 0;
    const options = currencies.map(function (currency) {
      return '<option ' + (safe.currency === currency ? 'selected' : '') + '>' + currency + '</option>';
    }).join('');
    modalShell(id ? 'Изменить сейф' : 'Новый сейф',
      field('Название', '<input name="name" value="' + esc(safe.name) + '" required>') +
      field('Валюта', '<select name="currency"' + (locked ? ' disabled' : '') + '>' + options + '</select>') +
      field('Комментарий', '<input name="comment" value="' + esc(safe.comment || '') + '">') +
      (id ? '' : field('Начальный остаток', '<input name="opening" inputmode="decimal" placeholder="0">')) +
      '<p class="safe-note">' + (locked ? 'Валюту нельзя сменить: в сейфе уже есть операции. Для другой валюты создайте отдельный сейф.' : 'Начальный остаток записывается как операция «Положить деньги».') + '</p>',
      'Сохранить',
      function (form) {
        const name = form.elements.name.value.trim();
        if (!name) { alert('Укажите название сейфа.'); return; }
        const currency = locked ? safe.currency : form.elements.currency.value;
        if (id) {
          safe.name = name;
          safe.comment = form.elements.comment.value.trim();
          safe.currency = currency;
        } else {
          const created = { id: uid(), name: name, currency: currency, comment: form.elements.comment.value.trim(), operations: [] };
          const opening = num(form.elements.opening && form.elements.opening.value);
          if (opening > 0) created.operations.push({ id: uid(), date: isoDate(today), amount: opening, currency: currency, direction: 'in', comment: 'Начальный остаток' });
          state.safes.push(created);
        }
        save();
        closeModal();
        render();
      });
  };

  window.openSafeOperation = function (id, direction) {
    const safe = state.safes.find(function (item) { return item.id === id; });
    if (!safe) return;
    modalShell(direction === 'out' ? 'Забрать деньги' : 'Положить деньги',
      field('Дата', '<input name="date" type="date" value="' + isoDate(today) + '" required>') +
      field('Сумма', '<input name="amount" inputmode="decimal" required>') +
      field('Валюта', '<select name="currency"><option selected>' + safe.currency + '</option></select>') +
      field('Комментарий', '<input name="comment" placeholder="' + (direction === 'out' ? 'Забрала из сейфа' : 'Положила в сейф') + '">'),
      direction === 'out' ? 'Забрать' : 'Положить',
      function (form) {
        const amount = num(form.elements.amount.value);
        const currency = form.elements.currency.value;
        if (!(amount > 0)) { alert('Укажите сумму больше нуля.'); return; }
        if (!form.elements.date.value) { alert('Укажите дату.'); return; }
        if (currency !== safe.currency) { alert('Валюта операции должна совпадать с валютой сейфа. Для другой валюты создайте отдельный сейф.'); return; }
        if (direction === 'out' && amount > safeBalance(safe) + 0.0001) { alert('В сейфе недостаточно денег для этой операции.'); return; }
        safe.operations.push({ id: uid(), date: form.elements.date.value, amount: amount, currency: currency, direction: direction, comment: form.elements.comment.value.trim() });
        save();
        closeModal();
        render();
      });
  };

  window.removeSafeOperation = function (safeId, opId) {
    const safe = state.safes.find(function (item) { return item.id === safeId; });
    if (!safe || !confirm('Удалить эту операцию? Остаток пересчитается по оставшимся записям.')) return;
    safe.operations = safe.operations.filter(function (op) { return op.id !== opId; });
    save();
    render();
  };

  window.removeSafe = function (id) {
    if (!confirm('Удалить сейф вместе с историей операций?')) return;
    state.safes = state.safes.filter(function (item) { return item.id !== id; });
    save();
    render();
  };

  const baseSettings = settings;
  settings = function () {
    ensureCapitalState();
    const fx = state.fx;
    const updated = fx.rateDate || fx.updated;
    const source = fx.source ? ' · ' + esc(fx.source) : '';
    const panel = '<div class="view-wrap"><div class="panel fx-panel"><div class="section-heading"><div><p class="eyebrow">ВАЛЮТА</p><h3>Курсы валют</h3><p>Исходные суммы в долларах и евро не меняются. Рублёвый эквивалент пересчитывается по этому курсу.</p></div></div><div class="fx-grid"><label>USD<input name="fx-usd" inputmode="decimal" value="' + esc(rateInput(fx.USD)) + '" placeholder="95,00"><span>₽</span></label><label>EUR<input name="fx-eur" inputmode="decimal" value="' + esc(rateInput(fx.EUR)) + '" placeholder="103,20"><span>₽</span></label></div><div class="form-field fx-mode"><label>Режим курса</label><select id="fx-mode"><option ' + (fx.mode !== 'Автоматический' ? 'selected' : '') + '>Ручной</option><option ' + (fx.mode === 'Автоматический' ? 'selected' : '') + '>Автоматический</option></select></div><div class="button-row"><button class="primary-button" type="button" onclick="refreshOfficialRates()">Обновить курс</button><button class="ghost-button" type="button" onclick="saveManualRates()">Сохранить курс</button></div><p class="muted fx-status">Последнее обновление: ' + (updated ? dateText(updated) : 'ещё не было') + source + '. Кнопка «Обновить курс» запрашивает курс ЦБ РФ. Если связи нет, остаются последние сохранённые значения.</p></div></div>';
    return baseSettings() + panel;
  };

  function readFxInputs() {
    const usd = document.querySelector('[name="fx-usd"]');
    const eur = document.querySelector('[name="fx-eur"]');
    const mode = document.getElementById('fx-mode');
    if (!usd || !eur) return null;
    return { USD: usd.value, EUR: eur.value, mode: mode && mode.value === 'Автоматический' ? 'Автоматический' : 'Ручной' };
  }

  window.saveManualRates = function () {
    const values = readFxInputs();
    if (!values) return;
    state.fx.USD = values.USD.trim() === '' ? '' : num(values.USD);
    state.fx.EUR = values.EUR.trim() === '' ? '' : num(values.EUR);
    state.fx.mode = values.mode;
    state.fx.source = 'Вручную';
    state.fx.updated = isoDate(today);
    state.fx.rateDate = isoDate(today);
    save();
    render();
  };

  window.refreshOfficialRates = async function (silent) {
    const button = document.querySelector('.fx-panel .primary-button');
    if (button) button.disabled = true;
    try {
      const response = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      const usd = data.Valute && data.Valute.USD;
      const eur = data.Valute && data.Valute.EUR;
      if (!usd || !eur) throw new Error('payload');
      state.fx.USD = num(usd.Value) / (num(usd.Nominal) || 1);
      state.fx.EUR = num(eur.Value) / (num(eur.Nominal) || 1);
      state.fx.updated = isoDate(today);
      state.fx.rateDate = String(data.Date || '').slice(0, 10);
      state.fx.source = 'ЦБ РФ';
      save();
      render();
    } catch (error) {
      if (button) button.disabled = false;
      if (!silent) alert('Не удалось обновить курс. Проверьте интернет или введите курс вручную. Сохранённые курсы не изменены.');
    }
  };

  assets = function () {
    ensureCapitalState();
    const rows = state.assets.map(function (asset) {
      const currency = asset.currency || 'RUB';
      const contract = moneyOriginal(asset.price, currency) + (currency === 'RUB' ? '' : '<br><span class="muted">сегодня ' + rubApprox(asset.price, currency, asset) + '</span>');
      const paid = moneyOriginal(assetPaid(asset), currency) + '<br><span class="muted">осталось ' + moneyOriginal(assetRemaining(asset), currency) + '</span>' + (currency === 'RUB' ? '' : '<br><span class="muted">реально потрачено ' + actualSpentText(asset) + '</span>');
      const appraisal = currency === 'RUB'
        ? '<strong>' + rub(asset.value) + '</strong>'
        : '<strong>' + moneyOriginal(asset.value, currency) + '</strong><br><span class="muted">сегодня ' + rubApprox(asset.value, currency, asset) + '</span>';
      return '<tr><td><strong>' + esc(asset.name) + '</strong><br><span class="muted">' + esc(asset.type || asset.category || '') + ' · ' + esc(asset.description || '') + '</span></td><td>' + contract + '</td><td>' + paid + '</td><td>' + appraisal + '<br><span class="muted">' + esc(asset.usageStatus || asset.status || '') + '</span></td><td>' + esc(asset.owner || '—') + '</td><td>' + actions('asset', asset.id) + '</td></tr>';
    }).join('');
    const total = state.assets.reduce(function (sum, asset) { return sum + assetAmountRub(asset, asset.value); }, 0);
    return listView('asset', 'Имущество', 'Оценочная стоимость сегодня: ' + rub(total) + '. Сумма договора хранится в валюте покупки.', 'Добавить объект', ['Объект', 'Стоимость', 'Оплачено', 'Стоимость сегодня', 'Оформлено на'], rows);
  };

  const priceField = schemas.asset && schemas.asset.fields.find(function (item) { return item[0] === 'price'; });
  if (priceField) priceField[1] = 'Стоимость по договору';

  function rubInput(row, value) {
    if (!row || row.querySelector('[name="payment-rub"]')) return;
    const input = document.createElement('input');
    input.name = 'payment-rub';
    input.setAttribute('inputmode', 'decimal');
    input.placeholder = 'Потрачено, ₽';
    input.className = 'payment-rub';
    input.value = value == null ? '' : value;
    const remove = row.querySelector('button');
    if (remove) row.insertBefore(input, remove);
    else row.appendChild(input);
  }

  function syncForeignFields(form) {
    const currency = form.querySelector('[name="currency"]');
    const foreign = !!(currency && currency.value !== 'RUB');
    form.querySelectorAll('.paid-rub-field, .fx-asset-note').forEach(function (node) { node.hidden = !foreign; });
    form.querySelectorAll('.payment-rub').forEach(function (node) { node.hidden = !foreign; });
  }

  function decorateAssetForm(id) {
    const form = document.getElementById('record-form');
    if (!form || form.dataset.fxReady) return;
    form.dataset.fxReady = '1';
    const asset = (id && state.assets.find(function (item) { return item.id === id; })) || {};
    const payments = assetPayments(asset);
    [...form.querySelectorAll('#payment-rows .payment-row')].forEach(function (row, index) {
      rubInput(row, payments[index] ? payments[index].rubActual : '');
    });
    const section = form.querySelector('.payment-section');
    if (section && !form.querySelector('[name="paidRub"]')) {
      section.insertAdjacentHTML('afterbegin', '<div class="paid-rub-field form-field"><label>Уже оплачено фактически, ₽</label><input name="paidRub" inputmode="decimal" value="' + esc(asset.paidRub ?? '') + '"><small>Сколько рублей вы реально потратили на уже внесённую часть. Изменение курса это число не пересчитывает.</small></div><p class="fx-asset-note">Стоимость по договору остаётся в валюте покупки. Строка «сегодня» считается по курсу из настроек.</p>');
    }
    const currency = form.querySelector('[name="currency"]');
    if (currency) currency.addEventListener('change', function () { syncForeignFields(form); });
    syncForeignFields(form);
    const previous = form.onsubmit;
    form.onsubmit = function (event) {
      const assetName = form.elements.name ? form.elements.name.value : '';
      const paidRubRaw = form.elements.paidRub ? form.elements.paidRub.value : '';
      const currencyValue = form.elements.currency ? form.elements.currency.value : 'RUB';
      const rubs = [...form.querySelectorAll('#payment-rows .payment-row')].filter(function (row) {
        const date = row.querySelector('[name="payment-date"]');
        const amount = row.querySelector('[name="payment-amount"]');
        return date && date.value && num(amount && amount.value) > 0;
      }).map(function (row) {
        const input = row.querySelector('[name="payment-rub"]');
        return input ? input.value : '';
      });
      const result = previous ? previous.call(this, event) : undefined;
      if (currencyValue === 'RUB') return result;
      const saved = id
        ? state.assets.find(function (item) { return item.id === id; })
        : state.assets.slice().reverse().find(function (item) { return item.name === assetName; });
      if (!saved) return result;
      saved.paidRub = paidRubRaw.trim() === '' ? '' : num(paidRubRaw);
      (saved.payments || []).forEach(function (payment, index) {
        payment.currency = saved.currency || currencyValue;
        payment.rubActual = rubs[index] == null || String(rubs[index]).trim() === '' ? '' : num(rubs[index]);
      });
      save();
      render();
      return result;
    };
  }

  const previousOpenForm = window.openForm;
  window.openForm = function (type, id) {
    previousOpenForm(type, id);
    if (type === 'asset') decorateAssetForm(id);
  };

  const previousAddPaymentRow = window.addPaymentRow;
  window.addPaymentRow = function () {
    previousAddPaymentRow();
    const form = document.getElementById('record-form');
    const row = form && form.querySelector('#payment-rows .payment-row:last-child');
    rubInput(row, '');
    if (form) syncForeignFields(form);
  };

  const baseRender = render;
  render = function () {
    ensureCapitalState();
    if (activeView === 'safe') {
      document.getElementById('app-view').innerHTML = safeView();
      document.querySelectorAll('.nav-item').forEach(function (button) { button.classList.toggle('active', button.dataset.view === 'safe'); });
      document.getElementById('page-title').textContent = 'Сейф';
      document.getElementById('deposit-count').textContent = state.deposits.length;
      document.getElementById('debt-count').textContent = obligations().length;
      document.getElementById('today-label').textContent = today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      return;
    }
    baseRender();
  };

  const baseDashboard = referenceDashboard;
  referenceDashboard = function () {
    const html = baseDashboard();
    if (!state.safes || !state.safes.length) return html;
    const line = totalsLine();
    const strip = '<section class="panel safe-dash"><div><p class="eyebrow">СЕЙФ</p><h3>В сейфе: ' + line.parts + '</h3><span>По текущему курсу: <b>' + line.rubText + '</b></span></div><button class="ghost-button" type="button" onclick="setView(\'safe\')">Открыть сейф →</button></section>';
    return html.replace('<div class="dash-main-grid">', strip + '<div class="dash-main-grid">');
  };

  ensureCapitalState();
  if (state.fx.mode === 'Автоматический' && state.fx.updated !== isoDate(today)) {
    setTimeout(function () { refreshOfficialRates(true); }, 500);
  }
}());
