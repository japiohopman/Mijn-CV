const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal");
const counters = document.querySelectorAll(".count");
const projectGrid = document.getElementById("projectGrid");
const staggerGroups = document.querySelectorAll(".stats, .skills-layout, .projects, .timeline, .proof-strip, .story-grid");

staggerGroups.forEach((group) => {
  Array.from(group.children).forEach((child, index) => {
    child.classList.add("stagger-item");
    child.style.setProperty("--stagger-index", index);
  });
});

if (!prefersReducedMotion) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.02, rootMargin: "0px 0px -2% 0px" }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("visible"));
}

const animateCounter = (element) => {
  const target = Number(element.dataset.target);
  let current = 0;
  const step = Math.max(1, Math.ceil(target / 34));

  const tick = () => {
    current += step;

    if (current >= target) {
      element.textContent = `${target}+`;
      return;
    }

    element.textContent = `${current}`;
    window.requestAnimationFrame(tick);
  };

  tick();
};

if (!prefersReducedMotion) {
  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.done) {
          animateCounter(entry.target);
          entry.target.dataset.done = "true";
          counterObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  counters.forEach((counter) => counterObserver.observe(counter));
} else {
  counters.forEach((counter) => {
    counter.textContent = `${counter.dataset.target}+`;
  });
}

const createRepoCard = (repo) => {
  const card = document.createElement("article");
  card.className = "project-card stagger-item visible";

  const languageChip = repo.language ? `<span class="tech-chip">${repo.language}</span>` : "";

  card.innerHTML = `
    <div class="project-topline">
      <span class="project-badge">GitHub Repo</span>
      <span class="project-type">${repo.language || "Open Source"}</span>
    </div>
    <h3>${repo.name}</h3>
    <p class="hero-project-desc" style="font-size: 0.95rem; margin-bottom: 1.2rem;">${repo.description}</p>
    <div class="project-tech-stack" style="margin-bottom: 1.2rem; padding: 0.5rem 0.8rem;">
      <span class="tech-label">Stack:</span>
      <div class="tech-chips">
        ${languageChip || '<span class="tech-chip">JavaScript</span>'}
        <span class="tech-chip">Open Source</span>
      </div>
    </div>
    <div class="project-links">
      <a href="${repo.html_url}" target="_blank" rel="noreferrer" class="btn-project-link secondary-link" style="padding: 0.5rem 1rem; font-size: 0.88rem;">Code op GitHub &rarr;</a>
    </div>
  `;

  return card;
};

const addRepoCards = async () => {
  if (!projectGrid) {
    return;
  }

  try {
    const response = await fetch("https://api.github.com/users/japiohopman/repos?sort=updated&per_page=12");

    if (!response.ok) {
      return;
    }

    const repos = await response.json();
    const filteredRepos = repos.filter((repo) => !repo.fork && repo.description).slice(0, 3);

    // Bepaal hoeveel elementen er al in het grid staan om de staggers correct te laten doorlopen
    const existingCount = projectGrid.children.length;

    filteredRepos.forEach((repo, index) => {
      const card = createRepoCard(repo);
      card.style.setProperty("--stagger-index", index + existingCount);
      projectGrid.appendChild(card);
    });
  } catch {
    // Stille fallback: de vaste kaarten zijn al genoeg om de sectie compleet te laten voelen.
  }
};

addRepoCards();

// Handle interaction with the image gallery thumbs
const setupGalleryListeners = () => {
  const galleries = document.querySelectorAll(".hero-project-gallery");
  galleries.forEach((gallery) => {
    const mainImg = gallery.querySelector(".main-preview-img");
    const thumbBtns = gallery.querySelectorAll(".thumb-btn");

    thumbBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        // Remove active class from other buttons in the same gallery
        thumbBtns.forEach((b) => b.classList.remove("active"));
        // Add active class to clicked button
        btn.classList.add("active");

        // Swap main image source with full image url
        const fullUrl = btn.dataset.full;
        if (mainImg && fullUrl) {
          mainImg.style.opacity = "0.4";
          setTimeout(() => {
            mainImg.src = fullUrl;
            mainImg.style.opacity = "1";
          }, 150);
        }
      });
    });
  });
};

setupGalleryListeners();

// Theme Toggle & Storage logic
const setupThemeToggle = () => {
  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;

  // Retrieve existing preferences or default to system
  const savedTheme = localStorage.getItem("theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;

  const setTheme = (theme) => {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "dark");
    }
  };

  // Initial application
  if (savedTheme === "light" || (!savedTheme && prefersLight)) {
    setTheme("light");
  } else {
    setTheme("dark");
  }

  // Click Handler
  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    if (currentTheme === "light") {
      setTheme("dark");
    } else {
      setTheme("light");
    }
  });
};

// Mobile Hamburger Navigation
const setupMobileNav = () => {
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");
  if (!navToggle || !navMenu) return;

  const toggleMenu = () => {
    const isActive = navToggle.classList.toggle("active");
    navMenu.classList.toggle("active");
    navToggle.setAttribute("aria-expanded", isActive ? "true" : "false");
    navToggle.setAttribute("aria-label", isActive ? "Sluit menu" : "Open menu");
  };

  const closeMenu = () => {
    navToggle.classList.remove("active");
    navMenu.classList.remove("active");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
  };

  navToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Close when clicking an anchor link
  const navLinks = navMenu.querySelectorAll("a");
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      closeMenu();
    });
  });

  // Close when clicking outside of the menu
  document.addEventListener("click", (e) => {
    if (!navMenu.contains(e.target) && !navToggle.contains(e.target)) {
      closeMenu();
    }
  });
};

// Setup Contact Form AJAX submission and Copy Email button logic
const setupContactForm = () => {
  const contactForm = document.getElementById("contactForm");
  const copyEmailBtn = document.getElementById("copyEmailBtn");

  if (copyEmailBtn) {
    const copyEmailIcon = document.getElementById("copyEmailIcon");
    const checkEmailIcon = document.getElementById("checkEmailIcon");
    const copyEmailText = document.getElementById("copyEmailText");

    copyEmailBtn.addEventListener("click", () => {
      const emailAddress = "japiehopman@gmail.com";
      navigator.clipboard.writeText(emailAddress).then(() => {
        copyEmailBtn.classList.add("success");
        if (copyEmailIcon) copyEmailIcon.style.display = "none";
        if (checkEmailIcon) checkEmailIcon.style.display = "inline-block";
        if (copyEmailText) copyEmailText.textContent = "Gekopieerd!";

        setTimeout(() => {
          copyEmailBtn.classList.remove("success");
          if (copyEmailIcon) copyEmailIcon.style.display = "inline-block";
          if (checkEmailIcon) checkEmailIcon.style.display = "none";
          if (copyEmailText) copyEmailText.textContent = "Kopieer";
        }, 2200);
      }).catch((err) => {
        console.error("Kon e-mailadres niet kopiëren:", err);
      });
    });
  }

  if (contactForm) {
    const submitBtn = document.getElementById("contactSubmitBtn");
    const feedbackDiv = document.getElementById("contactFeedback");
    const btnText = submitBtn ? submitBtn.querySelector(".btn-text") : null;
    const btnSpinner = submitBtn ? submitBtn.querySelector(".btn-spinner") : null;

    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!feedbackDiv) return;

      // Clear previous feedback state
      feedbackDiv.className = "form-feedback";
      feedbackDiv.style.display = "none";
      feedbackDiv.textContent = "";

      const formData = new FormData(contactForm);
      const data = {
        name: formData.get("name"),
        email: formData.get("email"),
        subject: formData.get("subject"),
        message: formData.get("message"),
        website_url: formData.get("website_url") // Honeypot field
      };

      // Basic client-side validation
      if (!data.name || !data.email || !data.message) {
        feedbackDiv.textContent = "Vul alstublieft alle verplichte velden in.";
        feedbackDiv.classList.add("error");
        feedbackDiv.style.display = "block";
        return;
      }

      // UI Loading state
      if (submitBtn) submitBtn.disabled = true;
      if (btnText) btnText.style.display = "none";
      if (btnSpinner) btnSpinner.style.display = "inline-block";

      try {
        const response = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok && result.success) {
          feedbackDiv.textContent = result.message || "Bedankt voor je bericht!";
          feedbackDiv.classList.add("success");
          feedbackDiv.style.display = "block";
          contactForm.reset();
        } else {
          feedbackDiv.textContent = result.message || "Er is een fout opgetreden. Probeer het opnieuw.";
          feedbackDiv.classList.add("error");
          feedbackDiv.style.display = "block";
        }
      } catch (err) {
        feedbackDiv.textContent = "Netwerkfout: kon het bericht niet verzenden. Probeer het later nog eens.";
        feedbackDiv.classList.add("error");
        feedbackDiv.style.display = "block";
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (btnText) btnText.style.display = "inline-block";
        if (btnSpinner) btnSpinner.style.display = "none";
      }
    });
  }
};

setupThemeToggle();
setupMobileNav();
setupContactForm();
