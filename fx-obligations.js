(function () {
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function moneyFx(amount, currency) {
    const code = currency || 'RUB';
    if (code === 'RUB') return rub(amount);
    const formatted = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(roundMoney(amount));
    if (code === 'USD') return formatted + ' $';
    if (code === 'EUR') return formatted + ' €';
    return formatted + ' ' + code;
  }

  function rateFx(rate) {
    const value = num(rate);
    if (!(value > 0)) return 'не задан';
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value) + ' ₽';
  }

  function rubExact(amount) {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(roundMoney(amount)) + ' ₽';
  }

  function paymentAmount(payment) {
    return num(payment.paidAmount != null && payment.paidAmount !== '' ? payment.paidAmount : payment.amount);
  }

  function paymentRubles(payment) {
    if (payment.rubActual != null && payment.rubActual !== '') return num(payment.rubActual);
    if (num(payment.payRate) > 0) return roundMoney(paymentAmount(payment) * num(payment.payRate));
    return 0;
  }

  function fxPaidPayments(asset, drafts, currency) {
    const saved = asset ? assetPayments(asset).filter(function (payment) { return payment.status === 'Оплачено'; }) : [];
    return saved.concat(drafts || []).filter(function (payment) {
      return (payment.currency || currency || 'RUB') === (currency || payment.currency);
    });
  }

  const previousMoney = window.moneyOriginal;
  window.moneyOriginal = function (amount, currency) {
    if (!currency || currency === 'RUB') return previousMoney ? previousMoney(amount, currency) : rub(amount);
    return moneyFx(amount, currency);
  };

  function legs(asset) {
    return Array.isArray(asset && asset.fxLegs) ? asset.fxLegs : [];
  }

  function paidOf(list) {
    return (list || []).filter(function (payment) { return payment.status === 'Оплачено'; }).reduce(function (sum, payment) {
      const amount = payment.paidAmount != null && payment.paidAmount !== '' ? payment.paidAmount : payment.amount;
      return sum + num(amount);
    }, 0);
  }

  function legRemaining(leg) {
    return Math.max(0, num(leg.amount) - paidOf(leg.payments));
  }

  function ownRate(asset, currency, explicit) {
    if (!currency || currency === 'RUB') return 1;
    const cabinet = num(state.fx && state.fx[currency]);
    if (cabinet > 0) return cabinet;
    if (num(explicit) > 0) return num(explicit);
    if (asset && (asset.currency || 'RUB') === currency && num(asset.currentRate) > 0) return num(asset.currentRate);
    if (typeof window.liveRate === 'function') {
      const fallback = window.liveRate(currency, asset);
      if (fallback > 0) return fallback;
    }
    return 0;
  }

  function primaryLeft(asset) {
    return Math.max(0, assetRemaining(asset));
  }

  function fxLines(asset) {
    const lines = [];
    const currency = (asset && asset.currency) || 'RUB';
    const left = primaryLeft(asset);
    if (currency === 'RUB') {
      lines.push({ id: '', currency: 'RUB', left: left, rate: 1, rub: left, prior: 0 });
    } else {
      const rate = ownRate(asset, currency, asset.currentRate);
      lines.push({
        id: '',
        currency: currency,
        left: left,
        rate: rate,
        rub: rate > 0 ? left * rate : 0,
        prior: num(asset.priorRate)
      });
    }
    legs(asset).forEach(function (leg) {
      const code = leg.currency || 'RUB';
      const left = legRemaining(leg);
      const rate = ownRate(asset, code, leg.currentRate);
      lines.push({
        id: leg.id,
        currency: code,
        left: left,
        rate: rate,
        rub: code === 'RUB' ? left : (rate > 0 ? left * rate : 0),
        prior: num(leg.priorRate)
      });
    });
    return lines;
  }

  window.fxObligationRub = function (asset) {
    return fxLines(asset).reduce(function (sum, line) { return sum + line.rub; }, 0);
  };

  function selectedCode(form) {
    const field = form.querySelector('[name="currency"]');
    const code = field && field.value;
    if (!code || code === '__OTHER__' || code === '__ADD__') return '';
    return code;
  }

  function legacyPaid(asset) {
    if (!asset) return 0;
    return asset.paidBase !== undefined ? num(asset.paidBase) : num(asset.paid);
  }

  function contractPaymentRows(asset) {
    const currency = (asset && asset.currency) || 'RUB';
    return assetPayments(asset).filter(function (payment) {
      return payment.status === 'Оплачено' && (payment.currency || currency) === currency;
    });
  }

  function contractPaid(asset) {
    const fromPayments = contractPaymentRows(asset).reduce(function (sum, payment) { return sum + paymentAmount(payment); }, 0);
    const legacy = legacyPaid(asset);
    if (fromPayments <= 0) return legacy;
    return Math.max(fromPayments, legacy);
  }

  function contractLeft(asset) {
    return Math.max(0, num(asset && asset.price) - contractPaid(asset));
  }

  function spentRubles(asset) {
    const rows = contractPaymentRows(asset);
    let total = 0;
    let known = true;
    rows.forEach(function (payment) {
      const rubles = paymentRubles(payment);
      if (payment.rubActual != null && payment.rubActual !== '' || num(payment.payRate) > 0) total += rubles;
      else known = false;
    });
    const fromPayments = rows.reduce(function (sum, payment) { return sum + paymentAmount(payment); }, 0);
    const opening = Math.max(0, contractPaid(asset) - fromPayments);
    if (opening > 0.009) {
      if (fromPayments <= 0 && num(asset && asset.paidRub) > 0) total += num(asset.paidRub);
      else known = false;
    }
    return { total: roundMoney(total), known: known };
  }

  function initialPlan(asset) {
    if (num(asset && asset.contractRub) > 0) return num(asset.contractRub);
    if (num(asset && asset.initialRate) > 0) return roundMoney(num(asset.price) * num(asset.initialRate));
    return 0;
  }

  function fxPurchase(asset) {
    const currency = (asset && asset.currency) || 'RUB';
    const paid = contractPaid(asset);
    const left = contractLeft(asset);
    const rate = ownRate(asset, currency, asset && asset.currentRate);
    const spent = spentRubles(asset);
    const future = rate > 0 ? roundMoney(left * rate) : 0;
    const plan = initialPlan(asset);
    const closed = left <= 0.009;
    const forecast = !closed && spent.known && rate > 0 ? roundMoney(spent.total + future) : 0;
    const compare = closed ? (spent.known ? spent.total : 0) : forecast;
    const delta = plan > 0 && compare > 0 ? roundMoney(compare - plan) : null;
    const average = closed && spent.known && num(asset && asset.price) > 0 ? spent.total / num(asset.price) : 0;
    return { currency: currency, paid: paid, left: left, rate: rate, spent: spent, future: future, plan: plan, closed: closed, forecast: forecast, delta: delta, average: average, initialRate: num(asset && asset.initialRate) };
  }

  function resultSentence(purchase) {
    if (!purchase.spent.known && purchase.paid > 0) return 'Укажите фактически потраченные рубли по платежам. Уже оплаченная часть не пересчитывается по сегодняшнему курсу.';
    if (purchase.delta == null) return 'Укажите курс при заключении договора, чтобы сравнить покупку с первоначальным планом.';
    const amount = rub(Math.abs(purchase.delta));
    if (Math.abs(purchase.delta) < 0.5) return purchase.closed ? 'Фактическая стоимость совпала с первоначальным планом.' : 'Прогноз сейчас совпадает с первоначальным планом.';
    if (purchase.closed) return purchase.delta > 0 ? 'Из-за изменения курса покупка фактически дороже на ' + amount + '.' : 'Из-за изменения курса покупка фактически дешевле на ' + amount + '.';
    return purchase.delta > 0 ? 'Из-за изменения курса покупка сейчас прогнозно дороже на ' + amount + '.' : 'Из-за изменения курса покупка сейчас прогнозно дешевле на ' + amount + '.';
  }

  window.fxPurchase = fxPurchase;

  function legPreview(row) {
    const code = row.querySelector('[name="fx-currency"]').value || 'USD';
    const amount = num(row.querySelector('[name="fx-amount"]').value);
    const rate = num(row.querySelector('[name="fx-rate"]').value);
    const id = row.querySelector('[name="fx-id"]').value;
    const assetId = row.closest('form') && row.closest('form').dataset.fxAssetId;
    const asset = assetId && state.assets.find(function (item) { return item.id === assetId; });
    const leg = asset && legs(asset).filter(function (item) { return item.id === id; })[0];
    const paid = leg ? paidOf(leg.payments) : 0;
    const left = Math.max(0, amount - paid);
    const rubLeft = rate > 0 ? left * rate : 0;
    const box = row.querySelector('.fx-leg-preview');
    box.innerHTML = '<span>Оплачено ' + esc(moneyFx(paid, code)) + ' · осталось ' + esc(moneyFx(left, code)) + '</span><strong>' + (rate > 0 ? 'Остаток сегодня ' + esc(rub(rubLeft)) : 'Укажите курс') + '</strong>';
  }

  function legRow(leg) {
    leg = leg || {};
    const code = leg.currency && leg.currency !== 'RUB' ? leg.currency : 'USD';
    return '<div class="fx-leg"><input name="fx-id" type="hidden" value="' + esc(leg.id || '') + '"><input name="fx-prior" type="hidden" value="' + esc(leg.priorRate != null ? leg.priorRate : '') + '"><label>Валюта<select name="fx-currency" data-currency-catalog="1"><option>' + esc(code) + '</option></select></label><label>Сумма<input name="fx-amount" inputmode="decimal" autocomplete="off" value="' + esc(leg.amount != null && leg.amount !== '' ? formatMoneyInput(leg.amount) : '') + '"></label><label>Текущий курс<input name="fx-rate" inputmode="decimal" autocomplete="off" value="' + esc(leg.currentRate != null && leg.currentRate !== '' ? String(leg.currentRate).replace('.', ',') : '') + '"></label><button type="button" class="ghost-button fx-leg-remove">Удалить</button><p class="fx-leg-preview"></p></div>';
  }

  function historyHtml(asset, currency) {
    const rows = contractPaymentRows(asset).slice().sort(function (a, b) { return String(a.paidDate || a.date || '').localeCompare(String(b.paidDate || b.date || '')); });
    const fromPayments = rows.reduce(function (sum, payment) { return sum + paymentAmount(payment); }, 0);
    const gap = Math.max(0, contractPaid(asset) - fromPayments);
    if (!rows.length && gap <= 0.009) return '<p class="fx-history-empty">Валютных платежей пока нет</p>';
    const gapRate = gap > 0.009 && fromPayments <= 0 && num(asset && asset.paidRub) > 0 ? num(asset.paidRub) / gap : 0;
    const gapRow = gap > 0.009 ? '<div class="fx-history-row"><span>В объекте</span><span>' + esc(moneyFx(gap, currency)) + '</span><span>' + esc(gapRate > 0 ? rateFx(gapRate) : '—') + '</span><span>' + esc(fromPayments <= 0 && num(asset && asset.paidRub) > 0 ? rubExact(asset.paidRub) : 'рубли не указаны') + '</span></div>' : '';
    const invested = rows.reduce(function (sum, payment) { return sum + paymentRubles(payment); }, 0) + (fromPayments <= 0 && num(asset && asset.paidRub) > 0 ? num(asset.paidRub) : 0);
    return '<h4>История валютных платежей</h4><div class="fx-history-table"><div class="fx-history-head"><span>Дата</span><span>Оплачено ' + esc(currency) + '</span><span>Курс платежа</span><span>Потрачено ₽</span></div>' + gapRow + rows.map(function (payment) {
      const rubles = paymentRubles(payment);
      return '<div class="fx-history-row"><span>' + esc(dateText(payment.paidDate || payment.date)) + '</span><span>' + esc(moneyFx(paymentAmount(payment), payment.currency || currency)) + '</span><span>' + esc(rateFx(payment.payRate)) + '</span><span>' + esc(rubles > 0 || payment.rubActual != null && payment.rubActual !== '' ? rubExact(rubles) : '—') + '</span></div>';
    }).join('') + '</div><p class="fx-history-total">Оплачено: <b>' + esc(moneyFx(contractPaid(asset), currency)) + '</b></p><p class="fx-history-total">Фактически потрачено: <b>' + esc(invested > 0 ? rubExact(invested) : 'рубли не указаны') + '</b></p>';
  }

  function paint(form) {
    const block = form.querySelector('.fx-calc');
    const currencyField = form.querySelector('[name="currency"]');
    if (!block || !currencyField) return;
    const currency = selectedCode(form) || 'RUB';
    const foreign = !!selectedCode(form) && currency !== 'RUB';
    block.hidden = !foreign;
    const stale = form.querySelector('.fx-asset-note');
    if (stale) stale.hidden = foreign;
    form.querySelectorAll('.fx-leg').forEach(legPreview);
    const rateLabel = block.querySelector('.fx-rate-slot label');
    if (rateLabel) rateLabel.firstChild.textContent = 'Текущий курс ' + currency + ' к рублю';
    if (!foreign) return;
    const stored = form.dataset.fxAssetId && state.assets.find(function (item) { return item.id === form.dataset.fxAssetId; });
    const typedPaid = num(form.elements.paid && form.elements.paid.value);
    const draft = Object.assign({}, stored || {}, {
      currency: currency,
      price: num(form.elements.price && form.elements.price.value),
      paid: typedPaid,
      paidBase: typedPaid,
      initialRate: num(form.elements.initialRate && form.elements.initialRate.value) || (stored && stored.initialRate),
      contractRub: stored && stored.contractRub,
      currentRate: num(form.elements.currentRate && form.elements.currentRate.value) || (stored && stored.currentRate),
      paidRub: stored && stored.paidRub,
      payments: assetPayments(stored || {}).concat(form._fxPayments || [])
    });
    const typedInitial = num(form.elements.initialRate && form.elements.initialRate.value);
    if (typedInitial > 0 && (!stored || !(num(stored.contractRub) > 0) || Math.abs(typedInitial - num(stored.initialRate)) > 1e-9 || Math.abs(draft.price - num(stored.price)) > 1e-9)) draft.contractRub = roundMoney(draft.price * typedInitial);
    const purchase = fxPurchase(draft);
    const set = function (name, text) { const node = block.querySelector('[data-fx="' + name + '"]'); if (node) node.textContent = text; };
    set('price', moneyFx(draft.price, currency));
    set('initial-rate', purchase.initialRate > 0 ? rateFx(purchase.initialRate) : 'не указан');
    set('plan', purchase.plan > 0 ? rub(purchase.plan) : 'не указана');
    set('spent', purchase.spent.known || purchase.spent.total > 0 ? rub(purchase.spent.total) : 'рубли не указаны');
    set('forecast', purchase.closed ? 'покупка оплачена' : (purchase.forecast > 0 ? rub(purchase.forecast) : '—'));
    set('paid', moneyFx(purchase.paid, currency));
    set('left', moneyFx(purchase.left, currency));
    set('rate', purchase.rate > 0 ? rateFx(purchase.rate) : 'курс не задан');
    set('left-rub', purchase.rate > 0 ? rub(purchase.future) : 'курс не задан');
    const history = block.querySelector('.fx-history');
    if (history) history.innerHTML = historyHtml(draft, currency);
    const result = block.querySelector('.fx-result');
    if (result) result.textContent = resultSentence(purchase);
  }

  function enhanceAssetCurrencyForm(id) {
    const form = document.getElementById('record-form');
    if (!form || form.dataset.fxCalcReady) return;
    form.dataset.fxCalcReady = '1';
    form.dataset.fxAssetId = id || '';
    const asset = (id && state.assets.find(function (item) { return item.id === id; })) || {};
    const currency = form.querySelector('[name="currency"]');
    if (currency) {
      const wrap = currency.closest('.form-field');
      if (wrap) {
        wrap.classList.remove('purchase-only');
        wrap.hidden = false;
        const label = wrap.querySelector('label');
        if (label) label.textContent = 'Валюта';
      }
      const stored = asset.currency || currency.value || 'RUB';
      currency.innerHTML = '<option value="' + esc(stored) + '">' + esc(stored) + '</option>';
      currency.value = stored;
      currency.dataset.currencyCatalog = '1';
      if (window.attachCurrencyPicker) window.attachCurrencyPicker(currency, { allowRub: true });
    }
    ['rateMode'].forEach(function (name) {
      const field = form.querySelector('[name="' + name + '"]');
      const wrap = field && field.closest('.form-field');
      if (wrap) wrap.classList.add('fx-legacy');
    });
    const refresh = form.querySelector('.rate-refresh');
    if (refresh) refresh.remove();
    const rateField = form.querySelector('[name="currentRate"]');
    const rateWrap = rateField && rateField.closest('.form-field');
    const rateHome = rateWrap && rateWrap.parentElement;
    const rateNext = rateWrap && rateWrap.nextSibling;
    if (rateWrap) {
      const label = rateWrap.querySelector('label');
      if (label) label.textContent = 'Текущий курс';
    }
    const initialField = form.querySelector('[name="initialRate"]');
    const initialWrap = initialField && initialField.closest('.form-field');
    const initialHome = initialWrap && initialWrap.parentElement;
    const initialNext = initialWrap && initialWrap.nextSibling;
    if (initialWrap) {
      const label = initialWrap.querySelector('label');
      if (label) label.textContent = 'Курс при заключении договора';
    }
    const host = (currency && currency.closest('.form-field')) || form.querySelector('.form-grid');
    if (!host || form.querySelector('.fx-calc')) return;
    host.insertAdjacentHTML('afterend', '<div class="fx-calc" hidden><h4>Покупка и остаток</h4><div class="fx-rate-slot"></div><div class="fx-readout"><div><span>Стоимость по договору</span><strong data-fx="price"></strong></div><div><span>Курс при заключении</span><strong data-fx="initial-rate"></strong></div><div><span>Первоначально планировалось</span><strong data-fx="plan"></strong></div><div><span>Фактически потрачено</span><strong data-fx="spent"></strong></div><div><span>Прогнозная итоговая стоимость</span><strong data-fx="forecast"></strong></div><div><span>Оплачено</span><strong data-fx="paid"></strong></div><div><span>Осталось</span><strong data-fx="left"></strong></div><div><span>Текущий курс</span><strong data-fx="rate"></strong></div><div><span>Необходимо подготовить</span><strong data-fx="left-rub"></strong></div></div><p class="fx-result"></p><div class="fx-history"></div><button type="button" class="ghost-button fx-add-leg">+ Добавить фактический платёж</button><div class="fx-pay-panel" hidden><div class="fx-pay-grid"><label>Дата платежа<input name="fx-pay-date" type="date" value="' + isoDate(today) + '"></label><label>Сумма платежа в валюте<input name="fx-pay-amount" inputmode="decimal" autocomplete="off"></label><label>Валюта<select name="fx-pay-currency" data-currency-catalog="1"><option>' + esc(asset.currency && asset.currency !== 'RUB' ? asset.currency : 'AED') + '</option></select></label><label>Курс к рублю на дату платежа<input name="fx-pay-rate" inputmode="decimal" autocomplete="off"></label><label>Фактически потрачено, ₽<input name="fx-pay-rub" inputmode="decimal" autocomplete="off"></label></div><button type="button" class="primary-button fx-pay-save">Сохранить платёж</button></div></div>');
    const block = form.querySelector('.fx-calc');
    form._fxPayments = [];
    function placeRate() {
      const foreign = selectedCode(form) !== 'RUB' && selectedCode(form) !== '';
      if (rateWrap) {
        if (foreign && block) {
          rateWrap.hidden = false;
          block.querySelector('.fx-rate-slot').appendChild(rateWrap);
        } else if (rateHome) rateHome.insertBefore(rateWrap, rateNext);
      }
      if (initialWrap) {
        if (foreign && block) {
          initialWrap.hidden = false;
          block.querySelector('.fx-rate-slot').appendChild(initialWrap);
        } else if (initialHome) {
          initialWrap.hidden = true;
          initialHome.insertBefore(initialWrap, initialNext);
        }
      }
    }
    const payPanel = block.querySelector('.fx-pay-panel');
    const payAmount = block.querySelector('[name="fx-pay-amount"]');
    const payRate = block.querySelector('[name="fx-pay-rate"]');
    const payRub = block.querySelector('[name="fx-pay-rub"]');
    const payCurrency = block.querySelector('[name="fx-pay-currency"]');
    function payCode() {
      return (payCurrency && payCurrency.value) || selectedCode(form) || '';
    }
    let payLock = false;
    function refillFromRate() {
      if (payLock) return;
      const amount = num(payAmount.value);
      const rate = num(payRate.value);
      if (!(amount > 0) || !(rate > 0)) return;
      payLock = true;
      payRub.value = formatMoneyInput(roundMoney(amount * rate));
      payLock = false;
    }
    function refillFromRub() {
      if (payLock) return;
      const amount = num(payAmount.value);
      const rubles = num(payRub.value);
      if (!(amount > 0) || !(rubles > 0)) return;
      payLock = true;
      payRate.value = String(rubles / amount).replace('.', ',');
      payLock = false;
    }
    payAmount.addEventListener('input', refillFromRate);
    payRate.addEventListener('input', refillFromRate);
    payRub.addEventListener('input', refillFromRub);
    block.querySelector('.fx-add-leg').addEventListener('click', function () {
      const code = selectedCode(form);
      if (payCurrency && code && code !== 'RUB') {
        if (![...payCurrency.options].some(function (option) { return option.value === code; })) payCurrency.add(new Option(code, code));
        payCurrency.value = code;
        if (payCurrency._currencyRefresh) payCurrency._currencyRefresh();
      }
      payPanel.hidden = false;
    });
    block.querySelector('.fx-pay-save').addEventListener('click', function () {
      const date = block.querySelector('[name="fx-pay-date"]').value;
      const amount = num(payAmount.value);
      let rate = num(payRate.value);
      let rubles = num(payRub.value);
      const code = payCode();
      if (!code || code === 'RUB') { alert('Выберите валюту платежа.'); return; }
      if (!date) { alert('Укажите дату платежа.'); return; }
      if (!(amount > 0)) { alert('Укажите сумму платежа.'); return; }
      if (!(rate > 0) && rubles > 0) rate = rubles / amount;
      if (!(rubles > 0) && rate > 0) rubles = roundMoney(amount * rate);
      if (!(rate > 0) || !(rubles > 0)) { alert('Укажите курс платежа или фактически потраченные рубли.'); return; }
      form._fxPayments.push({
        id: uid(),
        date: date,
        paidDate: date,
        amount: amount,
        paidAmount: amount,
        currency: code,
        status: 'Оплачено',
        payRate: rate,
        rubActual: rubles,
        comment: ''
      });
      payAmount.value = '';
      payRate.value = '';
      payRub.value = '';
      payPanel.hidden = true;
      paint(form);
    });
    form.addEventListener('input', function (event) {
      if (event.target && (event.target.name === 'fx-amount' || event.target.name === 'fx-rate' || event.target.name === 'price' || event.target.name === 'paid' || event.target.name === 'currentRate' || event.target.name === 'initialRate')) paint(form);
    });
    form.addEventListener('change', function (event) {
      if (!event.target) return;
      if (event.target.name === 'currency' || event.target.name === 'fx-currency' || event.target.name === 'payment-status') {
        placeRate();
        paint(form);
      }
      if (event.target === rateField || event.target === initialField) paint(form);
    });
    if (window.upgradeCurrencySelects) window.upgradeCurrencySelects(form);
    placeRate();
    paint(form);
    const previous = form.onsubmit;
    form.onsubmit = function (event) {
      if (currency && !window.currencyReady(currency)) {
        event.preventDefault();
        alert('Выберите валюту.');
        return;
      }
      const keptLegs = legs(asset).map(function (leg) { return Object.assign({}, leg, { payments: (leg.payments || []).slice() }); });
      const frozen = assetPayments(asset).map(function (payment) {
        return { id: payment.id, rubActual: payment.rubActual, payRate: payment.payRate, paidAmount: payment.paidAmount, currency: payment.currency, status: payment.status };
      });
      const drafts = (form._fxPayments || []).slice();
      const beforeIds = state.assets.map(function (item) { return item.id; });
      const name = form.elements.name ? form.elements.name.value : '';
      const result = previous ? previous.call(form, event) : undefined;
      const saved = id
        ? state.assets.find(function (item) { return item.id === id; })
        : state.assets.filter(function (item) { return beforeIds.indexOf(item.id) < 0; })[0] || state.assets.slice().reverse().find(function (item) { return item.name === name; });
      if (!saved) return result;
      if (!Array.isArray(saved.payments)) saved.payments = [];
      frozen.forEach(function (payment) {
        const found = saved.payments.find(function (item) { return item.id === payment.id; });
        if (!found || payment.rubActual == null || payment.rubActual === '') return;
        found.rubActual = payment.rubActual;
        found.payRate = payment.payRate;
        found.paidAmount = payment.paidAmount;
        found.currency = payment.currency || found.currency;
      });
      drafts.forEach(function (payment) {
        if (!saved.payments.some(function (item) { return item.id === payment.id; })) saved.payments.push(payment);
      });
      if (!Array.isArray(saved.fxLegs) || !saved.fxLegs.length) saved.fxLegs = keptLegs;
      if ((saved.currency || 'RUB') !== 'RUB') {
        const nextInitial = num(saved.initialRate);
        const planChanged = nextInitial > 0 && (!(num(saved.contractRub) > 0) || Math.abs(num(asset.initialRate) - nextInitial) > 1e-9 || Math.abs(num(asset.price) - num(saved.price)) > 1e-9);
        if (planChanged) saved.contractRub = roundMoney(num(saved.price) * nextInitial);
        const typed = num(form.elements.paid && form.elements.paid.value);
        const linked = Math.max(contractPaid(saved), typed);
        saved.paid = linked;
        saved.paidBase = linked;
      } else saved.paid = assetPaid(saved);
      save();
      render();
      return result;
    };
  }

  const baseOpenForm = window.openForm;
  window.openForm = function (type, id) {
    baseOpenForm(type, id);
    if (type === 'asset') enhanceAssetCurrencyForm(id);
  };

  function rememberPayment(asset, legId, payment) {
    if (!legId) {
      if (!Array.isArray(asset.payments)) asset.payments = [];
      asset.payments.push(payment);
      if (asset.paidBase === undefined) asset.paidBase = num(asset.paid);
      asset.paid = assetPaid(asset);
      return;
    }
    const leg = legs(asset).filter(function (item) { return item.id === legId; })[0];
    if (!leg) return;
    if (!Array.isArray(leg.payments)) leg.payments = [];
    leg.payments.push(payment);
  }

  window.openFxPayment = function (assetId, legId) {
    const asset = state.assets.find(function (item) { return item.id === assetId; });
    if (!asset) return;
    const leg = legId ? legs(asset).filter(function (item) { return item.id === legId; })[0] : null;
    if (legId && !leg) return;
    const currency = leg ? leg.currency : (asset.currency || 'RUB');
    const foreign = currency !== 'RUB';
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Платёж · ' + esc(currency) + '</h2><button class="close" type="button" onclick="closeModal()">×</button></div><form id="fx-pay-form"><div class="modal-body"><div class="form-grid"><div class="form-field"><label>Дата платежа</label><input name="payDate" type="date" value="' + isoDate(today) + '"></div><div class="form-field"><label>Сумма платежа в валюте</label><input name="fxPayAmount" inputmode="decimal" autocomplete="off"></div>' + (foreign ? '<div class="form-field"><label>Фактический курс платежа</label><input name="fxPayRate" inputmode="decimal" autocomplete="off"></div><div class="form-field"><label>Фактически потрачено, ₽</label><input name="rubActual" inputmode="decimal" autocomplete="off"></div>' : '') + '</div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Сохранить платёж</button></div></form></div></div>';
    const form = document.getElementById('fx-pay-form');
    const amountInput = form.querySelector('[name="fxPayAmount"]');
    const rateInput = form.querySelector('[name="fxPayRate"]');
    const rubInput = form.querySelector('[name="rubActual"]');
    let payLock = false;
    function refillFromRate() {
      if (payLock || !foreign || !rubInput || !rateInput) return;
      const amount = num(amountInput.value);
      const rate = num(rateInput.value);
      if (!(amount > 0) || !(rate > 0)) return;
      payLock = true;
      rubInput.value = formatMoneyInput(roundMoney(amount * rate));
      payLock = false;
    }
    function refillFromRub() {
      if (payLock || !foreign || !rubInput || !rateInput) return;
      const amount = num(amountInput.value);
      const rubles = num(rubInput.value);
      if (!(amount > 0) || !(rubles > 0)) return;
      payLock = true;
      rateInput.value = String(rubles / amount).replace('.', ',');
      payLock = false;
    }
    if (amountInput) amountInput.addEventListener('input', refillFromRate);
    if (rateInput) rateInput.addEventListener('input', refillFromRate);
    if (rubInput) rubInput.addEventListener('input', refillFromRub);
    form.onsubmit = function (event) {
      event.preventDefault();
      const amount = num(amountInput.value);
      let rate = rateInput ? num(rateInput.value) : 1;
      let rubles = rubInput ? num(rubInput.value) : amount;
      const date = form.querySelector('[name="payDate"]').value;
      if (!date) { alert('Укажите дату платежа.'); return; }
      if (!(amount > 0)) { alert('Укажите сумму платежа.'); return; }
      if (foreign && !(rate > 0) && rubles > 0) rate = rubles / amount;
      if (foreign && !(rubles > 0) && rate > 0) rubles = roundMoney(amount * rate);
      if (foreign && (!(rate > 0) || !(rubles > 0))) { alert('Укажите курс платежа или фактически потраченные рубли.'); return; }
      if (!foreign) rubles = amount;
      rememberPayment(asset, legId, {
        id: uid(),
        date: date,
        paidDate: date,
        amount: amount,
        paidAmount: amount,
        currency: currency,
        status: 'Оплачено',
        payRate: foreign ? rate : '',
        rubActual: rubles,
        comment: ''
      });
      save();
      closeModal();
      render();
    };
  };

  function marketLine(asset) {
    const history = asset && asset.rateHistory || [];
    if (history.length < 2) return '';
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    if (last.rubValue == null || prev.rubValue == null) return '';
    const delta = num(last.rubValue) - num(prev.rubValue);
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    return '<div><span>Изменение рыночной стоимости</span><strong>' + sign + rub(Math.abs(delta)) + '</strong></div>';
  }

  function purchaseCardHtml(asset) {
    const currency = (asset && asset.currency) || 'RUB';
    if (!currency || currency === 'RUB') return '';
    const purchase = fxPurchase(asset);
    const valueCode = asset.valueCurrency || currency;
    const valueRub = typeof assetAmountRub === 'function' ? assetAmountRub(asset, asset.value) : num(asset.value);
    const valueText = !(num(asset.value) > 0) ? 'не указана' : (valueCode === 'RUB' ? rub(asset.value) : (valueRub ? rub(valueRub) : moneyFx(asset.value, valueCode)));
    const spentText = purchase.spent.known || purchase.spent.total > 0 ? rub(purchase.spent.total) : 'рубли не указаны';
    const forecastText = purchase.closed ? '' : (purchase.forecast > 0 ? '<div><span>Прогнозная итоговая стоимость</span><strong>' + rub(purchase.forecast) + '</strong></div>' : '');
    const averageText = purchase.closed && purchase.average > 0 ? '<div><span>Средний фактический курс ' + esc(currency) + '</span><strong>' + esc(rateFx(purchase.average)) + '</strong></div>' : '';
    const result = resultSentence(purchase);
    return '<div class="fx-purchase"><section class="fx-block"><h4>Стоимость объекта сегодня</h4><div class="fx-asset-facts"><div><span>Текущая оценочная стоимость</span><strong>' + valueText + '</strong></div><div><span>Валюта оценки</span><strong>' + esc(valueCode) + '</strong></div>' + marketLine(asset) + '</div></section><section class="fx-block"><h4>Покупка и валютный результат</h4><div class="fx-asset-facts"><div><span>Стоимость по договору</span><strong>' + esc(moneyFx(asset.price, currency)) + '</strong></div><div><span>Курс при заключении договора</span><strong>' + (purchase.initialRate > 0 ? esc(rateFx(purchase.initialRate)) : 'не указан') + '</strong></div><div><span>Первоначально планировалось</span><strong>' + (purchase.plan > 0 ? rub(purchase.plan) : 'не указана') + '</strong></div><div><span>Фактически уже потрачено</span><strong>' + spentText + '</strong></div>' + forecastText + averageText + '</div><p class="fx-result">' + esc(result) + '</p></section><section class="fx-block"><h4>Осталось оплатить</h4><div class="fx-asset-facts"><div><span>Оплачено</span><strong>' + esc(moneyFx(purchase.paid, currency)) + '</strong></div><div><span>Осталось</span><strong>' + esc(moneyFx(purchase.left, currency)) + '</strong></div><div><span>Текущий курс</span><strong>' + (purchase.rate > 0 ? esc(rateFx(purchase.rate)) : 'курс не задан') + '</strong></div><div><span>Необходимо подготовить</span><strong>' + (purchase.closed ? 'оплачено' : (purchase.rate > 0 ? rub(purchase.future) : 'курс не задан')) + '</strong></div></div>' + historyHtml(asset, currency) + '</section></div>';
  }

  window.fxAssetCardHtml = purchaseCardHtml;

  const paidBeforeFx = assetPaid;
  assetPaid = function (asset) {
    if (!asset || (asset.currency || 'RUB') === 'RUB') return paidBeforeFx(asset);
    return contractPaid(asset);
  };
  const remainingBeforeFx = assetRemaining;
  assetRemaining = function (asset) {
    if (!asset || (asset.currency || 'RUB') === 'RUB') return remainingBeforeFx(asset);
    if (asset.ownershipStatus && asset.ownershipStatus !== 'Покупается') return 0;
    return contractLeft(asset);
  };

  const baseObligations = obligations;
  obligations = function () {
    const items = baseObligations();
    const seen = {};
    items.forEach(function (item) { if (item && item.asset) seen[item.asset.id] = true; });
    state.assets.forEach(function (asset) {
      if (seen[asset.id]) return;
      if (!legs(asset).some(function (leg) { return legRemaining(leg) > 0; })) return;
      items.push({
        id: 'asset-' + asset.id,
        kind: 'asset',
        asset: asset,
        what: asset.name,
        who: asset.owner || asset.description,
        total: num(asset.price),
        paid: assetPaid(asset),
        remaining: assetRemaining(asset),
        payments: [],
        allPayments: assetPayments(asset),
        nextDate: '',
        nextAmount: 0,
        status: asset.ownershipStatus || asset.status || ''
      });
    });
    return items;
  };
})();
