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

  card.innerHTML = `
    <div class="project-topline">
      <span class="project-badge">GitHub</span>
      <span class="project-type">${repo.language || "Code project"}</span>
    </div>
    <h3>${repo.name}</h3>
    <p>${repo.description}</p>
    <a href="${repo.html_url}" target="_blank" rel="noreferrer">Code op GitHub &rarr;</a>
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
    navToggle.setAttribute("aria-expanded", isActive);
  };

  const closeMenu = () => {
    navToggle.classList.remove("active");
    navMenu.classList.remove("active");
    navToggle.setAttribute("aria-expanded", "false");
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

setupThemeToggle();
setupMobileNav();
