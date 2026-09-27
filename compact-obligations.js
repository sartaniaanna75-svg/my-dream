function markObligationPayment(kind, ownerId, paymentId) {
  if (kind === 'asset') {
    if (typeof openPaymentFact === 'function') { openPaymentFact(ownerId, paymentId); return; }
    const asset = state.assets.find(function (item) { return item.id === ownerId; });
    const payment = asset && assetPayments(asset).find(function (item) { return item.id === paymentId; });
    if (payment) {
      if (asset.paidBase === undefined) asset.paidBase = num(asset.paid);
      payment.status = 'Оплачено';
      asset.paid = assetPaid(asset);
    }
  } else {
    const debt = state.debts.find(function (item) { return item.id === ownerId; });
    if (debt) debt.paid = num(debt.paid) + num(debt.nextAmount);
  }
  save();
  render();
}
window.markObligationPayment = markObligationPayment;

function toggleObligationPayments(id, button) {
  const list = document.getElementById('obligation-payments-' + id);
  if (!list) return;
  const open = list.classList.toggle('is-open');
  button.textContent = open ? 'Скрыть платежи ↑' : 'Все платежи (' + list.dataset.count + ') ↓';
}
window.toggleObligationPayments = toggleObligationPayments;

function obligationDateWithYear(value) {
  return dateText(value);
}

function compactObligationCard(item) {
  const all = item.allPayments || [];
  const upcoming = all.filter(function (payment) { return payment.status !== 'Оплачено'; }).sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
  const paid = all.filter(function (payment) { return payment.status === 'Оплачено'; }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  const next = upcoming[0];
  const ownerId = item.kind === 'asset' && item.asset ? item.asset.id : item.id;
  const showMoney = function (amount) {
    const currency = item.asset && item.asset.currency;
    if (currency && currency !== 'RUB' && typeof moneyOriginal === 'function') return moneyOriginal(amount, currency);
    return rub(amount);
  };
  const currency = (item.asset && item.asset.currency) || 'RUB';
  const cabinetRate = function (code) {
    if (!code || code === 'RUB') return 1;
    const rate = typeof currentFx === 'function' ? currentFx(item.asset, code) : num(state.fx && state.fx[code]);
    return rate > 0 ? rate : 0;
  };
  const rubNow = function (amount, code) {
    const rate = cabinetRate(code);
    if (!(rate > 0)) return '';
    return rub(roundMoney(num(amount) * rate));
  };
  const prepareBlock = function () {
    if (!currency || currency === 'RUB' || !(item.remaining > 0)) return '';
    const rate = cabinetRate(currency);
    const rateText = rate > 0 ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate) : '';
    const line = rate > 0 ? showMoney(item.remaining) + ' <span>≈ ' + rubNow(item.remaining, currency) + '</span>' : showMoney(item.remaining);
    const note = rate > 0 ? 'по текущему курсу ' + currency + ': ' + rateText + ' ₽' : 'курс не задан в Настройках → Курсы валют';
    return '<div class="ob-prepare"><span>Осталось подготовить</span><strong>' + line + '</strong><small>' + note + '</small></div>';
  };
  const paymentRub = function (amount, code) {
    const used = code && code !== 'RUB' ? code : currency;
    if (!used || used === 'RUB') return '';
    const text = rubNow(amount, used);
    return text ? '<em class="fx-rub-line">≈ ' + text + '</em>' : '<em class="fx-rub-line">курс не задан</em>';
  };
  const displayStatus = function (entry) {
    if (entry.status === 'Оплачено') return 'Оплачено';
    if (entry.status === 'Просрочено' || (entry.date && daysFromNow(entry.date) < 0)) return 'Просрочено';
    return 'Предстоит';
  };
  const payment = function (entry) {
    const status = displayStatus(entry);
    const paidOne = entry.status === 'Оплачено';
    const amount = paidOne && entry.paidAmount != null && entry.paidAmount !== '' ? entry.paidAmount : entry.amount;
    if (paidOne) {
      const when = obligationDateWithYear(entry.paidDate || entry.date);
      return '<div class="compact-payment compact-paid"><strong>✓ ' + showMoney(amount) + ' · ' + when + ' · Оплачено</strong></div>';
    }
    const overdue = status === 'Просрочено';
    return '<div class="compact-payment' + (overdue ? ' compact-overdue' : '') + '"><div><strong>' + showMoney(entry.amount) + '</strong><span>' + dateText(entry.date) + '</span></div><em class="compact-status">' + status + '</em></div>';
  };
  const history = paid.length ? '<div class="payment-group"><h4>Оплаченные</h4>' + paid.map(payment).join('') + '</div>' : '';
  const future = upcoming.length ? '<div class="payment-group"><h4>Предстоящие</h4>' + upcoming.map(payment).join('') + '</div>' : '';
  const nextOverdue = next && displayStatus(next) === 'Просрочено';
  const nextBlock = next
    ? '<div class="nearest-payment' + (nextOverdue ? ' is-overdue' : '') + '"><div><small>' + item.what + '</small><strong>' + showMoney(next.amount) + '</strong>' + paymentRub(next.amount, next.currency) + '<span>' + obligationDateWithYear(next.date) + ' · ' + ((next.currency) || currency) + ' · ' + displayStatus(next) + '</span></div><button class="primary-button compact-paid-button" onclick="markObligationPayment(\'' + item.kind + '\',\'' + ownerId + '\',\'' + next.id + '\')">Оплачено</button></div>'
    : (item.remaining <= 0 ? '<div class="fully-paid-badge">✓ Полностью оплачено</div>' : '<div class="no-payment-schedule">Будущие платежи не добавлены</div>');
  return '<article class="obligation-card compact-obligation-card"><div class="obligation-card-head"><div><h3>' + item.what + '</h3><span>' + (item.who || '') + '</span></div><span class="tag tag-blue">' + (item.kind === 'asset' ? 'Из имущества' : 'Вручную') + '</span></div><div class="ob-metrics"><div><span>Стоимость</span><strong>' + showMoney(item.total) + '</strong></div><div><span>Оплачено</span><strong>' + showMoney(item.paid) + '</strong></div><div><span>Осталось</span><strong class="danger">' + showMoney(item.remaining) + '</strong></div></div>' + prepareBlock() + nextBlock + '<button class="all-payments-toggle" type="button" onclick="toggleObligationPayments(\'' + item.id + '\',this)">Все платежи (' + all.length + ') ↓</button><div class="all-obligation-payments" id="obligation-payments-' + item.id + '" data-count="' + all.length + '">' + future + history + '</div></article>';
}

var obligationPeriod = 'days';

function obligationTitle(item) {
  const name = item && item.what ? String(item.what).trim() : '';
  if (name) return name;
  if (item && item.asset) {
    const description = String(item.asset.description || '').trim();
    if (description) return description;
    if (item.asset.type) return item.asset.type;
  }
  return 'Объект';
}

function unpaidObligation(payment) {
  if (!payment || !payment.date) return false;
  const status = payment.status || 'Предстоит';
  return status !== 'Оплачено' && status !== 'Отменён';
}

function paymentCode(item, payment) {
  if (payment && payment.currency) return payment.currency;
  if (item && item.kind === 'manual') return 'RUB';
  return (item && item.asset && item.asset.currency) || 'RUB';
}

function paymentRate(item, code) {
  if (!code || code === 'RUB') return 1;
  const rate = typeof currentFx === 'function' ? currentFx(item && item.asset, code) : num(state.fx && state.fx[code]);
  return rate > 0 ? rate : 0;
}

function paymentRubAmount(item, payment) {
  const code = paymentCode(item, payment);
  const amount = num(payment.amount);
  if (code === 'RUB') return roundMoney(amount);
  const rate = paymentRate(item, code);
  if (!(rate > 0)) return null;
  return roundMoney(amount * rate);
}

function moneyInCode(amount, code) {
  if (!code || code === 'RUB') return rub(amount);
  if (typeof moneyOriginal === 'function') return moneyOriginal(amount, code);
  return rub(amount);
}

function rateCaption(code, rate) {
  if (!code || code === 'RUB' || !(rate > 0)) return '';
  const text = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate);
  return 'Курс: 1 ' + code + ' = ' + text + ' ₽';
}

function shiftIso(days) {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function obligationWindow(key) {
  if (key === 'month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { key: key, from: isoDate(from), to: isoDate(to), title: 'Этот месяц' };
  }
  if (key === 'next') {
    const from = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return { key: key, from: isoDate(from), to: isoDate(to), title: 'Следующий месяц' };
  }
  return { key: 'days', from: '0000-01-01', to: shiftIso(30), title: 'Ближайшие 30 дней' };
}

function duePayments(items, window) {
  const rows = [];
  items.forEach(function (item) {
    (item.allPayments || []).forEach(function (payment) {
      if (!unpaidObligation(payment)) return;
      if (payment.date < window.from || payment.date > window.to) return;
      const code = paymentCode(item, payment);
      const rate = paymentRate(item, code);
      rows.push({
        item: item,
        payment: payment,
        title: obligationTitle(item),
        code: code,
        rate: rate,
        rub: paymentRubAmount(item, payment)
      });
    });
  });
  rows.sort(function (a, b) {
    const byDate = String(a.payment.date).localeCompare(String(b.payment.date));
    if (byDate) return byDate;
    return a.title.localeCompare(b.title, 'ru');
  });
  return rows;
}

function attentionPhrase(date) {
  const days = daysFromNow(date);
  const work = businessDaysUntil(date);
  if (days < 0) return 'Платёж просрочен';
  if (days === 0) return 'Оплатить сегодня';
  if (work === 1) return 'Через 1 рабочий день';
  if (work === 2) return 'Через 2 рабочих дня';
  return '';
}

function periodSwitch(window) {
  const buttons = [
    ['days', 'Ближайшие 30 дней'],
    ['month', 'Этот месяц'],
    ['next', 'Следующий месяц']
  ];
  return '<div class="obligation-period">' + buttons.map(function (button) {
    return '<button type="button" class="' + (window.key === button[0] ? 'is-on' : '') + '" onclick="setObligationPeriod(\'' + button[0] + '\')">' + button[1] + '</button>';
  }).join('') + '</div>';
}

function dueList(rows, totalRub, missingRate) {
  if (!rows.length) {
    return '<section class="obligation-due panel"><p class="eyebrow">ЧТО НУЖНО ОПЛАТИТЬ</p><h3>Платежи периода</h3><div class="rent-empty">В выбранном периоде неоплаченных платежей нет</div></section>';
  }
  let running = 0;
  const body = rows.map(function (row) {
    if (row.rub != null) running = roundMoney(running + row.rub);
    return { row: row, phrase: attentionPhrase(row.payment.date), running: running };
  });
  const reserve = dueList.reserve || 0;
  const html = body.map(function (entry) {
    const row = entry.row;
    const foreign = row.code !== 'RUB';
    const original = moneyInCode(row.payment.amount, row.code);
    const rubLine = foreign ? (row.rub == null ? '<em class="fx-rub-line">курс не задан</em>' : '<em class="fx-rub-line">≈ ' + rub(row.rub) + '</em>') : '';
    const course = foreign ? '<small>' + escText(rateCaption(row.code, row.rate) || 'курс не задан в Настройках → Курсы валют') + '</small>' : '';
    const shortfall = entry.running > reserve ? roundMoney(entry.running - reserve) : 0;
    const hot = entry.phrase && shortfall > 0;
    const warn = entry.phrase ? '<em class="due-warn">' + (hot ? '⚠ ' : '') + escText(entry.phrase) + '</em>' : '';
    const lack = hot ? '<span class="due-lack">Не хватает: ' + rub(shortfall) + '</span>' : '';
    return '<article class="due-row' + (hot ? ' is-hot' : '') + '"><time>' + fullDate(row.payment.date) + '</time><div><b>' + escText(row.title) + '</b><strong>' + original + '</strong>' + rubLine + course + warn + lack + '</div></article>';
  }).join('');
  const note = missingRate ? '<small>Для части платежей курс не задан, они не вошли в рублёвый итог.</small>' : '';
  return '<section class="obligation-due panel"><p class="eyebrow">ЧТО НУЖНО ОПЛАТИТЬ</p><h3>Платежи по датам</h3><div class="due-list">' + html + '</div><div class="due-foot"><span>Всего платежей: <b>' + rows.length + '</b></span><span>Всего подготовить: <b>' + rub(totalRub) + '</b></span></div>' + note + '</section>';
}

function compactDebtsView() {
  const active = obligations();
  const activeAssetIds = {};
  active.forEach(function (item) { if (item.kind === 'asset' && item.asset) activeAssetIds[item.asset.id] = true; });
  const completed = state.assets.filter(function (asset) { return assetRemaining(asset) <= 0 && !activeAssetIds[asset.id]; }).map(function (asset) { return { kind: 'asset', id: asset.id, asset: asset, what: asset.name, who: asset.owner || asset.description, total: num(asset.price), paid: assetPaid(asset), remaining: 0, allPayments: assetPayments(asset) }; });
  const cover = typeof financialCoverage === 'function' ? financialCoverage() : null;
  const available = cover ? cover.reserve : num(totals().cash) + num(totals().safe);
  const total = cover ? cover.due : active.reduce(function (sum, item) { return sum + (typeof obligationRemainingRub === 'function' ? obligationRemainingRub(item) : item.remaining); }, 0);
  const horizon = obligationWindow(obligationPeriod);
  const rows = duePayments(active, horizon);
  let periodRub = 0;
  let missingRate = false;
  rows.forEach(function (row) {
    if (row.rub == null) missingRate = true;
    else periodRub = roundMoney(periodRub + row.rub);
  });
  const gap = roundMoney(periodRub - available);
  const covered = gap <= 0;
  const countLabel = rows.length + ' ' + plural(rows.length, 'платёж', 'платежа', 'платежей');
  const outsideOverdue = obligationPeriod === 'days' ? 0 : active.reduce(function (sum, item) {
    return sum + (item.allPayments || []).filter(function (payment) {
      return unpaidObligation(payment) && payment.date < isoDate(today) && payment.date < horizon.from;
    }).length;
  }, 0);
  const overdueNote = outsideOverdue ? '<p class="due-outside">Просроченных платежей вне этого периода: ' + outsideOverdue + '. Они видны в режиме «Ближайшие 30 дней».</p>' : '';
  const summary = '<div class="obligation-summary">' +
    '<div class="obligation-summary-item"><span>Финансовый резерв</span><strong>' + rub(available) + '</strong><small>только деньги с разрешением на оплату</small></div>' +
    '<div class="obligation-summary-item"><span>Все обязательства</span><strong>' + rub(total) + '</strong><small>осталось оплатить по всем договорам</small></div>' +
    '<div class="obligation-summary-item summary-next"><span>Ближайшие платежи</span><strong>' + rub(periodRub) + '</strong><small>' + escText(horizon.title) + ' · ' + countLabel + (missingRate ? ' · курс не задан для части платежей' : '') + '</small></div>' +
    '<div class="obligation-summary-item ' + (covered ? 'summary-good' : 'summary-danger') + '"><span>Нужно обеспечить</span><strong>' + (covered ? 'Средств достаточно' : rub(gap)) + '</strong><small>' + (covered ? 'остаток резерва ' + rub(roundMoney(available - periodRub)) : 'не хватает на платежи выбранного периода') + '</small></div>' +
    '</div>';
  dueList.reserve = available;
  return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</p><h2>Обязательства</h2><p>Сколько денег и к каким датам нужно подготовить по всем обязательствам</p></div><button class="primary-button" onclick="openForm(\'debt\')">＋ Добавить обязательство</button></div>' + periodSwitch(horizon) + summary + overdueNote + dueList(rows, periodRub, missingRate) + '<div class="obligation-cards">' + (active.length ? active.map(compactObligationCard).join('') : '<div class="panel empty">Активных обязательств нет</div>') + '</div>' + (completed.length ? '<details class="completed-obligations"><summary>Завершённые (' + completed.length + ')</summary><div class="obligation-cards">' + completed.map(compactObligationCard).join('') + '</div></details>' : '') + '</div>';
}

window.setObligationPeriod = function (key) {
  obligationPeriod = key === 'month' || key === 'next' ? key : 'days';
  if (typeof activeView !== 'undefined' && activeView === 'debts') render();
};

debts = compactDebtsView;
if (typeof activeView !== 'undefined' && activeView === 'debts') render();
