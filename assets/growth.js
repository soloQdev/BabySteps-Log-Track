/* BabySteps growth percentile calculator.
 * Data: data/who-growth.json, exported from the app's WHOGrowthData.swift
 * (WHO Child Growth Standards, 3rd/15th/50th/85th/97th percentile curves by month).
 * Everything runs in the browser; nothing is sent anywhere.
 */
(function () {
  'use strict';

  var DAYS_PER_MONTH = 30.4375; // WHO convention: 365.25 / 12

  // ---- Maths -------------------------------------------------------------

  // Standard normal CDF (Abramowitz & Stegun 7.1.26 on erf, error < 1.5e-7).
  function normCdf(z) {
    var x = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  // Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9).
  function invNorm(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    var q, r;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - 0.02425) return -invNorm(1 - p);
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // Values of every field at a fractional age, interpolating linearly between whole months.
  function rowAt(rows, ageMonths) {
    var last = rows[rows.length - 1];
    if (ageMonths <= rows[0].ageInMonths) return rows[0];
    if (ageMonths >= last.ageInMonths) return last;
    for (var i = 1; i < rows.length; i++) {
      if (ageMonths <= rows[i].ageInMonths) {
        var lo = rows[i - 1], hi = rows[i];
        var f = (ageMonths - lo.ageInMonths) / (hi.ageInMonths - lo.ageInMonths);
        var out = {};
        Object.keys(hi).forEach(function (k) { out[k] = lo[k] + f * (hi[k] - lo[k]); });
        return out;
      }
    }
    return last;
  }

  /* Where `value` sits against the curves at one age.
   * With L/M/S fields: the WHO LMS z-score. Otherwise: piecewise-linear interpolation of the
   * z-score between the published percentile curves (3rd..97th), so the result is approximate.
   * Outside the lowest/highest curve no percentile is estimated: status is "below" / "above". */
  function estimate(value, row, percentiles) {
    var keys = percentiles.map(function (p) { return 'p' + p; });
    var curve = keys.map(function (k) { return row[k]; });
    var lowest = percentiles[0], highest = percentiles[percentiles.length - 1];
    var z;
    if (row.L !== undefined && row.M !== undefined && row.S !== undefined) {
      z = Math.abs(row.L) < 1e-9 ? Math.log(value / row.M) / row.S : (Math.pow(value / row.M, row.L) - 1) / (row.L * row.S);
    } else {
      if (value < curve[0]) return { status: 'below', curve: curve };
      if (value > curve[curve.length - 1]) return { status: 'above', curve: curve };
      var zs = percentiles.map(function (p) { return invNorm(p / 100); });
      for (var i = 0; i < curve.length - 1; i++) {
        if (value <= curve[i + 1]) {
          z = zs[i] + (value - curve[i]) / (curve[i + 1] - curve[i]) * (zs[i + 1] - zs[i]);
          break;
        }
      }
    }
    var pct = normCdf(z) * 100;
    // The tolerance absorbs approximation error when the value sits exactly on an outer curve.
    if (pct < lowest - 1e-3) return { status: 'below', curve: curve, z: z };
    if (pct > highest + 1e-3) return { status: 'above', curve: curve, z: z };
    return { status: 'within', z: z, percentile: Math.min(highest, Math.max(lowest, Math.round(pct))), curve: curve };
  }

  // ---- Dates and numbers ---------------------------------------------------

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function daysBetween(fromStr, toStr) {
    var a = parseDate(fromStr), b = parseDate(toStr);
    return isNaN(a) || isNaN(b) ? NaN : Math.round((b - a) / 86400000);
  }
  // Completed calendar months and remaining days between two ISO dates.
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
  // Accepts "6.5", "6,5", Arabic-Indic and Persian digits, and the Arabic decimal separator.
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

  var KG_PER_LB = 0.45359237, CM_PER_IN = 2.54;

  var api = { normCdf: normCdf, invNorm: invNorm, rowAt: rowAt, estimate: estimate, daysBetween: daysBetween,
    calendarAge: calendarAge, parseNumber: parseNumber, DAYS_PER_MONTH: DAYS_PER_MONTH, KG_PER_LB: KG_PER_LB, CM_PER_IN: CM_PER_IN };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof document === 'undefined') return;

  // ---- Page ----------------------------------------------------------------

  var form = document.getElementById('growth-form');
  if (!form) return;
  var S = JSON.parse(document.getElementById('tool-strings').textContent);
  var locale = S.locale;
  var errorsBox = document.getElementById('errors');
  var resultsBox = document.getElementById('results');
  var dataPromise = fetch(form.getAttribute('data-json')).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
  dataPromise.catch(function () { showErrors([S.loadError]); });

  var MEASURES = [
    { key: 'weight', json: 'weight_for_age', kind: 'mass', plausible: [0.5, 30], example: 6.5 },
    { key: 'length', json: 'length_for_age', kind: 'length', plausible: [30, 120], example: 62 },
    { key: 'head', json: 'head_circumference_for_age', kind: 'length', plausible: [20, 60], example: 40 }
  ];

  function nf(opts) { return new Intl.NumberFormat(locale, opts); }
  function num(v, digits) { return nf({ maximumFractionDigits: digits === undefined ? 1 : digits }).format(v); }
  function unit(v, u, digits) {
    try { return nf({ style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: digits === undefined ? 1 : digits }).format(v); }
    catch (e) { return num(v, digits) + ' ' + (S.units[u] || u); }
  }
  function list(parts, type) {
    try { return new Intl.ListFormat(locale, { type: type || 'unit', style: 'narrow' }).format(parts); }
    catch (e) { return parts.join(' '); }
  }
  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (_, k) { return values[k] !== undefined ? values[k] : ''; });
  }
  function ordinal(n) {
    switch (S.ordinal) {
      case 'en':
        var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
      case 'dot': return num(n, 0) + '.';
      case 'e': return num(n, 0) + (n === 1 ? 'er' : 'e');
      default: return num(n, 0);
    }
  }
  function ageText(months, days) {
    var parts = [];
    var long = function (v, u) {
      try { return nf({ style: 'unit', unit: u, unitDisplay: 'long' }).format(v); } catch (e) { return num(v, 0) + ' ' + u; }
    };
    if (months > 0) parts.push(long(months, 'month'));
    if (days > 0 || months === 0) parts.push(long(days, 'day'));
    try { return new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' }).format(parts); }
    catch (e) { return parts.join(', '); }
  }

  function units() { return form.elements.units.value === 'imperial' ? 'imperial' : 'metric'; }
  // Typed values keep up to 2 decimals in kg; curve values are shown at the data's precision (1 decimal).
  function formatMeasure(m, metricValue, kgDigits) {
    if (m.kind === 'mass') {
      if (units() === 'metric') return unit(metricValue, 'kilogram', kgDigits === undefined ? 2 : kgDigits);
      var totalOz = Math.round(metricValue / KG_PER_LB * 16);
      var lb = Math.floor(totalOz / 16), oz = totalOz % 16;
      return oz ? list([unit(lb, 'pound', 0), unit(oz, 'ounce', 0)]) : unit(lb, 'pound', 0);
    }
    return units() === 'metric' ? unit(metricValue, 'centimeter', 1) : unit(metricValue / CM_PER_IN, 'inch', 1);
  }

  // Measurement inputs use an "m-" prefix: a control named "length" would clash with form.length.
  function field(key) { return document.getElementById('m-' + key); }

  // Reads a measurement in metric, as typed in `system` (default: the selected one).
  // Returns null when left empty, NaN when unreadable.
  function readMeasure(m, system) {
    var imperial = (system || units()) === 'imperial';
    var main = field(m.key).value.trim();
    var ozField = field(m.key + '-oz');
    var oz = ozField && imperial ? ozField.value.trim() : '';
    if (!main && !oz) return null;
    var a = main ? parseNumber(main) : 0;
    var b = oz ? parseNumber(oz) : 0;
    if (isNaN(a) || isNaN(b)) return NaN;
    if (m.kind === 'mass') return imperial ? (a + b / 16) * KG_PER_LB : a;
    return imperial ? a * CM_PER_IN : a;
  }

  function setUnitLabels() {
    var imperial = units() === 'imperial';
    Array.prototype.forEach.call(form.querySelectorAll('[data-metric]'), function (el) {
      el.textContent = imperial ? el.getAttribute('data-imperial') : el.getAttribute('data-metric');
    });
    Array.prototype.forEach.call(form.querySelectorAll('.imperial-only'), function (el) { el.hidden = !imperial; });
  }
  // Convert anything already typed when the unit system changes.
  var lastUnits = units();
  function onUnitsChange() {
    var next = units();
    if (next === lastUnits) return;
    MEASURES.forEach(function (m) {
      var input = field(m.key), ozField = field(m.key + '-oz');
      var metric = readMeasure(m, lastUnits);
      if (metric === null || isNaN(metric)) return;
      if (m.kind === 'mass') {
        if (next === 'metric') { input.value = num(metric, 2); if (ozField) ozField.value = ''; }
        else {
          var totalOz = Math.round(metric / KG_PER_LB * 16);
          input.value = num(Math.floor(totalOz / 16), 0); if (ozField) ozField.value = num(totalOz % 16, 0);
        }
      } else {
        input.value = num(next === 'metric' ? metric : metric / CM_PER_IN, 1);
      }
    });
    lastUnits = next;
    setUnitLabels();
  }

  function setAgeMode() {
    var byAge = form.elements.agemode.value === 'age';
    document.getElementById('age-dates').hidden = byAge;
    document.getElementById('age-numbers').hidden = !byAge;
  }

  function showErrors(messages) {
    resultsBox.hidden = true;
    errorsBox.innerHTML = '';
    if (!messages.length) { errorsBox.hidden = true; return; }
    var ul = document.createElement('ul');
    messages.forEach(function (msg) { var li = document.createElement('li'); li.textContent = msg; ul.appendChild(li); });
    errorsBox.appendChild(ul);
    errorsBox.hidden = false;
    errorsBox.focus();
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function scale(result, percentiles) {
    var wrap = el('div', 'scale');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.setAttribute('dir', 'ltr');
    var span = 2.4;
    var pos = function (z) { return Math.max(0, Math.min(100, (z + span) / (2 * span) * 100)); };
    wrap.appendChild(el('div', 'track'));
    percentiles.forEach(function (p) {
      var t = el('div', 'tick');
      t.style.left = pos(invNorm(p / 100)) + '%';
      t.appendChild(el('span', '', num(p, 0)));
      wrap.appendChild(t);
    });
    var z = result.status === 'below' ? -span : result.status === 'above' ? span : result.z;
    var mk = el('div', 'marker');
    mk.style.left = pos(z) + '%';
    wrap.appendChild(mk);
    return wrap;
  }

  function compute(data) {
    var errors = [];
    if (!form.elements.sex.value) errors.push(S.errSex);

    var days, months, remDays;
    if (form.elements.agemode.value === 'age') {
      var mStr = form.elements['age-months'].value.trim(), dStr = form.elements['age-days'].value.trim();
      months = mStr ? parseNumber(mStr) : 0; remDays = dStr ? parseNumber(dStr) : 0;
      if ((!mStr && !dStr) || isNaN(months) || isNaN(remDays) || months % 1 || remDays % 1) errors.push(S.errAge);
      else days = Math.round(months * DAYS_PER_MONTH + remDays);
    } else {
      var dob = form.elements.dob.value, when = form.elements.measured.value;
      days = daysBetween(dob, when);
      if (isNaN(days)) errors.push(S.errDob);
      else if (days < 0) errors.push(S.errOrder);
      else { var cal = calendarAge(dob, when); months = cal.months; remDays = cal.days; }
    }

    var values = [], measureError = false;
    MEASURES.forEach(function (m) {
      var v = readMeasure(m);
      var label = S.labels[m.key];
      if (v === null) return;
      if (isNaN(v)) { measureError = true; errors.push(fill(S.errNumber, { field: label, example: num(m.example, 1) })); return; }
      if (v < m.plausible[0] || v > m.plausible[1]) { measureError = true; errors.push(fill(S.errPlausible, { field: label, v: formatMeasure(m, v) })); return; }
      values.push({ m: m, v: v });
    });
    if (!values.length && !measureError) errors.push(S.errNone);
    if (errors.length) { showErrors(errors); return; }

    var maxAge = data.ageRangeMonths[1];
    var age = ageText(months, remDays);
    if (days > Math.ceil(maxAge * DAYS_PER_MONTH)) { showErrors([fill(S.outOfRange, { age: age })]); return; }
    var ageMonths = Math.min(maxAge, days / DAYS_PER_MONTH);

    showErrors([]);
    var listEl = document.getElementById('result-list');
    listEl.innerHTML = '';
    document.getElementById('result-age').textContent = fill(S.age, { age: age });
    var pcts = data.percentiles;
    values.forEach(function (item) {
      var rows = data.measures[item.m.json][form.elements.sex.value];
      var row = rowAt(rows, ageMonths);
      var r = estimate(item.v, row, pcts);
      var card = el('article', 'result');
      card.appendChild(el('h3', '', S.labels[item.m.key]));
      card.appendChild(el('p', 'value', formatMeasure(item.m, item.v)));
      var lo = r.curve[0], hi = r.curve[r.curve.length - 1], mid = row.p50;
      if (r.status === 'within') {
        card.appendChild(el('p', 'pct', fill(S.pAbout, { p: ordinal(r.percentile) })));
        card.appendChild(scale(r, pcts));
        card.appendChild(el('p', '', fill(S.explain, { n: num(r.percentile, 0) })));
      } else {
        var lowLine = r.status === 'below';
        card.appendChild(el('p', 'pct', fill(lowLine ? S.below : S.above, {
          p: ordinal(lowLine ? pcts[0] : pcts[pcts.length - 1]), v: formatMeasure(item.m, lowLine ? lo : hi, 1)
        })));
        card.appendChild(scale(r, pcts));
        card.appendChild(el('p', '', S.outsideNote));
      }
      if (mid !== undefined) {
        card.appendChild(el('p', 'muted', fill(S.range, { lo: formatMeasure(item.m, lo, 1), hi: formatMeasure(item.m, hi, 1), mid: formatMeasure(item.m, mid, 1) })));
      }
      listEl.appendChild(card);
    });
    resultsBox.hidden = false;
    document.getElementById('results-heading').focus();
  }

  form.elements.measured.value = todayISO();
  form.elements.measured.max = todayISO();
  form.elements.dob.max = todayISO();
  Array.prototype.forEach.call(form.elements.units, function (r) { r.addEventListener('change', onUnitsChange); });
  Array.prototype.forEach.call(form.elements.agemode, function (r) { r.addEventListener('change', setAgeMode); });
  setUnitLabels();
  setAgeMode();
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    dataPromise.then(compute, function () { showErrors([S.loadError]); });
  });
})();
