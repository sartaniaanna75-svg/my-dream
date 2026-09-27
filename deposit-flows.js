(function () {
  let openDepositId = '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function moneyOk(value) {
    return roundMoney(num(value));
  }

  function depositTitle(deposit) {
    return 'Вклад ' + (deposit.bank || deposit.name || '');
  }

  function accountTitle(account) {
    const kind = /карт/i.test(account.type || '') ? 'Карта' : 'Счёт';
    return kind + ' ' + (account.bank || '');
  }

  function obligationChoices() {
    return obligations().map(function (item) {
      const id = item.kind === 'asset' && item.asset ? item.asset.id : item.id;
      return { kind: item.kind === 'asset' ? 'asset' : 'manual', id: id, label: item.what || 'Обязательство', remaining: moneyOk(item.remaining) };
    }).filter(function (item) { return item.id && item.remaining > 0; });
  }

  function findObligation(kind, id) {
    return obligationChoices().filter(function (item) { return item.kind === kind && item.id === id; })[0] || null;
  }

  function purposeText(deposit) {
    if (deposit.purpose === 'reserve') return 'Резерв на обязательства';
    if (deposit.purpose === 'specific') {
      const name = deposit.allocations && deposit.allocations[0] && deposit.allocations[0].label;
      return name ? 'Резерв на обязательство «' + name + '»' : 'Конкретное обязательство';
    }
    return 'Свободные накопления';
  }

  function movementText(type, deposit, account, obligation) {
    const bank = deposit.bank || deposit.name || 'Вклад';
    const place = depositTitle(deposit);
    if (type === 'personal') return 'Личные средства → ' + place;
    if (type === 'topup') return 'Пополнение → ' + place;
    if (type === 'transfer-in') return accountTitle(account) + ' → ' + place;
    if (type === 'interest') return 'Получены проценты';
    if (type === 'pay') return bank + ' → ' + (obligation ? obligation.label : 'Обязательство');
    if (type === 'transfer-out') return place + ' → ' + accountTitle(account);
    if (account) return place + ' → ' + accountTitle(account);
    return place + ' → вывод';
  }

  function applyObligationSide(opId, date, amount, text, kind, targetId) {
    if (kind === 'manual') {
      const debt = state.debts.find(function (item) { return item.id === targetId; });
      if (!debt) return false;
      if (!Array.isArray(debt.movements)) debt.movements = [];
      if (debt.movements.some(function (item) { return item.id === opId; })) return true;
      debt.paid = moneyOk(num(debt.paid) + amount);
      debt.movements.push({ id: opId, date: date, amount: amount, text: text, depositId: '' });
      return true;
    }
    const asset = state.assets.find(function (item) { return item.id === targetId; });
    if (!asset) return false;
    if (!Array.isArray(asset.payments)) asset.payments = [];
    if (asset.payments.some(function (item) { return item.id === opId || item.linkId === opId; })) return true;
    asset.payments.push({
      id: opId,
      linkId: opId,
      fromDeposit: true,
      date: date,
      amount: amount,
      paidAmount: amount,
      status: 'Оплачено',
      paidDate: date,
      currency: 'RUB',
      comment: text
    });
    asset.paid = assetPaid(asset);
    return true;
  }

  function applyDepositOperation(deposit, draft) {
    const amount = moneyOk(draft.amount);
    const type = draft.type;
    if (!(amount > 0)) { alert('Укажите сумму операции.'); return false; }
    if (!Array.isArray(deposit.movements)) deposit.movements = [];
    if (deposit.movements.some(function (item) { return item.id === draft.id; })) return false;
    const outgoing = type === 'pay' || type === 'transfer-out' || type === 'close';
    if (outgoing && moneyOk(deposit.current) + 0.001 < amount) { alert('На вкладе недостаточно средств.'); return false; }
    let account = null;
    let obligation = null;
    if (type === 'transfer-in' || type === 'transfer-out' || (type === 'close' && draft.accountId)) {
      account = state.accounts.find(function (item) { return item.id === draft.accountId; });
      if (!account) { alert(type === 'close' ? 'Выберите, куда вывести вклад.' : 'Выберите карту или счёт.'); return false; }
      if (type === 'transfer-in' && moneyOk(account.balance) + 0.001 < amount) { alert('На карте или счёте недостаточно средств.'); return false; }
    }
    if (type === 'pay') {
      obligation = findObligation(draft.obligationKind, draft.obligationId);
      if (!obligation) { alert('Выберите обязательство.'); return false; }
      if (obligation.remaining + 0.001 < amount) { alert('Сумма больше остатка обязательства.'); return false; }
    }
    const text = movementText(type, deposit, account, obligation);
    if (type === 'pay' && !applyObligationSide(draft.id, draft.date, amount, text, draft.obligationKind, draft.obligationId)) {
      alert('Не удалось связать оплату с обязательством.');
      return false;
    }
    if (account && type === 'transfer-in') account.balance = moneyOk(num(account.balance) - amount);
    if (account && (type === 'transfer-out' || type === 'close')) account.balance = moneyOk(num(account.balance) + amount);
    if (account) {
      if (!Array.isArray(account.movements)) account.movements = [];
      if (!account.movements.some(function (item) { return item.id === draft.id; })) {
        account.movements.push({ id: draft.id, date: draft.date, amount: amount, text: text, direction: type === 'transfer-in' ? 'out' : 'in', depositId: deposit.id });
      }
    }
    if (type === 'pay') {
      const debt = state.debts.find(function (item) { return item.id === draft.obligationId; });
      if (debt && debt.movements) {
        const linked = debt.movements.find(function (item) { return item.id === draft.id; });
        if (linked) linked.depositId = deposit.id;
      }
    }
    if (type === 'interest') {
      deposit.received = moneyOk(num(deposit.received) + amount);
      deposit.status = num(deposit.received) >= num(deposit.expected) ? 'Получено' : 'Не получено';
    }
    deposit.current = moneyOk(num(deposit.current) + (outgoing ? -amount : amount));
    deposit.movements.push({
      id: draft.id,
      date: draft.date,
      type: type,
      amount: amount,
      direction: outgoing ? 'out' : 'in',
      text: text,
      comment: draft.comment || '',
      accountId: account ? account.id : '',
      obligationKind: obligation ? draft.obligationKind : '',
      obligationId: obligation ? draft.obligationId : ''
    });
    return true;
  }

  function historyBlock(deposit) {
    const rows = (deposit.movements || []).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id));
    });
    if (!rows.length) return '<h4>История операций</h4><div class="empty">Операций пока нет</div>';
    return '<h4>История операций</h4>' + rows.map(function (item) {
      const sign = item.direction === 'out' ? '−' : '+';
      const tone = item.direction === 'out' ? 'minus' : 'plus';
      const note = item.comment ? '<small>' + esc(item.comment) + '</small>' : '';
      return '<div class="stat-row"><span>' + dateText(item.date) + '<br>' + esc(item.text || '') + note + '</span><strong class="' + tone + '">' + sign + rub(item.amount) + '</strong></div>';
    }).join('');
  }

  function allocationBlock(deposit) {
    const items = deposit.allocations || [];
    if (deposit.purpose === 'reserve' && !items.length) return '<p class="muted">Деньги отмечены как резерв на обязательства и по-прежнему лежат на вкладе.</p>';
    if (!items.length) return '';
    const assigned = moneyOk(items.reduce(function (sum, item) { return sum + num(item.amount); }, 0));
    const free = Math.max(0, moneyOk(num(deposit.current) - assigned));
    const lines = items.map(function (item) {
      return '<div class="stat-row"><span>' + esc(item.label || 'Обязательство') + '</span><strong>' + rub(item.amount) + '</strong></div>';
    }).join('');
    return '<h4>Назначено</h4>' + lines + '<div class="stat-row"><span>Свободно на вкладе</span><strong>' + rub(free) + '</strong></div><p class="muted">Назначение не списывает вклад и не уменьшает обязательство.</p>';
  }

  function detailRow(deposit) {
    const cover = deposit.coverObligations === false ? 'Нет' : 'Да';
    const facts = [
      ['Последние 4 цифры', deposit.last4 ? '•••• ' + deposit.last4 : '—'],
      ['Ставка годовых', rateText(deposit.rate) + '%'],
      ['Дата открытия', dateText(deposit.open)],
      ['Дата окончания', dateText(deposit.end)],
      ['Следующее начисление', dateText(deposit.nextDate)],
      ['Ожидается процентов', rub(deposit.status === 'Получено' ? 0 : deposit.expected)],
      ['Получено процентов', rub(deposit.received)],
      ['Для покрытия обязательств', cover],
      ['Назначение денег', purposeText(deposit)]
    ];
    const factHtml = '<div class="deposit-facts">' + facts.map(function (fact) {
      return '<div><span>' + fact[0] + '</span><b>' + esc(fact[1]) + '</b></div>';
    }).join('') + '</div>';
    return '<tr class="deposit-detail-row"><td colspan="8"><div class="deposit-detail">' + factHtml + allocationBlock(deposit) + '</div></td></tr>';
  }

  function depositsByNextDate() {
    return state.deposits.map(function (deposit, index) {
      return { deposit: deposit, index: index };
    }).filter(function (item) { return !item.deposit.closed; }).sort(function (a, b) {
      const left = a.deposit.nextDate || '';
      const right = b.deposit.nextDate || '';
      if (left !== right) {
        if (!left) return 1;
        if (!right) return -1;
        return left < right ? -1 : 1;
      }
      return a.index - b.index;
    });
  }

  function depositBoard() {
    const rows = depositsByNextDate().map(function (item) {
      const deposit = item.deposit;
      const opened = openDepositId === deposit.id;
      const main = '<tr><td><strong>' + esc(deposit.bank || '—') + '</strong>' + (deposit.last4 ? '<br><span class="muted">•••• ' + esc(deposit.last4) + '</span>' : '') + '</td><td>' + esc(deposit.name || '—') + '</td><td>' + esc(deposit.owner || '—') + '</td><td><strong>' + rub(deposit.current) + '</strong><br><span class="positive">' + rateText(deposit.rate) + '% годовых</span></td><td class="deposit-next">' + dateText(deposit.nextDate) + '</td><td>' + rub(deposit.status === 'Получено' ? 0 : deposit.expected) + '</td><td>' + esc(purposeText(deposit)) + '</td><td><div class="button-row"><button class="ghost-button" type="button" onclick="toggleDepositDetail(\'' + deposit.id + '\')">' + (opened ? 'Скрыть' : 'Подробнее') + '</button><button class="ghost-button" type="button" onclick="openForm(\'deposit\',\'' + deposit.id + '\')">Изменить</button><button class="ghost-button" type="button" onclick="openCloseDeposit(\'' + deposit.id + '\')">Закрыть вклад</button><button class="ghost-button" type="button" onclick="removeDepositRecord(\'' + deposit.id + '\')">Удалить</button></div></td></tr>';
      return main + (opened ? detailRow(deposit) : '');
    }).join('');
    const table = listView('deposit', 'Вклады', 'Действующие вклады и ближайшие выплаты', 'Добавить вклад', ['Банк', 'Вклад', 'На кого оформлен', 'Сумма вклада', 'Следующее начисление', 'Ожидается', 'Назначение'], rows);
    return table + (typeof depositMonthForecast === 'function' ? depositMonthForecast() : '') + archiveBlock();
  }

  deposits = depositBoard;

  window.toggleDepositDetail = function (id) {
    openDepositId = openDepositId === id ? '' : id;
    render();
  };

  function destinationOptions() {
    const accounts = state.accounts.map(function (account) {
      const tail = account.last4 ? ' · •••• ' + account.last4 : '';
      return '<option value="account|' + esc(account.id) + '">' + esc(accountTitle(account) + tail + ' · ' + rub(account.balance)) + '</option>';
    }).join('');
    const safes = (state.safes || []).filter(function (safe) { return (safe.currency || 'RUB') === 'RUB'; }).map(function (safe) {
      const balance = (safe.operations || []).reduce(function (sum, op) {
        const amount = Math.abs(num(op.amount));
        return sum + (op.direction === 'out' ? -amount : amount);
      }, 0);
      return '<option value="safe|' + esc(safe.id) + '">Сейф · ' + esc(safe.name || 'Сейф') + ' · ' + rub(balance) + '</option>';
    }).join('');
    return accounts + safes + '<option value="other">Другое / не учитывать перевод</option>';
  }

  function archiveBlock() {
    const items = state.deposits.filter(function (deposit) { return deposit.closed; }).slice().sort(function (a, b) {
      return String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
    });
    const rows = items.map(function (deposit) {
      const where = deposit.destination && deposit.destination.label ? deposit.destination.label : '—';
      return '<tr><td><strong>' + esc(deposit.bank || '—') + '</strong></td><td>' + esc(deposit.name || '—') + '</td><td>' + (deposit.last4 ? '•••• ' + esc(deposit.last4) : '—') + '</td><td>' + rub(deposit.current) + '</td><td class="deposit-next">' + dateText(deposit.open) + '</td><td class="deposit-next">' + dateText(deposit.closedAt) + '</td><td>' + rub(deposit.closeInterest) + '</td><td>' + esc(where) + '</td></tr>';
    }).join('');
    const count = items.length;
    const word = typeof plural === 'function' ? plural(count, 'закрытый', 'закрытых', 'закрытых') : 'закрытых';
    return '<details class="deposit-archive panel"><summary>Архив вкладов · ' + count + ' ' + word + '</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Банк</th><th>Название вклада</th><th>Последние 4 цифры</th><th>Сумма вклада</th><th>Дата открытия</th><th>Дата закрытия</th><th>Получено процентов</th><th>Куда поступили деньги</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8"><div class="empty">Закрытых вкладов пока нет</div></td></tr>') + '</tbody></table></div></details>';
  }

  window.removeDepositRecord = function (id) {
    if (!confirm('Удалить ошибочно созданный вклад? Для реального закрытия используйте «Закрыть вклад».')) return;
    state.deposits = state.deposits.filter(function (item) { return item.id !== id; });
    save();
    render();
  };

  window.openCloseDeposit = function (id) {
    const deposit = state.deposits.find(function (item) { return item.id === id; });
    if (!deposit || deposit.closed) return;
    const interestDefault = deposit.status === 'Получено' ? 0 : num(deposit.expected);
    const interestValue = typeof formatMoneyInput === 'function' ? formatMoneyInput(interestDefault) : interestDefault;
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Закрыть вклад</h2><button class="close" type="button" onclick="closeModal()">×</button></div><form id="close-deposit-form"><div class="modal-body"><div class="form-grid"><div class="form-field"><label>Банк</label><input value="' + esc(deposit.bank || '—') + '" readonly></div><div class="form-field"><label>Название вклада</label><input value="' + esc(deposit.name || '—') + '" readonly></div><div class="form-field"><label>Последние 4 цифры</label><input value="' + esc(deposit.last4 ? '•••• ' + deposit.last4 : '—') + '" readonly></div><div class="form-field"><label>Сумма вклада</label><input value="' + esc(rub(deposit.current)) + '" readonly></div><div class="form-field"><label>Дата закрытия</label><input name="closedAt" type="date" value="' + isoDate(today) + '"></div><div class="form-field"><label>Фактически полученные проценты</label><input name="closeInterest" type="text" inputmode="decimal" autocomplete="off" value="' + esc(interestValue) + '"></div><div class="form-field full deposit-close-total"><label>Итого к получению</label><strong class="deposit-payout">' + rub(moneyOk(num(deposit.current) + num(interestDefault))) + '</strong></div><div class="form-field full"><label>Куда поступили деньги?</label><select name="destination"><option value="">Выберите</option>' + destinationOptions() + '</select></div></div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Закрыть вклад</button></div></form></div></div>';
    const form = document.getElementById('close-deposit-form');
    const interestInput = form.querySelector('[name="closeInterest"]');
    const payout = form.querySelector('.deposit-payout');
    const refresh = function () { payout.textContent = rub(moneyOk(num(deposit.current) + num(interestInput.value))); };
    interestInput.addEventListener('input', refresh);
    form.onsubmit = function (event) {
      event.preventDefault();
      if (form.dataset.saving === '1' || deposit.closed) return;
      const date = form.querySelector('[name="closedAt"]').value;
      const interest = moneyOk(interestInput.value);
      const target = form.querySelector('[name="destination"]').value;
      if (!date) { alert('Укажите дату закрытия.'); return; }
      if (interest < 0) { alert('Проценты не могут быть отрицательными.'); return; }
      if (!target) { alert('Укажите, куда поступили деньги.'); return; }
      const payoutAmount = moneyOk(num(deposit.current) + interest);
      const kind = target === 'other' ? 'other' : target.split('|')[0];
      const targetId = target === 'other' ? '' : target.split('|').slice(1).join('|');
      let label = 'Другое / не учитывать перевод';
      if (kind === 'account') {
        const account = state.accounts.find(function (item) { return item.id === targetId; });
        if (!account) { alert('Выберите карту или счёт.'); return; }
        account.balance = moneyOk(num(account.balance) + payoutAmount);
        label = accountTitle(account) + (account.last4 ? ' · •••• ' + account.last4 : '');
      } else if (kind === 'safe') {
        const safe = (state.safes || []).find(function (item) { return item.id === targetId; });
        if (!safe || (safe.currency || 'RUB') !== 'RUB') { alert('Выберите рублёвый сейф.'); return; }
        if (!Array.isArray(safe.operations)) safe.operations = [];
        safe.operations.push({ id: uid(), date: date, amount: payoutAmount, currency: 'RUB', direction: 'in', comment: 'Закрытие вклада «' + (deposit.name || deposit.bank || '') + '»' });
        label = 'Сейф · ' + (safe.name || 'Сейф');
      }
      form.dataset.saving = '1';
      deposit.closed = true;
      deposit.closedAt = date;
      deposit.closeInterest = interest;
      deposit.payout = payoutAmount;
      deposit.destination = { kind: kind, id: targetId, label: label };
      openDepositId = '';
      save();
      closeModal();
      render();
    };
  };

  window.openDepositOperation = function (depositId) {
    const deposit = state.deposits.find(function (item) { return item.id === depositId; });
    if (!deposit) return;
    const accounts = state.accounts.map(function (account) {
      return '<option value="' + esc(account.id) + '">' + esc(accountTitle(account) + ' · ' + rub(account.balance)) + '</option>';
    }).join('');
    const obligationsHtml = obligationChoices().map(function (item) {
      return '<option value="' + esc(item.kind + '|' + item.id) + '">' + esc(item.label + ' · осталось ' + rub(item.remaining)) + '</option>';
    }).join('');
    const closeAccounts = '<option value="">Выведены из кабинета</option>' + accounts;
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Операция · ' + esc(deposit.bank || deposit.name || 'Вклад') + '</h2><button class="close" type="button" onclick="closeModal()">×</button></div><form id="deposit-op-form"><div class="modal-body"><div class="form-grid"><div class="form-field"><label>Дата</label><input name="opDate" type="date" value="' + isoDate(today) + '"></div><div class="form-field"><label>Тип операции</label><select name="opType"><option value="personal">Внесла личные средства</option><option value="topup">Пополнение вклада</option><option value="transfer-in">Перевод с карты/счёта</option><option value="interest">Получены проценты</option><option value="pay">Оплата обязательства</option><option value="transfer-out">Вывод на карту/счёт</option><option value="close">Закрытие вклада</option></select></div><div class="form-field"><label>Сумма</label><input name="amount" type="text" inputmode="decimal" autocomplete="off"></div><div class="form-field deposit-op-only" data-op="account"><label>Карта или счёт</label><select name="opAccount">' + (accounts || '<option value="">Нет карт и счетов</option>') + '</select></div><div class="form-field deposit-op-only" data-op="obligation"><label>Обязательство</label><select name="opObligation">' + (obligationsHtml || '<option value="">Нет обязательств</option>') + '</select></div><div class="form-field deposit-op-only" data-op="close"><label>Куда вывести</label><select name="closeAccount">' + closeAccounts + '</select></div><div class="form-field full"><label>Комментарий</label><input name="opComment"></div></div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Сохранить</button></div></form></div></div>';
    const form = document.getElementById('deposit-op-form');
    const typeField = form.querySelector('[name="opType"]');
    const amountField = form.querySelector('[name="amount"]');
    const sync = function () {
      const type = typeField.value;
      form.querySelector('[data-op="account"]').hidden = type !== 'transfer-in' && type !== 'transfer-out';
      form.querySelector('[data-op="obligation"]').hidden = type !== 'pay';
      form.querySelector('[data-op="close"]').hidden = type !== 'close';
      if (type === 'close' && !amountField.dataset.touched) amountField.value = typeof formatMoneyInput === 'function' ? formatMoneyInput(deposit.current) : deposit.current;
    };
    typeField.addEventListener('change', sync);
    amountField.addEventListener('input', function () { amountField.dataset.touched = '1'; });
    sync();
    form.onsubmit = function (event) {
      event.preventDefault();
      if (form.dataset.saving === '1') return;
      const type = typeField.value;
      const target = (form.querySelector('[name="opObligation"]').value || '').split('|');
      const accountId = type === 'close' ? form.querySelector('[name="closeAccount"]').value : form.querySelector('[name="opAccount"]').value;
      form.dataset.saving = '1';
      const applied = applyDepositOperation(deposit, {
        id: uid(),
        date: form.querySelector('[name="opDate"]').value || isoDate(today),
        type: type,
        amount: amountField.value,
        accountId: accountId,
        obligationKind: target[0] || '',
        obligationId: target.slice(1).join('|'),
        comment: form.querySelector('[name="opComment"]').value.trim()
      });
      form.dataset.saving = '';
      if (!applied) return;
      openDepositId = deposit.id;
      save();
      closeModal();
      render();
    };
  };

  function purposeFields(deposit) {
    const purpose = deposit && deposit.purpose ? deposit.purpose : 'free';
    const allocation = deposit && deposit.allocations && deposit.allocations[0];
    const selected = allocation ? allocation.kind + '|' + allocation.targetId : '';
    const options = obligationChoices().map(function (item) {
      const value = item.kind + '|' + item.id;
      return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(item.label) + '</option>';
    }).join('');
    const amount = allocation ? (typeof formatMoneyInput === 'function' ? formatMoneyInput(allocation.amount) : allocation.amount) : '';
    return '<div class="form-field full"><label>Назначение денег</label><select name="depositPurpose"><option value="free"' + (purpose === 'free' ? ' selected' : '') + '>Свободные накопления</option><option value="reserve"' + (purpose === 'reserve' ? ' selected' : '') + '>Резерв на обязательства</option><option value="specific"' + (purpose === 'specific' ? ' selected' : '') + '>Конкретное обязательство</option></select></div><div class="deposit-specific"><div class="form-field"><label>Обязательство</label><select name="allocationTarget">' + (options || '<option value="">Нет обязательств</option>') + '</select></div><div class="form-field"><label>Сумма резерва</label><input name="allocationAmount" type="text" inputmode="decimal" autocomplete="off" value="' + esc(amount) + '"><small class="muted">Деньги остаются на вкладе. Обязательство уменьшится только после операции «Оплата обязательства».</small></div></div>';
  }

  function keepMovements(form, type, id) {
    const list = state[type + 's'];
    const previous = id && list ? list.find(function (item) { return item.id === id; }) : null;
    const movements = previous && previous.movements ? previous.movements.slice() : null;
    const previousSubmit = form.onsubmit;
    if (!previousSubmit || !movements) return;
    form.onsubmit = function (event) {
      previousSubmit.call(form, event);
      const saved = state[type + 's'].find(function (item) { return item.id === id; });
      if (!saved) return;
      saved.movements = movements;
      save();
      render();
    };
  }

  const baseOpenForm = window.openForm;
  window.openForm = function (type, id) {
    baseOpenForm(type, id);
    const form = document.getElementById('record-form');
    if (!form) return;
    if (type === 'account' || type === 'debt') { keepMovements(form, type, id); return; }
    if (type !== 'deposit' && type !== 'quick') return;
    const grid = form.querySelector('.form-grid');
    if (!grid || grid.querySelector('[name="depositPurpose"]')) return;
    const deposit = id ? state.deposits.find(function (item) { return item.id === id; }) : null;
    grid.insertAdjacentHTML('beforeend', purposeFields(deposit));
    const purposeSelect = grid.querySelector('[name="depositPurpose"]');
    const specific = grid.querySelector('.deposit-specific');
    const syncPurpose = function () { specific.hidden = purposeSelect.value !== 'specific'; };
    purposeSelect.addEventListener('change', syncPurpose);
    syncPurpose();
    const allocationInput = grid.querySelector('[name="allocationAmount"]');
    if (allocationInput && typeof bindMoneyInput === 'function') bindMoneyInput(allocationInput);
    const previousSubmit = form.onsubmit;
    form.onsubmit = function (event) {
      const chosen = purposeSelect.value;
      const target = grid.querySelector('[name="allocationTarget"]').value;
      const reserved = num(allocationInput.value);
      if (chosen === 'specific' && !target) {
        event.preventDefault();
        alert('Выберите обязательство для назначения денег.');
        return;
      }
      const snapshot = deposit ? { movements: (deposit.movements || []).slice(), initial: deposit.initial, allocations: (deposit.allocations || []).slice(), closed: deposit.closed, closedAt: deposit.closedAt, closeInterest: deposit.closeInterest, payout: deposit.payout, destination: deposit.destination } : null;
      const before = state.deposits.map(function (item) { return item.id; });
      previousSubmit.call(form, event);
      const saved = id ? state.deposits.find(function (item) { return item.id === id; }) : state.deposits.filter(function (item) { return before.indexOf(item.id) < 0; })[0];
      if (!saved) return;
      saved.movements = snapshot ? snapshot.movements : (saved.movements || []);
      if (snapshot && snapshot.initial != null && snapshot.initial !== '') saved.initial = snapshot.initial;
      else if (saved.initial == null || saved.initial === '') saved.initial = saved.current;
      saved.purpose = chosen === 'reserve' || chosen === 'specific' ? chosen : 'free';
      delete saved.depositPurpose;
      delete saved.allocationTarget;
      delete saved.allocationAmount;
      if (saved.purpose === 'specific') {
        const parts = target.split('|');
        const kind = parts[0];
        const targetId = parts.slice(1).join('|');
        const found = obligationChoices().filter(function (item) { return item.kind === kind && item.id === targetId; })[0];
        const previousAllocation = snapshot && snapshot.allocations ? snapshot.allocations.filter(function (item) { return item.targetId === targetId && item.kind === kind; })[0] : null;
        const first = { id: previousAllocation ? previousAllocation.id : uid(), kind: kind, targetId: targetId, label: found ? found.label : (previousAllocation && previousAllocation.label) || '', amount: reserved > 0 ? moneyOk(reserved) : moneyOk(saved.current) };
        saved.allocations = [first];
      } else saved.allocations = [];
      if (!Array.isArray(saved.movements)) saved.movements = [];
      if (snapshot && snapshot.closed) {
        saved.closed = true;
        saved.closedAt = snapshot.closedAt;
        saved.closeInterest = snapshot.closeInterest;
        saved.payout = snapshot.payout;
        saved.destination = snapshot.destination;
      }
      save();
      render();
    };
  };

  function obligationFlowHtml(item) {
    let rows = [];
    if (item.kind === 'manual' && item.debt && item.debt.movements) rows = item.debt.movements;
    if (item.kind === 'asset' && item.asset) {
      rows = assetPayments(item.asset).filter(function (payment) { return payment.fromDeposit || payment.linkId; }).map(function (payment) {
        return { date: payment.paidDate || payment.date, amount: payment.paidAmount != null && payment.paidAmount !== '' ? payment.paidAmount : payment.amount, text: payment.comment || '' };
      });
    }
    if (!rows.length) return '';
    return '<div class="payment-group deposit-link-note"><h4>Оплаты со вкладов</h4>' + rows.map(function (row) {
      return '<div class="compact-payment compact-paid"><strong>' + dateText(row.date) + ' · ' + rub(row.amount) + '</strong><span>' + esc(row.text || '') + '</span></div>';
    }).join('') + '</div>';
  }

  if (typeof compactObligationCard === 'function') {
    const baseObligationCard = compactObligationCard;
    compactObligationCard = function (item) {
      const html = baseObligationCard(item);
      const note = obligationFlowHtml(item);
      if (!note) return html;
      return html.replace('</article>', note + '</article>');
    };
  }

  if (typeof activeView !== 'undefined' && activeView === 'deposits') render();
})();
