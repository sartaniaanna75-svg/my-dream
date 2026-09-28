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
    const kind = /карт/i.test(account.type || '') ? 'Карта' : (account.type || 'Счёт');
    return kind + ' ' + (account.bank || '');
  }

  function accountChoiceLabel(account) {
    const bank = account.bank || 'Счёт';
    const tail = account.last4 ? '•••• ' + account.last4 : '';
    const owner = String(account.owner || '').trim();
    const code = account.currency || 'RUB';
    return [bank + (tail ? ' ' + tail : ''), owner, code].filter(Boolean).join(' · ');
  }

  function cabinetRate(code) {
    if (!code || code === 'RUB') return 1;
    const cabinet = num(state.fx && state.fx[code]);
    if (cabinet > 0) return cabinet;
    if (typeof window.liveRate === 'function') {
      const rate = window.liveRate(code);
      if (num(rate) > 0) return num(rate);
    }
    return 0;
  }

  function ratePlain(rate) {
    if (!(num(rate) > 0)) return '';
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(num(rate));
  }

  function accountOriginal(account, amount) {
    const code = (account && account.currency) || 'RUB';
    const value = amount == null ? account.balance : amount;
    if (typeof moneyOriginal === 'function') return moneyOriginal(value, code);
    return rub(value);
  }

  function rememberAnchor(account) {
    const code = (account && account.currency) || 'RUB';
    const rate = cabinetRate(code);
    if (rate > 0) account.rateAnchor = rate;
  }

  function pushAccountMovement(account, movement) {
    if (!account) return false;
    if (!Array.isArray(account.movements)) account.movements = [];
    if (movement.id && account.movements.some(function (item) { return item.id === movement.id; })) return false;
    const amount = moneyOk(movement.amount);
    if (!(amount > 0)) return false;
    const direction = movement.direction === 'out' ? 'out' : 'in';
    if (direction === 'out' && moneyOk(account.balance) + 0.001 < amount) return false;
    account.balance = moneyOk(num(account.balance) + (direction === 'out' ? -amount : amount));
    account.movements.push({
      id: movement.id || uid(),
      date: movement.date || isoDate(today),
      type: movement.type || (direction === 'out' ? 'Списание' : 'Пополнение'),
      amount: amount,
      direction: direction,
      currency: account.currency || 'RUB',
      comment: movement.comment || '',
      text: movement.text || movement.comment || movement.type || ''
    });
    rememberAnchor(account);
    return true;
  }

  window.receiveRentOnAccount = function (asset, payment, accountId) {
    if (!payment || payment.credited) return;
    const id = accountId || (asset && asset.rent && asset.rent.accountId) || '';
    if (!id) return;
    const account = state.accounts.find(function (item) { return item.id === id; });
    if (!account) return;
    const currency = payment.currency || (asset && asset.rent && asset.rent.currency) || (asset && asset.currency) || 'RUB';
    if ((account.currency || 'RUB') !== currency) {
      alert('Валюта счёта не совпадает с валютой аренды. Остаток счёта не изменён.');
      return;
    }
    const name = asset && asset.name ? asset.name : 'Объект';
    const moved = pushAccountMovement(account, {
      id: 'rent-' + payment.id,
      date: payment.receivedAt || isoDate(today),
      type: 'Аренда',
      amount: num(payment.amount),
      direction: 'in',
      comment: name,
      text: 'Аренда — ' + name
    });
    if (moved) payment.credited = true;
  };

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
      if ((account.currency || 'RUB') !== 'RUB') { alert('Вклад в рублях можно перевести только на рублёвый счёт.'); return false; }
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
        account.movements.push({ id: draft.id, date: draft.date, amount: amount, text: text, type: type === 'transfer-in' ? 'Перевод' : 'Пополнение', direction: type === 'transfer-in' ? 'out' : 'in', currency: account.currency || 'RUB', comment: text, depositId: deposit.id });
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

  function ownerKey(value) {
    return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function sameOwner(left, right) {
    const key = ownerKey(left);
    return key !== '' && key === ownerKey(right);
  }

  function accountDestinationText(account) {
    return accountChoiceLabel(account) + ' · ' + accountOriginal(account);
  }

  function accountOption(account) {
    return '<option value="account|' + esc(account.id) + '">' + esc(accountDestinationText(account)) + '</option>';
  }

  function safeStoredBalance(safe) {
    return (safe.operations || []).reduce(function (sum, op) {
      const amount = Math.abs(num(op.amount));
      return sum + (op.direction === 'out' ? -amount : amount);
    }, 0);
  }

  function ownerOwnsSafe(safe, owner) {
    const name = ownerKey(safe && (safe.owner || safe.name));
    const who = ownerKey(owner);
    if (!name || !who) return false;
    return name === who || who.indexOf(name + ' ') === 0 || name.indexOf(who + ' ') === 0;
  }

  function safeDestinationOptions() {
    return (state.safes || []).filter(function (safe) { return (safe.currency || 'RUB') === 'RUB'; }).map(function (safe) {
      return '<option value="safe|' + esc(safe.id) + '">Сейф · ' + esc(safe.name || 'Сейф') + ' · ' + rub(safeStoredBalance(safe)) + '</option>';
    }).join('');
  }

  function fundingOptions(owner, kind) {
    if (!ownerKey(owner)) return '<option value="">Сначала укажите, на кого оформлен вклад</option>';
    if (kind === 'safe') {
      const safes = (state.safes || []).filter(function (safe) {
        return (safe.currency || 'RUB') === 'RUB' && ownerOwnsSafe(safe, owner);
      });
      if (!safes.length) return '<option value="">Нет рублёвого сейфа этого владельца</option>';
      return '<option value="">Выберите сейф</option>' + safes.map(function (safe) {
        return '<option value="safe|' + esc(safe.id) + '">Сейф · ' + esc(safe.name || 'Сейф') + ' · ' + rub(safeStoredBalance(safe)) + '</option>';
      }).join('');
    }
    const accounts = state.accounts.filter(function (account) {
      return (account.currency || 'RUB') === 'RUB' && sameOwner(account.owner, owner);
    });
    if (!accounts.length) return '<option value="">Нет рублёвых карт и счетов этого владельца</option>';
    return '<option value="">Выберите карту или счёт</option>' + accounts.map(function (account) {
      return '<option value="account|' + esc(account.id) + '">' + esc(accountDestinationText(account)) + '</option>';
    }).join('');
  }

  function shortageMessage(kind, account, available) {
    return 'На выбранном источнике недостаточно средств. Доступно: ' + rub(available);
  }

  function fundingBalance(sourceValue) {
    const parts = String(sourceValue || '').split('|');
    const kind = parts[0];
    const targetId = parts.slice(1).join('|');
    if (kind === 'account') {
      const account = state.accounts.find(function (item) { return item.id === targetId; });
      if (!account || (account.currency || 'RUB') !== 'RUB') return null;
      return { kind: kind, id: targetId, account: account, available: moneyOk(account.balance) };
    }
    if (kind === 'safe') {
      const safe = (state.safes || []).find(function (item) { return item.id === targetId; });
      if (!safe || (safe.currency || 'RUB') !== 'RUB') return null;
      return { kind: kind, id: targetId, safe: safe, available: moneyOk(safeStoredBalance(safe)) };
    }
    return null;
  }

  function applyOpeningFunding(deposit, sourceValue, amount) {
    const source = fundingBalance(sourceValue);
    const moveId = 'open-fund-' + deposit.id;
    if ((deposit.movements || []).some(function (item) { return item.id === moveId; })) return true;
    if (!source || source.available + 0.001 < amount) return false;
    const name = deposit.name || deposit.bank || 'Вклад';
    const date = deposit.open || isoDate(today);
    let label = '';
    if (source.kind === 'account') {
      const moved = pushAccountMovement(source.account, {
        id: moveId,
        date: date,
        type: 'Перевод',
        amount: amount,
        direction: 'out',
        comment: 'Открытие вклада «' + name + '». Перевод своих денег, не расход.',
        text: 'Перевод на вклад «' + name + '»'
      });
      if (!moved) return false;
      label = accountTitle(source.account);
    } else {
      if (!Array.isArray(source.safe.operations)) source.safe.operations = [];
      if (!source.safe.operations.some(function (op) { return op.id === moveId; })) {
        source.safe.operations.push({
          id: moveId,
          date: date,
          amount: amount,
          currency: 'RUB',
          direction: 'out',
          comment: 'Открытие вклада «' + name + '». Перевод своих денег, не расход.'
        });
      }
      label = 'Сейф ' + (source.safe.name || 'Сейф');
    }
    if (!Array.isArray(deposit.movements)) deposit.movements = [];
    deposit.movements.push({
      id: moveId,
      date: date,
      type: 'transfer-in',
      flow: 'open',
      amount: amount,
      direction: 'in',
      internal: true,
      income: false,
      text: 'Открытие вклада — ' + rub(amount) + ' с ' + label,
      title: 'Открытие вклада',
      route: label + ' → Вклад «' + name + '»'
    });
    deposit.funding = { kind: source.kind, id: source.id, label: label, amount: amount, date: date };
    return true;
  }

  function applyPersonalOpening(deposit, amount) {
    const moveId = 'open-fund-' + deposit.id;
    if ((deposit.movements || []).some(function (item) { return item.id === moveId; })) return true;
    const name = deposit.name || deposit.bank || 'Вклад';
    const date = deposit.open || isoDate(today);
    if (!Array.isArray(deposit.movements)) deposit.movements = [];
    deposit.movements.push({
      id: moveId,
      date: date,
      type: 'transfer-in',
      flow: 'open',
      amount: amount,
      direction: 'in',
      internal: false,
      income: false,
      source: 'personal',
      text: 'Открытие вклада — ' + rub(amount) + '. Источник: личные средства',
      title: 'Открытие вклада',
      route: 'Личные средства → Вклад «' + name + '»'
    });
    deposit.funding = { kind: 'personal', id: '', label: 'Личные средства', amount: amount, date: date };
    return true;
  }

  function destinationOptions(deposit, mode) {
    const mine = [];
    const others = [];
    state.accounts.forEach(function (account) {
      if (sameOwner(account.owner, deposit.owner)) mine.push(account);
      else others.push(account);
    });
    const mineHtml = mine.length ? mine.map(accountOption).join('') : '<option value="" disabled>Нет счетов этого владельца</option>';
    let html = '<option value="">Выберите</option><optgroup label="Счета владельца вклада">' + mineHtml + '</optgroup>';
    if (mode === 'all') {
      if (others.length) html += '<optgroup label="Другие счета">' + others.map(accountOption).join('') + '</optgroup>';
      const safes = safeDestinationOptions();
      if (safes) html += '<optgroup label="Сейф">' + safes + '</optgroup>';
    }
    return html + '<option value="other">Другое / не учитывать перевод</option>';
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
    const bookPrincipal = moneyOk(deposit.current);
    const interestDefault = deposit.status === 'Получено' ? 0 : num(deposit.expected);
    const interestOn = interestDefault > 0;
    const interestValue = typeof formatMoneyInput === 'function' ? formatMoneyInput(interestDefault) : interestDefault;
    const principalValue = typeof formatMoneyInput === 'function' ? formatMoneyInput(bookPrincipal) : bookPrincipal;
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><h2>Закрыть вклад</h2><button class="close" type="button" onclick="closeModal()">×</button></div><form id="close-deposit-form"><div class="modal-body"><div class="form-grid"><div class="form-field"><label>Банк</label><input value="' + esc(deposit.bank || '—') + '" readonly></div><div class="form-field"><label>Название вклада</label><input value="' + esc(deposit.name || '—') + '" readonly></div><div class="form-field"><label>Последние 4 цифры</label><input value="' + esc(deposit.last4 ? '•••• ' + deposit.last4 : '—') + '" readonly></div><div class="form-field"><label>Фактически получено по основной сумме</label><input name="closePrincipal" type="text" inputmode="decimal" autocomplete="off" value="' + esc(principalValue) + '"></div><div class="form-field"><label>Дата закрытия</label><input name="closedAt" type="date" value="' + isoDate(today) + '"></div><div class="form-field full"><label><input name="interestReceived" type="checkbox"' + (interestOn ? ' checked' : '') + '> Проценты получены</label><small class="muted">Основная сумма — возврат своих денег, это не доход. В доход попадает только сумма процентов.</small></div><div class="form-field deposit-interest-field"' + (interestOn ? '' : ' hidden') + '><label>Фактически полученные проценты</label><input name="closeInterest" type="text" inputmode="decimal" autocomplete="off" value="' + esc(interestValue) + '"></div><div class="form-field full deposit-close-total"><label>На выбранную карту или счёт поступит</label><strong class="deposit-payout">' + rub(moneyOk(bookPrincipal + (interestOn ? num(interestDefault) : 0))) + '</strong><small class="muted">Доход от капитала: <b class="deposit-income">' + rub(interestOn ? interestDefault : 0) + '</b></small></div><div class="form-field full"><label>Куда зачислить деньги</label><div class="deposit-owner-filter"><span>Владелец:</span><button type="button" class="ghost-button' + (ownerKey(deposit.owner) ? ' is-active' : '') + '" data-filter="owner">Владелец вклада</button><button type="button" class="ghost-button' + (ownerKey(deposit.owner) ? '' : ' is-active') + '" data-filter="all">Все</button></div><select name="destination">' + destinationOptions(deposit, ownerKey(deposit.owner) ? 'owner' : 'all') + '</select></div></div></div><div class="modal-footer"><button type="button" class="ghost-button" onclick="closeModal()">Отмена</button><button class="primary-button">Закрыть вклад</button></div></form></div></div>';
    const form = document.getElementById('close-deposit-form');
    const principalInput = form.querySelector('[name="closePrincipal"]');
    const interestInput = form.querySelector('[name="closeInterest"]');
    const interestFlag = form.querySelector('[name="interestReceived"]');
    const interestField = form.querySelector('.deposit-interest-field');
    const payout = form.querySelector('.deposit-payout');
    const incomeNote = form.querySelector('.deposit-income');
    const interestNow = function () { return interestFlag.checked ? moneyOk(interestInput.value) : 0; };
    const principalNow = function () { return moneyOk(principalInput.value); };
    const refresh = function () {
      const interest = interestNow();
      interestField.hidden = !interestFlag.checked;
      payout.textContent = rub(moneyOk(principalNow() + interest));
      incomeNote.textContent = rub(interest);
    };
    principalInput.addEventListener('input', refresh);
    interestInput.addEventListener('input', refresh);
    interestFlag.addEventListener('change', refresh);
    const destinationSelect = form.querySelector('[name="destination"]');
    form.querySelectorAll('[data-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        const current = destinationSelect.value;
        form.querySelectorAll('[data-filter]').forEach(function (item) { item.classList.toggle('is-active', item === button); });
        destinationSelect.innerHTML = destinationOptions(deposit, button.getAttribute('data-filter'));
        const stillThere = [].some.call(destinationSelect.options, function (option) { return option.value === current && !option.disabled; });
        if (stillThere) destinationSelect.value = current;
      });
    });
    form.onsubmit = function (event) {
      event.preventDefault();
      if (form.dataset.saving === '1' || deposit.closed) return;
      const date = form.querySelector('[name="closedAt"]').value;
      const interest = interestNow();
      const target = form.querySelector('[name="destination"]').value;
      const principal = principalNow();
      if (!date) { alert('Укажите дату закрытия.'); return; }
      if (!(principal > 0)) { alert('Укажите фактически полученную основную сумму.'); return; }
      if (interest < 0) { alert('Проценты не могут быть отрицательными.'); return; }
      if (interestFlag.checked && !(interest > 0)) { alert('Укажите сумму полученных процентов или снимите отметку.'); return; }
      if (!target) { alert('Укажите, куда поступили деньги.'); return; }
      form.dataset.saving = '1';
      const payoutAmount = moneyOk(principal + interest);
      const kind = target === 'other' ? 'other' : target.split('|')[0];
      const targetId = target === 'other' ? '' : target.split('|').slice(1).join('|');
      const depositName = deposit.name || deposit.bank || 'Вклад';
      const payoutId = 'close-payout-' + deposit.id;
      let label = 'Другое / не учитывать перевод';
      if (kind === 'account') {
        const account = state.accounts.find(function (item) { return item.id === targetId; });
        if (!account) { form.dataset.saving = ''; alert('Выберите карту или счёт.'); return; }
        if ((account.currency || 'RUB') !== 'RUB') { form.dataset.saving = ''; alert('Рублёвый вклад можно зачислить только на рублёвую карту или счёт.'); return; }
        const moved = pushAccountMovement(account, {
          id: payoutId,
          date: date,
          type: 'Пополнение',
          amount: payoutAmount,
          direction: 'in',
          comment: 'Закрытие вклада «' + depositName + '»: тело ' + rub(principal) + (interest > 0 ? ', проценты ' + rub(interest) : '') + '.',
          text: 'Закрытие вклада — основная сумма ' + rub(principal) + (interest > 0 ? ', проценты ' + rub(interest) : '')
        });
        if (!moved && !(account.movements || []).some(function (item) { return item.id === payoutId; })) { form.dataset.saving = ''; alert('Не удалось зачислить деньги на выбранную карту.'); return; }
        label = (account.bank || '—') + ' · ' + (String(account.owner || '').trim() || '—') + (account.last4 ? ' · •••• ' + account.last4 : '');
      } else if (kind === 'safe') {
        const safe = (state.safes || []).find(function (item) { return item.id === targetId; });
        if (!safe || (safe.currency || 'RUB') !== 'RUB') { form.dataset.saving = ''; alert('Выберите рублёвый сейф.'); return; }
        if (!Array.isArray(safe.operations)) safe.operations = [];
        if (!safe.operations.some(function (op) { return op.id === payoutId; })) {
          safe.operations.push({ id: payoutId, date: date, amount: payoutAmount, currency: 'RUB', direction: 'in', comment: 'Закрытие вклада «' + depositName + '»: тело ' + rub(principal) + (interest > 0 ? ', проценты ' + rub(interest) : '') + '.' });
        }
        label = 'Сейф · ' + (safe.name || 'Сейф');
      }
      if (!Array.isArray(deposit.movements)) deposit.movements = [];
      if (!deposit.movements.some(function (item) { return item.id === 'close-body-' + deposit.id; })) {
        deposit.movements.push({
          id: 'close-body-' + deposit.id,
          date: date,
          type: 'close',
          flow: 'close',
          amount: principal,
          principal: principal,
          interest: interest,
          payout: payoutAmount,
          destinationLabel: label,
          direction: 'out',
          internal: true,
          income: false,
          title: 'Закрытие вклада «' + depositName + '»',
          text: 'Закрытие вклада — основная сумма ' + rub(principal) + ' → ' + label
        });
      }
      if (interest > 0 && !deposit.movements.some(function (item) { return item.id === 'close-interest-' + deposit.id; })) {
        deposit.movements.push({
          id: 'close-interest-' + deposit.id,
          date: date,
          type: 'interest',
          amount: interest,
          direction: 'in',
          income: true,
          text: 'Получены проценты по вкладу — ' + rub(interest),
          comment: 'Доход от капитала'
        });
        deposit.received = moneyOk(num(deposit.received) + interest);
      }
      deposit.current = principal;
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
      return '<option value="' + esc(account.id) + '">' + esc(accountChoiceLabel(account) + ' · ' + accountOriginal(account)) + '</option>';
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

  const ACCOUNT_PURPOSES = ['Личные средства', 'Доход от аренды', 'Для обязательств', 'Накопления', 'Другое'];

  function accountPurposeFields(record) {
    const stored = record && record.purpose ? record.purpose : 'Личные средства';
    const known = ACCOUNT_PURPOSES.indexOf(stored) >= 0;
    const selected = known ? stored : 'Другое';
    const custom = known ? '' : stored;
    const options = ACCOUNT_PURPOSES.map(function (item) {
      return '<option value="' + esc(item) + '"' + (item === selected ? ' selected' : '') + '>' + esc(item) + '</option>';
    }).join('');
    const assetId = record && record.linkedAssetId || '';
    const assets = (state.assets || []).map(function (asset) {
      const place = asset.description ? ' — ' + asset.description : '';
      return '<option value="' + esc(asset.id) + '"' + (asset.id === assetId ? ' selected' : '') + '>' + esc((asset.name || 'Объект') + place) + '</option>';
    }).join('');
    return '<div class="form-field"><label>Назначение счёта</label><select name="accountPurpose">' + options + '</select></div><div class="form-field account-purpose-custom"' + (selected === 'Другое' ? '' : ' hidden') + '><label>Своё назначение</label><input name="accountPurposeCustom" value="' + esc(custom) + '"></div><div class="form-field account-purpose-asset"' + (selected === 'Доход от аренды' ? '' : ' hidden') + '><label>Объект</label><select name="linkedAssetId"><option value="">Выберите объект</option>' + assets + '</select></div><p class="account-fx-note" hidden></p>';
  }

  function attachAccountCurrency(form, id) {
    const grid = form.querySelector('.form-grid');
    if (!grid || grid.querySelector('[name="currency"]')) return;
    const record = id ? state.accounts.find(function (item) { return item.id === id; }) : null;
    const code = (record && record.currency) || 'RUB';
    const last4 = grid.querySelector('[name="last4"]');
    const last4Field = last4 && last4.closest('.form-field');
    const currencyHtml = '<div class="form-field"><label>Валюта счёта</label><select name="currency" data-currency-catalog="1"><option>' + esc(code) + '</option></select></div>';
    if (last4Field) last4Field.insertAdjacentHTML('afterend', currencyHtml);
    else grid.insertAdjacentHTML('beforeend', currencyHtml);
    const balance = grid.querySelector('[name="balance"]');
    const balanceField = balance && balance.closest('.form-field');
    if (balanceField) balanceField.insertAdjacentHTML('afterend', accountPurposeFields(record));
    else grid.insertAdjacentHTML('beforeend', accountPurposeFields(record));
    const select = grid.querySelector('[name="currency"]');
    if (window.attachCurrencyPicker) window.attachCurrencyPicker(select, { allowRub: true });
    const note = grid.querySelector('.account-fx-note');
    const purpose = grid.querySelector('[name="accountPurpose"]');
    const custom = grid.querySelector('.account-purpose-custom');
    const assetWrap = grid.querySelector('.account-purpose-asset');
    const syncPurpose = function () {
      custom.hidden = purpose.value !== 'Другое';
      assetWrap.hidden = purpose.value !== 'Доход от аренды';
    };
    const syncRate = function () {
      const chosen = select.value || 'RUB';
      const foreign = chosen && chosen !== 'RUB' && chosen !== '__OTHER__' && chosen !== '__ADD__';
      note.hidden = !foreign;
      if (!foreign) { note.textContent = ''; return; }
      const amount = num(balance && balance.value);
      const rate = cabinetRate(chosen);
      note.textContent = rate > 0
        ? 'Текущий курс: 1 ' + chosen + ' = ' + ratePlain(rate) + ' ₽. Рублёвый эквивалент: ' + rub(roundMoney(amount * rate)) + '.'
        : 'Текущий курс ' + chosen + ' не задан. Укажите его в Настройках → Курсы валют.';
    };
    purpose.addEventListener('change', syncPurpose);
    select.addEventListener('change', syncRate);
    if (balance) balance.addEventListener('input', syncRate);
    syncPurpose();
    syncRate();
    const previousSubmit = form.onsubmit;
    form.onsubmit = function (event) {
      if (!String(form.elements.owner && form.elements.owner.value || '').trim()) { event.preventDefault(); alert('Укажите владельца счёта.'); return; }
      if (window.currencyReady && !window.currencyReady(select)) { event.preventDefault(); alert('Выберите валюту.'); return; }
      const chosen = select.value || 'RUB';
      const purposeValue = purpose.value === 'Другое' ? (String(grid.querySelector('[name="accountPurposeCustom"]').value || '').trim() || 'Другое') : purpose.value;
      const linked = purpose.value === 'Доход от аренды' ? grid.querySelector('[name="linkedAssetId"]').value : '';
      if (purpose.value === 'Доход от аренды' && !linked) { event.preventDefault(); alert('Выберите объект, с которого поступает аренда.'); return; }
      const previous = id ? state.accounts.find(function (item) { return item.id === id; }) : null;
      const oldBalance = previous ? num(previous.balance) : null;
      const oldCurrency = previous ? (previous.currency || 'RUB') : chosen;
      const oldMovements = previous && previous.movements ? previous.movements.map(function (item) { return Object.assign({}, item); }) : [];
      const before = state.accounts.map(function (item) { return item.id; });
      if (previousSubmit) previousSubmit.call(form, event);
      const saved = id
        ? state.accounts.find(function (item) { return item.id === id; })
        : state.accounts.filter(function (item) { return before.indexOf(item.id) < 0; })[0];
      if (!saved) return;
      saved.currency = chosen;
      saved.purpose = purposeValue;
      saved.linkedAssetId = linked;
      delete saved.accountPurpose;
      delete saved.accountPurposeCustom;
      saved.movements = oldMovements;
      if (previous && previous.fxRate != null && previous.fxRate !== '') saved.fxRate = previous.fxRate;
      const nextBalance = num(saved.balance);
      const balanceChanged = previous && oldCurrency === chosen && Math.abs(nextBalance - oldBalance) > 0.009;
      if (balanceChanged) {
        const delta = moneyOk(nextBalance - oldBalance);
        saved.movements.push({
          id: uid(),
          date: isoDate(today),
          type: delta > 0 ? 'Пополнение' : 'Списание',
          amount: Math.abs(delta),
          direction: delta > 0 ? 'in' : 'out',
          currency: chosen,
          comment: 'Изменение остатка',
          text: 'Изменение остатка'
        });
        rememberAnchor(saved);
      } else if (previous && oldCurrency === chosen && num(previous.rateAnchor) > 0) saved.rateAnchor = previous.rateAnchor;
      else rememberAnchor(saved);
      save();
      render();
    };
  }

  function attachRecordCurrency(form, type, id) {
    if (type === 'account') { attachAccountCurrency(form, id); return; }
    const grid = form.querySelector('.form-grid');
    if (!grid || grid.querySelector('[name="currency"]')) return;
    const list = state[type + 's'] || [];
    const record = id ? list.find(function (item) { return item.id === id; }) : null;
    const code = (record && record.currency) || 'RUB';
    const rate = record && record.fxRate != null && record.fxRate !== '' ? String(record.fxRate).replace('.', ',') : '';
    const amountName = 'total';
    grid.insertAdjacentHTML('beforeend', '<div class="form-field"><label>Валюта</label><select name="currency" data-currency-catalog="1"><option>' + esc(code) + '</option></select></div><div class="form-field record-fx-rate"' + (code === 'RUB' ? ' hidden' : '') + '><label>Курс к рублю</label><input name="fxRate" inputmode="decimal" autocomplete="off" value="' + esc(rate) + '"></div><p class="record-fx-eq"' + (code === 'RUB' ? ' hidden' : '') + '></p>');
    const select = grid.querySelector('[name="currency"]');
    if (window.attachCurrencyPicker) window.attachCurrencyPicker(select, { allowRub: true });
    const rateWrap = grid.querySelector('.record-fx-rate');
    const eq = grid.querySelector('.record-fx-eq');
    const rateInput = grid.querySelector('[name="fxRate"]');
    const sync = function () {
      const foreign = select.value && select.value !== 'RUB';
      rateWrap.hidden = !foreign;
      eq.hidden = !foreign;
      if (!foreign) return;
      const amount = num(form.elements[amountName] && form.elements[amountName].value);
      const fx = num(rateInput.value);
      eq.textContent = fx > 0 ? 'Эквивалент: ' + rub(roundMoney(amount * fx)) : 'Укажите курс к рублю';
    };
    select.addEventListener('change', sync);
    rateInput.addEventListener('input', sync);
    if (form.elements[amountName]) form.elements[amountName].addEventListener('input', sync);
    sync();
    const previousSubmit = form.onsubmit;
    form.onsubmit = function (event) {
      if (window.currencyReady && !window.currencyReady(select)) { event.preventDefault(); alert('Выберите валюту.'); return; }
      const chosen = select.value || 'RUB';
      const fx = chosen === 'RUB' ? '' : num(rateInput.value);
      if (chosen !== 'RUB' && !(fx > 0)) { event.preventDefault(); alert('Укажите курс к рублю.'); return; }
      const before = (state[type + 's'] || []).map(function (item) { return item.id; });
      if (previousSubmit) previousSubmit.call(form, event);
      const saved = id
        ? (state[type + 's'] || []).find(function (item) { return item.id === id; })
        : (state[type + 's'] || []).filter(function (item) { return before.indexOf(item.id) < 0; })[0];
      if (!saved) return;
      saved.currency = chosen;
      saved.fxRate = fx;
      save();
      render();
    };
  }

  const baseOpenForm = window.openForm;
  window.openForm = function (type, id) {
    baseOpenForm(type, id);
    const form = document.getElementById('record-form');
    if (!form) return;
    if (type === 'account' || type === 'debt') {
      keepMovements(form, type, id);
      attachRecordCurrency(form, type, id);
      return;
    }
    if (type !== 'deposit' && type !== 'quick') return;
    const grid = form.querySelector('.form-grid');
    if (!grid || grid.querySelector('[name="depositPurpose"]')) return;
    const deposit = id ? state.deposits.find(function (item) { return item.id === id; }) : null;
    grid.insertAdjacentHTML('beforeend', purposeFields(deposit));
    if (!id) {
      grid.insertAdjacentHTML('beforeend', '<div class="form-field full deposit-funding"><p class="eyebrow">ОТКУДА ДЕНЬГИ НА ВКЛАД</p><label>Тип источника</label><div class="deposit-owner-filter"><label><input type="radio" name="fundingKind" value="account" checked> Карта / счёт</label><label><input type="radio" name="fundingKind" value="safe"> Сейф</label><label><input type="radio" name="fundingKind" value="personal"> Личные средства</label></div><div class="deposit-funding-source"><label>Конкретный источник</label><select name="fundingSource"></select></div><small class="muted">Деньги переносятся с выбранной карты, счёта или сейфа на вклад. Это не расход и не доход.</small></div>');
    }
    const purposeSelect = grid.querySelector('[name="depositPurpose"]');
    const specific = grid.querySelector('.deposit-specific');
    const syncPurpose = function () { specific.hidden = purposeSelect.value !== 'specific'; };
    purposeSelect.addEventListener('change', syncPurpose);
    syncPurpose();
    const allocationInput = grid.querySelector('[name="allocationAmount"]');
    if (allocationInput && typeof bindMoneyInput === 'function') bindMoneyInput(allocationInput);
    const previousSubmit = form.onsubmit;
    const fundingPanel = grid.querySelector('.deposit-funding');
    const fundingSelect = fundingPanel && fundingPanel.querySelector('[name="fundingSource"]');
    if (fundingPanel) {
      const fundingKindNow = function () {
        const picked = fundingPanel.querySelector('[name="fundingKind"]:checked');
        return picked && picked.value === 'safe' ? 'safe' : 'account';
      };
      const refillFunding = function () {
        const owner = String(form.elements.owner && form.elements.owner.value || '').trim();
        const current = fundingSelect.value;
        fundingSelect.innerHTML = fundingOptions(owner, fundingKindNow());
        const stillThere = [].some.call(fundingSelect.options, function (option) { return option.value && option.value === current; });
        if (stillThere) fundingSelect.value = current;
      };
      const sourceBox = fundingPanel.querySelector('.deposit-funding-source');
      const fundingHint = fundingPanel.querySelector('small');
      const fundingChoice = function () {
        const picked = fundingPanel.querySelector('[name="fundingKind"]:checked');
        return picked ? picked.value : 'account';
      };
      const syncFundingKind = function () {
        const personal = fundingChoice() === 'personal';
        if (sourceBox) sourceBox.hidden = personal;
        if (fundingHint) fundingHint.textContent = personal ? 'Деньги вносятся извне и раньше не учитывались в кабинете. Карты, счета и сейф не меняются. Это не доход от капитала.' : 'Деньги переносятся с выбранной карты, счёта или сейфа на вклад. Это не расход и не доход.';
        if (!personal) refillFunding();
      };
      fundingPanel.querySelectorAll('[name="fundingKind"]').forEach(function (input) {
        input.addEventListener('change', syncFundingKind);
      });
      if (form.elements.owner) {
        form.elements.owner.addEventListener('input', syncFundingKind);
        form.elements.owner.addEventListener('change', syncFundingKind);
      }
      syncFundingKind();
    }
    form.onsubmit = function (event) {
      if (form.dataset.saving === '1') { event.preventDefault(); return; }
      const chosen = purposeSelect.value;
      const target = grid.querySelector('[name="allocationTarget"]').value;
      const reserved = num(allocationInput.value);
      if (chosen === 'specific' && !target) {
        event.preventDefault();
        alert('Выберите обязательство для назначения денег.');
        return;
      }
      let openingSource = '';
      let openingPersonal = false;
      if (!id) {
        const owner = String(form.elements.owner && form.elements.owner.value || '').trim();
        const amount = moneyOk(form.elements.current && form.elements.current.value);
        const fundingKind = fundingPanel.querySelector('[name="fundingKind"]:checked');
        if (fundingKind && fundingKind.value === 'personal') {
          if (!owner) { event.preventDefault(); alert('Укажите владельца вклада.'); return; }
          if (!(amount > 0)) { event.preventDefault(); alert('Укажите сумму вклада.'); return; }
          openingPersonal = true;
          form.dataset.saving = '1';
          const submitButton = form.querySelector('.primary-button');
          if (submitButton) submitButton.disabled = true;
        } else {
          const kind = fundingKind && fundingKind.value === 'safe' ? 'safe' : 'account';
          if (!owner) { event.preventDefault(); alert('Укажите владельца вклада.'); return; }
          if (!(amount > 0)) { event.preventDefault(); alert('Укажите сумму вклада.'); return; }
          openingSource = fundingSelect.value;
          const source = fundingBalance(openingSource);
          if (!source || source.kind !== kind || (kind === 'account' && !sameOwner(source.account.owner, owner)) || (kind === 'safe' && !ownerOwnsSafe(source.safe, owner))) {
            event.preventDefault();
            alert('Выберите, откуда берутся деньги на вклад.');
            return;
          }
          if (source.available + 0.001 < amount) {
            event.preventDefault();
            alert(shortageMessage(source.kind, source.account, source.available));
            return;
          }
          form.dataset.saving = '1';
          const submitButton = form.querySelector('.primary-button');
          if (submitButton) submitButton.disabled = true;
        }
      }
      const snapshot = deposit ? { movements: (deposit.movements || []).slice(), initial: deposit.initial, allocations: (deposit.allocations || []).slice(), closed: deposit.closed, closedAt: deposit.closedAt, closeInterest: deposit.closeInterest, payout: deposit.payout, destination: deposit.destination, funding: deposit.funding } : null;
      const before = state.deposits.map(function (item) { return item.id; });
      previousSubmit.call(form, event);
      const saved = id ? state.deposits.find(function (item) { return item.id === id; }) : state.deposits.filter(function (item) { return before.indexOf(item.id) < 0; })[0];
      if (!saved) { form.dataset.saving = ''; const submitButton = form.querySelector('.primary-button'); if (submitButton) submitButton.disabled = false; return; }
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
      if (snapshot && snapshot.funding) saved.funding = snapshot.funding;
      delete saved.fundingSource;
      delete saved.fundingKind;
      if (!id && openingPersonal) {
        applyPersonalOpening(saved, moneyOk(saved.current));
      } else if (!id && openingSource) {
        const funded = applyOpeningFunding(saved, openingSource, moneyOk(saved.current));
        if (!funded) {
          state.deposits = state.deposits.filter(function (item) { return item.id !== saved.id; });
          alert('Недостаточно средств на выбранном источнике. Вклад не открыт.');
          save();
          render();
          return;
        }
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

  function accountPurposeLine(account) {
    const purpose = account.purpose || 'Личные средства';
    if (purpose === 'Доход от аренды') {
      const asset = (state.assets || []).find(function (item) { return item.id === account.linkedAssetId; });
      return asset ? 'Аренда · ' + asset.name : 'Доход от аренды';
    }
    return purpose;
  }

  function accountRevalue(account) {
    const code = account.currency || 'RUB';
    if (code === 'RUB') return 0;
    const rate = cabinetRate(code);
    const anchor = num(account.rateAnchor);
    if (!(rate > 0) || !(anchor > 0)) return null;
    return moneyOk(num(account.balance) * rate) - moneyOk(num(account.balance) * anchor);
  }

  function signedMoney(amount, currency) {
    const text = typeof moneyOriginal === 'function' ? moneyOriginal(Math.abs(amount), currency || 'RUB') : rub(Math.abs(amount));
    if (amount > 0) return '+' + text;
    if (amount < 0) return '−' + text;
    return text;
  }

  function accountDetails(account) {
    const code = account.currency || 'RUB';
    const foreign = code !== 'RUB';
    const rate = cabinetRate(code);
    const equivalent = foreign ? (rate > 0 ? rub(accountRub(account)) : 'курс не задан') : '';
    const asset = (state.assets || []).find(function (item) { return item.id === account.linkedAssetId; });
    const receipts = (account.movements || []).filter(function (item) { return item.direction !== 'out'; }).reduce(function (sum, item) { return sum + num(item.amount); }, 0);
    const revalue = accountRevalue(account);
    const revalueText = !foreign ? '' : (revalue == null ? 'курс не задан' : signedMoney(revalue, 'RUB'));
    const facts = [
      ['Банк', account.bank || '—'],
      ['Тип', account.type || 'Карта'],
      ['Владелец', account.owner || '—'],
      ['Последние 4 цифры', account.last4 ? '•••• ' + account.last4 : '—'],
      ['Валюта', typeof currencyTitle === 'function' ? currencyTitle(code) : code],
      ['Текущий остаток', accountOriginal(account)],
      foreign ? ['Текущий курс', rate > 0 ? '1 ' + code + ' = ' + ratePlain(rate) + ' ₽' : 'не задан в Настройках'] : null,
      foreign ? ['Рублёвый эквивалент', equivalent] : null,
      ['Назначение', account.purpose || 'Личные средства'],
      asset ? ['Связанный объект', asset.name + (asset.description ? ' — ' + asset.description : '')] : null,
      ['Для покрытия обязательств', account.coverObligations === false ? 'Нет' : 'Да'],
      account.comment ? ['Комментарий', account.comment] : null
    ].filter(Boolean);
    const history = (account.movements || []).slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    const rows = history.map(function (item) {
      const sign = item.direction === 'out' ? -num(item.amount) : num(item.amount);
      const title = item.text || item.type || 'Операция';
      return '<div class="account-op"><span>' + esc(dateText(item.date)) + '</span><strong>' + esc(title) + '</strong><b>' + esc(signedMoney(sign, item.currency || code)) + '</b><small>' + esc(item.comment && item.comment !== title ? item.comment : '') + '</small></div>';
    }).join('');
    return '<div class="account-facts">' + facts.map(function (row) { return '<div><span>' + esc(row[0]) + '</span><strong>' + esc(row[1]) + '</strong></div>'; }).join('') + '</div><div class="account-split"><div><span>Фактические поступления</span><strong>' + esc(accountOriginal(account, receipts)) + '</strong><small>Подтверждённые операции по счёту</small></div>' + (foreign ? '<div><span>Валютная переоценка</span><strong>' + esc(revalueText) + '</strong><small>Это не поступление и не доход. Остаток в ' + esc(code) + ' не меняется.</small></div>' : '') + '</div><div class="account-history"><h4>Операции</h4>' + (rows || '<p class="muted">Операций пока нет. Изменение курса сюда не записывается.</p>') + '<div class="account-op-form"><input type="date" data-op="date" value="' + isoDate(today) + '"><select data-op="type"><option>Пополнение</option><option>Списание</option><option>Перевод</option></select><input data-op="amount" inputmode="decimal" placeholder="Сумма"><input data-op="comment" placeholder="Комментарий"><button type="button" class="ghost-button" onclick="addAccountMovement(\'' + account.id + '\', this)">Добавить</button></div></div>';
  }

  function accountCards() {
    const total = state.accounts.reduce(function (sum, account) { return sum + accountRub(account); }, 0);
    const cards = state.accounts.map(function (account) {
      const code = account.currency || 'RUB';
      const foreign = code !== 'RUB';
      const rate = cabinetRate(code);
      const equivalent = foreign ? (rate > 0 ? '≈ ' + rub(accountRub(account)) : 'курс не задан') : '';
      return '<article class="account-row panel"><div class="account-row-main"><div class="account-row-title"><strong>' + esc(account.bank || 'Счёт') + '</strong><span>' + esc(account.type || 'Карта') + (account.last4 ? ' · •••• ' + esc(account.last4) : '') + '</span><span>' + esc(account.owner || '—') + '</span></div><div class="account-row-money"><strong>' + esc(accountOriginal(account)) + '</strong>' + (equivalent ? '<small>' + esc(equivalent) + '</small>' : '') + '<span>' + esc(accountPurposeLine(account)) + '</span></div><button type="button" class="ghost-button account-more" onclick="toggleAccountDetails(\'' + account.id + '\', this)">Подробнее</button></div><div class="account-details" id="account-details-' + account.id + '" hidden>' + accountDetails(account) + '<div class="button-row">' + actions('account', account.id) + '</div></div></article>';
    }).join('');
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</p><h2>Карты и счета</h2><p>Всего в рублях: ' + rub(total) + '</p></div><button class="primary-button" onclick="openForm(\'account\')">＋ Добавить счёт</button></div><div class="account-list">' + (cards || '<div class="panel empty">Нет записей. Добавьте первую запись.</div>') + '</div></div>';
  }
  accounts = accountCards;

  window.toggleAccountDetails = function (id, button) {
    const panel = document.getElementById('account-details-' + id);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (button) button.textContent = panel.hidden ? 'Подробнее' : 'Скрыть';
  };

  window.addAccountMovement = function (id, button) {
    const account = state.accounts.find(function (item) { return item.id === id; });
    const form = button && button.closest('.account-op-form');
    if (!account || !form) return;
    const kind = form.querySelector('[data-op="type"]').value;
    const amount = num(form.querySelector('[data-op="amount"]').value);
    const date = form.querySelector('[data-op="date"]').value;
    const comment = form.querySelector('[data-op="comment"]').value.trim();
    if (!date) { alert('Укажите дату операции.'); return; }
    if (!(amount > 0)) { alert('Укажите сумму больше нуля.'); return; }
    const out = kind === 'Списание' || kind === 'Перевод';
    const moved = pushAccountMovement(account, { date: date, type: kind, amount: amount, direction: out ? 'out' : 'in', comment: comment, text: comment ? kind + ' — ' + comment : kind });
    if (!moved) { alert('На счёте недостаточно средств.'); return; }
    save();
    render();
    const panel = document.getElementById('account-details-' + id);
    if (panel) panel.hidden = false;
  };

  function capitalFlowHistory() {
    const rows = [];
    (state.deposits || []).forEach(function (deposit) {
      (deposit.movements || []).forEach(function (item) {
        if (item.flow === 'open' || item.flow === 'close') rows.push(item);
      });
    });
    rows.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    const html = rows.map(function (item) {
      if (item.flow === 'open') {
        if (item.source === 'personal') {
          return '<div class="stat-row"><span>' + dateText(item.date) + '<br><b>' + esc(item.title || 'Открытие вклада') + '</b><br>' + esc(item.text || '') + '<small>Ранее не учтённые деньги. Не доход от капитала.</small></span><strong>' + rub(item.amount) + '</strong></div>';
        }
        return '<div class="stat-row"><span>' + dateText(item.date) + '<br><b>' + esc(item.title || 'Открытие вклада') + '</b><br>' + esc(item.route || item.text || '') + '<small>Внутреннее перемещение. Не расход и не доход.</small></span><strong>' + rub(item.amount) + '</strong></div>';
      }
      const interest = num(item.interest);
      return '<div class="stat-row"><span>' + dateText(item.date) + '<br><b>' + esc(item.title || 'Закрытие вклада') + '</b><br>Тело вклада: ' + rub(item.principal) + '<br>Полученные проценты: ' + rub(interest) + '<br>Зачислено: ' + rub(item.payout) + ' · ' + esc(item.destinationLabel || '') + (interest > 0 ? '<br>Доход от капитала: +' + rub(interest) : '<br>Доход от капитала: 0 ₽') + '</span><strong>' + rub(item.payout) + '</strong></div>';
    }).join('');
    return '<div class="panel"><h3>Движение денег по вкладам</h3>' + (html || '<div class="empty">Новых перемещений между вкладами, картами и сейфом пока нет</div>') + '</div>';
  }

  if (typeof history === 'function') {
    const baseHistory = history;
    history = function () { return baseHistory() + capitalFlowHistory(); };
  }

  if (typeof activeView !== 'undefined' && activeView === 'deposits') render();
})();
