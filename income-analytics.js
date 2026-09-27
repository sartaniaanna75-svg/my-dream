(function () {
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
  const nowKey = isoDate(today).slice(0, 7);
  const filter = { source: 'all', span: 'month', month: nowKey, year: nowKey.slice(0, 4) };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function monthKey(date) {
    const text = String(date || '');
    return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : '';
  }

  function shiftMonth(key, delta) {
    const parts = String(key || '').split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function monthTitle(key) {
    const parts = String(key || '').split('-');
    const index = Number(parts[1]) - 1;
    if (!MONTHS[index]) return key;
    return MONTHS[index].toLowerCase() + ' ' + parts[0];
  }

  function convert(amount, currency) {
    const code = currency || 'RUB';
    const value = num(amount);
    if (code === 'RUB') return { rub: roundMoney(value), known: true };
    const rate = typeof currentFx === 'function' ? currentFx(null, code) : num(state.fx && state.fx[code]);
    if (!(rate > 0)) return { rub: 0, known: false };
    return { rub: roundMoney(value * rate), known: true };
  }

  function original(amount, currency) {
    if (typeof moneyOriginal === 'function') return moneyOriginal(amount, currency || 'RUB');
    return rub(amount);
  }

  function signed(amount, currency) {
    const value = roundMoney(amount);
    if (Math.abs(value) < 0.005) return original(0, currency);
    const body = original(Math.abs(value), currency);
    return (value > 0 ? '+' : '−') + body;
  }

  function pct(part, whole) {
    if (!(whole > 0)) return null;
    return part / whole * 100;
  }

  function pctText(value) {
    if (value == null || !isFinite(value)) return '—';
    return value.toFixed(1).replace('.', ',') + '%';
  }

  function entry(data) {
    const planFx = convert(data.plan, data.currency);
    const factFx = convert(data.fact, data.currency);
    return {
      id: data.id,
      source: data.source,
      sourceTitle: data.sourceTitle,
      name: data.name,
      date: data.date,
      currency: data.currency || 'RUB',
      plan: roundMoney(data.plan),
      fact: roundMoney(data.fact),
      planRub: planFx.rub,
      factRub: factFx.rub,
      planKnown: planFx.known,
      factKnown: factFx.known
    };
  }

  function collectDeposits() {
    const rows = [];
    (state.deposits || []).forEach(function (deposit) {
      const movements = (deposit.movements || []).filter(function (item) { return item.type === 'interest' && monthKey(item.date); });
      const movementTotal = movements.reduce(function (sum, item) { return sum + num(item.amount); }, 0);
      const gap = deposit.status === 'Получено' ? Math.max(0, num(deposit.received) - movementTotal) : 0;
      const onDate = movements.filter(function (item) { return item.date === deposit.nextDate; });
      const factHere = onDate.reduce(function (sum, item) { return sum + num(item.amount); }, 0) + gap;
      if (monthKey(deposit.nextDate) && (num(deposit.expected) > 0 || factHere > 0)) {
        rows.push(entry({
          id: 'deposit-' + deposit.id + '-' + deposit.nextDate,
          source: 'deposit',
          sourceTitle: 'Проценты',
          name: deposit.bank || deposit.name || 'Вклад',
          date: deposit.nextDate,
          currency: 'RUB',
          plan: num(deposit.expected),
          fact: factHere
        }));
      }
      movements.forEach(function (item) {
        if (item.date === deposit.nextDate) return;
        rows.push(entry({
          id: 'deposit-move-' + (item.id || deposit.id + '-' + item.date),
          source: 'deposit',
          sourceTitle: 'Проценты',
          name: deposit.bank || deposit.name || 'Вклад',
          date: item.date,
          currency: 'RUB',
          plan: 0,
          fact: num(item.amount)
        }));
      });
    });
    return rows;
  }

  function pushRent(rows, id, name, payment, currency) {
    if (!payment || payment.status === 'Отменён' || !monthKey(payment.date) || !(num(payment.amount) > 0)) return;
    const seen = {};
    rows.forEach(function (row) { seen[row.id] = true; });
    const rowId = 'rent-' + id + '-' + (payment.id || payment.date);
    if (seen[rowId]) return;
    rows.push(entry({
      id: rowId,
      source: 'rent',
      sourceTitle: 'Аренда',
      name: name,
      date: payment.date,
      currency: payment.currency || currency || 'RUB',
      plan: num(payment.amount),
      fact: payment.status === 'Получено' ? num(payment.receivedAmount != null && payment.receivedAmount !== '' ? payment.receivedAmount : payment.amount) : 0
    }));
  }

  function collectRent() {
    const rows = [];
    (state.assets || []).forEach(function (asset) {
      const rent = asset.rent || {};
      const currency = rent.currency || asset.currency || 'RUB';
      const dates = {};
      const liveIds = {};
      (rent.payments || []).forEach(function (payment) {
        dates[payment.date] = true;
        if (payment.id) liveIds[payment.id] = true;
        pushRent(rows, asset.id, asset.name || 'Объект', payment, currency);
      });
      (asset.rentHistory || []).forEach(function (lease) {
        (lease.payments || []).forEach(function (payment) {
          if (payment.status !== 'Получено' || (payment.id && liveIds[payment.id])) return;
          pushRent(rows, asset.id + '-hist', asset.name || 'Объект', payment, payment.currency || lease.currency || currency);
        });
      });
      const live = (asset.usage || asset.usageStatus) === 'Сдаётся в аренду';
      if (live && monthKey(rent.nextDate) && num(rent.amount) > 0 && !dates[rent.nextDate]) {
        pushRent(rows, asset.id, asset.name || 'Объект', { id: 'plan', date: rent.nextDate, amount: rent.amount, currency: currency, status: 'Ожидается' }, currency);
      }
      (asset.parts || []).forEach(function (part, index) {
        const partKey = part.id || ('part' + index);
        const partCurrency = part.rentCurrency || currency;
        const partDates = {};
        const place = (asset.name || 'Объект') + ' · ' + (part.name || 'Помещение');
        (part.rentPayments || []).forEach(function (payment) {
          partDates[payment.date] = true;
          pushRent(rows, asset.id + '-' + partKey, place, payment, partCurrency);
        });
        if (part.usage === 'Сдаётся в аренду' && monthKey(part.rentNext || part.rentStart) && num(part.rentAmount) > 0) {
          const date = part.rentNext || part.rentStart;
          if (!partDates[date]) pushRent(rows, asset.id + '-' + partKey, place, { id: 'plan', date: date, amount: part.rentAmount, currency: partCurrency, status: 'Ожидается' }, partCurrency);
        }
      });
    });
    return rows;
  }

  const SOURCES = [
    { id: 'deposit', title: 'Проценты по вкладам', short: 'Вклады', heading: 'Доход по вкладам', collect: collectDeposits },
    { id: 'rent', title: 'Аренда', short: 'Аренда', heading: 'Доход от аренды', collect: collectRent }
  ];

  function collectAll() {
    return SOURCES.reduce(function (rows, source) { return rows.concat(source.collect()); }, []);
  }

  function matchesSource(row) {
    return filter.source === 'all' || row.source === filter.source;
  }

  function matchesSpan(date, span, month, year) {
    const key = monthKey(date);
    if (!key) return false;
    if (span === 'all') return true;
    if (span === 'year') return key.slice(0, 4) === String(year);
    return key === month;
  }

  function inView(row) {
    return matchesSource(row) && matchesSpan(row.date, filter.span, filter.month, filter.year);
  }

  function sumRows(rows) {
    return rows.reduce(function (total, row) {
      total.plan += row.planKnown ? row.planRub : 0;
      total.fact += row.factKnown ? row.factRub : 0;
      if (!row.planKnown || !row.factKnown) total.missing = true;
      if (!total.by[row.source]) total.by[row.source] = { plan: 0, fact: 0 };
      total.by[row.source].plan += row.planKnown ? row.planRub : 0;
      total.by[row.source].fact += row.factKnown ? row.factRub : 0;
      return total;
    }, { plan: 0, fact: 0, missing: false, by: {} });
  }

  function periodPhrase() {
    if (filter.span === 'year') return filter.year + ' год';
    if (filter.span === 'all') return 'весь период';
    return monthTitle(filter.month);
  }

  function heading() {
    const source = SOURCES.filter(function (item) { return item.id === filter.source; })[0];
    return (source ? source.heading : 'Доход от капитала') + ' — ' + periodPhrase();
  }

  function statusOf(row) {
    if ((row.plan <= 0 && row.fact > 0) || (row.plan > 0 && row.fact + 0.001 >= row.plan)) return 'Получено';
    if (row.fact > 0) return 'Частично';
    if (row.date < isoDate(today)) return 'Просрочено';
    return 'Ожидается';
  }

  function weightedRate() {
    let weighted = 0;
    let base = 0;
    (state.deposits || []).forEach(function (deposit) {
      if (deposit.closed || !(num(deposit.current) > 0)) return;
      weighted += num(deposit.current) * num(deposit.rate);
      base += num(deposit.current);
    });
    return base > 0 ? weighted / base : null;
  }

  function rateText(value) {
    return value.toFixed(2).replace('.', ',') + '%';
  }

  function monthOptions() {
    const keys = {};
    keys[nowKey] = true;
    keys[shiftMonth(nowKey, -1)] = true;
    keys[shiftMonth(nowKey, 1)] = true;
    const year = Number(nowKey.slice(0, 4));
    for (let month = 1; month <= 12; month += 1) keys[year + '-' + String(month).padStart(2, '0')] = true;
    collectAll().forEach(function (row) { const key = monthKey(row.date); if (key) keys[key] = true; });
    return Object.keys(keys).filter(Boolean).sort();
  }

  function yearOptions() {
    const years = {};
    years[nowKey.slice(0, 4)] = true;
    years[String(Number(nowKey.slice(0, 4)) - 1)] = true;
    collectAll().forEach(function (row) { const key = monthKey(row.date); if (key) years[key.slice(0, 4)] = true; });
    return Object.keys(years).sort();
  }

  function chartKeys() {
    if (filter.span === 'year') {
      const list = [];
      for (let month = 1; month <= 12; month += 1) list.push(filter.year + '-' + String(month).padStart(2, '0'));
      return list;
    }
    if (filter.span === 'month') {
      const list = [];
      for (let index = 5; index >= 0; index -= 1) list.push(shiftMonth(filter.month, -index));
      return list;
    }
    const keys = collectAll().filter(matchesSource).map(function (row) { return monthKey(row.date); }).filter(Boolean).sort();
    if (!keys.length) return [nowKey];
    const list = [];
    let cursor = keys[0];
    const last = keys[keys.length - 1];
    while (cursor && cursor <= last && list.length < 36) {
      list.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    return list;
  }

  function rowsFor(span, month, year) {
    return collectAll().filter(function (row) {
      return matchesSource(row) && matchesSpan(row.date, span, month, year);
    });
  }

  function compareLine(label, current, previous, against) {
    const delta = roundMoney(current - previous);
    let change = 'без изменений к ' + against;
    let cls = '';
    if (Math.abs(delta) >= 0.005) {
      const percent = previous > 0 ? pctText(Math.abs(delta) / previous * 100) : '';
      change = signed(delta, 'RUB') + ' к ' + against + (percent ? ' · ' + (delta > 0 ? '+' : '−') + percent : '');
      cls = delta > 0 ? 'positive' : 'danger';
    }
    return '<div><span>' + esc(label) + '</span><strong>' + rub(current) + '</strong><small class="' + cls + '">' + esc(change) + '</small></div>';
  }

  function comparison(currentRows) {
    if (filter.span === 'all') return '';
    let previousRows = [];
    let against = '';
    let label = '';
    if (filter.span === 'month') {
      const previous = shiftMonth(filter.month, -1);
      previousRows = rowsFor('month', previous, filter.year);
      against = MONTHS_DAT[Number(previous.slice(5, 7)) - 1];
      label = 'Доход ' + MONTHS_GEN[Number(filter.month.slice(5, 7)) - 1];
    } else {
      const previousYear = String(Number(filter.year) - 1);
      previousRows = rowsFor('year', filter.month, previousYear);
      against = previousYear + ' году';
      label = 'Доход ' + filter.year + ' года';
    }
    const current = sumRows(currentRows);
    const previous = sumRows(previousRows);
    let html = compareLine(label, current.fact, previous.fact, against);
    if (filter.source === 'all') {
      SOURCES.forEach(function (source) {
        const now = current.by[source.id] ? current.by[source.id].fact : 0;
        const then = previous.by[source.id] ? previous.by[source.id].fact : 0;
        html += compareLine(source.short, now, then, against);
      });
    }
    return '<section class="panel income-compare"><div class="panel-head"><div><p class="eyebrow">СРАВНЕНИЕ</p><h3>К предыдущему периоду</h3></div></div><div class="income-compare-grid">' + html + '</div></section>';
  }

  function shownSources() {
    return SOURCES.filter(function (source) { return filter.source === 'all' || filter.source === source.id; });
  }

  function sourceScore(by, id) {
    const item = by && by[id] ? by[id] : { plan: 0, fact: 0 };
    const plan = num(item.plan);
    const fact = num(item.fact);
    return { plan: plan, fact: fact, delta: roundMoney(fact - plan), rate: pct(fact, plan) };
  }

  function scoreText(title, score) {
    const tone = score.delta < -0.004 ? 'danger' : score.delta > 0.004 ? 'positive' : '';
    return '<div class="income-tip-row"><b>' + esc(title) + '</b><span>План: ' + esc(rub(score.plan)) + '</span><span>Факт: ' + esc(rub(score.fact)) + '</span><span class="' + tone + '">Отклонение: ' + esc(signed(score.delta, 'RUB')) + '</span><span>Выполнение: ' + esc(pctText(score.rate)) + '</span></div>';
  }

  function periodScore(rows) {
    const total = sumRows(rows);
    const score = sourceScore({ all: total }, 'all');
    const tone = score.delta < -0.004 ? 'danger' : score.delta > 0.004 ? 'positive' : '';
    return '<div class="income-score"><span>Выполнение плана дохода</span><div><small>План</small><strong>' + rub(score.plan) + '</strong></div><div><small>Факт</small><strong>' + rub(score.fact) + '</strong></div><div><small>Отклонение</small><strong class="' + tone + '">' + signed(score.delta, 'RUB') + '</strong></div><div><small>Выполнение</small><strong>' + pctText(score.rate) + '</strong></div></div>';
  }

  function barHeight(value, max) {
    if (!(max > 0) || !(value > 0)) return 0;
    return Math.max(4, Math.round(value / max * 100));
  }

  function chart(allRows, periodRows) {
    const sources = shownSources();
    const keys = chartKeys();
    const groups = keys.map(function (key) {
      const rows = allRows.filter(function (row) { return monthKey(row.date) === key; });
      return { key: key, total: sumRows(rows) };
    });
    const max = groups.reduce(function (peak, item) {
      return sources.reduce(function (inner, source) {
        const score = sourceScore(item.total.by, source.id);
        return Math.max(inner, score.plan, score.fact);
      }, peak);
    }, 0);
    const cols = groups.map(function (item) {
      const monthName = MONTHS[Number(item.key.slice(5, 7)) - 1] + ' ' + item.key.slice(0, 4);
      const pieces = sources.map(function (source) { return { source: source, score: sourceScore(item.total.by, source.id) }; });
      const overall = sourceScore({ all: item.total }, 'all');
      const tip = '<strong>' + esc(monthName) + '</strong>' + pieces.map(function (piece) { return scoreText(piece.source.short, piece.score); }).join('') + (sources.length > 1 ? scoreText('Итого', overall) : '');
      const bars = pieces.map(function (piece, index) {
        const plan = barHeight(piece.score.plan, max);
        const fact = barHeight(piece.score.fact, max);
        const gap = index > 0 ? '<b class="income-gap"></b>' : '';
        return gap + '<i class="income-plan ' + piece.source.id + '" style="height:' + plan + '%"></i><i class="income-fact ' + piece.source.id + '" style="height:' + fact + '%"></i>';
      }).join('');
      return '<div class="income-col" data-tip="' + esc(tip) + '" onmouseenter="showIncomeMonth(this)"><div class="income-bars">' + bars + '</div><span>' + esc(MONTHS[Number(item.key.slice(5, 7)) - 1]) + '</span></div>';
    }).join('');
    const legend = sources.map(function (source) {
      return '<span><i class="income-plan ' + source.id + '"></i>План · ' + esc(source.short) + '</span><span><i class="income-fact ' + source.id + '"></i>Факт · ' + esc(source.short) + '</span>';
    }).join('');
    return '<section class="panel"><div class="panel-head"><div><p class="eyebrow">ДИНАМИКА</p><h3>Динамика дохода от капитала</h3><p>План и факт по вкладам и аренде отдельно. Валютный доход показан рублёвым эквивалентом по текущему курсу.</p></div></div>' + periodScore(periodRows) + '<div class="income-hover" id="income-hover">Наведите на месяц</div><div class="income-chart">' + cols + '</div><div class="income-legend">' + legend + '</div></section>';
  }

  window.showIncomeMonth = function (node) {
    const box = document.getElementById('income-hover');
    if (box && node) box.innerHTML = node.getAttribute('data-tip') || '';
  };

  function moneyCell(amount, rubles, currency, known) {
    const main = esc(original(amount, currency));
    if (!currency || currency === 'RUB') return main;
    return main + '<br><span class="muted">' + esc(known ? '≈ ' + rub(rubles) : 'курс не задан') + '</span>';
  }

  function table(rows) {
    const sorted = rows.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || a.name.localeCompare(b.name, 'ru'); });
    const body = sorted.map(function (row) {
      const status = statusOf(row);
      const tone = status === 'Получено' ? 'tag-green' : status === 'Просрочено' ? 'tag-red' : 'tag-blue';
      return '<tr><td>' + esc(row.sourceTitle) + '</td><td>' + esc(row.name) + '</td><td>' + esc(fullDate(row.date)) + '</td><td>' + esc(row.currency) + '</td><td>' + moneyCell(row.plan, row.planRub, row.currency, row.planKnown) + '</td><td>' + moneyCell(row.fact, row.factRub, row.currency, row.factKnown) + '</td><td>' + esc(signed(row.fact - row.plan, row.currency)) + '</td><td><span class="tag ' + tone + '">' + status + '</span></td></tr>';
    }).join('');
    return '<section class="panel"><div class="panel-head"><div><p class="eyebrow">ДЕТАЛИЗАЦИЯ</p><h3>Из чего сложился доход</h3></div></div><div class="table-wrap"><table class="data-table income-table"><thead><tr><th>Источник</th><th>Объект / банк</th><th>Дата</th><th>Валюта</th><th>План</th><th>Факт</th><th>Разница</th><th>Статус</th></tr></thead><tbody>' + (body || '<tr><td colspan="8"><div class="empty">В выбранном периоде нет процентных и арендных поступлений</div></td></tr>') + '</tbody></table></div></section>';
  }

  function structure(total) {
    if (filter.source !== 'all') return '';
    const cards = SOURCES.map(function (source) {
      const item = total.by[source.id] || { plan: 0, fact: 0 };
      return '<div><span>' + esc(source.short) + '</span><strong>' + rub(item.fact) + '</strong><small>план ' + rub(item.plan) + '</small></div>';
    }).join('');
    return '<section class="panel income-structure"><div class="panel-head"><div><p class="eyebrow">СТРУКТУРА</p><h3>Из каких источников получен доход</h3></div></div><div class="income-structure-grid">' + cards + '</div></section>';
  }

  function rateCard() {
    if (filter.source !== 'deposit') return '';
    const rate = weightedRate();
    return '<div class="metric income-rate"><div class="metric-label">Средняя ставка</div><div class="metric-value">' + (rate == null ? '—' : rateText(rate)) + '</div><div class="metric-sub">Средневзвешенная: сумма вклада × ставка / сумма вкладов</div></div>';
  }

  function filters() {
    const sources = '<option value="all"' + (filter.source === 'all' ? ' selected' : '') + '>Все доходы</option>' + SOURCES.map(function (source) {
      return '<option value="' + source.id + '"' + (filter.source === source.id ? ' selected' : '') + '>' + esc(source.title) + '</option>';
    }).join('');
    const spans = [['month', 'Месяц'], ['year', 'Год'], ['all', 'Весь период']].map(function (item) {
      return '<option value="' + item[0] + '"' + (filter.span === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
    }).join('');
    let second = '';
    if (filter.span === 'month') {
      second = '<label>Месяц<select onchange="setIncomeAnalytics({month:this.value})">' + monthOptions().map(function (key) {
        return '<option value="' + key + '"' + (key === filter.month ? ' selected' : '') + '>' + esc(MONTHS[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(0, 4)) + '</option>';
      }).join('') + '</select></label>';
    } else if (filter.span === 'year') {
      second = '<label>Год<select onchange="setIncomeAnalytics({year:this.value})">' + yearOptions().map(function (year) {
        return '<option value="' + year + '"' + (year === filter.year ? ' selected' : '') + '>' + year + '</option>';
      }).join('') + '</select></label>';
    }
    return '<div class="income-filters"><label>Источник дохода<select onchange="setIncomeAnalytics({source:this.value})">' + sources + '</select></label><label>Период<select onchange="setIncomeAnalytics({span:this.value})">' + spans + '</select></label>' + second + '</div>';
  }

  function cards(total) {
    const delta = roundMoney(total.fact - total.plan);
    const deltaClass = delta < -0.004 ? 'danger' : delta > 0.004 ? 'positive' : '';
    const note = total.missing ? '<br><span class="warning">для части валют курс не задан</span>' : '';
    return '<div class="income-metrics">' +
      '<div class="metric"><div class="metric-label">План дохода за ' + esc(periodPhrase()) + '</div><div class="metric-value">' + rub(total.plan) + '</div><div class="metric-sub">назначенные поступления</div></div>' +
      '<div class="metric"><div class="metric-label">Фактически получено</div><div class="metric-value">' + rub(total.fact) + '</div><div class="metric-sub">только отмеченные получения' + note + '</div></div>' +
      '<div class="metric"><div class="metric-label">Разница план / факт</div><div class="metric-value ' + deltaClass + '">' + signed(delta, 'RUB') + '</div><div class="metric-sub">факт минус план</div></div>' +
      '<div class="metric"><div class="metric-label">Выполнение плана</div><div class="metric-value">' + pctText(pct(total.fact, total.plan)) + '</div><div class="metric-sub">' + (total.plan > 0 ? 'факт к плану' : 'план не задан') + '</div></div>' +
      rateCard() + '</div>';
  }

  income = function () {
    const viewed = collectAll().filter(inView);
    const total = sumRows(viewed);
    const chartRows = collectAll().filter(matchesSource);
    return '<div class="view-wrap"><div class="section-heading"><div><p class="eyebrow">АНАЛИТИКА</p><h2>' + esc(heading()) + '</h2><p>Проценты по вкладам и аренда. Оценочная стоимость имущества в эти суммы не входит.</p></div></div>' +
      filters() + cards(total) + structure(total) + comparison(viewed) + chart(chartRows, viewed) + table(viewed) +
      '<section class="panel income-apart"><p class="eyebrow">ОТДЕЛЬНО ОТ ДОХОДА</p><h3>Изменение стоимости имущества</h3><p>Рост или снижение оценочной стоимости квартиры, дома и другого имущества — это изменение капитала, а не доход за период. В показатели выше оно не входит.</p></section></div>';
  };

  window.setIncomeAnalytics = function (patch) {
    Object.assign(filter, patch || {});
    if (activeView === 'income') render();
  };

  const baseRender = render;
  render = function () {
    baseRender();
    if (activeView === 'income') {
      const title = document.getElementById('page-title');
      if (title) title.textContent = 'Аналитика';
    }
  };
}());
