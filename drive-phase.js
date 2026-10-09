/* Drive-day phases in America/New_York minutes-from-midnight.
   Leave-by and arrival clocks are read from the text already on the page. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DrivePhase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function clockMinutes(hour, minute, mer) {
    var h = Number(hour);
    var m = minute == null || minute === '' ? 0 : Number(minute);
    if (!isFinite(h) || !isFinite(m) || m > 59) return null;
    var ap = String(mer || '').replace(/\./g, '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (h > 23) return null;
    return h * 60 + m;
  }

  function clocksFrom(text) {
    var out = [];
    var re = /(\d{1,2})(?::(\d{2}))?\s*(?:[–—-]\s*(\d{1,2})(?::(\d{2}))?)?\s*(a\.?m\.?|p\.?m\.?)|\b(noon|midnight)\b/gi;
    var match;
    while ((match = re.exec(String(text || '')))) {
      if (match[6]) {
        out.push(/noon/i.test(match[6]) ? 12 * 60 : 0);
        continue;
      }
      var picked = match[3]
        ? clockMinutes(match[3], match[4], match[5])
        : clockMinutes(match[1], match[2], match[5]);
      if (picked != null) out.push(picked);
    }
    return out;
  }

  function leaveByMinutes(leaveText) {
    var clocks = clocksFrom(leaveText);
    if (!clocks.length) return null;
    return Math.max.apply(null, clocks);
  }

  function arrivalByMinutes(arrivalText) {
    var sentences = String(arrivalText || '').split(/(?<=\.)\s+/);
    var clause = '';
    for (var i = 0; i < sentences.length; i++) {
      if (/check[\s-]*in|arriv/i.test(sentences[i])) {
        clause = sentences[i];
        break;
      }
    }
    if (!clause) return null;
    var clocks = clocksFrom(clause.replace(/check[\s-]*out\b[^.]*/ig, ''));
    if (!clocks.length) return null;
    return Math.max.apply(null, clocks);
  }

  function checkoutByMinutes(text) {
    var s = String(text || '');
    var m = s.match(/check\s*out(?:\s+by|\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
    if (m) return clockMinutes(m[1], m[2], m[3]);
    if (/check\s*out(?:\s+by|\s+at)?\s+noon/i.test(s)) return 12 * 60;
    return null;
  }

  /* before: still time to leave. enroute: leave-by has passed, arrival has not.
     arrived: expected arrival / check-in time has been reached. */
  function drivePhase(leaveText, arrivalText, minutes) {
    if (minutes == null || !isFinite(minutes)) return 'before';
    var arrive = arrivalByMinutes(arrivalText);
    var leave = leaveByMinutes(leaveText);
    if (arrive != null && minutes >= arrive) return 'arrived';
    if (leave != null && minutes >= leave) return 'enroute';
    return 'before';
  }

  function checkoutPassed(text, minutes) {
    var at = checkoutByMinutes(text);
    if (at == null || minutes == null || !isFinite(minutes)) return false;
    return minutes >= at;
  }

  return {
    clockMinutes: clockMinutes,
    leaveByMinutes: leaveByMinutes,
    arrivalByMinutes: arrivalByMinutes,
    checkoutByMinutes: checkoutByMinutes,
    drivePhase: drivePhase,
    checkoutPassed: checkoutPassed
  };
});
