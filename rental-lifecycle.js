(function () {
  const ENDING_DAYS = 30;
  const REASONS = ['окончание договора', 'арендатор съехал', 'досрочное расторжение', 'другое'];
  const DEPOSIT_RETURNS = ['возвращён полностью', 'возвращён частично', 'удержан', 'залога не было'];
  const PERIODS = ['Месяц', 'Квартал', 'Год', 'Другой период'];

  function esc(value) {
    return escText(value);
  }

  function usageOf(asset) {
    return (asset && (asset.usage || asset.usageStatus)) || '';
  }

  function isRented(asset) {
    return usageOf(asset) === 'Сдаётся в аренду';
  }

  function isIntent(asset) {
    if (!asset) return false;
    const usage = usageOf(asset);
    if (usage === 'Планируется сдача в аренду' || usage === 'Сдаётся в аренду') return true;
    if ((asset.rentHistory || []).length || (asset.rentVacancies || []).length) return true;
    return !!(asset.rent && asset.rent.planned && usage === 'Не используется / свободно');
  }

  function assetTitle(asset) {
    return asset.name || asset.type || 'Объект';
  }

  function shiftDate(iso, days) {
    const date = new Date(iso + 'T12:00:00');
    date.setDate(date.getDate() + days);
    return isoDate(date);
  }

  function daysSpan(start, end) {
    if (!start || !end || end < start) return 0;
    return Math.round((new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000) + 1;
  }

  function daysWord(count) {
    return plural(count, 'день', 'дня', 'дней');
  }

  function monthStep(date, periodicity) {
    if (periodicity === 'Год') date.setFullYear(date.getFullYear() + 1);
    else if (periodicity === 'Квартал') date.setMonth(date.getMonth() + 3);
    else date.setMonth(date.getMonth() + 1);
  }

  function monthlyEquivalent(amount, periodicity) {
    const value = num(amount);
    if (!(value > 0)) return 0;
    if (periodicity === 'Квартал') return value / 3;
    if (periodicity === 'Год') return value / 12;
    if (periodicity === 'Другой период') return null;
    return value;
  }

  function lostBetween(amount, periodicity, start, end) {
    const monthly = monthlyEquivalent(amount, periodicity);
    if (monthly == null || !(monthly > 0) || !start || !end || end < start) return 0;
    let total = 0;
    const cursor = new Date(start + 'T12:00:00');
    const last = new Date(end + 'T12:00:00');
    while (cursor <= last) {
      const dim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      total += monthly / dim;
      cursor.setDate(cursor.getDate() + 1);
    }
    return roundMoney(total);
  }

  function moneyPair(amount, currency) {
    const code = currency || 'RUB';
    const original = typeof moneyOriginal === 'function' ? moneyOriginal(amount, code) : rub(amount);
    if (code === 'RUB' || !(num(amount) > 0)) return { original: original, hint: '', rub: num(amount) };
    const rate = typeof currentFx === 'function' ? currentFx(null, code) : 0;
    if (!(rate > 0)) return { original: original, hint: 'курс не задан в Настройках', rub: 0 };
    const rubles = roundMoney(num(amount) * rate);
    return { original: original, hint: '≈ ' + rub(rubles) + ' по текущему курсу', rub: rubles };
  }

  function moneyLine(amount, currency) {
    const pair = moneyPair(amount, currency);
    return pair.original + (pair.hint ? ' <small>' + esc(pair.hint) + '</small>' : '');
  }

  function periodWord(periodicity) {
    if (periodicity === 'Квартал') return 'в квартал';
    if (periodicity === 'Год') return 'в год';
    return 'в месяц';
  }

  function plannedStart(asset) {
    const rent = asset.rent || {};
    if (isRented(asset)) return rent.contractStart || rent.startDate || '';
    return rent.contractStart || rent.startDate || rent.nextDate || '';
  }

  function openVacancy(asset) {
    return (asset.rentVacancies || []).filter(function (item) { return item && !item.end; })[0] || null;
  }

  function remainingDebt(lease) {
    if (!lease) return 0;
    const paid = (lease.debtPayments || []).reduce(function (sum, item) { return sum + num(item.amount); }, 0);
    return Math.max(0, roundMoney(num(lease.debt) - paid));
  }

  function debtLeases(asset) {
    return (asset.rentHistory || []).filter(function (lease) { return remainingDebt(lease) > 0; });
  }

  function idleWindow(asset) {
    if (!asset || isRented(asset) || !isIntent(asset)) return null;
    const todayIso = isoDate(today);
    const vacancy = openVacancy(asset);
    const rent = asset.rent || {};
    if (vacancy) {
      const active = vacancy.start <= todayIso;
      return {
        start: vacancy.start,
        end: active ? todayIso : vacancy.start,
        active: active,
        amount: vacancy.amount,
        currency: vacancy.currency || rent.currency || 'RUB',
        periodicity: vacancy.periodicity || rent.periodicity || 'Месяц'
      };
    }
    const start = plannedStart(asset);
    if (!start || start > todayIso) return null;
    return {
      start: start,
      end: todayIso,
      active: true,
      amount: rent.amount,
      currency: rent.currency || asset.currency || 'RUB',
      periodicity: rent.periodicity || 'Месяц'
    };
  }

  function attentionOf(asset) {
    const items = [];
    if (!asset) return items;
    debtLeases(asset).forEach(function (lease) {
      items.push({
        kind: 'debt',
        lease: lease,
        text: 'Задолженность после выезда: ' + (lease.tenant || 'арендатор') + ' · ' + (moneyPair(remainingDebt(lease), lease.debtCurrency || lease.currency).original)
      });
    });
    if (isRented(asset)) {
      const end = (asset.rent && asset.rent.contractEnd) || '';
      if (end) {
        const days = daysFromNow(end);
        if (days < 0) items.push({ kind: 'ended', text: 'Срок договора истёк ' + fullDate(end) });
        else if (days <= ENDING_DAYS) items.push({ kind: 'ending', text: 'Аренда заканчивается ' + fullDate(end) });
      }
      return items;
    }
    if (!isIntent(asset)) return items;
    const idle = idleWindow(asset);
    if (idle && idle.active) {
      const days = daysSpan(idle.start, idle.end);
      const lost = lostBetween(idle.amount, idle.periodicity, idle.start, idle.end);
      items.push({
        kind: 'vacant',
        days: days,
        lost: lost,
        currency: idle.currency || 'RUB',
        text: 'Не сдано ' + days + ' ' + daysWord(days)
      });
    } else if (openVacancy(asset) || usageOf(asset) === 'Не используется / свободно') {
      items.push({ kind: 'seeking', text: 'Свободен, ищем арендатора' });
    }
    return items;
  }

  function needsAttention(asset) {
    return attentionOf(asset).length > 0;
  }

  function attentionAssets() {
    return (state.assets || []).filter(needsAttention);
  }

  function statusLabel(asset) {
    const attention = attentionOf(asset);
    if (attention.some(function (item) { return item.kind === 'ending'; })) return 'Аренда заканчивается';
    if (attention.some(function (item) { return item.kind === 'vacant' || item.kind === 'ended' || item.kind === 'seeking'; })) return 'Требует внимания';
    if (isRented(asset)) return 'Сдан в аренду';
    if (usageOf(asset) === 'Не используется / свободно') return 'Свободен / ищем арендатора';
    return 'Планируется к сдаче';
  }

  function rememberUsage(asset) {
    if (!Array.isArray(asset.statusHistory)) asset.statusHistory = [];
    const last = asset.statusHistory[asset.statusHistory.length - 1];
    if (!last || last.value !== asset.usage) asset.statusHistory.push({ date: isoDate(today), value: asset.usage });
  }

  function ensureCycle(asset) {
    if (!Array.isArray(asset.rentHistory)) asset.rentHistory = [];
    if (!Array.isArray(asset.rentVacancies)) asset.rentVacancies = [];
  }

  function addSchedule(rent) {
    if (!rent || !rent.nextDate || !(num(rent.amount) > 0) || !rent.leaseId) return;
    if (!Array.isArray(rent.payments)) rent.payments = [];
    const count = rent.periodicity === 'Год' ? 2 : rent.periodicity === 'Квартал' ? 5 : 13;
    const existing = {};
    rent.payments.forEach(function (payment) {
      if (payment.leaseId === rent.leaseId) existing[payment.date] = true;
    });
    const date = new Date(rent.nextDate + 'T12:00:00');
    for (let index = 0; index < count; index += 1) {
      const paymentDate = isoDate(date);
      if (!existing[paymentDate]) {
        rent.payments.push({
          id: uid(),
          leaseId: rent.leaseId,
          date: paymentDate,
          amount: num(rent.amount),
          currency: rent.currency || 'RUB',
          status: 'Ожидается'
        });
      }
      monthStep(date, rent.periodicity);
    }
    rent.payments.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }

  function currentPayments(asset) {
    const rent = asset.rent || {};
    const list = rent.payments || [];
    if (!rent.leaseId) return list.slice();
    return list.filter(function (payment) { return !payment.leaseId || payment.leaseId === rent.leaseId; });
  }

  function nextPayment(asset) {
    return currentPayments(asset).filter(function (payment) { return payment.status !== 'Получено' && payment.status !== 'Отменён'; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })[0] || null;
  }

  function paymentTotals(payments, cutoff) {
    const limit = cutoff || isoDate(today);
    const accrued = (payments || []).filter(function (payment) { return payment.date && payment.date <= limit; }).reduce(function (sum, payment) { return sum + num(payment.amount); }, 0);
    const received = (payments || []).filter(function (payment) { return payment.status === 'Получено'; }).reduce(function (sum, payment) { return sum + num(payment.amount); }, 0);
    return { accrued: roundMoney(accrued), received: roundMoney(received) };
  }

  function closeOpenVacancy(asset, leaseStart) {
    const vacancy = openVacancy(asset);
    if (!vacancy || !leaseStart) return;
    const end = shiftDate(leaseStart, -1);
    if (end >= vacancy.start) vacancy.end = end;
    else asset.rentVacancies = asset.rentVacancies.filter(function (item) { return item !== vacancy; });
  }

  function startLease(asset, fields) {
    ensureCycle(asset);
    const wasRented = isRented(asset);
    const previousStart = plannedStart(asset);
    const previousRent = asset.rent || {};
    if (!wasRented) {
      const receivedBefore = (previousRent.payments || []).filter(function (payment) { return payment.status === 'Получено'; });
      if (receivedBefore.length) {
        asset.rentHistory.push({
          id: previousRent.leaseId || uid(),
          tenant: previousRent.tenant || '',
          phone: previousRent.phone || '',
          amount: num(previousRent.amount),
          currency: previousRent.currency || fields.currency,
          periodicity: previousRent.periodicity || fields.period,
          start: previousRent.contractStart || previousRent.startDate || '',
          end: previousRent.contractEnd || '',
          moveOut: previousStart && fields.start && previousStart < fields.start ? shiftDate(fields.start, -1) : (previousRent.contractEnd || ''),
          reason: 'завершено до новой сдачи',
          comment: previousRent.comment || '',
          debt: 0,
          debtCurrency: previousRent.currency || fields.currency,
          debtPayments: [],
          settlement: 'Расчёт завершён',
          deposit: num(previousRent.deposit),
          accountId: previousRent.accountId || '',
          payments: JSON.parse(JSON.stringify(previousRent.payments || [])),
          status: 'Завершён'
        });
      }
      if (openVacancy(asset)) closeOpenVacancy(asset, fields.start);
      else if (previousStart && fields.start && previousStart < fields.start) {
        asset.rentVacancies.push({
          id: uid(),
          start: previousStart,
          end: shiftDate(fields.start, -1),
          amount: num(previousRent.amount) || fields.amount,
          currency: previousRent.currency || fields.currency,
          periodicity: previousRent.periodicity || fields.period
        });
      }
    }
    const leaseId = wasRented && previousRent.leaseId ? previousRent.leaseId : uid();
    const kept = wasRented ? (previousRent.payments || []).slice() : [];
    asset.usage = 'Сдаётся в аренду';
    asset.usageStatus = asset.usage;
    asset.rent = Object.assign({}, previousRent, {
      leaseId: leaseId,
      tenant: fields.tenant,
      phone: fields.phone,
      amount: fields.amount,
      currency: fields.currency,
      contractStart: fields.start,
      startDate: fields.start,
      contractEnd: fields.end,
      periodicity: fields.period,
      nextDate: fields.next || fields.start,
      comment: fields.comment,
      accountId: fields.accountId,
      planned: true,
      payments: kept
    });
    if (wasRented) {
      (asset.rent.payments || []).forEach(function (payment) {
        if (payment.status === 'Получено') return;
        payment.amount = fields.amount;
        payment.currency = fields.currency;
        if (!payment.leaseId) payment.leaseId = leaseId;
      });
    }
    addSchedule(asset.rent);
    rememberUsage(asset);
    save();
    closeModal();
    render();
  }

  function finishLease(asset, fields) {
    ensureCycle(asset);
    const rent = asset.rent || {};
    const payments = JSON.parse(JSON.stringify(rent.payments || []));
    const debt = roundMoney(num(fields.debt));
    asset.rentHistory.push({
      id: rent.leaseId || uid(),
      tenant: rent.tenant || '',
      phone: rent.phone || '',
      amount: num(rent.amount),
      currency: rent.currency || asset.currency || 'RUB',
      periodicity: rent.periodicity || 'Месяц',
      start: rent.contractStart || rent.startDate || '',
      end: rent.contractEnd || '',
      moveOut: fields.moveOut,
      reason: fields.reason,
      comment: fields.comment,
      lastPaidPeriod: fields.lastPaid,
      debt: debt,
      debtCurrency: rent.currency || asset.currency || 'RUB',
      debtPayments: [],
      settlement: debt > 0 ? 'Есть задолженность' : 'Расчёт завершён',
      depositReturn: fields.depositReturn,
      deposit: num(rent.deposit),
      accountId: rent.accountId || '',
      payments: payments,
      status: 'Завершён'
    });
    asset.rentVacancies.push({
      id: uid(),
      start: fields.moveOut ? shiftDate(fields.moveOut, 1) : isoDate(today),
      end: '',
      amount: num(rent.amount),
      currency: rent.currency || asset.currency || 'RUB',
      periodicity: rent.periodicity || 'Месяц'
    });
    asset.usage = 'Не используется / свободно';
    asset.usageStatus = asset.usage;
    asset.rent = {
      planned: true,
      periodicity: rent.periodicity || 'Месяц',
      currency: rent.currency || asset.currency || 'RUB',
      amount: num(rent.amount),
      payments: [],
      contractStart: '',
      startDate: '',
      contractEnd: '',
      nextDate: '',
      tenant: '',
      phone: '',
      comment: '',
      accountId: rent.accountId || '',
      deposit: 0,
      leaseId: ''
    };
    rememberUsage(asset);
    save();
    closeModal();
    render();
  }

  function accountOptions(selected) {
    const rows = (state.accounts || []).map(function (account) {
      const tail = account.last4 ? ' •••• ' + account.last4 : '';
      const owner = account.owner ? ' · ' + account.owner : '';
      const label = (account.bank || 'Счёт') + tail + owner + ' · ' + (account.currency || 'RUB');
      return '<option value="' + esc(account.id) + '"' + (account.id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    return '<option value="">Не выбран</option>' + rows;
  }

  function field(label, html) {
    return '<div class="form-field"><label>' + label + '</label>' + html + '</div>';
  }

  function readLeaseForm(form) {
    const currencyField = form.elements.currency;
    if (currencyField && window.currencyReady && !window.currencyReady(currencyField)) {
      alert('Выберите валюту аренды.');
      return null;
    }
    const amount = num(form.elements.amount.value);
    if (!(amount > 0)) {
      alert('Укажите сумму аренды.');
      return null;
    }
    const start = form.elements.start.value;
    if (!start) {
      alert('Укажите дату начала аренды.');
      return null;
    }
    return {
      tenant: form.elements.tenant.value.trim(),
      phone: form.elements.phone.value.trim(),
      amount: amount,
      currency: currencyField.value || 'RUB',
      start: start,
      end: form.elements.end.value,
      period: form.elements.period.value,
      next: form.elements.next.value || start,
      accountId: form.elements.accountId.value,
      comment: form.elements.comment.value.trim()
    };
  }

  const previousOpenRentLease = window.openRentLease;
  window.openRentLease = function (assetId, partId) {
    if (partId) {
      if (typeof previousOpenRentLease === 'function') previousOpenRentLease(assetId, partId);
      return;
    }
    const asset = (state.assets || []).find(function (item) { return item.id === assetId; });
    if (!asset) return;
    const rent = asset.rent || {};
    const editing = isRented(asset);
    const currency = rent.currency || asset.currency || 'RUB';
    const amount = rent.amount ? (typeof formatMoneyInput === 'function' ? formatMoneyInput(rent.amount) : rent.amount) : '';
    const start = editing ? (rent.contractStart || rent.startDate || '') : (plannedStart(asset) || '');
    const periodOptions = PERIODS.map(function (item) {
      return '<option' + (item === (rent.periodicity || 'Месяц') ? ' selected' : '') + '>' + item + '</option>';
    }).join('');
    const root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>' + (editing ? 'Условия аренды' : 'Сдать в аренду') + '</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="rent-lease-form"><div class="modal-body"><p class="rent-modal-object">' + esc(assetTitle(asset)) + '</p><div class="form-grid">' +
      field('ФИО или название арендатора', '<input name="tenant" value="' + esc(editing ? (rent.tenant || '') : '') + '">') +
      field('Телефон или контакт', '<input name="phone" value="' + esc(editing ? (rent.phone || '') : '') + '">') +
      field('Сумма аренды', '<input name="amount" inputmode="decimal" value="' + esc(amount) + '" required>') +
      field('Валюта', '<select name="currency" data-currency-catalog="1"><option>' + esc(currency) + '</option></select>') +
      field('Дата начала аренды', '<input name="start" type="date" value="' + esc(start) + '" required>') +
      field('Дата окончания договора', '<input name="end" type="date" value="' + esc(editing ? (rent.contractEnd || '') : '') + '">') +
      field('Периодичность платежа', '<select name="period">' + periodOptions + '</select>') +
      field('Дата следующего платежа', '<input name="next" type="date" value="' + esc(editing ? (rent.nextDate || start) : start) + '">') +
      field('Куда поступает аренда', '<select name="accountId">' + accountOptions(rent.accountId || '') + '</select>') +
      field('Комментарий', '<input name="comment" value="' + esc(editing ? (rent.comment || '') : '') + '">') +
      '</div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">' + (editing ? 'Сохранить' : 'Сдать') + '</button></div></form></div></div>';
    const currencySelect = root.querySelector('[name="currency"]');
    if (currencySelect && window.attachCurrencyPicker) window.attachCurrencyPicker(currencySelect, { value: currency, allowRub: true });
    document.getElementById('rent-lease-form').onsubmit = function (event) {
      event.preventDefault();
      const fields = readLeaseForm(event.target);
      if (!fields) return;
      startLease(asset, fields);
    };
  };

  window.openRentFinish = function (assetId) {
    const asset = (state.assets || []).find(function (item) { return item.id === assetId; });
    if (!asset || !isRented(asset)) return;
    const rent = asset.rent || {};
    const payments = currentPayments(asset);
    const cutoff = rent.contractEnd && rent.contractEnd < isoDate(today) ? rent.contractEnd : isoDate(today);
    const unpaid = payments.filter(function (payment) { return payment.status !== 'Получено' && payment.date && payment.date <= cutoff; }).reduce(function (sum, payment) { return sum + num(payment.amount); }, 0);
    const lastPaid = payments.filter(function (payment) { return payment.status === 'Получено'; }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0];
    const debtValue = unpaid > 0 && typeof formatMoneyInput === 'function' ? formatMoneyInput(roundMoney(unpaid)) : (unpaid > 0 ? String(roundMoney(unpaid)) : '');
    const reasonOptions = REASONS.map(function (item) { return '<option>' + item + '</option>'; }).join('');
    const depositOptions = DEPOSIT_RETURNS.map(function (item, index) {
      const selected = num(rent.deposit) > 0 ? index === 0 : item === 'залога не было';
      return '<option' + (selected ? ' selected' : '') + '>' + item + '</option>';
    }).join('');
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Завершение аренды</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="rent-finish-form"><div class="modal-body"><div class="form-grid">' +
      field('Объект', '<input value="' + esc(assetTitle(asset)) + '" readonly>') +
      field('Арендатор', '<input value="' + esc(rent.tenant || '—') + '" readonly>') +
      field('Дата выезда', '<input name="moveOut" type="date" value="' + esc(rent.contractEnd || isoDate(today)) + '" required>') +
      field('Причина', '<select name="reason">' + reasonOptions + '</select>') +
      field('Последний оплаченный период', '<input name="lastPaid" type="date" value="' + esc(lastPaid ? lastPaid.date : '') + '">') +
      field('Есть задолженность', '<input name="debt" inputmode="decimal" value="' + esc(debtValue) + '">') +
      field('Залог', '<select name="depositReturn">' + depositOptions + '</select>') +
      field('Комментарий', '<textarea name="comment" rows="3"></textarea>') +
      '</div><p class="rent-modal-note">Аренда завершается, расчёты могут остаться открытыми. Договор, платежи и арендатор сохраняются в истории.</p></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Завершить аренду</button></div></form></div></div>';
    document.getElementById('rent-finish-form').onsubmit = function (event) {
      event.preventDefault();
      const form = event.target;
      if (!form.elements.moveOut.value) {
        alert('Укажите дату выезда.');
        return;
      }
      finishLease(asset, {
        moveOut: form.elements.moveOut.value,
        reason: form.elements.reason.value,
        lastPaid: form.elements.lastPaid.value,
        debt: form.elements.debt.value,
        depositReturn: form.elements.depositReturn.value,
        comment: form.elements.comment.value.trim()
      });
    };
  };

  window.openRentDebt = function (assetId, leaseId) {
    const asset = (state.assets || []).find(function (item) { return item.id === assetId; });
    const lease = asset && (asset.rentHistory || []).find(function (item) { return item.id === leaseId; });
    if (!lease) return;
    const left = remainingDebt(lease);
    const shown = typeof formatMoneyInput === 'function' ? formatMoneyInput(left) : String(left);
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Погашение задолженности</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="rent-debt-form"><div class="modal-body"><div class="form-grid">' +
      field('Арендатор', '<input value="' + esc(lease.tenant || '—') + '" readonly>') +
      field('Осталось', '<input value="' + esc(moneyPair(left, lease.debtCurrency || lease.currency).original) + '" readonly>') +
      field('Сумма погашения', '<input name="amount" inputmode="decimal" value="' + esc(shown) + '" required>') +
      field('Зачислить на счёт', '<select name="accountId">' + accountOptions(lease.accountId || '') + '</select>') +
      '</div><p class="rent-modal-note">Платёж относится только к этому арендатору и не смешивается с действующей арендой.</p></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Погасить</button></div></form></div></div>';
    document.getElementById('rent-debt-form').onsubmit = function (event) {
      event.preventDefault();
      const form = event.target;
      const pay = Math.min(num(form.elements.amount.value), remainingDebt(lease));
      if (!(pay > 0)) {
        alert('Укажите сумму погашения.');
        return;
      }
      const accountId = form.elements.accountId.value;
      const payment = { id: uid(), date: isoDate(today), amount: pay, currency: lease.debtCurrency || lease.currency || 'RUB' };
      if (accountId && typeof receiveRentOnAccount === 'function') {
        receiveRentOnAccount(asset, payment, accountId);
        if (!payment.credited) return;
      }
      if (!Array.isArray(lease.debtPayments)) lease.debtPayments = [];
      lease.debtPayments.push(payment);
      lease.settlement = remainingDebt(lease) > 0 ? 'Есть задолженность' : 'Расчёт завершён';
      save();
      closeModal();
      render();
    };
  };

  function leaseLength(lease, current) {
    const end = lease.moveOut || (!current ? lease.end : '') || isoDate(today);
    if (!lease.start || !end || end < lease.start) return '—';
    const days = daysSpan(lease.start, end);
    return days + ' ' + daysWord(days);
  }

  function historyRows(asset) {
    const rows = (asset.rentHistory || []).map(function (lease) {
      return { kind: 'lease', sort: lease.start || lease.moveOut || '9999-99-99', lease: lease, current: false };
    });
    if (isRented(asset) && asset.rent) {
      const rent = asset.rent;
      rows.push({
        kind: 'lease',
        sort: rent.contractStart || rent.startDate || '9999-99-99',
        current: true,
        lease: {
          id: rent.leaseId || '',
          tenant: rent.tenant || '',
          amount: rent.amount,
          currency: rent.currency || asset.currency || 'RUB',
          periodicity: rent.periodicity || 'Месяц',
          start: rent.contractStart || rent.startDate || '',
          end: rent.contractEnd || '',
          deposit: rent.deposit,
          payments: currentPayments(asset),
          status: 'Действует'
        }
      });
    }
    (asset.rentVacancies || []).forEach(function (vacancy) {
      rows.push({ kind: 'gap', sort: vacancy.start || '9999-99-99', vacancy: vacancy });
    });
    const idle = idleWindow(asset);
    if (idle && idle.active && !openVacancy(asset)) {
      rows.push({
        kind: 'gap',
        sort: idle.start,
        vacancy: { start: idle.start, end: '', amount: idle.amount, currency: idle.currency, periodicity: idle.periodicity }
      });
    }
    rows.sort(function (a, b) { return String(a.sort).localeCompare(String(b.sort)); });
    return rows;
  }

  function objectStats(asset) {
    const todayIso = isoDate(today);
    const leases = (asset.rentHistory || []).slice();
    if (isRented(asset) && asset.rent) {
      leases.push({
        start: asset.rent.contractStart || asset.rent.startDate || '',
        moveOut: '',
        end: asset.rent.contractEnd || '',
        tenant: asset.rent.tenant || '',
        payments: currentPayments(asset),
        currency: asset.rent.currency || 'RUB',
        current: true
      });
    }
    let rentedDays = 0;
    const names = {};
    leases.forEach(function (lease) {
      if (lease.tenant) names[lease.tenant] = true;
      const end = lease.moveOut || (lease.current ? todayIso : (lease.end && lease.end < todayIso ? lease.end : todayIso));
      rentedDays += daysSpan(lease.start, end);
    });
    let vacantDays = 0;
    let lost = 0;
    let lostCurrency = (asset.rent && asset.rent.currency) || 'RUB';
    (asset.rentVacancies || []).forEach(function (vacancy) {
      const end = vacancy.end || (vacancy.start && vacancy.start <= todayIso ? todayIso : '');
      if (!end || end < vacancy.start) return;
      vacantDays += daysSpan(vacancy.start, end);
      lost += lostBetween(vacancy.amount, vacancy.periodicity, vacancy.start, end);
      lostCurrency = vacancy.currency || lostCurrency;
    });
    const idle = idleWindow(asset);
    if (idle && idle.active && !openVacancy(asset)) {
      vacantDays += daysSpan(idle.start, idle.end);
      lost += lostBetween(idle.amount, idle.periodicity, idle.start, idle.end);
      lostCurrency = idle.currency || lostCurrency;
    }
    const dates = [];
    if (asset.acquisition || asset.purchase) dates.push(asset.acquisition || asset.purchase);
    leases.forEach(function (lease) { if (lease.start) dates.push(lease.start); });
    (asset.rentVacancies || []).forEach(function (vacancy) { if (vacancy.start) dates.push(vacancy.start); });
    if (idle && idle.start) dates.push(idle.start);
    dates.sort();
    const watchStart = dates[0] || '';
    const watchDays = watchStart ? daysSpan(watchStart, todayIso) : rentedDays + vacantDays;
    const occupancy = watchDays > 0 ? rentedDays / watchDays * 100 : 0;
    let accrued = 0;
    let received = 0;
    let debt = 0;
    (asset.rentHistory || []).forEach(function (lease) {
      const totals = paymentTotals(lease.payments, lease.moveOut || lease.end || isoDate(today));
      accrued += totals.accrued;
      received += totals.received;
      (lease.debtPayments || []).forEach(function (payment) { received += num(payment.amount); });
      debt += remainingDebt(lease);
    });
    if (isRented(asset)) {
      const totals = paymentTotals(currentPayments(asset));
      accrued += totals.accrued;
      received += totals.received;
    }
    const months = watchDays > 0 ? watchDays / (365 / 12) : 0;
    return {
      watchDays: watchDays,
      rentedDays: rentedDays,
      vacantDays: vacantDays,
      occupancy: occupancy,
      tenants: Object.keys(names).length,
      accrued: roundMoney(accrued),
      received: roundMoney(received),
      debt: roundMoney(debt),
      average: months > 0 ? roundMoney(received / months) : 0,
      lost: roundMoney(lost),
      currency: lostCurrency
    };
  }

  function statsHtml(asset) {
    const stats = objectStats(asset);
    if (!stats.watchDays && !stats.tenants && !(stats.lost > 0)) return '';
    const pair = moneyPair(stats.lost, stats.currency);
    const lostText = stats.currency === 'RUB' ? '≈ ' + rub(stats.lost) : pair.original + (pair.hint ? ' · ' + pair.hint : '');
    return '<div class="rent-stats">' +
      '<div><span>Период наблюдения</span><strong>' + stats.watchDays + ' ' + daysWord(stats.watchDays) + '</strong></div>' +
      '<div><span>Сдано</span><strong>' + stats.rentedDays + ' ' + daysWord(stats.rentedDays) + '</strong></div>' +
      '<div><span>Простой</span><strong>' + stats.vacantDays + ' ' + daysWord(stats.vacantDays) + '</strong></div>' +
      '<div><span>Занятость</span><strong>' + (stats.watchDays ? (Math.round(stats.occupancy * 10) / 10).toFixed(1).replace('.', ',') + '%' : '—') + '</strong></div>' +
      '<div><span>Арендаторов</span><strong>' + stats.tenants + '</strong></div>' +
      '<div><span>Начислено</span><strong>' + moneyLine(stats.accrued, stats.currency) + '</strong></div>' +
      '<div><span>Получено аренды</span><strong>' + moneyLine(stats.received, stats.currency) + '</strong></div>' +
      '<div><span>Текущая задолженность</span><strong>' + moneyLine(stats.debt, stats.currency) + '</strong></div>' +
      '<div><span>Средний доход в месяц</span><strong>' + moneyLine(stats.average, stats.currency) + '</strong></div>' +
      '<div><span>Потенциально недополучено</span><strong>' + lostText + '</strong><small>аналитический показатель, не расход и не уменьшает капитал</small></div>' +
      '</div>';
  }

  function historyHtml(asset) {
    const rows = historyRows(asset);
    if (!rows.length) return '';
    const body = rows.map(function (row) {
      if (row.kind === 'gap') {
        const vacancy = row.vacancy;
        const todayIso = isoDate(today);
        const end = vacancy.end || (vacancy.start && vacancy.start <= todayIso ? todayIso : '');
        const days = end ? daysSpan(vacancy.start, end) : 0;
        const lost = end ? lostBetween(vacancy.amount, vacancy.periodicity, vacancy.start, end) : 0;
        return '<article class="rent-life-row"><div><b>Простой</b><span>' + fullDate(vacancy.start) + ' – ' + (vacancy.end ? fullDate(vacancy.end) : 'по настоящее время') + '</span></div><div><span>Срок</span><strong>' + days + ' ' + daysWord(days) + '</strong></div><div><span>Потенциально недополучено</span><strong>≈ ' + moneyLine(lost, vacancy.currency) + '</strong></div></article>';
      }
      const lease = row.lease;
      const totals = paymentTotals(lease.payments, row.current ? isoDate(today) : (lease.moveOut || lease.end || isoDate(today)));
      const debtLeft = row.current ? 0 : remainingDebt(lease);
      const debtButton = !row.current && debtLeft > 0 ? '<button type="button" class="ghost-button" onclick="openRentDebt(\'' + jsId(asset.id) + '\',\'' + jsId(lease.id) + '\')">Погасить задолженность</button>' : '';
      return '<article class="rent-life-row"><div><b>' + esc(lease.tenant || 'Арендатор не указан') + '</b><span>' + fullDate(lease.start) + ' – ' + (row.current ? 'по настоящее время' : fullDate(lease.moveOut || lease.end)) + '</span></div>' +
        '<div><span>Срок аренды</span><strong>' + leaseLength(lease, row.current) + '</strong></div>' +
        '<div><span>Ставка</span><strong>' + moneyLine(lease.amount, lease.currency) + '</strong><small>' + periodWord(lease.periodicity) + '</small></div>' +
        '<div><span>Начислено</span><strong>' + moneyLine(totals.accrued, lease.currency) + '</strong></div>' +
        '<div><span>Получено</span><strong>' + moneyLine(totals.received, lease.currency) + '</strong></div>' +
        '<div><span>Задолженность</span><strong>' + (row.current ? '—' : moneyLine(debtLeft, lease.debtCurrency || lease.currency)) + '</strong></div>' +
        '<div><span>Залог</span><strong>' + (num(lease.deposit) > 0 ? moneyLine(lease.deposit, lease.currency) : '—') + '</strong>' + (lease.depositReturn ? '<small>' + esc(lease.depositReturn) + '</small>' : '') + '</div>' +
        '<div><span>Причина завершения</span><strong>' + esc(lease.reason || '—') + '</strong></div>' +
        '<div><span>Статус</span><strong>' + esc(lease.status || (row.current ? 'Действует' : 'Завершён')) + '</strong>' + (lease.settlement ? '<small>' + esc(lease.settlement) + '</small>' : '') + '</div>' +
        debtButton + '</article>';
    }).join('');
    return '<details class="rent-history"><summary>История аренды</summary>' + body + '</details>';
  }

  function jsId(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
  }

  function rentPeriodName(date) {
    if (!date) return '—';
    const parsed = new Date(date + 'T12:00:00');
    if (Number.isNaN(parsed.getTime())) return '—';
    const names = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    return names[parsed.getMonth()] + ' ' + parsed.getFullYear();
  }

  function paymentWatch(payment) {
    if (!payment || !payment.date) return null;
    const days = daysFromNow(payment.date);
    if (payment.status === 'Получено') return { kind: 'received', days: days };
    if (days < 0) return { kind: 'overdue', days: -days };
    if (days === 0) return { kind: 'today', days: 0 };
    if (days <= 2) return { kind: 'soon', days: days };
    return { kind: 'wait', days: days };
  }

  function lastReceivedPayment(payments) {
    return (payments || []).filter(function (payment) { return payment.status === 'Получено'; }).sort(function (a, b) {
      return String(b.receivedAt || b.date).localeCompare(String(a.receivedAt || a.date));
    })[0] || null;
  }

  function rentTone(usage, payment) {
    const watch = paymentWatch(payment);
    if (usage === 'rented' && watch && watch.kind === 'overdue') return { tone: 'red', tag: 'tag-red', label: 'Просрочена оплата' };
    if (usage === 'rented') return { tone: 'green', tag: 'tag-green', label: 'Сдано' };
    if (usage === 'planned') return { tone: 'yellow', tag: 'tag-yellow', label: 'Планируется к сдаче' };
    return { tone: 'orange', tag: 'tag-orange', label: 'Свободно / ищем арендатора' };
  }

  function paymentControlHtml(payment, received, currency) {
    const blocks = [];
    if (received) {
      const code = received.currency || currency || 'RUB';
      const sum = moneyPair(received.receivedAmount != null && received.receivedAmount !== '' ? received.receivedAmount : received.amount, code).original;
      blocks.push('<div class="rent-pay is-received"><span>Получено</span><strong>' + sum + '</strong><small>' + fullDate(received.receivedAt || received.date) + '</small></div>');
    }
    const watch = paymentWatch(payment);
    if (payment && watch && watch.kind !== 'received') {
      const code = payment.currency || currency || 'RUB';
      const sum = moneyPair(payment.amount, code).original;
      if (watch.kind === 'overdue') blocks.push('<div class="rent-pay is-overdue"><span>Просрочено</span><strong>' + sum + '</strong><small>просрочено ' + watch.days + ' ' + daysWord(watch.days) + '</small></div>');
      else if (watch.kind === 'today') blocks.push('<div class="rent-pay is-today"><span>Платёж сегодня</span><strong>' + sum + '</strong></div>');
      else if (watch.kind === 'soon') blocks.push('<div class="rent-pay is-soon"><span>Скоро платёж</span><strong>' + sum + '</strong><small>получить до ' + fullDate(payment.date) + '</small></div>');
      else blocks.push('<div class="rent-pay"><span>Следующий платёж</span><strong>' + fullDate(payment.date) + '</strong><b>' + sum + '</b><small>Ожидается</small></div>');
    }
    return blocks.length ? '<div class="rent-pay-box">' + blocks.join('') + '</div>' : '';
  }

  function appendNextRentPayment(list, periodicity, amount, currency, leaseId) {
    if (!Array.isArray(list) || !(num(amount) > 0)) return;
    const open = list.some(function (payment) { return payment.status !== 'Получено' && payment.status !== 'Отменён'; });
    if (open) return;
    const dated = list.filter(function (payment) { return payment.date; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    const last = dated[dated.length - 1];
    if (!last) return;
    const date = new Date(last.date + 'T12:00:00');
    monthStep(date, periodicity || 'Месяц');
    list.push({
      id: uid(),
      leaseId: leaseId || last.leaseId || '',
      date: isoDate(date),
      amount: num(amount),
      currency: currency || last.currency || 'RUB',
      status: 'Ожидается'
    });
  }

  function unitPayments(asset, part) {
    if (part) return part.rentPayments || [];
    return currentPayments(asset);
  }

  window.openRentReceipt = function (assetId, partId, paymentId) {
    const asset = (state.assets || []).find(function (item) { return item.id === assetId; });
    if (!asset) return;
    const part = partId ? (asset.parts || []).find(function (item) { return item.id === partId; }) : null;
    if (partId && !part) return;
    const payment = unitPayments(asset, part).find(function (item) { return item.id === paymentId; });
    if (!payment || payment.status === 'Получено') return;
    const currency = payment.currency || (part ? part.rentCurrency : (asset.rent && asset.rent.currency)) || 'RUB';
    const planned = moneyPair(payment.amount, currency).original;
    const shown = typeof formatMoneyInput === 'function' ? formatMoneyInput(payment.amount) : String(payment.amount);
    const place = part ? (assetTitle(asset) + ' / ' + (part.name || 'Помещение')) : assetTitle(asset);
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Получение аренды</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="rent-receipt-form"><div class="modal-body"><p class="rent-modal-object">' + esc(place) + '</p><div class="form-grid">' +
      field('Платёж за', '<input value="' + esc(rentPeriodName(payment.date)) + '" readonly>') +
      field('Плановая дата', '<input value="' + esc(fullDate(payment.date)) + '" readonly>') +
      field('Плановая сумма', '<input value="' + esc(planned) + '" readonly>') +
      field('Фактически получено', '<input name="received" inputmode="decimal" value="' + esc(shown) + '" required>') +
      field('Дата получения', '<input name="receivedAt" type="date" value="' + esc(isoDate(today)) + '" required>') +
      '</div><p class="rent-modal-note">В доход попадёт только подтверждённая сумма. График и история арендатора сохраняются.</p></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Подтвердить получение</button></div></form></div></div>';
    document.getElementById('rent-receipt-form').onsubmit = function (event) {
      event.preventDefault();
      const form = event.target;
      const actual = num(form.elements.received.value);
      const receivedAt = form.elements.receivedAt.value;
      if (!(actual > 0)) { alert('Укажите фактически полученную сумму.'); return; }
      if (!receivedAt) { alert('Укажите дату получения.'); return; }
      const tenant = part ? (part.tenant || '') : ((asset.rent && asset.rent.tenant) || '');
      payment.plannedAmount = payment.plannedAmount != null && payment.plannedAmount !== '' ? payment.plannedAmount : num(payment.amount);
      payment.plannedDate = payment.plannedDate || payment.date;
      payment.receivedAmount = actual;
      payment.receivedAt = receivedAt;
      payment.status = 'Получено';
      payment.tenant = tenant;
      payment.place = place;
      payment.objectName = assetTitle(asset);
      payment.roomName = part ? (part.name || 'Помещение') : '';
      payment.periodLabel = rentPeriodName(payment.plannedDate);
      if (!payment.currency) payment.currency = currency;
      const accountId = part ? (part.rentAccountId || (asset.rent && asset.rent.accountId) || '') : ((asset.rent && asset.rent.accountId) || '');
      if (accountId && typeof receiveRentOnAccount === 'function') {
        const credit = { id: payment.id, amount: actual, currency: payment.currency, receivedAt: receivedAt, credited: payment.credited };
        receiveRentOnAccount(asset, credit, accountId);
        if (credit.credited) payment.credited = true;
      }
      if (part) {
        if (!Array.isArray(part.rentPayments)) part.rentPayments = [];
        appendNextRentPayment(part.rentPayments, part.rentPeriod || 'Месяц', part.rentAmount, part.rentCurrency || currency, '');
      } else if (asset.rent) {
        if (!Array.isArray(asset.rent.payments)) asset.rent.payments = [];
        appendNextRentPayment(asset.rent.payments, asset.rent.periodicity || 'Месяц', asset.rent.amount, asset.rent.currency || currency, asset.rent.leaseId || '');
      }
      save();
      closeModal();
      render();
    };
  };

  window.markUnitRentReceived = function (assetId, partId, paymentId) {
    window.openRentReceipt(assetId, partId, paymentId);
  };

  window.finishPartRent = function (assetId, partId) {
    const asset = (state.assets || []).find(function (item) { return item.id === assetId; });
    const part = asset && (asset.parts || []).find(function (item) { return item.id === partId; });
    if (!asset || !part || part.usage !== 'Сдаётся в аренду') return;
    const place = assetTitle(asset) + ' / ' + (part.name || 'Помещение');
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Завершение аренды</h2><button type="button" class="close" onclick="closeModal()">×</button></div><form id="part-finish-form"><div class="modal-body"><p class="rent-modal-object">' + esc(place) + '</p><p class="rent-modal-note">Помещение станет свободным. Платежи и арендатор останутся в истории, новый договор их не сотрёт.</p></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Завершить аренду</button></div></form></div></div>';
    document.getElementById('part-finish-form').onsubmit = function (event) {
      event.preventDefault();
      if (!Array.isArray(part.rentHistory)) part.rentHistory = [];
      part.rentHistory.push({
        id: uid(),
        tenant: part.tenant || '',
        phone: part.rentPhone || '',
        amount: num(part.rentAmount),
        currency: part.rentCurrency || 'RUB',
        periodicity: part.rentPeriod || 'Месяц',
        start: part.rentStart || '',
        end: part.rentEnd || '',
        moveOut: isoDate(today),
        payments: JSON.parse(JSON.stringify(part.rentPayments || [])),
        status: 'Завершён'
      });
      part.usage = 'Не используется / свободно';
      part.tenant = '';
      save();
      closeModal();
      render();
    };
  };

  function assetCard(asset) {
    const rent = asset.rent || {};
    const attention = attentionOf(asset);
    const ending = attention.some(function (item) { return item.kind === 'ending'; });
    const rented = isRented(asset);
    const idle = idleWindow(asset);
    const amount = num(rent.amount);
    const currency = rent.currency || asset.currency || 'RUB';
    const next = rented ? nextPayment(asset) : null;
    const tone = rentTone(rented ? 'rented' : (usageOf(asset) === 'Планируется сдача в аренду' ? 'planned' : 'vacant'), next);
    const flag = ending ? '<div class="rent-flag">Договор заканчивается ' + fullDate(rent.contractEnd) + '</div>' : '';
    const lost = idle && idle.active ? lostBetween(idle.amount, idle.periodicity, idle.start, idle.end) : 0;
    const lostPair = moneyPair(lost, idle ? idle.currency : currency);
    const vacancy = openVacancy(asset);
    const startLabel = rented ? 'Дата начала' : (vacancy ? 'Свободен с' : 'Планируемая дата начала сдачи');
    const startValue = rented ? plannedStart(asset) : (vacancy ? vacancy.start : plannedStart(asset));
    const facts = '<div><span>Объект</span><strong>' + esc(assetTitle(asset)) + '</strong><small>' + esc(asset.type || '') + '</small></div>' +
      '<div><span>' + (rented ? 'Аренда' : 'Планируемая аренда') + '</span><strong>' + (amount ? moneyLine(amount, currency) : '—') + '</strong><small>' + periodWord(rent.periodicity) + '</small></div>' +
      '<div><span>' + startLabel + '</span><strong>' + (startValue ? fullDate(startValue) : '—') + '</strong></div>' +
      (rented && rent.contractEnd ? '<div><span>Окончание договора</span><strong>' + fullDate(rent.contractEnd) + '</strong></div>' : '') +
      '<div><span>Помещение</span><strong>' + (rented ? 'Весь объект' : '—') + '</strong></div>' +
      (rent.tenant ? '<div><span>Арендатор</span><strong>' + esc(rent.tenant) + '</strong></div>' : '') +
      (idle && idle.active ? '<div><span>Свободен</span><strong>' + daysSpan(idle.start, idle.end) + ' ' + daysWord(daysSpan(idle.start, idle.end)) + '</strong></div><div><span>Потенциально недополучено</span><strong>≈ ' + (idle.currency === 'RUB' ? rub(lost) : lostPair.original + (lostPair.hint ? ' · ' + lostPair.hint : '')) + '</strong><small>не расход и не уменьшает капитал</small></div>' : '') +
      attention.filter(function (item) { return item.kind === 'debt' || item.kind === 'ended'; }).map(function (item) { return '<div><span>Контроль</span><strong>' + esc(item.text) + '</strong></div>'; }).join('');
    const pay = rented ? paymentControlHtml(next, lastReceivedPayment(currentPayments(asset)), currency) : '';
    const actions = rented
      ? '<button type="button" class="ghost-button" onclick="openRentFinish(\'' + jsId(asset.id) + '\')">Завершить аренду</button><button type="button" class="ghost-button" onclick="openRentLease(\'' + jsId(asset.id) + '\',\'\')">Условия</button>' + (next ? '<button type="button" class="primary-button" onclick="markUnitRentReceived(\'' + jsId(asset.id) + '\',\'\',\'' + jsId(next.id) + '\')">Получено</button>' : '')
      : '<button type="button" class="primary-button" onclick="openRentLease(\'' + jsId(asset.id) + '\',\'\')">Сдать</button>';
    return '<article class="rent-row panel rent-tone-' + tone.tone + '">' + flag + '<div class="rent-row-main">' + facts + '</div>' + pay + '<span class="tag rent-status ' + tone.tag + '">' + tone.label + '</span><div class="rent-row-actions">' + actions + '</div>' + statsHtml(asset) + historyHtml(asset) + '</article>';
  }

  function partCard(asset, part) {
    const rented = part.usage === 'Сдаётся в аренду';
    const planned = part.usage === 'Планируется сдача в аренду';
    const next = (part.rentPayments || []).filter(function (payment) { return payment.status !== 'Получено' && payment.status !== 'Отменён'; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })[0];
    const tone = rentTone(rented ? 'rented' : (planned ? 'planned' : 'vacant'), next);
    const currency = part.rentCurrency || 'RUB';
    const actions = rented
      ? '<button type="button" class="ghost-button" onclick="finishPartRent(\'' + jsId(asset.id) + '\',\'' + jsId(part.id) + '\')">Завершить аренду</button><button type="button" class="ghost-button" onclick="openRentLease(\'' + jsId(asset.id) + '\',\'' + jsId(part.id) + '\')">Условия</button>' + (next ? '<button type="button" class="primary-button" onclick="markUnitRentReceived(\'' + jsId(asset.id) + '\',\'' + jsId(part.id) + '\',\'' + jsId(next.id) + '\')">Получено</button>' : '')
      : '<button type="button" class="primary-button" onclick="openRentLease(\'' + jsId(asset.id) + '\',\'' + jsId(part.id) + '\')">Сдать</button>';
    const facts = '<div><span>Объект</span><strong>' + esc(assetTitle(asset)) + '</strong></div>' +
      '<div><span>Помещение</span><strong>' + esc(part.name || 'Помещение') + '</strong></div>' +
      (part.tenant ? '<div><span>Арендатор</span><strong>' + esc(part.tenant) + '</strong></div>' : '') +
      '<div><span>' + (rented ? 'Аренда' : 'Планируемая аренда') + '</span><strong>' + (num(part.rentAmount) ? moneyLine(part.rentAmount, currency) : '—') + '</strong><small>' + periodWord(part.rentPeriod) + '</small></div>' +
      '<div><span>Дата начала</span><strong>' + (part.rentStart ? fullDate(part.rentStart) : '—') + '</strong></div>' +
      (part.rentEnd ? '<div><span>Окончание договора</span><strong>' + fullDate(part.rentEnd) + '</strong></div>' : '');
    const pay = rented ? paymentControlHtml(next, lastReceivedPayment(part.rentPayments), currency) : '';
    return '<article class="rent-row panel rent-tone-' + tone.tone + '"><div class="rent-row-main">' + facts + '</div>' + pay + '<span class="tag rent-status ' + tone.tag + '">' + tone.label + '</span><div class="rent-row-actions">' + actions + '</div></article>';
  }

  function collectUnits() {
    const units = [];
    (state.assets || []).forEach(function (asset) {
      const usage = usageOf(asset);
      if (usage === 'Планируется сдача в аренду' || usage === 'Не используется / свободно' || usage === 'Сдаётся в аренду') units.push({ asset: asset, part: null, usage: usage });
      (asset.parts || []).forEach(function (part) {
        if (part.usage === 'Планируется сдача в аренду' || part.usage === 'Не используется / свободно' || part.usage === 'Сдаётся в аренду') units.push({ asset: asset, part: part, usage: part.usage });
      });
    });
    return units;
  }

  function paymentRub(payment, fallbackCurrency) {
    const code = (payment && payment.currency) || fallbackCurrency || 'RUB';
    const source = payment && payment.status === 'Получено' && payment.receivedAmount != null && payment.receivedAmount !== '' ? payment.receivedAmount : (payment && payment.amount);
    if (code === 'RUB') return num(source);
    return moneyPair(source, code).rub || 0;
  }

  function rentalsPage() {
    const units = collectUnits();
    const planned = units.filter(function (unit) { return unit.usage === 'Планируется сдача в аренду'; });
    const vacant = units.filter(function (unit) { return unit.usage === 'Не используется / свободно'; });
    const rented = units.filter(function (unit) { return unit.usage === 'Сдаётся в аренду'; });
    let expected = 0;
    let received = 0;
    let overdue = 0;
    rented.forEach(function (unit) {
      const payments = unit.part ? (unit.part.rentPayments || []) : currentPayments(unit.asset);
      const currency = unit.part ? (unit.part.rentCurrency || 'RUB') : ((unit.asset.rent && unit.asset.rent.currency) || unit.asset.currency || 'RUB');
      payments.forEach(function (payment) {
        if (!payment || payment.status === 'Отменён' || !payment.date) return;
        if (payment.status === 'Получено') {
          if (inCurrentMonth(payment.receivedAt || payment.date)) received += paymentRub(payment, currency);
          return;
        }
        if (inCurrentMonth(payment.date)) expected += paymentRub(payment, currency);
        if (daysFromNow(payment.date) < 0) overdue += paymentRub(payment, currency);
      });
    });
    expected = roundMoney(expected);
    received = roundMoney(received);
    overdue = roundMoney(overdue);
    const board = '<section class="rent-board"><article><span>Сдано</span><strong>' + rented.length + '</strong><small>' + plural(rented.length, 'объект', 'объекта', 'объектов') + '</small></article><article><span>Свободно</span><strong>' + vacant.length + '</strong><small>' + plural(vacant.length, 'объект', 'объекта', 'объектов') + '</small></article><article><span>Ожидается в этом месяце</span><strong>' + rub(expected) + '</strong></article><article><span>Получено в этом месяце</span><strong>' + rub(received) + '</strong></article><article class="' + (overdue > 0 ? 'is-alert' : '') + '"><span>Просрочено</span><strong>' + rub(overdue) + '</strong></article></section>';
    const blocks = [
      [planned, 'Планируется к сдаче', 'Дата начала ещё не наступила. Эти суммы не входят в доход.'],
      [vacant, 'Свободно / ищем арендатора', 'Сейчас не приносит доход и требует поиска арендатора.'],
      [rented, 'Сдано в аренду', 'Плановый платёж не является доходом, пока не нажато «Получено».']
    ];
    const body = blocks.map(function (block) {
      const cards = block[0].map(function (unit) { return unit.part ? partCard(unit.asset, unit.part) : assetCard(unit.asset); }).join('');
      return '<section class="rent-block"><div class="rent-block-head"><h3>' + block[1] + '</h3><span>' + block[0].length + '</span></div><p>' + block[2] + '</p>' + (cards || '<div class="rent-empty">Пока нет</div>') + '</section>';
    }).join('');
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">ДОХОД ОТ ИМУЩЕСТВА</p><h2>Аренда</h2><p>Те же объекты и помещения из раздела «Имущество». Доход учитывается только после «Получено».</p></div></div>' + board + body + '</div>';
  }

  function dashboardAlert() {
    const items = attentionAssets();
    if (!items.length) return '';
    const rows = items.map(function (asset) {
      const attention = attentionOf(asset);
      const vacant = attention.filter(function (item) { return item.kind === 'vacant'; })[0];
      const lines = attention.map(function (item) {
        if (item.kind === 'vacant') {
          const pair = moneyPair(item.lost, item.currency);
          const lost = item.currency === 'RUB' ? '≈ ' + rub(item.lost) : pair.original + (pair.hint ? ' · ' + pair.hint : '');
          return esc(item.text) + '<small>Потенциально недополучено ' + lost + '</small>';
        }
        return esc(item.text);
      }).join('<small class="rent-alert-gap"></small>');
      return '<article class="rent-alert-row"><div><b>' + esc(assetTitle(asset)) + '</b><span>' + (lines || 'Требует внимания') + '</span>' + (vacant ? '' : '') + '</div><button type="button" class="primary-button" onclick="setView(\'rentals\')">Перейти в аренду</button></article>';
    }).join('');
    return '<section class="rent-alert panel"><div class="dash-panel-heading"><div><p class="eyebrow">ТРЕБУЕТ ВНИМАНИЯ</p><h3>Аренда</h3></div></div>' + rows + '</section>';
  }

  function rentLifeEvents() {
    const events = [];
    (state.assets || []).forEach(function (asset) {
      if (!isIntent(asset)) return;
      const rent = asset.rent || {};
      const place = assetTitle(asset);
      const pair = moneyPair(rent.amount, rent.currency || asset.currency || 'RUB');
      if (isRented(asset)) {
        const start = rent.contractStart || rent.startDate || '';
        if (start) events.push({ date: start, title: 'Начало аренды', label: 'Начало аренды', primary: place, secondary: rent.tenant || '', amountText: pair.original || '—', rubHint: pair.hint, type: 'rent', kind: 'rent-start', status: 'Действует', attention: '', noteLines: ['Начало аренды ' + fullDate(start)], done: daysFromNow(start) < 0, id: 'rent-life-start-' + asset.id });
        if (rent.contractEnd) {
          const days = daysFromNow(rent.contractEnd);
          const attention = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= ENDING_DAYS ? 'soon' : '';
          events.push({ date: rent.contractEnd, title: 'Окончание аренды', label: attention ? 'Аренда заканчивается' : 'Окончание аренды', primary: place, secondary: rent.tenant || '', amountText: pair.original || '—', rubHint: pair.hint, type: 'rent-end', kind: 'rent-end', status: attention ? 'Требует внимания' : 'Предстоит', attention: attention, noteLines: ['Окончание договора ' + fullDate(rent.contractEnd)], done: false, id: 'rent-life-end-' + asset.id });
        }
      } else {
        const start = plannedStart(asset);
        if (start) {
          const days = daysFromNow(start);
          const attention = days < 0 ? 'overdue' : days === 0 ? 'today' : '';
          events.push({ date: start, title: 'Планируемая сдача', label: attention ? 'Объект не сдан' : 'Планируемая сдача', primary: place, secondary: 'Ищем арендатора', amountText: pair.original || '—', rubHint: pair.hint, type: 'rent-end', kind: 'rent-plan', status: attention ? 'Не сдано' : 'Предстоит', attention: attention, noteLines: ['Планируемая дата начала сдачи ' + fullDate(start)], done: false, id: 'rent-life-plan-' + asset.id });
        }
      }
    });
    return events.filter(function (event) { return event.date; });
  }

  const baseEventList = eventList;
  eventList = function () {
    return baseEventList().concat(rentLifeEvents()).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  };

  function paintRentChrome() {
    const count = attentionAssets().length;
    const node = document.getElementById('rent-count');
    if (node) {
      node.hidden = count === 0;
      node.textContent = count ? String(count) : '';
      node.classList.toggle('nav-alert', count > 0);
    }
    if (typeof activeView === 'undefined') return;
    if (activeView === 'rentals') {
      const view = document.getElementById('app-view');
      if (view) view.innerHTML = rentalsPage();
      const title = document.getElementById('page-title');
      if (title) title.textContent = 'Аренда';
      document.querySelectorAll('.nav-item').forEach(function (button) {
        button.classList.toggle('active', button.dataset.view === 'rentals');
      });
    }
    if (activeView === 'dashboard') {
      const shell = document.querySelector('.dashboard-shell');
      if (!shell) return;
      const old = shell.querySelector('.rent-alert');
      if (old) old.remove();
      const html = dashboardAlert();
      if (!html) return;
      const summary = shell.querySelector('.rental-summary');
      if (summary) summary.insertAdjacentHTML('afterend', html);
      else shell.insertAdjacentHTML('afterbegin', html);
    }
  }

  const baseRender = render;
  render = function () {
    baseRender();
    paintRentChrome();
  };

  const nav = document.getElementById('main-nav');
  const top = document.querySelector('.top-actions');
  if (nav) nav.addEventListener('click', function () { setTimeout(paintRentChrome, 0); });
  if (top) top.addEventListener('click', function () { setTimeout(paintRentChrome, 0); });
  setTimeout(paintRentChrome, 0);
}());
