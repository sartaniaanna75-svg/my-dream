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

  function settledCurrency(payment) {
    if (payment.paidAmount != null && payment.paidAmount !== '') return num(payment.paidAmount);
    return num(payment.amount);
  }

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
      if (payment.rubActual != null && payment.rubActual !== '') { total += num(payment.rubActual); return; }
      if (paymentCurrency === 'RUB') { total += settledCurrency(payment); return; }
      if (payment.payRate != null && payment.payRate !== '' && num(payment.payRate) > 0) { total += settledCurrency(payment) * num(payment.payRate); return; }
      known = false;
    });
    return { total: total, known: known };
  }

  assetPaid = function (asset) {
    const base = asset.paidBase === undefined ? num(asset.paid) : num(asset.paidBase);
    return base + assetPayments(asset).filter(function (payment) { return payment.status === 'Оплачено'; }).reduce(function (sum, payment) {
      return sum + settledCurrency(payment);
    }, 0);
  };

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

  function formatDecimal(value) {
    const rounded = Math.round(num(value) * 100) / 100;
    if (!rounded) return '';
    return String(rounded).replace('.', ',');
  }

  function signedOriginal(amount, currency) {
    const n = Number(amount) || 0;
    const text = moneyOriginal(Math.abs(n), currency);
    if (n > 0) return '+' + text;
    if (n < 0) return '−' + text;
    return text;
  }

  function contractTodayText(asset) {
    const currency = asset.currency || 'RUB';
    if (currency === 'RUB') return '';
    const text = rubApprox(asset.price, currency, asset);
    return text === 'курс не задан' ? text : text + ' по текущему курсу';
  }

  function paymentDisplayStatus(payment) {
    if (payment.status === 'Оплачено') return 'Оплачено';
    if (payment.status === 'Просрочено' || (payment.date && daysFromNow(payment.date) < 0)) return 'Просрочено';
    return 'Предстоит';
  }

  function assetIsForeign(asset) {
    if (asset && asset.calcType === 'Зарубежное имущество') return true;
    if (asset && asset.calcType === 'Рубли') return false;
    return !!(asset && asset.currency && asset.currency !== 'RUB');
  }

  function rateUnit(currency) {
    if (currency === 'EUR') return '₽/€';
    if (currency === 'USD') return '₽/$';
    return '₽';
  }

  function paymentPlanRate(payment, currency, asset) {
    if (payment && payment.planRate != null && payment.planRate !== '' && num(payment.planRate) > 0) return num(payment.planRate);
    return liveRate(currency, asset) || 0;
  }

  function assetCity(asset) {
    if (asset.city) return String(asset.city).trim();
    const text = String(asset.description || '').trim();
    if (!text) return '';
    const comma = text.indexOf(',');
    return (comma > 0 ? text.slice(0, comma) : text).trim();
  }

  function signedRub(amount) {
    const n = Number(amount) || 0;
    const text = rub(Math.abs(n));
    if (n > 0) return '+' + text;
    if (n < 0) return '−' + text;
    return text;
  }

  function assetCard(asset) {
    const currency = asset.currency || 'RUB';
    const foreign = assetIsForeign(asset);
    const change = num(asset.value) - num(asset.price);
    const initial = num(asset.initialRate);
    const current = liveRate(currency, asset);
    const revalue = foreign && initial > 1 && current > 0 ? num(asset.value) * (current - initial) : null;
    const revalueBlock = !foreign ? '' : '<div class="asset-revalue"><span>Валютная переоценка</span><strong>' + (revalue == null ? 'Курс при внесении не указан' : signedOriginal(revalue, 'RUB')) + '</strong><small>Это не полученная прибыль. Так меняется рублёвый эквивалент текущей оценки из-за курса, сама цена в ' + currency + ' при этом не считается доходом.</small></div>';
    const todayValue = foreign ? (rubApprox(asset.value, currency, asset) === 'курс не задан' ? 'курс не задан' : rub(assetAmountRub(asset, asset.value))) : rub(asset.value);
    const prepareRate = liveRate(currency, asset);
    const prepareText = prepareRate > 0 ? '≈ ' + rub(assetRemaining(asset) * prepareRate) : 'курс не задан';
    const metrics = foreign
      ? '<div class="asset-metrics asset-fx-facts"><div><span>Валюта договора</span><strong>' + esc(currency) + '</strong></div><div><span>Стоимость по договору</span><strong>' + moneyOriginal(asset.price, currency) + '</strong><small>' + contractTodayText(asset) + '</small></div><div><span>Оплачено в валюте</span><strong>' + moneyOriginal(assetPaid(asset), currency) + '</strong></div><div><span>Фактически потрачено</span><strong>' + actualSpentText(asset) + '</strong></div><div><span>Осталось оплатить</span><strong>' + moneyOriginal(assetRemaining(asset), currency) + '</strong></div><div><span>Нужно подготовить</span><strong>' + prepareText + '</strong><small>по текущему курсу</small></div></div>'
      : '<div class="asset-metrics"><div><span>Стоимость по договору</span><strong>' + moneyOriginal(asset.price, 'RUB') + '</strong></div><div><span>Оплачено</span><strong>' + moneyOriginal(assetPaid(asset), 'RUB') + '</strong></div><div><span>Осталось</span><strong>' + moneyOriginal(assetRemaining(asset), 'RUB') + '</strong></div><div><span>Фактически вложено</span><strong>' + actualSpentText(asset) + '</strong></div></div>';
    const valueBlock = foreign
      ? '<div class="asset-value-block"><div><span>Текущая оценка</span><strong>' + moneyOriginal(asset.value, currency) + '</strong></div><div><span>Текущий курс</span><strong>' + rateLabel(currency, asset) + '</strong></div><div><span>Стоимость сегодня</span><strong>' + todayValue + '</strong></div><div><span>Изменение цены объекта</span><strong>' + signedOriginal(change, currency) + '</strong></div></div>'
      : '<div class="asset-value-block"><div><span>Текущая оценка</span><strong>' + rub(asset.value) + '</strong></div><div><span>Стоимость сегодня</span><strong>' + rub(asset.value) + '</strong></div><div><span>Изменение цены объекта</span><strong>' + signedOriginal(change, 'RUB') + '</strong></div></div>';
    const typeLabel = esc(asset.type || asset.category || 'Имущество');
    const city = assetCity(asset);
    const meta = city ? typeLabel + ' · ' + esc(city) : typeLabel;
    const buying = assetRemaining(asset) > 0;
    const currentMain = foreign ? todayValue : rub(asset.value);
    const currentSub = foreign ? moneyOriginal(asset.value, currency) : '';
    const remainMain = moneyOriginal(assetRemaining(asset), foreign ? currency : 'RUB');
    const remainSub = foreign ? prepareText : '';
    const extras = [
      asset.owner ? ['Оформлено на', asset.owner] : null,
      (asset.acquisition || asset.purchase) ? ['Дата приобретения', dateText(asset.acquisition || asset.purchase)] : null,
      asset.description ? ['Адрес', asset.description] : null,
      asset.usageStatus ? ['Использование', asset.usageStatus] : null,
      asset.comment ? ['Комментарий', asset.comment] : null
    ].filter(Boolean);
    const extraBlock = extras.length ? '<div class="asset-extra">' + extras.map(function (row) { return '<div><span>' + esc(row[0]) + '</span><strong>' + esc(row[1]) + '</strong></div>'; }).join('') + '</div>' : '';
    return '<article class="asset-row panel"><div class="asset-row-main"><div class="asset-row-title"><strong>' + esc(asset.name) + '</strong><span>' + meta + '</span></div><div class="asset-row-facts"><div><span>Текущая стоимость</span><strong>' + currentMain + '</strong>' + (currentSub ? '<small>' + currentSub + '</small>' : '') + '</div><div><span>Фактически вложено</span><strong>' + actualSpentText(asset) + '</strong></div><div><span>Осталось оплатить</span><strong>' + remainMain + '</strong>' + (remainSub ? '<small>' + remainSub + '</small>' : '') + '</div></div><span class="tag asset-status ' + (buying ? 'tag-yellow' : 'tag-green') + '">' + (buying ? 'Покупается' : 'Оплачен') + '</span><button type="button" class="ghost-button asset-more" aria-expanded="false" onclick="toggleAssetDetails(\'' + asset.id + '\',this)">Подробнее</button></div><div class="asset-details" id="asset-details-' + asset.id + '" hidden><div class="asset-details-head"><p class="eyebrow">' + (foreign ? 'ЗАРУБЕЖНОЕ ИМУЩЕСТВО' : 'РУБЛИ') + '</p>' + actions('asset', asset.id) + '</div>' + metrics + valueBlock + revalueBlock + extraBlock + '<p class="asset-open-note">График платежей сохранён. Будущие платежи этого объекта показываются в разделе «Обязательства» и не дублируются отдельной записью.</p></div></article>';
  }

  window.toggleAssetDetails = function (id, button) {
    const panel = document.getElementById('asset-details-' + id);
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    button.textContent = open ? 'Скрыть' : 'Подробнее';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  window.previewPaymentPlan = function (input) {
    const need = input.closest('.asset-pay') && input.closest('.asset-pay').querySelector('.plan-need');
    if (!need) return;
    const rate = num(input.value);
    need.textContent = 'Нужно подготовить сегодня: ' + (rate > 0 ? '≈ ' + rub(num(input.dataset.amount) * rate) : 'курс не задан');
  };

  window.setPaymentPlanRate = function (assetId, paymentId, input) {
    const asset = state.assets.find(function (item) { return item.id === assetId; });
    const payment = asset && assetPayments(asset).find(function (item) { return item.id === paymentId; });
    if (!asset || !payment || payment.status === 'Оплачено') return;
    const currency = payment.currency || asset.currency || 'RUB';
    const cabinet = liveRate(currency, asset) || 0;
    const raw = input.value.trim();
    const typed = num(raw);
    const previous = payment.planRate != null && payment.planRate !== '' ? num(payment.planRate) : null;
    let next = null;
    if (raw !== '' && typed > 0 && !(cabinet > 0 && Math.abs(typed - cabinet) < 0.005)) next = typed;
    if (previous === next || (previous == null && next == null)) {
      if (raw === '') input.value = cabinet > 0 ? formatDecimal(cabinet) : '';
      previewPaymentPlan(input);
      return;
    }
    if (next == null) delete payment.planRate;
    else payment.planRate = next;
    save();
    if (raw === '') input.value = cabinet > 0 ? formatDecimal(cabinet) : '';
    previewPaymentPlan(input);
  };

  assets = function () {
    ensureCapitalState();
    let totalValue = 0;
    let invested = 0;
    let investedKnown = true;
    let remaining = 0;
    let change = 0;
    state.assets.forEach(function (asset) {
      const now = assetAmountRub(asset, asset.value);
      totalValue += now;
      change += now - assetAmountRub(asset, asset.price);
      const spent = actualRubSpent(asset);
      invested += spent.total;
      if (!spent.known) investedKnown = false;
      remaining += assetAmountRub(asset, assetRemaining(asset));
    });
    const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
    const summary = '<div class="asset-summary"><div><span>Общая стоимость имущества</span><strong>' + rub(totalValue) + '</strong></div><div><span>Фактически вложено</span><strong>' + rub(invested) + '</strong>' + (investedKnown ? '' : '<small>есть платежи без суммы в ₽</small>') + '</div><div><span>Осталось оплатить</span><strong>' + rub(remaining) + '</strong></div><div><span>Изменение стоимости</span><strong class="' + changeClass + '">' + signedRub(change) + '</strong></div></div>';
    const cards = state.assets.map(assetCard).join('');
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</p><h2>Имущество</h2><p>Сумма договора хранится в валюте покупки и не меняется из-за курса. Платежи по покупке — в «Обязательствах».</p></div><button class="primary-button" type="button" onclick="openForm(\'asset\')">＋ Добавить объект</button></div>' + summary + '<div class="asset-list">' + (cards || '<div class="panel empty">Объектов пока нет.</div>') + '</div></div>';
  };

  const priceField = schemas.asset && schemas.asset.fields.find(function (item) { return item[0] === 'price'; });
  if (priceField) priceField[1] = 'Стоимость по договору';

  function formCurrency() {
    const form = document.getElementById('record-form');
    const field = form && form.querySelector('[name="currency"]');
    return field && field.value ? field.value : 'RUB';
  }

  function paymentRowHtml(payment) {
    const currency = payment.currency || formCurrency();
    const status = payment.status || 'Предстоит';
    const options = ['Предстоит', 'Оплачено', 'Просрочено'].map(function (item) {
      return '<option ' + (status === item ? 'selected' : '') + '>' + item + '</option>';
    }).join('');
    const currencies = ['RUB', 'USD', 'EUR'].map(function (item) {
      return '<option ' + (currency === item ? 'selected' : '') + '>' + item + '</option>';
    }).join('');
    const storedPlan = payment.planRate != null && payment.planRate !== '' && num(payment.planRate) > 0 ? num(payment.planRate) : 0;
    const shownPlan = storedPlan || (currency !== 'RUB' ? (liveRate(currency) || 0) : 0);
    const comment = payment.comment || '';
    const commentOpen = String(comment).trim() !== '';
    return '<div class="payment-row payment-plan"><input name="payment-id" type="hidden" value="' + esc(payment.id || '') + '"><input class="pay-date" name="payment-date" type="date" title="Дата" value="' + esc(payment.date || '') + '"><input class="pay-amount" name="payment-amount" inputmode="decimal" placeholder="Сумма" title="Сумма" value="' + esc(payment.amount ?? '') + '"><select class="pay-currency" name="payment-currency" title="Валюта">' + currencies + '</select><select class="pay-status" name="payment-status" title="Статус">' + options + '</select><label class="payment-plan-field pay-rate">Курс<input name="payment-plan-rate" inputmode="decimal" title="Курс для этого платежа. Пустое значение равно курсу программы" value="' + esc(shownPlan ? formatDecimal(shownPlan) : '') + '"></label><strong class="pay-rub-eq"></strong><button type="button" class="pay-note-toggle">' + (commentOpen ? 'Скрыть комментарий' : 'Комментарий') + '</button><button type="button" class="ghost-button pay-delete" onclick="this.parentElement.remove()">Удалить</button><label class="payment-comment"' + (commentOpen ? '' : ' hidden') + '><input name="payment-comment" placeholder="Комментарий" value="' + esc(comment) + '"></label><div class="payment-fact"><label>Дата оплаты<input name="payment-paid-date" type="date" value="' + esc(payment.paidDate || '') + '"></label><label>Оплачено<input name="payment-paid-amount" inputmode="decimal" value="' + esc(payment.paidAmount ?? '') + '"></label><label class="payment-rate-field">Курс оплаты<input name="payment-rate" inputmode="decimal" value="' + esc(payment.payRate != null && payment.payRate !== '' ? formatDecimal(payment.payRate) : '') + '"></label><label class="payment-rub-field">Потрачено, ₽<input name="payment-rub" inputmode="decimal" data-manual="' + (payment.rubActual != null && payment.rubActual !== '' ? '1' : '0') + '" value="' + esc(payment.rubActual ?? '') + '"></label></div></div>';
  }

  function prefillFact(row) {
    const paidDate = row.querySelector('[name="payment-paid-date"]');
    const paidAmount = row.querySelector('[name="payment-paid-amount"]');
    const rate = row.querySelector('[name="payment-rate"]');
    const rubles = row.querySelector('[name="payment-rub"]');
    const planned = num(row.querySelector('[name="payment-amount"]').value);
    const currency = row.querySelector('[name="payment-currency"]').value || 'RUB';
    if (paidDate && !paidDate.value) paidDate.value = isoDate(today);
    if (paidAmount && paidAmount.value === '') paidAmount.value = row.querySelector('[name="payment-amount"]').value;
    if (currency !== 'RUB' && rate && rate.value === '') {
      const current = liveRate(currency);
      if (current > 0) rate.value = formatDecimal(current);
    }
    if (rubles && rubles.dataset.manual !== '1' && rubles.value === '') {
      if (currency === 'RUB') rubles.value = paidAmount.value;
      else if (num(rate.value) > 0) rubles.value = formatDecimal((paidAmount.value === '' ? planned : num(paidAmount.value)) * num(rate.value));
    }
  }

  function wirePaymentRow(row) {
    const status = row.querySelector('[name="payment-status"]');
    const fact = row.querySelector('.payment-fact');
    const rate = row.querySelector('[name="payment-rate"]');
    const rubles = row.querySelector('[name="payment-rub"]');
    const paidAmount = row.querySelector('[name="payment-paid-amount"]');
    const currency = row.querySelector('[name="payment-currency"]');
    const date = row.querySelector('[name="payment-date"]');
    function sync() {
      const foreign = (currency.value || 'RUB') !== 'RUB';
      const paid = status.value === 'Оплачено';
      fact.hidden = !paid;
      const factRate = row.querySelector('.payment-rate-field');
      if (factRate) factRate.hidden = !foreign;
      const rubField = row.querySelector('.payment-rub-field');
      if (rubField) rubField.hidden = !foreign;
      const plan = row.querySelector('.payment-plan-field');
      if (plan) plan.hidden = !foreign || paid;
      const equivalent = row.querySelector('.pay-rub-eq');
      if (equivalent) {
        equivalent.hidden = !foreign;
        if (foreign) {
          if (paid) {
            const stored = rubles && rubles.value.trim() !== '' ? num(rubles.value) : 0;
            const paidRate = num(rate.value);
            const paidSum = num(paidAmount.value || row.querySelector('[name="payment-amount"]').value);
            equivalent.textContent = stored > 0 ? '≈ ' + rub(stored) : (paidRate > 0 ? '≈ ' + rub(paidSum * paidRate) : 'курс не задан');
          } else {
            const planRate = num(row.querySelector('[name="payment-plan-rate"]').value);
            const planned = num(row.querySelector('[name="payment-amount"]').value);
            equivalent.textContent = planRate > 0 ? '≈ ' + rub(planned * planRate) : 'курс не задан';
          }
        }
      }
    }
    status.addEventListener('change', function () {
      if (status.value === 'Оплачено') prefillFact(row);
      sync();
    });
    currency.addEventListener('change', function () {
      const planInput = row.querySelector('[name="payment-plan-rate"]');
      if ((currency.value || 'RUB') !== 'RUB' && planInput && planInput.value.trim() === '') {
        const current = liveRate(currency.value);
        if (current > 0) planInput.value = formatDecimal(current);
      }
      sync();
    });
    const planInput = row.querySelector('[name="payment-plan-rate"]');
    if (planInput) planInput.addEventListener('input', sync);
    row.querySelector('[name="payment-amount"]').addEventListener('input', sync);
    const noteButton = row.querySelector('.pay-note-toggle');
    const note = row.querySelector('.payment-comment');
    if (noteButton && note) noteButton.addEventListener('click', function () {
      note.hidden = !note.hidden;
      noteButton.textContent = note.hidden ? 'Комментарий' : 'Скрыть комментарий';
    });
    rate.addEventListener('input', function () {
      if (rubles.dataset.manual !== '1') {
        const amount = num(paidAmount.value || row.querySelector('[name="payment-amount"]').value);
        if (num(rate.value) > 0) rubles.value = formatDecimal(amount * num(rate.value));
      }
      sync();
    });
    paidAmount.addEventListener('input', function () {
      if (rubles.dataset.manual !== '1') {
        const currentRate = num(rate.value);
        if ((currency.value || 'RUB') === 'RUB') rubles.value = paidAmount.value;
        else if (currentRate > 0) rubles.value = formatDecimal(num(paidAmount.value) * currentRate);
      }
      sync();
    });
    rubles.addEventListener('input', function () { rubles.dataset.manual = '1'; });
    if (date) bindPaymentDate(date);
    row.syncPaymentFields = sync;
    sync();
  }

  function readPaymentExtras(row) {
    const rubles = row.querySelector('[name="payment-rub"]');
    const rate = row.querySelector('[name="payment-rate"]');
    const paidAmount = row.querySelector('[name="payment-paid-amount"]');
    return {
      id: row.querySelector('[name="payment-id"]').value,
      currency: row.querySelector('[name="payment-currency"]').value || 'RUB',
      paidDate: row.querySelector('[name="payment-paid-date"]').value,
      paidAmount: paidAmount.value.trim() === '' ? '' : num(paidAmount.value),
      payRate: rate.value.trim() === '' ? '' : num(rate.value),
      rubActual: !rubles || rubles.value.trim() === '' ? '' : num(rubles.value),
      rubManual: rubles && rubles.dataset.manual === '1',
      comment: row.querySelector('[name="payment-comment"]').value.trim(),
      planRate: (function () {
        const field = row.querySelector('[name="payment-plan-rate"]');
        if (!field || field.value.trim() === '') return '';
        return num(field.value);
      })()
    };
  }

  function refreshFxPreview(form) {
    const note = form.querySelector('.fx-asset-note');
    if (!note || note.hidden) return;
    const currency = formCurrency();
    const price = num(form.elements.price && form.elements.price.value);
    const rate = liveRate(currency);
    const equivalent = rate > 0 ? '≈ ' + rub(price * rate) : 'курс не задан';
    note.textContent = 'Стоимость по договору ' + moneyOriginal(price, currency) + '. Рублёвый эквивалент по текущему курсу: ' + equivalent + '. Фактические рубли оплаченных платежей при смене курса не пересчитываются.';
  }

  function applyCalcMode(form) {
    const calc = form.querySelector('[name="calcType"]');
    const foreign = !!(calc && calc.value === 'Зарубежное имущество');
    const currency = form.querySelector('[name="currency"]');
    if (currency) {
      [...currency.options].forEach(function (option) { option.hidden = foreign ? option.textContent === 'RUB' : false; });
      if (!foreign) currency.value = 'RUB';
      else if (currency.value === 'RUB') currency.value = 'USD';
      const wrap = currency.closest('.form-field');
      const label = wrap && wrap.querySelector('label');
      if (label) label.textContent = 'Валюта договора';
      if (wrap) wrap.hidden = !foreign;
    }
    ['rateMode', 'initialRate', 'currentRate'].forEach(function (name) {
      const field = form.querySelector('[name="' + name + '"]');
      const wrap = field && field.closest('.form-field');
      if (wrap) wrap.hidden = !foreign;
    });
    form.querySelectorAll('.paid-rub-field, .fx-asset-note').forEach(function (node) { node.hidden = !foreign; });
    form.querySelectorAll('#payment-rows .payment-row').forEach(function (row) {
      if (row.syncPaymentFields) row.syncPaymentFields();
    });
    refreshFxPreview(form);
  }

  function storePlanRate(payment, typed, asset) {
    const cabinet = liveRate(payment.currency || asset.currency, asset) || 0;
    if (!(typed > 0) || (cabinet > 0 && Math.abs(typed - cabinet) < 0.005)) delete payment.planRate;
    else payment.planRate = typed;
  }

  window.addPaymentSeries = function () {
    const form = document.getElementById('record-form');
    if (!form) return;
    const count = Math.round(num(form.querySelector('[name="series-count"]').value));
    const amount = form.querySelector('[name="series-amount"]').value;
    const start = form.querySelector('[name="series-start"]').value;
    if (!(count > 0) || num(amount) <= 0 || !start) { alert('Укажите первую дату, сумму и количество платежей.'); return; }
    const limit = Math.min(count, 120);
    const date = new Date(start + 'T12:00:00');
    for (let index = 0; index < limit; index += 1) {
      window.addPaymentRow({ date: isoDate(date), amount: amount, currency: formCurrency(), status: 'Предстоит' });
      date.setMonth(date.getMonth() + 1);
    }
  };

  function decorateAssetForm(id) {
    const form = document.getElementById('record-form');
    if (!form || form.dataset.fxReady) return;
    form.dataset.fxReady = '1';
    const asset = (id && state.assets.find(function (item) { return item.id === id; })) || {};
    const container = form.querySelector('#payment-rows');
    if (container) {
      container.innerHTML = assetPayments(asset).map(paymentRowHtml).join('');
      [...container.querySelectorAll('.payment-row')].forEach(wirePaymentRow);
    }
    const section = form.querySelector('.payment-section');
    const head = section && section.querySelector('.payment-section-head');
    if (section && !form.querySelector('[name="series-count"]')) {
      if (head) head.insertAdjacentHTML('afterend', '<div class="payment-series"><label>Первая дата<input name="series-start" type="date"></label><label>Сумма<input name="series-amount" inputmode="decimal"></label><label>Количество<input name="series-count" inputmode="numeric" placeholder="12"></label><button type="button" class="ghost-button" onclick="addPaymentSeries()">Добавить все платежи</button><small>Платежи создаются раз в месяц, начиная с первой даты. Их можно поправить по отдельности.</small></div>');
    }
    const addButton = head && head.querySelector('button');
    if (addButton) addButton.classList.add('add-payment-below');
    anchorAddPaymentButton();
    if (section && !form.querySelector('[name="paidRub"]')) {
      section.insertAdjacentHTML('afterbegin', '<div class="paid-rub-field form-field"><label>Уже оплачено фактически, ₽</label><input name="paidRub" inputmode="decimal" value="' + esc(asset.paidRub ?? '') + '"><small>Только для части, внесённой до графика. Курс это число потом не пересчитывает.</small></div><p class="fx-asset-note">Стоимость по договору остаётся в валюте покупки. «Фактически вложено» складывается из рублей, указанных в оплаченных платежах.</p>');
    }
    const grid = form.querySelector('.form-grid');
    if (grid && !form.querySelector('[name="calcType"]')) {
      const foreignNow = assetIsForeign(asset);
      grid.insertAdjacentHTML('afterbegin', '<div class="form-field calc-type-field"><label>Тип расчёта</label><select name="calcType"><option ' + (foreignNow ? '' : 'selected') + '>Рубли</option><option ' + (foreignNow ? 'selected' : '') + '>Зарубежное имущество</option></select></div>');
    }
    const valueField = form.querySelector('[name="value"]');
    if (valueField && !form.querySelector('.value-hint')) valueField.insertAdjacentHTML('afterend', '<small class="value-hint">Меняет только текущую оценку. Стоимость по договору останется прежней.</small>');
    const calcType = form.querySelector('[name="calcType"]');
    if (calcType) calcType.addEventListener('change', function () { applyCalcMode(form); });
    const currency = form.querySelector('[name="currency"]');
    if (currency) currency.addEventListener('change', function () { applyCalcMode(form); });
    ['price', 'paid'].forEach(function (name) {
      const field = form.querySelector('[name="' + name + '"]');
      if (field) field.addEventListener('input', function () { refreshFxPreview(form); });
    });
    applyCalcMode(form);
    const previous = form.onsubmit;
    form.onsubmit = function (event) {
      const assetName = form.elements.name ? form.elements.name.value : '';
      const paidRubRaw = form.elements.paidRub ? form.elements.paidRub.value : '';
      const calcTypeValue = form.elements.calcType ? form.elements.calcType.value : '';
      if (calcTypeValue === 'Рубли' && form.elements.currency) form.elements.currency.value = 'RUB';
      if (calcTypeValue === 'Зарубежное имущество' && form.elements.currency && form.elements.currency.value === 'RUB') form.elements.currency.value = 'USD';
      const currencyValue = form.elements.currency ? form.elements.currency.value : 'RUB';
      const extras = [...form.querySelectorAll('#payment-rows .payment-row')].filter(function (row) {
        const date = row.querySelector('[name="payment-date"]');
        const amount = row.querySelector('[name="payment-amount"]');
        return date && date.value && num(amount && amount.value) > 0;
      }).map(readPaymentExtras);
      const result = previous ? previous.call(this, event) : undefined;
      const saved = id
        ? state.assets.find(function (item) { return item.id === id; })
        : state.assets.slice().reverse().find(function (item) { return item.name === assetName; });
      if (!saved) return result;
      if (calcTypeValue) saved.calcType = calcTypeValue;
      if (currencyValue !== 'RUB') saved.paidRub = paidRubRaw.trim() === '' ? '' : num(paidRubRaw);
      (saved.payments || []).forEach(function (payment, index) {
        const extra = extras[index];
        if (!extra) return;
        if (extra.id) payment.id = extra.id;
        payment.currency = extra.currency || saved.currency || currencyValue;
        payment.paidDate = extra.paidDate;
        payment.paidAmount = extra.paidAmount;
        payment.payRate = extra.payRate;
        payment.comment = extra.comment;
        if (calcTypeValue === 'Зарубежное имущество') storePlanRate(payment, extra.planRate, saved);
        if (payment.status === 'Оплачено') {
          if (extra.rubActual !== '') payment.rubActual = extra.rubActual;
          else if (extra.payRate !== '' && num(extra.payRate) > 0) payment.rubActual = Math.round(settledCurrency(payment) * num(extra.payRate) * 100) / 100;
          else if ((payment.currency || 'RUB') === 'RUB') payment.rubActual = settledCurrency(payment);
          else payment.rubActual = '';
        } else payment.rubActual = extra.rubActual;
      });
      save();
      render();
      return result;
    };
  }

  window.openPaymentFact = function (assetId, paymentId) {
    const asset = state.assets.find(function (item) { return item.id === assetId; });
    const payment = asset && assetPayments(asset).find(function (item) { return item.id === paymentId; });
    if (!asset || !payment) return;
    const currency = payment.currency || asset.currency || 'RUB';
    const foreign = currency !== 'RUB';
    const planned = num(payment.amount);
    const currentRate = foreign ? liveRate(currency, asset) : 1;
    const paidAmount = payment.paidAmount != null && payment.paidAmount !== '' ? payment.paidAmount : planned;
    const rateValue = payment.payRate != null && payment.payRate !== '' ? formatDecimal(payment.payRate) : (currentRate > 0 && currentRate !== 1 ? formatDecimal(currentRate) : '');
    const rubValue = payment.rubActual != null && payment.rubActual !== '' ? formatDecimal(payment.rubActual) : (foreign && num(rateValue) > 0 ? formatDecimal(num(paidAmount) * num(rateValue)) : formatDecimal(paidAmount));
    modalShell('Фактическая оплата',
      '<p class="safe-note">План: ' + moneyOriginal(planned, currency) + ' · ' + dateText(payment.date) + '. Если введёте рубли вручную, сохранится именно эта сумма, а не сегодняшний курс.</p>' +
      field('Фактическая дата оплаты', '<input name="paidDate" type="date" value="' + esc(payment.paidDate || isoDate(today)) + '" required>') +
      field('Оплачено, ' + currency, '<input name="paidAmount" inputmode="decimal" value="' + esc(paidAmount) + '">') +
      (foreign ? field('Курс фактической оплаты', '<input name="payRate" inputmode="decimal" value="' + esc(rateValue) + '">') : '') +
      field('Фактически потрачено, ₽', '<input name="rubActual" inputmode="decimal" value="' + esc(rubValue) + '">') +
      field('Комментарий', '<input name="comment" value="' + esc(payment.comment || '') + '">'),
      'Сохранить оплату',
      function (form) {
        const amount = num(form.elements.paidAmount.value);
        const rate = form.elements.payRate ? num(form.elements.payRate.value) : 0;
        const rubRaw = form.elements.rubActual.value.trim();
        if (!(amount > 0)) { alert('Укажите оплаченную сумму.'); return; }
        if (!form.elements.paidDate.value) { alert('Укажите фактическую дату.'); return; }
        if (foreign && rubRaw === '' && !(rate > 0)) { alert('Укажите курс оплаты или фактически потраченные рубли.'); return; }
        if (asset.paidBase === undefined) asset.paidBase = num(asset.paid);
        payment.status = 'Оплачено';
        payment.currency = currency;
        payment.paidDate = form.elements.paidDate.value;
        payment.paidAmount = amount;
        payment.payRate = foreign && rate > 0 ? rate : '';
        payment.comment = form.elements.comment.value.trim();
        payment.rubActual = rubRaw === '' ? Math.round(amount * rate * 100) / 100 : num(rubRaw);
        asset.paid = assetPaid(asset);
        save();
        closeModal();
        render();
      });
    const form = document.getElementById('safe-form');
    const rubInput = form.querySelector('[name="rubActual"]');
    const rateInput = form.querySelector('[name="payRate"]');
    const amountInput = form.querySelector('[name="paidAmount"]');
    let rubTouched = payment.rubActual != null && payment.rubActual !== '';
    function refill() {
      if (rubTouched) return;
      const amount = num(amountInput.value);
      if (!foreign) { rubInput.value = formatDecimal(amount); return; }
      const rate = num(rateInput && rateInput.value);
      if (rate > 0) rubInput.value = formatDecimal(amount * rate);
    }
    if (amountInput) amountInput.addEventListener('input', refill);
    if (rateInput) rateInput.addEventListener('input', refill);
    if (rubInput) rubInput.addEventListener('input', function () { rubTouched = true; });
  };

  const previousOpenForm = window.openForm;
  window.openForm = function (type, id) {
    previousOpenForm(type, id);
    if (type === 'asset') decorateAssetForm(id);
  };

  function anchorAddPaymentButton() {
    const container = document.getElementById('payment-rows');
    const section = container && container.closest('.payment-section');
    const button = section && (section.querySelector('.add-payment-below') || section.querySelector('.payment-section-head button'));
    if (!container || !button) return;
    container.insertAdjacentElement('afterend', button);
    button.classList.add('add-payment-below');
  }

  window.addPaymentRow = function (payment) {
    const container = document.getElementById('payment-rows');
    if (!container) return;
    const item = payment && payment.date ? payment : { currency: formCurrency(), status: 'Предстоит' };
    container.insertAdjacentHTML('beforeend', paymentRowHtml(item));
    wirePaymentRow(container.lastElementChild);
    anchorAddPaymentButton();
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
