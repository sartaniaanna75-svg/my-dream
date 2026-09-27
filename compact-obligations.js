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
  const fxNote = item.asset && item.asset.currency && item.asset.currency !== 'RUB' && typeof rubApprox === 'function' ? '<p class="fx-obligation-note">Стоимость сегодня ' + rubApprox(item.total, item.asset.currency, item.asset) + (typeof actualSpentText === 'function' ? ' · реально потрачено ' + actualSpentText(item.asset) : '') + '</p>' : '';
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
    ? '<div class="nearest-payment' + (nextOverdue ? ' is-overdue' : '') + '"><div><small>' + item.what + '</small><strong>' + showMoney(next.amount) + '</strong><span>' + obligationDateWithYear(next.date) + ' · ' + ((next.currency) || (item.asset && item.asset.currency) || 'RUB') + ' · ' + displayStatus(next) + '</span></div><button class="primary-button compact-paid-button" onclick="markObligationPayment(\'' + item.kind + '\',\'' + ownerId + '\',\'' + next.id + '\')">Оплачено</button></div>'
    : (item.remaining <= 0 ? '<div class="fully-paid-badge">✓ Полностью оплачено</div>' : '<div class="no-payment-schedule">Будущие платежи не добавлены</div>');
  return '<article class="obligation-card compact-obligation-card"><div class="obligation-card-head"><div><h3>' + item.what + '</h3><span>' + (item.who || '') + '</span></div><span class="tag tag-blue">' + (item.kind === 'asset' ? 'Из имущества' : 'Вручную') + '</span></div><div class="ob-metrics"><div><span>Стоимость</span><strong>' + showMoney(item.total) + '</strong></div><div><span>Оплачено</span><strong>' + showMoney(item.paid) + '</strong></div><div><span>Осталось</span><strong class="danger">' + showMoney(item.remaining) + '</strong></div></div>' + fxNote + nextBlock + '<button class="all-payments-toggle" type="button" onclick="toggleObligationPayments(\'' + item.id + '\',this)">Все платежи (' + all.length + ') ↓</button><div class="all-obligation-payments" id="obligation-payments-' + item.id + '" data-count="' + all.length + '">' + future + history + '</div></article>';
}

function nearestObligationPayment(items) {
  const found = [];
  items.forEach(function (item) {
    (item.allPayments || []).forEach(function (payment) {
      if (payment.status === 'Оплачено' || !payment.date) return;
      found.push({ item: item, payment: payment });
    });
  });
  found.sort(function (a, b) { return String(a.payment.date).localeCompare(String(b.payment.date)); });
  return found[0] || null;
}

function compactDebtsView() {
  const active = obligations();
  const activeAssetIds = {};
  active.forEach(function (item) { if (item.kind === 'asset' && item.asset) activeAssetIds[item.asset.id] = true; });
  const completed = state.assets.filter(function (asset) { return assetRemaining(asset) <= 0 && !activeAssetIds[asset.id]; }).map(function (asset) { return { kind: 'asset', id: asset.id, asset: asset, what: asset.name, who: asset.owner || asset.description, total: num(asset.price), paid: assetPaid(asset), remaining: 0, allPayments: assetPayments(asset) }; });
  const cover = typeof financialCoverage === 'function' ? financialCoverage() : null;
  const available = cover ? cover.reserve : num(totals().cash) + num(totals().safe);
  const total = cover ? cover.due : active.reduce(function (sum, item) { return sum + (typeof obligationRemainingRub === 'function' ? obligationRemainingRub(item) : item.remaining); }, 0);
  const need = cover ? cover.need : Math.max(0, total - available);
  const nearest = nearestObligationPayment(active);
  const nearestMoney = nearest ? (function () {
    const currency = nearest.item.asset && nearest.item.asset.currency;
    if (currency && currency !== 'RUB' && typeof moneyOriginal === 'function') return moneyOriginal(nearest.payment.amount, currency);
    return rub(nearest.payment.amount);
  })() : '—';
  const summary = '<div class="obligation-summary">' +
    '<div class="obligation-summary-item"><span>Финансовый резерв</span><strong>' + rub(available) + '</strong><small>только деньги с разрешением на оплату</small></div>' +
    '<div class="obligation-summary-item"><span>Все обязательства</span><strong>' + rub(total) + '</strong><small>осталось оплатить</small></div>' +
    '<div class="obligation-summary-item summary-next"><span>Ближайший платёж</span><strong>' + nearestMoney + '</strong>' + (nearest ? '<small>' + dateText(nearest.payment.date) + '</small><b class="summary-object">' + nearest.item.what + '</b>' : '<small>платежей нет</small>') + '</div>' +
    '<div class="obligation-summary-item ' + (need ? 'summary-danger' : 'summary-good') + '"><span>Нужно обеспечить</span><strong>' + rub(need) + '</strong><small>' + (need ? 'не хватает для покрытия обязательств' : 'денег достаточно') + '</small></div>' +
    '</div>';
  return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</p><h2>Обязательства</h2><p>Компактный контроль ближайших платежей</p></div><button class="primary-button" onclick="openForm(\'debt\')">＋ Добавить обязательство</button></div>' + summary + '<div class="obligation-cards">' + (active.length ? active.map(compactObligationCard).join('') : '<div class="panel empty">Активных обязательств нет</div>') + '</div>' + (completed.length ? '<details class="completed-obligations"><summary>Завершённые (' + completed.length + ')</summary><div class="obligation-cards">' + completed.map(compactObligationCard).join('') + '</div></details>' : '') + '</div>';
}

debts = compactDebtsView;
if (typeof activeView !== 'undefined' && activeView === 'debts') render();
