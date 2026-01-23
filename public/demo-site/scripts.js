/**
 * NovaTech Solutions - Demo Website Scripts
 * Handles animations, sticky header, parallax, and interactions
 */

(function() {
  'use strict';

  // ==========================================================================
  // Sticky Header
  // ==========================================================================

  const header = document.querySelector('.header');
  let lastScroll = 0;

  function handleHeaderScroll() {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
  }

  window.addEventListener('scroll', handleHeaderScroll, { passive: true });

  // ==========================================================================
  // Parallax Effect for Hero
  // ==========================================================================

  const heroContent = document.querySelector('.hero-content');
  const heroBg = document.querySelector('.hero-bg-gradient');

  function handleParallax() {
    const scrolled = window.pageYOffset;
    const heroHeight = document.querySelector('.hero')?.offsetHeight || 800;

    if (scrolled < heroHeight) {
      const speed = 0.3;

      if (heroContent) {
        heroContent.style.transform = `translateY(${scrolled * speed}px)`;
        heroContent.style.opacity = 1 - (scrolled / heroHeight);
      }

      if (heroBg) {
        heroBg.style.transform = `translate(${scrolled * 0.05}px, ${scrolled * 0.1}px)`;
      }
    }
  }

  window.addEventListener('scroll', handleParallax, { passive: true });

  // ==========================================================================
  // Scroll-triggered Animations
  // ==========================================================================

  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const animationObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');

        // For step animations
        if (entry.target.classList.contains('step')) {
          entry.target.classList.add('animate');
        }
      }
    });
  }, observerOptions);

  // Observe all animated elements
  document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .scale-in, .step').forEach(el => {
    animationObserver.observe(el);
  });

  // ==========================================================================
  // Pricing Toggle
  // ==========================================================================

  const pricingToggle = document.querySelector('.pricing-toggle-switch');
  const monthlyLabel = document.querySelector('.pricing-toggle-label.monthly');
  const annualLabel = document.querySelector('.pricing-toggle-label.annual');
  const priceAmounts = document.querySelectorAll('.pricing-amount');

  const prices = {
    monthly: ['29', '79', '199'],
    annual: ['24', '66', '166']
  };

  if (pricingToggle) {
    pricingToggle.addEventListener('click', () => {
      pricingToggle.classList.toggle('annual');
      const isAnnual = pricingToggle.classList.contains('annual');

      monthlyLabel.classList.toggle('active', !isAnnual);
      annualLabel.classList.toggle('active', isAnnual);

      priceAmounts.forEach((el, i) => {
        el.textContent = isAnnual ? prices.annual[i] : prices.monthly[i];
      });
    });
  }

  // ==========================================================================
  // Smooth Scroll for Anchor Links
  // ==========================================================================

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // ==========================================================================
  // Mobile Menu (placeholder - would need more implementation)
  // ==========================================================================

  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      // Toggle mobile menu
      console.log('Mobile menu clicked');
    });
  }

  // ==========================================================================
  // Form Handling (Contact Page)
  // ==========================================================================

  const contactForm = document.querySelector('.contact-form form');

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Thank you for your message! This is a demo form.');
    });
  }

  // ==========================================================================
  // Active Navigation Link
  // ==========================================================================

  function setActiveNavLink() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage || (href === 'index.html' && currentPage === '')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  setActiveNavLink();

  // ==========================================================================
  // Counter Animation for Stats
  // ==========================================================================

  function animateCounter(el, target, duration = 2000) {
    const start = 0;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.floor(start + (target - start) * easeOutQuart);

      el.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = target.toLocaleString();
      }
    }

    requestAnimationFrame(update);
  }

  // Observe stat elements
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.dataset.target, 10);
        if (target) {
          animateCounter(el, target);
          statObserver.unobserve(el);
        }
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.hero-stat-value[data-target]').forEach(el => {
    statObserver.observe(el);
  });

  // ==========================================================================
  // Typing Animation for Hero (optional)
  // ==========================================================================

  const typingElement = document.querySelector('.typing-text');

  if (typingElement) {
    const words = ['faster', 'smarter', 'better', 'together'];
    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    function type() {
      const currentWord = words[wordIndex];

      if (isDeleting) {
        typingElement.textContent = currentWord.substring(0, charIndex - 1);
        charIndex--;
      } else {
        typingElement.textContent = currentWord.substring(0, charIndex + 1);
        charIndex++;
      }

      let typeSpeed = isDeleting ? 50 : 100;

      if (!isDeleting && charIndex === currentWord.length) {
        typeSpeed = 2000;
        isDeleting = true;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
        typeSpeed = 500;
      }

      setTimeout(type, typeSpeed);
    }

    type();
  }

  console.log('NovaTech Demo Scripts Loaded');
})();
