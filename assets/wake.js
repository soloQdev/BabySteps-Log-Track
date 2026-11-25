/* BabySteps wake-window chart.
 * Data: data/wake-windows.json, exported from the app's SmartDayAgeData.swift
 * (typical wake-window bounds by age band, 0-12 months).
 * Everything runs in the browser; nothing is sent anywhere.
 */
(function () {
  'use strict';

  var DAYS_PER_MONTH = 30.4375;

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function daysBetween(fromStr, toStr) {
    var a = parseDate(fromStr), b = parseDate(toStr);
    return isNaN(a) || isNaN(b) ? NaN : Math.round((b - a) / 86400000);
  }
  function calendarAge(fromStr, toStr) {
    var a = new Date(parseDate(fromStr)), b = new Date(parseDate(toStr));
    var months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    var anchor = function (n) {
      var y = a.getUTCFullYear(), mo = a.getUTCMonth() + n;
      var dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      return Date.UTC(y, mo, Math.min(a.getUTCDate(), dim));
    };
    if (anchor(months) > b.getTime()) months -= 1;
    return { months: months, days: Math.round((b.getTime() - anchor(months)) / 86400000) };
  }
  function parseNumber(s) {
    if (s === undefined || s === null) return NaN;
    var t = String(s).trim()
      .replace(/[٠-٩]/g, function (ch) { return String(ch.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (ch) { return String(ch.charCodeAt(0) - 0x06F0); })
      .replace(/[٫,]/g, '.').replace(/[\s٬ ]/g, '');
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return NaN;
    return parseFloat(t);
  }
  function todayISO() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // The band containing an age in days (bands are inclusive day ranges), or null.
  function bandFor(bands, days) {
    for (var i = 0; i < bands.length; i++) if (days >= bands[i].fromDay && days <= bands[i].toDay) return bands[i];
    return null;
  }

  var api = { bandFor: bandFor, daysBetween: daysBetween, calendarAge: calendarAge, parseNumber: parseNumber, DAYS_PER_MONTH: DAYS_PER_MONTH };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof document === 'undefined') return;

  var form = document.getElementById('wake-form');
  if (!form) return;
  var S = JSON.parse(document.getElementById('tool-strings').textContent);
  var locale = S.locale;
  var errorsBox = document.getElementById('errors');
  var resultBox = document.getElementById('result');
  var tbody = document.getElementById('wake-rows');

  function nf(opts) { return new Intl.NumberFormat(locale, opts); }
  function num(v) { return nf({ maximumFractionDigits: 0 }).format(v); }
  function fill(t, v) { return t.replace(/\{(\w+)\}/g, function (_, k) { return v[k] !== undefined ? v[k] : ''; }); }
  function unit(v, u, display) {
    try { return nf({ style: 'unit', unit: u, unitDisplay: display || 'short' }).format(v); }
    catch (e) { return num(v) + ' ' + u; }
  }
  function duration(minutes) {
    var h = Math.floor(minutes / 60), m = Math.round(minutes % 60), parts = [];
    if (h) parts.push(unit(h, 'hour'));
    if (m || !h) parts.push(unit(m, 'minute'));
    if (S.durationJoin) return parts.join(S.durationJoin);
    try { return new Intl.ListFormat(locale, { type: 'unit', style: 'narrow' }).format(parts); }
    catch (e) { return parts.join(' '); }
  }
  function range(band) { return fill(S.range, { a: duration(band.lowerMinutes), b: duration(band.upperMinutes) }); }
  function bandLabel(band) {
    var word = S.monthForms[new Intl.PluralRules(locale).select(band.toMonth)] || S.monthForms.other;
    return fill(S.bandLabel, { a: num(band.fromMonth), b: num(band.toMonth), unit: word });
  }
  function ageText(months, days) {
    var parts = [];
    if (months > 0) parts.push(unit(months, 'month', 'long'));
    if (days > 0 || months === 0) parts.push(unit(days, 'day', 'long'));
    try { return new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' }).format(parts); }
    catch (e) { return parts.join(', '); }
  }

  function showErrors(messages) {
    errorsBox.innerHTML = '';
    if (!messages.length) { errorsBox.hidden = true; return; }
    var ul = document.createElement('ul');
    messages.forEach(function (msg) { var li = document.createElement('li'); li.textContent = msg; ul.appendChild(li); });
    errorsBox.appendChild(ul);
    errorsBox.hidden = false;
    resultBox.hidden = true;
    errorsBox.focus();
  }

  var data;
  var dataPromise = fetch(form.getAttribute('data-json')).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (json) {
    data = json;
    tbody.innerHTML = '';
    data.wakeBands.forEach(function (band) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-from', band.fromDay);
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = bandLabel(band);
      var td = document.createElement('td');
      td.textContent = range(band);
      tr.appendChild(th); tr.appendChild(td);
      tbody.appendChild(tr);
    });
    return json;
  });
  dataPromise.catch(function () { showErrors([S.loadError]); });

  function highlight(band) {
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      var on = band && String(band.fromDay) === tr.getAttribute('data-from');
      tr.classList.toggle('is-current', !!on);
      var old = tr.querySelector('.badge');
      if (old) old.parentNode.removeChild(old);
      if (on) {
        var b = document.createElement('span');
        b.className = 'badge';
        b.textContent = S.youHere;
        tr.querySelector('th').appendChild(b);
      }
    });
  }

  function compute() {
    var days, months, remDays;
    if (form.elements.agemode.value === 'age') {
      var mStr = form.elements['age-months'].value.trim(), dStr = form.elements['age-days'].value.trim();
      months = mStr ? parseNumber(mStr) : 0; remDays = dStr ? parseNumber(dStr) : 0;
      if ((!mStr && !dStr) || isNaN(months) || isNaN(remDays) || months % 1 || remDays % 1) { highlight(null); showErrors([S.errAge]); return; }
      days = Math.round(months * DAYS_PER_MONTH + remDays);
    } else {
      var dob = form.elements.dob.value, today = todayISO();
      days = daysBetween(dob, today);
      if (isNaN(days)) { highlight(null); showErrors([S.errDob]); return; }
      if (days < 0) { highlight(null); showErrors([S.errFuture]); return; }
      var cal = calendarAge(dob, today); months = cal.months; remDays = cal.days;
    }
    showErrors([]);
    var band = bandFor(data.wakeBands, days);
    var main = document.getElementById('result-main'), note = document.getElementById('result-note');
    if (band) {
      main.textContent = fill(S.result, { age: ageText(months, remDays), range: range(band) });
      note.textContent = S.resultNote;
    } else {
      main.textContent = S.toddler;
      note.textContent = '';
    }
    highlight(band);
    resultBox.hidden = false;
    main.focus();
  }

  function setAgeMode() {
    var byAge = form.elements.agemode.value === 'age';
    document.getElementById('age-dates').hidden = byAge;
    document.getElementById('age-numbers').hidden = !byAge;
  }
  form.elements.dob.max = todayISO();
  Array.prototype.forEach.call(form.elements.agemode, function (r) { r.addEventListener('change', setAgeMode); });
  setAgeMode();
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    dataPromise.then(compute, function () { showErrors([S.loadError]); });
  });
})();
