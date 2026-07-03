// ===========================================================================
// REACTIVE RHYTHM — chat.js (build111 s1)
//   Shared TEXT-chat primitives: profanity filter + matcher, extracted out of
//   catalog.js's IIFE (scrubName/LB_BADWORDS were trapped in its closure and
//   unreachable from multiplayer.js). Load BEFORE catalog.js and multiplayer.js
//   — both <script>-include this file and consume window.RhythmChat.
//
//   filterChatText(s) is MASK-not-REJECT: matched substrings become '***' —
//   the message is never discarded outright (differs from scrubName/cleanName,
//   which return a generic replacement for the WHOLE string — that's the right
//   call for a single display NAME, but wrong for a chat MESSAGE where most of
//   the text is fine and should survive).
//
//   ZERO behavior change to existing leaderboard-name filtering: catalog.js's
//   scrubName and index.html's cleanName keep their own copies/logic for now
//   (both already ship, both already work) — this file exists so NEW chat
//   surfaces (lobby/room chat, reports) have one shared source instead of a
//   third hand-copied wordlist. See CHANGELOG build111 for the extraction note.
// ===========================================================================
(function () {
  'use strict';

  // Same list as catalog.js `LB_BADWORDS` / index.html `LB_BADWORDS` — kept in
  // sync by hand (three call sites total: leaderboard names ×2 + chat text ×1).
  // If you touch this list, touch the other two too.
  var BADWORDS = ['nigger', 'nigga', 'faggot', 'retard', 'cunt', 'rape', 'kike', 'spic', 'chink', 'fuck', 'shit', 'bitch', 'whore', 'slut', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'nazi', 'wank', 'twat', 'jizz', 'coon', 'tranny'];

  // Leet-speak normalization (mirrors scrubName/cleanName) — used only to DETECT
  // a hit; the mask is applied against the ORIGINAL string so punctuation/case
  // in the source text survives untouched outside the masked span.
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s_\-.]/g, '')
      .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
      .replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i');
  }

  // Builds one case-insensitive regex alternation from BADWORDS, longest-first
  // so a longer match (e.g. a compound) wins over a shorter substring inside it.
  var _rx = null;
  function matcher() {
    if (_rx) return _rx;
    var words = BADWORDS.slice().sort(function (a, b) { return b.length - a.length; });
    var esc = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    _rx = new RegExp('(' + esc.join('|') + ')', 'gi');
    return _rx;
  }

  // mask-not-reject: replace each matched run of letters with a same-length
  // '***' (fixed 3 stars, not length-matched — avoids leaking word length as a
  // side channel for anything egregious, matches common chat-filter convention).
  // Runs a plain substring pass on the RAW text first (catches exact-cased
  // hits fast + handles the common case); falls back to a normalized re-scan
  // so leet/spacing tricks ("n1gg3r", "n i g g e r") still get caught, at the
  // cost of masking the whole matched span (normalization collapses spacing,
  // so we can't map back to exact original offsets in that fallback path —
  // acceptable for a defense-in-depth chat filter, not a leaderboard identity).
  function filterChatText(s) {
    var raw = String(s == null ? '' : s);
    if (!raw) return raw;
    var out = raw.replace(matcher(), '***');
    // fallback: normalized scan catches leet/spaced variants the raw regex missed.
    // If the normalized form contains a badword but the raw pass found nothing,
    // mask the ENTIRE message — we can't safely map normalized offsets back to
    // the original string's punctuation/spacing.
    if (out === raw) {
      var norm = normalize(raw);
      for (var i = 0; i < BADWORDS.length; i++) {
        if (norm.indexOf(BADWORDS[i]) >= 0) return '***';
      }
    }
    return out;
  }

  // Whole-string mask used for display NAMES (roster/kebab/report target labels
  // inside chat.js's own UI) — same semantics as catalog.js scrubName / index.html
  // cleanName, exposed here so chat-adjacent code (chat.js itself, multiplayer.js
  // mod UI) has one call instead of a 4th hand-copy. Leaderboard rendering paths
  // keep using their existing local copies unchanged (zero behavior change).
  function filterDisplayName(s) {
    var raw = String(s == null ? '' : s).trim();
    if (!raw) return 'anon';
    var norm = normalize(raw);
    for (var i = 0; i < BADWORDS.length; i++) { if (norm.indexOf(BADWORDS[i]) >= 0) return 'player'; }
    return raw;
  }

  window.RhythmChat = {
    filterChatText: filterChatText,
    filterDisplayName: filterDisplayName,
    BADWORDS: BADWORDS   // read-only convenience export (array reference — don't mutate)
  };
})();
