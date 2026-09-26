function markObligationPayment(kind, ownerId, paymentId) {
  if (kind === 'asset') {
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
  button.textContent = open ? 'Скрыть платежи ▲' : 'Все платежи (' + list.querySelectorAll('.compact-payment').length + ') ▼';
}
window.toggleObligationPayments = toggleObligationPayments;

function compactObligationCard(item) {
  const all = item.allPayments || [];
  const upcoming = all.filter(function (payment) { return payment.status !== 'Оплачено'; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  const paid = all.filter(function (payment) { return payment.status === 'Оплачено'; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  const next = upcoming[0];
  const ownerId = item.kind === 'asset' && item.asset ? item.asset.id : item.id;
  const payment = function (entry) { return '<div class="compact-payment ' + (entry.status === 'Оплачено' ? 'compact-paid' : '') + '"><div><strong>' + (entry.status === 'Оплачено' ? '✓ ' : '') + rub(entry.amount) + '</strong><span>' + dateText(entry.date) + '</span></div><span class="compact-status">' + (entry.status === 'Оплачено' ? 'Оплачено' : 'Предстоит') + '</span></div>'; };
  const history = paid.length ? '<div class="payment-group"><h4>История оплаченных</h4>' + paid.map(payment).join('') + '</div>' : '';
  const future = upcoming.length ? '<div class="payment-group"><h4>Предстоящие</h4>' + upcoming.map(payment).join('') + '</div>' : '';
  const nextBlock = next ? '<div class="nearest-payment"><div><small>Ближайший платёж</small><strong>' + rub(next.amount) + '</strong><span>' + dateText(next.date) + '</span></div><button class="primary-button compact-paid-button" onclick="markObligationPayment(\'' + item.kind + '\',\'' + ownerId + '\',\'' + next.id + '\')">Оплачено</button></div>' : (item.remaining <= 0 ? '<div class="fully-paid-badge">✓ Полностью оплачено</div>' : '<div class="no-payment-schedule">Будущие платежи не добавлены</div>');
  return '<article class="obligation-card compact-obligation-card"><div class="obligation-card-head"><div><p class="eyebrow">' + (item.kind === 'asset' ? 'ИМУЩЕСТВО' : 'РУЧНОЕ ОБЯЗАТЕЛЬСТВО') + '</p><h3>' + item.what + '</h3><span>' + item.who + '</span></div><span class="tag tag-blue">' + (item.kind === 'asset' ? 'Из имущества' : 'Вручную') + '</span></div><div class="obligation-totals"><div><span>Стоимость</span><strong>' + rub(item.total) + '</strong></div><div><span>Оплачено</span><strong>' + rub(item.paid) + '</strong></div><div><span>Осталось оплатить</span><strong class="danger">' + rub(item.remaining) + '</strong></div></div>' + nextBlock + '<button class="all-payments-toggle" onclick="toggleObligationPayments(\'' + item.id + '\',this)">Все платежи (' + all.length + ') ▼</button><div class="all-obligation-payments" id="obligation-payments-' + item.id + '">' + future + history + '</div></article>';
}

function compactDebtsView() {
  const active = obligations();
  const completed = state.assets.filter(function (asset) { return assetRemaining(asset) <= 0; }).map(function (asset) { return { kind: 'asset', id: asset.id, what: asset.name, who: asset.owner || asset.description, total: num(asset.price), paid: assetPaid(asset), remaining: 0, allPayments: assetPayments(asset) }; });
  const cash = state.accounts.reduce(function (sum, account) { return sum + num(account.balance); }, 0);
  const total = active.reduce(function (sum, item) { return sum + item.remaining; }, 0);
  const need = Math.max(0, total - cash);
  const summary = '<div class="obligation-summary"><div class="obligation-summary-item"><span>Доступно на картах и счетах</span><strong>' + rub(cash) + '</strong></div><div class="obligation-summary-item"><span>Всего обязательств</span><strong>' + rub(total) + '</strong></div><div class="obligation-summary-item"><span>Ближайший платёж</span><strong>См. в карточках</strong></div><div class="obligation-summary-item ' + (need ? 'summary-danger' : 'summary-good') + '"><span>Нужно обеспечить</span><strong>' + (need ? 'Нужно обеспечить ещё: ' + rub(need) : 'Средств достаточно') + '</strong></div></div>';
  return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</p><h2>Обязательства</h2><p>Компактный контроль ближайших платежей</p></div><button class="primary-button" onclick="openForm(\'debt\')">＋ Добавить обязательство</button></div>' + summary + '<div class="obligation-cards">' + (active.length ? active.map(compactObligationCard).join('') : '<div class="panel empty">Активных обязательств нет</div>') + '</div>' + (completed.length ? '<details class="completed-obligations"><summary>Завершённые (' + completed.length + ')</summary><div class="obligation-cards">' + completed.map(compactObligationCard).join('') + '</div></details>' : '') + '</div>';
}

debts = compactDebtsView;
if (typeof activeView !== 'undefined' && activeView === 'debts') render();
