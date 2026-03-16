// Scroll reveal — shared across all pages
(function () {
  var reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry, i) {
      if (entry.isIntersecting) {
        setTimeout(function () {
          entry.target.classList.add('visible');
        }, i * 80);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  reveals.forEach(function (el) { observer.observe(el); });
})();

// Dark mode toggle
(function () {
  var html = document.documentElement;
  var btn = document.getElementById('darkToggle');
  var stored = localStorage.getItem('theme');

  if (stored === 'dark') {
    html.classList.add('dark');
    if (btn) btn.textContent = '\u25D1 Light';
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var isDark = html.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      btn.textContent = isDark ? '\u25D1 Light' : '\u25D1 Dark';
    });
  }
})();

// Mobile hamburger menu
(function () {
  var burger = document.querySelector('.nav-burger');
  var nav = document.querySelector('nav');
  if (!burger || !nav) return;

  burger.addEventListener('click', function () {
    nav.classList.toggle('nav-open');
  });

  // Close menu when a nav link is tapped
  document.querySelectorAll('.nav-links a').forEach(function (link) {
    link.addEventListener('click', function () {
      nav.classList.remove('nav-open');
    });
  });
})();

// Career dropdown — close on outside click
(function () {
  document.addEventListener('click', function (e) {
    var dropdowns = document.querySelectorAll('.nav-dropdown');
    dropdowns.forEach(function (dd) {
      if (!dd.contains(e.target)) {
        dd.classList.remove('open');
      }
    });
  });

  var dropdownLinks = document.querySelectorAll('.nav-dropdown > a');
  dropdownLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      var dd = link.parentElement;
      var isOpen = dd.classList.contains('open');
      document.querySelectorAll('.nav-dropdown').forEach(function (d) {
        d.classList.remove('open');
      });
      if (!isOpen) {
        e.preventDefault();
        dd.classList.add('open');
        link.blur();
      }
    });
  });
})();
