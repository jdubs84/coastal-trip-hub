/* Stay-card detail lines and which phone a changeover day should call.
   The cabin identity may appear once. "Still {place}" is not a detail,
   and "Still {place} · checkout …" keeps only the checkout fact.
   On a changeover date the incoming stay's phone replaces the date table
   once arrival has passed, or once that morning's checkout has passed. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StayCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function labelsFor(stay, cabin) {
    var raw = [];
    if (stay && stay.name) raw.push(stay.name);
    if (cabin) raw.push(cabin);
    var labels = [];
    raw.forEach(function (name) {
      String(name).split(/\s*[·|/]\s*/).forEach(function (part) {
        part = clean(part);
        if (part) labels.push(part);
        var word = part.split(/\s+/)[0] || '';
        if (word.length >= 5 && !/^cabin$/i.test(word)) labels.push(word);
      });
      var whole = clean(name);
      if (whole) labels.push(whole);
    });
    var seen = {};
    return labels.filter(function (label) {
      var key = label.toLowerCase();
      if (seen[key] || label.length < 4 || /^cabin\b/i.test(label)) return false;
      seen[key] = true;
      return true;
    }).sort(function (a, b) { return b.length - a.length; });
  }

  function placeWords(labels) {
    var words = {};
    labels.forEach(function (label) {
      label.toLowerCase().split(/[\s·,/]+/).forEach(function (word) {
        if (word.length >= 4) words[word] = true;
      });
    });
    return words;
  }

  function placeOnly(text, labels) {
    var parts = clean(text).toLowerCase().replace(/[·,/]/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    var words = placeWords(labels);
    return parts.every(function (word) {
      return words[word] || word === 'sp' || word === 'cabin';
    });
  }

  function stripLeadingLabel(text, labels) {
    var rest = text;
    var changed = false;
    var guard = 0;
    while (guard++ < 6) {
      var lower = rest.toLowerCase();
      var hit = '';
      for (var i = 0; i < labels.length; i++) {
        var label = labels[i];
        if (lower.indexOf(label.toLowerCase()) !== 0) continue;
        var after = rest.slice(label.length);
        if (after === '' || /^[\s·,:\-–—]+/.test(after)) {
          hit = label;
          break;
        }
      }
      if (!hit) break;
      rest = clean(rest.slice(hit.length).replace(/^[\s·,:\-–—]+/, ''));
      changed = true;
      if (!rest) break;
    }
    return { rest: rest, changed: changed };
  }

  function stayDetailLine(checkin, stay, cabin) {
    var identity = clean(cabin);
    var text = clean(checkin);
    if (identity && (!text || /^cabin\s*:/i.test(text))) return identity;
    text = text.replace(/^still\s+/i, '').trim();
    if (!text) return identity;
    if (identity && text.toLowerCase() === identity.toLowerCase()) return identity;
    var labels = labelsFor(stay, identity);
    if (placeOnly(text, labels)) return '';
    var stripped = stripLeadingLabel(text, labels);
    if (!stripped.changed) return text;
    if (!stripped.rest || placeOnly(stripped.rest, labels)) return '';
    return capitalize(stripped.rest);
  }

  function incomingStay(stays, day) {
    var list = stays || [];
    for (var i = 0; i < list.length; i++) {
      var stay = list[i];
      if (day >= stay.start && day < stay.end) return stay;
    }
    return null;
  }

  function outgoingStay(stays, day) {
    var list = stays || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].end === day) return list[i];
    }
    return null;
  }

  /* switched: arrival has passed, or this morning's checkout has passed.
     Before that, dayCall stands so a drive morning keeps the number the
     page already publishes. After the switch, a new stay with no phone
     returns null — never the place you just left. */
  function callForDay(day, stays, stayCall, dayCall, switched) {
    var incoming = incomingStay(stays, day);
    var outgoing = outgoingStay(stays, day);
    var changeover = !!(outgoing && incoming && outgoing.id !== incoming.id);
    if (changeover && switched) return (stayCall && stayCall[incoming.id]) || null;
    if (dayCall && dayCall[day]) return dayCall[day];
    return (incoming && stayCall && stayCall[incoming.id]) || null;
  }

  return {
    stayDetailLine: stayDetailLine,
    callForDay: callForDay,
    incomingStay: incomingStay,
    outgoingStay: outgoingStay
  };
});
