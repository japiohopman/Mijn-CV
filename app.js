const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal");
const counters = document.querySelectorAll(".count");
const heroTilt = document.querySelector("[data-tilt]");
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
    { threshold: 0.18, rootMargin: "0px 0px -4% 0px" }
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

if (heroTilt && !prefersReducedMotion) {
  heroTilt.addEventListener("mousemove", (event) => {
    const bounds = heroTilt.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    heroTilt.style.transform =
      `perspective(1200px) rotateX(${-(y * 3)}deg) rotateY(${x * 4}deg) translate3d(0, -4px, 0)`;
  });

  heroTilt.addEventListener("mouseleave", () => {
    heroTilt.style.transform = "perspective(1200px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)";
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

    filteredRepos.forEach((repo, index) => {
      const card = createRepoCard(repo);
      card.style.setProperty("--stagger-index", index + 3);
      projectGrid.appendChild(card);
    });
  } catch {
    // Stille fallback: de vaste kaarten zijn al genoeg om de sectie compleet te laten voelen.
  }
};

addRepoCards();
