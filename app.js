const revealItems = document.querySelectorAll('.reveal');
const counters = document.querySelectorAll('.count');
const heroTilt = document.querySelector('[data-tilt]');
const projectGrid = document.getElementById('projectGrid');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  },
  { threshold: 0.18 }
);

revealItems.forEach((item) => observer.observe(item));

const animateCounter = (el) => {
  const target = Number(el.dataset.target);
  let current = 0;
  const step = Math.ceil(target / 36);

  const tick = () => {
    current += step;
    if (current >= target) {
      el.textContent = `${target}+`;
      return;
    }
    el.textContent = current;
    requestAnimationFrame(tick);
  };

  tick();
};

const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !entry.target.dataset.done) {
        animateCounter(entry.target);
        entry.target.dataset.done = 'true';
      }
    });
  },
  { threshold: 0.5 }
);

counters.forEach((counter) => counterObserver.observe(counter));

if (heroTilt) {
  heroTilt.addEventListener('mousemove', (event) => {
    const bounds = heroTilt.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    heroTilt.style.transform = `perspective(800px) rotateX(${-(y * 4)}deg) rotateY(${x * 6}deg)`;
  });

  heroTilt.addEventListener('mouseleave', () => {
    heroTilt.style.transform = 'perspective(800px) rotateX(0) rotateY(0)';
  });
}

const addRepoCards = async () => {
  try {
    const response = await fetch('https://api.github.com/users/japiohopman/repos?sort=updated&per_page=12');
    if (!response.ok) {
      return;
    }

    const repos = await response.json();
    const filtered = repos.filter((repo) => !repo.fork && repo.description).slice(0, 6);

    filtered.forEach((repo) => {
      const card = document.createElement('article');
      card.className = 'project-card';
      card.innerHTML = `
        <h3>${repo.name}</h3>
        <p>${repo.description}</p>
        <a href="${repo.html_url}" target="_blank" rel="noreferrer">Code op GitHub ↗</a>
      `;
      projectGrid.appendChild(card);
    });
  } catch {
    // Stil falen: statische projectkaarten blijven zichtbaar.
  }
};

addRepoCards();
