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
    if (currency !== 'RUB') {
      const left = primaryLeft(asset);
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

  function shiftHtml(left, prior, rate) {
    if (!(prior > 0) || !(rate > 0) || Math.abs(prior - rate) < 1e-9) return '';
    const before = left * prior;
    const now = left * rate;
    const delta = now - before;
    return '<p class="fx-shift">Изменение рублёвого эквивалента из-за курса<br>Вчера для погашения остатка требовалось: ' + rub(before) + '<br>Сегодня: ' + rub(now) + '<br>Изменение: ' + (delta > 0 ? '+' : delta < 0 ? '−' : '') + rub(Math.abs(delta)) + '<br>Это переоценка оставшегося обязательства, а не платёж и не новый долг.</p>';
  }

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

  function historyHtml(payments, currency) {
    const rows = payments.slice().sort(function (a, b) { return String(a.paidDate || a.date || '').localeCompare(String(b.paidDate || b.date || '')); });
    if (!rows.length) return '<p class="fx-history-empty">Валютных платежей пока нет</p>';
    const paid = rows.reduce(function (sum, payment) { return sum + paymentAmount(payment); }, 0);
    const invested = rows.reduce(function (sum, payment) { return sum + paymentRubles(payment); }, 0);
    return '<h4>История валютных платежей</h4><div class="fx-history-table"><div class="fx-history-head"><span>Дата</span><span>Сумма в валюте</span><span>Курс</span><span>Эквивалент в ₽</span></div>' + rows.map(function (payment) {
      return '<div class="fx-history-row"><span>' + esc(dateText(payment.paidDate || payment.date)) + '</span><span>' + esc(moneyFx(paymentAmount(payment), payment.currency || currency)) + '</span><span>' + esc(rateFx(payment.payRate)) + '</span><span>' + esc(rubExact(paymentRubles(payment))) + '</span></div>';
    }).join('') + '</div><p class="fx-history-total">Фактически оплачено: <b>' + esc(moneyFx(paid, currency)) + '</b></p><p class="fx-history-total">Фактически вложено: <b>' + esc(rubExact(invested)) + '</b></p>';
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
    const asset = form.dataset.fxAssetId && state.assets.find(function (item) { return item.id === form.dataset.fxAssetId; });
    const payments = fxPaidPayments(asset, form._fxPayments, currency);
    const price = num(form.elements.price && form.elements.price.value);
    const paid = payments.reduce(function (sum, payment) { return sum + paymentAmount(payment); }, 0);
    const invested = payments.reduce(function (sum, payment) { return sum + paymentRubles(payment); }, 0);
    const rate = num(form.elements.currentRate && form.elements.currentRate.value);
    const left = Math.max(0, price - paid);
    const set = function (name, text) { const node = block.querySelector('[data-fx="' + name + '"]'); if (node) node.textContent = text; };
    set('price', moneyFx(price, currency));
    set('rate', rateFx(rate));
    set('paid', moneyFx(paid, currency));
    set('invested', rubExact(invested));
    set('left', moneyFx(left, currency));
    set('left-rub', rate > 0 ? rubExact(left * rate) : 'курс не задан');
    const history = block.querySelector('.fx-history');
    if (history) history.innerHTML = historyHtml(payments, currency);
    const shift = block.querySelector('.fx-shift');
    if (shift) {
      const prior = num(block.dataset.priorRate);
      const html = shiftHtml(left, prior, rate);
      shift.hidden = !html;
      shift.innerHTML = html ? html.replace(/^<p class="fx-shift">|<\/p>$/g, '') : '';
    }
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
    ['rateMode', 'initialRate'].forEach(function (name) {
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
    const host = (currency && currency.closest('.form-field')) || form.querySelector('.form-grid');
    if (!host || form.querySelector('.fx-calc')) return;
    host.insertAdjacentHTML('afterend', '<div class="fx-calc" hidden data-prior-rate="' + esc(asset.priorRate != null && asset.priorRate !== '' ? asset.priorRate : '') + '"><h4>Валютный расчёт</h4><div class="fx-rate-slot"></div><div class="fx-readout"><div><span>Стоимость</span><strong data-fx="price"></strong></div><div><span>Текущий курс</span><strong data-fx="rate"></strong></div><div><span>Оплачено</span><strong data-fx="paid"></strong></div><div><span>Фактически вложено</span><strong data-fx="invested"></strong></div><div><span>Осталось</span><strong data-fx="left"></strong></div><div><span>Остаток по текущему курсу</span><strong data-fx="left-rub"></strong></div></div><p class="fx-shift" hidden></p><div class="fx-history"></div><button type="button" class="ghost-button fx-add-leg">+ Добавить валютную часть</button><div class="fx-pay-panel" hidden><div class="fx-pay-grid"><label>Дата платежа<input name="fx-pay-date" type="date" value="' + isoDate(today) + '"></label><label>Сумма платежа в валюте<input name="fx-pay-amount" inputmode="decimal" autocomplete="off"></label><label>Валюта<select name="fx-pay-currency" data-currency-catalog="1"><option>' + esc(asset.currency && asset.currency !== 'RUB' ? asset.currency : 'AED') + '</option></select></label><label>Курс к рублю на дату платежа<input name="fx-pay-rate" inputmode="decimal" autocomplete="off"></label><label>Эквивалент платежа в рублях<input name="fx-pay-rub" inputmode="decimal" autocomplete="off" readonly></label></div><button type="button" class="primary-button fx-pay-save">Сохранить платёж</button></div></div>');
    const block = form.querySelector('.fx-calc');
    form._fxPayments = [];
    if (asset.priorRate != null && asset.priorRate !== '') block.dataset.priorRate = asset.priorRate;
    function placeRate() {
      if (!rateWrap || !block) return;
      const foreign = selectedCode(form) !== 'RUB' && selectedCode(form) !== '';
      if (foreign) {
        rateWrap.hidden = false;
        block.querySelector('.fx-rate-slot').appendChild(rateWrap);
      } else if (rateHome) rateHome.insertBefore(rateWrap, rateNext);
    }
    const payPanel = block.querySelector('.fx-pay-panel');
    const payAmount = block.querySelector('[name="fx-pay-amount"]');
    const payRate = block.querySelector('[name="fx-pay-rate"]');
    const payRub = block.querySelector('[name="fx-pay-rub"]');
    const payCurrency = block.querySelector('[name="fx-pay-currency"]');
    function payCode() {
      return (payCurrency && payCurrency.value) || selectedCode(form) || '';
    }
    function refillPay() {
      const amount = num(payAmount.value);
      const rate = num(payRate.value);
      if (payRub.dataset.manual === '1') return;
      payRub.value = rate > 0 ? formatMoneyInput(roundMoney(amount * rate)) : '';
    }
    payAmount.addEventListener('input', refillPay);
    payRate.addEventListener('input', refillPay);
    payRub.addEventListener('input', function () { payRub.dataset.manual = '1'; });
    block.querySelector('.fx-add-leg').addEventListener('click', function () {
      const code = selectedCode(form);
      if (payCurrency && code && code !== 'RUB') {
        if (![...payCurrency.options].some(function (option) { return option.value === code; })) payCurrency.add(new Option(code, code));
        payCurrency.value = code;
        if (payCurrency._currencyRefresh) payCurrency._currencyRefresh();
      }
      payPanel.hidden = false;
      payRub.dataset.manual = '';
      refillPay();
    });
    block.querySelector('.fx-pay-save').addEventListener('click', function () {
      const date = block.querySelector('[name="fx-pay-date"]').value;
      const amount = num(payAmount.value);
      const rate = num(payRate.value);
      const code = payCode();
      if (!code || code === 'RUB') { alert('Выберите валюту платежа.'); return; }
      if (!date) { alert('Укажите дату платежа.'); return; }
      if (!(amount > 0)) { alert('Укажите сумму платежа.'); return; }
      if (!(rate > 0)) { alert('Укажите курс на дату платежа.'); return; }
      const rubles = payRub.dataset.manual === '1' && payRub.value.trim() !== '' ? num(payRub.value) : roundMoney(amount * rate);
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
      payRub.dataset.manual = '';
      payPanel.hidden = true;
      paint(form);
    });
    form.addEventListener('input', function (event) {
      if (event.target && (event.target.name === 'fx-amount' || event.target.name === 'fx-rate' || event.target.name === 'price' || event.target.name === 'paid' || event.target.name === 'currentRate')) paint(form);
    });
    form.addEventListener('change', function (event) {
      if (!event.target) return;
      if (event.target.name === 'currency' || event.target.name === 'fx-currency' || event.target.name === 'payment-status') {
        placeRate();
        paint(form);
      }
      if (event.target === rateField) {
        const next = num(rateField.value);
        const started = num(block.dataset.rateFocus);
        if (started > 0 && next > 0 && Math.abs(started - next) > 1e-9) block.dataset.priorRate = String(started);
        paint(form);
      }
    });
    if (rateField) rateField.addEventListener('focus', function () {
      if (!num(block.dataset.priorRate)) block.dataset.rateFocus = String(num(rateField.value) || '');
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
      const rateBefore = num(asset.currentRate);
      const sessionPrior = num(block.dataset.priorRate);
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
      const nextRate = num(saved.currentRate);
      if (rateBefore > 0 && Math.abs(rateBefore - nextRate) > 1e-9) saved.priorRate = rateBefore;
      else if (!(num(saved.priorRate) > 0) && sessionPrior > 0 && Math.abs(sessionPrior - nextRate) > 1e-9) saved.priorRate = sessionPrior;
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
      saved.paid = assetPaid(saved);
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
    const suggested = leg ? num(leg.currentRate) : ownRate(asset, currency, asset.currentRate);
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Платёж · ' + esc(currency) + '</h2><button class="close" type="button" onclick="closeModal()">×</button></div><form id="fx-pay-form"><div class="modal-body"><div class="form-grid"><div class="form-field"><label>Дата платежа</label><input name="payDate" type="date" value="' + isoDate(today) + '"></div><div class="form-field"><label>Сумма платежа в валюте</label><input name="fxPayAmount" inputmode="decimal" autocomplete="off"></div>' + (foreign ? '<div class="form-field"><label>Фактический курс платежа</label><input name="fxPayRate" inputmode="decimal" autocomplete="off" value="' + esc(suggested ? String(suggested).replace('.', ',') : '') + '"></div><div class="form-field"><label>Фактически оплачено в рублях</label><input name="rubActual" inputmode="decimal" autocomplete="off"></div>' : '') + '</div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Сохранить платёж</button></div></form></div></div>';
    const form = document.getElementById('fx-pay-form');
    const amountInput = form.querySelector('[name="fxPayAmount"]');
    const rateInput = form.querySelector('[name="fxPayRate"]');
    const rubInput = form.querySelector('[name="rubActual"]');
    let rubTouched = false;
    function refill() {
      if (!foreign || !rubInput || rubTouched) return;
      const amount = num(amountInput.value);
      const rate = num(rateInput && rateInput.value);
      rubInput.value = rate > 0 ? formatMoneyInput(roundMoney(amount * rate)) : '';
    }
    if (amountInput) amountInput.addEventListener('input', refill);
    if (rateInput) rateInput.addEventListener('input', refill);
    if (rubInput) rubInput.addEventListener('input', function () { rubTouched = true; });
    form.onsubmit = function (event) {
      event.preventDefault();
      const amount = num(amountInput.value);
      const rate = rateInput ? num(rateInput.value) : 1;
      const date = form.querySelector('[name="payDate"]').value;
      if (!date) { alert('Укажите дату платежа.'); return; }
      if (!(amount > 0)) { alert('Укажите сумму платежа.'); return; }
      if (foreign && !(rate > 0)) { alert('Укажите фактический курс платежа.'); return; }
      const rubles = foreign ? (rubTouched && rubInput.value.trim() !== '' ? num(rubInput.value) : roundMoney(amount * rate)) : amount;
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

  window.fxAssetCardHtml = function (asset) {
    const currency = (asset && asset.currency) || 'RUB';
    if (!currency || currency === 'RUB') return '';
    const payments = fxPaidPayments(asset, [], currency);
    const paid = payments.reduce(function (sum, payment) { return sum + paymentAmount(payment); }, 0);
    const invested = payments.reduce(function (sum, payment) { return sum + paymentRubles(payment); }, 0);
    const left = Math.max(0, assetRemaining(asset));
    const rate = ownRate(asset, currency, asset.currentRate);
    return '<div class="fx-asset-facts"><div><span>Стоимость</span><strong>' + esc(moneyFx(asset.price, currency)) + '</strong></div><div><span>Оплачено</span><strong>' + esc(moneyFx(paid, currency)) + '</strong></div><div><span>Фактически вложено</span><strong>' + esc(rubExact(invested)) + '</strong></div><div><span>Осталось</span><strong>' + esc(moneyFx(left, currency)) + '</strong></div><div><span>Текущий курс</span><strong>' + esc(rateFx(rate)) + '</strong></div><div><span>Остаток по текущему курсу</span><strong>' + esc(rate > 0 ? rubExact(left * rate) : 'курс не задан') + '</strong></div></div>' + historyHtml(payments, currency);
  };

  function cardExtra(asset) {
    return window.fxAssetCardHtml(asset);
  }

  if (typeof compactObligationCard === 'function') {
    const baseCard = compactObligationCard;
    compactObligationCard = function (item) {
      const html = baseCard(item);
      if (!item || !item.asset) return html;
      const extra = cardExtra(item.asset);
      if (!extra) return html;
      const history = extra.match(/<div class="compact-payment[\s\S]*$/) ? extra : '';
      const head = history ? extra.slice(0, extra.length - history.length) : extra;
      let next = html.replace('<button class="all-payments-toggle"', head + '<button class="all-payments-toggle"');
      if (history) next = next.replace('</div></article>', history + '</div></article>');
      return next;
    };
  }

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
