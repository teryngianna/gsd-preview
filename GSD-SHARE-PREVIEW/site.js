// site.js — shared client behavior for the GSD static site.
// Loaded (deferred) on every page. Each block only runs when its target
// elements are present, so this one file is safe on every page.
(function () {
  'use strict';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ─── Theme toggle ──────────────────────────────────────────────────
  // The no-FOUC inline <head> script already set data-theme before paint.
  // Both icons live in the button markup; we just show the right one and
  // persist clicks. (No innerHTML — visibility is toggled on existing nodes.)
  var root = document.documentElement;
  var toggle = document.querySelector('.theme-toggle');

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncToggle(theme) {
    if (!toggle) return;
    var sun = toggle.querySelector('.icon-sun');
    var moon = toggle.querySelector('.icon-moon');
    // Dark mode shows the sun (click → light); light mode shows the moon (click → dark).
    if (sun) sun.style.display = theme === 'dark' ? '' : 'none';
    if (moon) moon.style.display = theme === 'dark' ? 'none' : '';
    var next = theme === 'dark' ? 'light' : 'dark';
    toggle.setAttribute('aria-label', 'Switch to ' + next + ' mode');
    toggle.setAttribute('title', 'Switch to ' + next + ' mode');
  }

  // Keep the Turnstile widget's theme in step with the page theme. The widget
  // defaults to its markup theme; only act when it actually needs to flip
  // (and only re-render once it has actually mounted its iframe).
  function syncTurnstileTheme(theme) {
    var w = document.querySelector('.cf-turnstile');
    if (!w || w.getAttribute('data-theme') === theme) return;
    w.setAttribute('data-theme', theme);
    if (window.turnstile && w.querySelector('iframe')) {
      try { window.turnstile.reset(); } catch (e) {}
    }
  }

  if (toggle) {
    syncToggle(currentTheme());
    syncTurnstileTheme(currentTheme());
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('gsd-theme', next); } catch (e) {}
      syncToggle(next);
      syncTurnstileTheme(next);
    });
  }

  // Default theme follows the OS. When the user hasn't picked a theme, live-update
  // as the system preference flips; an explicit toggle choice (stored) wins.
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var stored = null;
      try { stored = localStorage.getItem('gsd-theme'); } catch (e2) {}
      if (stored) return;
      var sys = e.matches ? 'dark' : 'light';
      root.setAttribute('data-theme', sys);
      syncToggle(sys);
      syncTurnstileTheme(sys);
    });
  } catch (e) {}

  // ─── Mobile nav panel ──────────────────────────────────────────────
  var mobileToggle = document.querySelector('.nav-mobile-toggle');
  var mobilePanel = document.getElementById('nav-mobile-panel');
  if (mobileToggle && mobilePanel) {
    mobileToggle.addEventListener('click', function () {
      var open = mobilePanel.classList.toggle('closed') === false;
      mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileToggle.textContent = open ? 'Close' : 'Menu';
    });
  }

  // ─── Contact form ──────────────────────────────────────────────────
  // Posts FormData to the live Worker at /api/contact. Field names here
  // must match src/contact.js: name, email, org, need, message,
  // cf-turnstile-response.
  var form = document.getElementById('contact-form');
  if (form) {
    var submitBtn = document.getElementById('submit-btn');
    var formMessage = document.getElementById('form-message');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      formMessage.className = 'form-message';
      formMessage.textContent = '';

      var turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
      if (!turnstileResponse || !turnstileResponse.value) {
        formMessage.className = 'form-message error';
        formMessage.textContent = 'Please complete the verification.';
        return;
      }

      submitBtn.disabled = true;
      var originalText = submitBtn.textContent;
      submitBtn.textContent = 'Sending...';

      fetch('/api/contact', { method: 'POST', body: new FormData(form) })
        .then(function (response) {
          return response.json().then(function (result) {
            if (response.ok) {
              formMessage.className = 'form-message success';
              formMessage.textContent = "Message sent. We'll be in touch soon.";
              form.reset();
            } else {
              formMessage.className = 'form-message error';
              formMessage.textContent = result.error || 'Something went wrong. Please try again.';
            }
            if (window.turnstile) window.turnstile.reset();
          });
        })
        .catch(function () {
          formMessage.className = 'form-message error';
          formMessage.textContent = 'Network error. Please check your connection and try again.';
          if (window.turnstile) window.turnstile.reset();
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        });
    });
  }

  // ─── Footer newsletter ─────────────────────────────────────────────
  // Posts email to /api/subscribe (Slack ping), protected by Turnstile. The
  // widget is lazy-loaded on first engagement with the field, so the footer
  // form doesn't pull Turnstile's script onto every page. Honeypot 'company'
  // must stay blank; the Worker rejects it if filled.
  var newsForm = document.getElementById('newsletter-form');
  if (newsForm) {
    var newsStatus = document.getElementById('newsletter-status');
    var newsBtn = newsForm.querySelector('button[type="submit"]');
    var newsEmail = newsForm.querySelector('input[name="email"]');
    var ntBox = document.getElementById('newsletter-turnstile');
    var ntId = null;

    function showNews(kind, text) {
      newsStatus.hidden = false;
      newsStatus.className = 'news-status ' + kind;
      newsStatus.textContent = text;
    }

    // Load Turnstile's script once (it may already be present on pages with the
    // contact form), then run cb when window.turnstile is ready.
    function ensureTurnstile(cb) {
      if (window.turnstile) return cb();
      var waitReady = function () {
        var iv = setInterval(function () {
          if (window.turnstile) { clearInterval(iv); cb(); }
        }, 60);
      };
      if (document.getElementById('cf-turnstile-api')) return waitReady();
      var s = document.createElement('script');
      s.id = 'cf-turnstile-api';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      s.onload = waitReady;
      document.head.appendChild(s);
    }

    function renderNewsletterTurnstile() {
      if (ntId !== null || !ntBox || !window.turnstile) return;
      try {
        ntId = window.turnstile.render(ntBox, {
          sitekey: '0x4AAAAAACRJ5LTwjM4wvxwQ',
          theme: currentTheme(),
          size: 'flexible'
        });
      } catch (e) {}
    }

    var ntStarted = false;
    function initTurnstile() {
      if (ntStarted) return;
      ntStarted = true;
      ensureTurnstile(renderNewsletterTurnstile);
    }
    newsEmail.addEventListener('focus', initTurnstile, { once: true });

    newsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!newsEmail.value || !EMAIL_RE.test(newsEmail.value.trim())) {
        showNews('error', 'Enter a valid email address.');
        return;
      }
      initTurnstile();
      var tokenInput = newsForm.querySelector('[name="cf-turnstile-response"]');
      if (!tokenInput || !tokenInput.value) {
        showNews('error', 'Please complete the verification, then subscribe.');
        return;
      }
      newsBtn.disabled = true;
      fetch('/api/subscribe', { method: 'POST', body: new FormData(newsForm) })
        .then(function (r) {
          if (r.ok) {
            newsForm.reset();
            showNews('success', "Thanks, you're on the list.");
          } else {
            showNews('error', 'Something went wrong. Please try again.');
          }
          if (window.turnstile && ntId !== null) window.turnstile.reset(ntId);
        })
        .catch(function () {
          showNews('error', 'Network error. Please try again.');
          if (window.turnstile && ntId !== null) window.turnstile.reset(ntId);
        })
        .finally(function () { newsBtn.disabled = false; });
    });
  }

  // ─── Chat demo (GSD page only) ─────────────────────────────────────
  var chatBody = document.getElementById('chat-body');
  var chatSection = document.querySelector('.chat-section');
  if (chatBody && chatSection) {
    var CHAT_SCRIPT = [
      { type: 'timestamp', text: 'Tuesday 9:14 AM', delay: 400 },
      { type: 'client', name: 'Sarah (Customer)', text: 'Hey, we just hired someone and she starts Thursday. Can you get her set up?', delay: 600 },
      { type: 'gsd', name: 'GSD Support', text: "On it. What's her name and role? We'll have email, Slack, Drive, and her laptop config ready by EOD Wednesday.", delay: 900 },
      { type: 'client', name: 'Sarah (Customer)', text: "Angela Torres, Program Coordinator. She'll need access to the grants folder too.", delay: 800 },
      { type: 'gsd', name: 'GSD Support', text: "Done. She'll get a welcome email Thursday morning with everything she needs. We'll also set up MFA on her account so we're good on security.", delay: 1000 },
      { type: 'client', name: 'Sarah (Customer)', text: "You're the best. That used to take us like 3 days lol", delay: 800 },
      { type: 'gsd', name: 'GSD Support', text: 'That’s why we’re here. Go do the important stuff. ✌️', delay: 700 }
    ];

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var chatStarted = false;
    var chatRunId = 0;

    function appendChatMsg(msg) {
      if (msg.type === 'timestamp') {
        var ts = document.createElement('div');
        ts.className = 'chat-timestamp';
        ts.textContent = msg.text;
        if (!reducedMotion) ts.style.animationDelay = '0s';
        chatBody.appendChild(ts);
      } else {
        var el = document.createElement('div');
        el.className = 'chat-msg ' + msg.type;
        if (!reducedMotion) el.style.animationDelay = '0s';
        var nameEl = document.createElement('div');
        nameEl.className = 'msg-name';
        nameEl.textContent = msg.name;
        el.appendChild(nameEl);
        el.appendChild(document.createTextNode(msg.text));
        chatBody.appendChild(el);
      }
      chatBody.scrollTop = chatBody.scrollHeight;
    }

    function runChat() {
      var runId = ++chatRunId;
      while (chatBody.firstChild) chatBody.removeChild(chatBody.firstChild);
      if (reducedMotion) {
        CHAT_SCRIPT.forEach(appendChatMsg);
        return;
      }
      var total = 0;
      CHAT_SCRIPT.forEach(function (msg) {
        total += msg.delay;
        setTimeout(function () {
          if (chatRunId !== runId) return;
          appendChatMsg(msg);
        }, total);
      });
    }

    var chatObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !chatStarted) {
          chatStarted = true;
          setTimeout(runChat, 500);
        } else if (!entry.isIntersecting) {
          chatStarted = false;
        }
      });
    }, { threshold: 0.3 });
    chatObserver.observe(chatSection);
  }

  // ─── Team card flip (GSD page only) ────────────────────────────────
  var flipCards = document.querySelectorAll('.team-portrait.has-flip');
  Array.prototype.forEach.call(flipCards, function (card) {
    function flip() {
      var flipped = card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    }
    card.addEventListener('click', flip);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        flip();
      }
    });
  });
})();

// ─── Stat count-up ───
// Numbers in .stat-number count up once, the first time they scroll into view.
// The real number is in the page from the start (for search engines, screen
// readers, and visitors without JavaScript); this only animates it visually.
(function () {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var els = Array.prototype.slice.call(document.querySelectorAll('.stat-number'));
  els.forEach(function (el) {
    var text = el.textContent;
    var m = text.match(/\d[\d,]*/);
    if (!m) return;
    var target = parseInt(m[0].replace(/,/g, ''), 10);
    if (!target) return; // "0 outages" stays as it is
    var hasComma = m[0].indexOf(',') !== -1;
    var before = text.slice(0, m.index), after = text.slice(m.index + m[0].length);
    var fmt = function (n) { return hasComma ? n.toLocaleString('en-US') : String(n); };
    el.setAttribute('aria-label', text.trim());
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.disconnect();
        var start = null, dur = target > 1000 ? 1400 : 900;
        function step(ts) {
          if (start === null) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = before + fmt(Math.round(target * eased)) + after;
          if (p < 1) requestAnimationFrame(step); else el.textContent = text;
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    io.observe(el);
  });
})();

// ─── Card spotlight ───
// Feeds the mouse position to the card under it (CSS draws the light).
(function () {
  if (!window.matchMedia('(hover: hover)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var sel = '.why-item, .trust-item, .engagement-card, .wwd-card, .segment-card, .work-card, .record-tile, .signs-list li, .stat-item, .situations-cards li, .faq-item';
  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest && e.target.closest(sel);
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
})();
