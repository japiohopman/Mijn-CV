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
      themeToggle.setAttribute("aria-pressed", "true");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "dark");
      themeToggle.setAttribute("aria-pressed", "false");
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

// Mobile Hamburger Navigation & Backdrop
const setupMobileNav = () => {
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");
  if (!navToggle || !navMenu) return;

  // Create backdrop overlay dynamically if not already present
  let navBackdrop = document.querySelector(".nav-backdrop");
  if (!navBackdrop) {
    navBackdrop = document.createElement("div");
    navBackdrop.className = "nav-backdrop";
    navBackdrop.setAttribute("aria-hidden", "true");
    document.body.appendChild(navBackdrop);
  }

  const toggleMenu = () => {
    const isActive = navToggle.classList.toggle("active");
    navMenu.classList.toggle("active");
    navBackdrop.classList.toggle("active");
    document.body.classList.toggle("menu-open", isActive);
    navToggle.setAttribute("aria-expanded", isActive ? "true" : "false");
    navToggle.setAttribute("aria-label", isActive ? "Sluit menu" : "Open menu");
  };

  const closeMenu = () => {
    navToggle.classList.remove("active");
    navMenu.classList.remove("active");
    navBackdrop.classList.remove("active");
    document.body.classList.remove("menu-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
  };

  navToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  navBackdrop.addEventListener("click", closeMenu);

  // Close on Escape key press
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && navMenu.classList.contains("active")) {
      closeMenu();
    }
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
        copyEmailBtn.setAttribute("aria-label", "E-mailadres gekopieerd naar klembord");
        if (copyEmailIcon) copyEmailIcon.style.display = "none";
        if (checkEmailIcon) checkEmailIcon.style.display = "inline-block";
        if (copyEmailText) copyEmailText.textContent = "Gekopieerd!";

        setTimeout(() => {
          copyEmailBtn.classList.remove("success");
          copyEmailBtn.setAttribute("aria-label", "Kopieer e-mailadres naar klembord");
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

// On-demand Project Demo Iframe Trigger & Escape Handler
const setupProjectDemos = () => {
  const demoTriggers = document.querySelectorAll(".btn-demo-trigger");
  const closeBtns = document.querySelectorAll(".btn-close-demo");

  demoTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const targetId = trigger.dataset.demoTarget;
      const demoContainer = document.getElementById(targetId);

      if (!demoContainer) return;

      const iframe = demoContainer.querySelector(".demo-iframe");
      const loading = demoContainer.querySelector(".demo-loading");

      demoContainer.style.display = "block";
      demoContainer.setAttribute("aria-hidden", "false");

      // Set iframe src on-demand if not already loaded
      if (iframe && iframe.dataset.src && (!iframe.src || iframe.src === "about:blank")) {
        if (loading) loading.style.opacity = "1";

        iframe.src = iframe.dataset.src;

        iframe.onload = () => {
          if (loading) {
            loading.style.opacity = "0";
            setTimeout(() => {
              loading.style.display = "none";
            }, 300);
          }
        };
      }

      // Scroll demo smoothly into view if on mobile
      if (window.innerWidth < 880) {
        demoContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });

  closeBtns.forEach((closeBtn) => {
    closeBtn.addEventListener("click", () => {
      const targetId = closeBtn.dataset.demoTarget;
      const demoContainer = document.getElementById(targetId);

      if (demoContainer) {
        demoContainer.style.display = "none";
        demoContainer.setAttribute("aria-hidden", "true");
      }
    });
  });
};

// Artificer Interactive Dice & LLM State Simulator
const setupArtificerDiceSim = () => {
  const rollBtn = document.getElementById("rollDiceBtn");
  const checkSelect = document.getElementById("simCheckType");
  const outputDiv = document.getElementById("simOutput");

  if (!rollBtn || !checkSelect || !outputDiv) return;

  const checks = {
    perception: { name: "Perception Check (WIS)", dc: 14, mod: 3, stat: "Wisdom" },
    stealth: { name: "Stealth Check (DEX)", dc: 12, mod: 4, stat: "Dexterity" },
    attack: { name: "Longsword Attack (STR)", dc: 15, mod: 5, stat: "Strength" },
    arcana: { name: "Arcana Knowledge (INT)", dc: 16, mod: 2, stat: "Intelligence" }
  };

  rollBtn.addEventListener("click", () => {
    const selectedKey = checkSelect.value;
    const config = checks[selectedKey] || checks.perception;

    // Simulate 1d20
    const rawRoll = Math.floor(Math.random() * 20) + 1;
    const totalRoll = rawRoll + config.mod;
    const isSuccess = totalRoll >= config.dc;
    const isCrit = rawRoll === 20;

    let resClass = isSuccess ? "sim-res-success" : "sim-res-fail";
    let resLabel = isSuccess ? "✅ SLAGSLAAGD" : "❌ MISLUKT";

    if (isCrit) {
      resClass = "sim-res-crit";
      resLabel = "💥 CRITICAL SUCCESS!";
    }

    const statePayload = {
      event: "DICE_ROLL_RESOLVED",
      timestamp: new Date().toISOString().split("T")[1].slice(0, 8),
      check_type: config.name,
      dc_threshold: config.dc,
      dice_breakdown: {
        raw_d20: rawRoll,
        modifier: config.mod,
        total: totalRoll
      },
      outcome: isSuccess ? "SUCCESS" : "FAILURE",
      llm_narrative_prompt: `[ENGINE_EVENT]: Player attempted ${config.name}. Roll: ${totalRoll} vs DC ${config.dc}. Outcome: ${isSuccess ? 'PASS' : 'FAIL'}. Inject narrative continuation.`
    };

    outputDiv.innerHTML = `
      <div class="sim-res-header">
        <span>${config.name}: <strong>1d20 (${rawRoll}) + ${config.mod} = ${totalRoll}</strong> vs DC ${config.dc}</span>
        <span class="${resClass}">${resLabel}</span>
      </div>
      <div class="sim-json-preview">${JSON.stringify(statePayload, null, 2)}</div>
    `;
  });
};

// SuperMail Interactive Email Classification & Prompt Pipeline Simulator
const setupSuperMailSim = () => {
  const runBtn = document.getElementById("runSuperMailBtn");
  const scenarioSelect = document.getElementById("simEmailScenario");
  const outputDiv = document.getElementById("superMailOutput");

  if (!runBtn || !scenarioSelect || !outputDiv) return;

  const scenarios = {
    client_quote: {
      s: "dirk@innovate-tech.nl",
      p: 4,
      pl: "🟡 HOOG (4/5)",
      c: "sim-res-success",
      i: "PROPOSAL_REQUEST",
      a: ["Schat uren & architectuur in voor dashboard", "Plan intakegesprek 30 min", "Deel portfolio case-studies"],
      d: "Beste Dirk, bedankt voor je bericht! Ik help graag bij het dashboard. Wanneer past een korte call deze week?"
    },
    urgent_bug: {
      s: "ops-alerts@cloudmonitoring.io",
      p: 5,
      pl: "🚨 CRITISCH (5/5)",
      c: "sim-res-crit",
      i: "SYSTEM_OUTAGE_ALERT",
      a: ["Controleer Express server logs port 3000", "Escaleer naar bereikbaarheidsdienst", "Verstuur update binnen 15 min"],
      d: "Beste DevOps team, melding is direct opgepakt. We controleren Nginx en Node.js logs. Update volgt z.s.m."
    },
    collab_request: {
      s: "lotte@creative-studio.amsterdam",
      p: 3,
      pl: "🟢 NORMAAL (3/5)",
      c: "sim-res-success",
      i: "COLLABORATION_INVITE",
      a: ["Evalueer generative UI concepten", "Bekijk Figma/GitHub links", "Reageer met beschikbaarheid"],
      d: "Hallo Lotte, tof initiatief! Ik bekijk de materialen en kom er morgen op terug."
    },
    general_inquiry: {
      s: "recruiter@techmatch.nl",
      p: 2,
      pl: "⚪ LAAG (2/5)",
      c: "sim-res-fail",
      i: "AVAILABILITY_QUERY",
      a: ["Controleer agenda en projectbelasting", "Stuur link naar jaaphopman.com"],
      d: "Beste recruiter, dank voor de interesse! Mijn portfolio is te bekijken op jaaphopman.com."
    }
  };

  runBtn.addEventListener("click", () => {
    const cfg = scenarios[scenarioSelect.value] || scenarios.client_quote;

    const payload = {
      event: "EMAIL_PIPELINE_RESOLVED",
      timestamp: new Date().toISOString().split("T")[1].slice(0, 8),
      input_metadata: { sender: cfg.s, scenario: scenarioSelect.value },
      structured_analysis: { intent: cfg.i, urgency_score: cfg.p, action_items: cfg.a },
      generated_draft: { recipient: cfg.s, status: "DRAFT_READY_FOR_HUMAN_REVIEW", body_text: cfg.d }
    };

    outputDiv.innerHTML = `
      <div class="sim-res-header">
        <span>Intentie: <strong>${cfg.i}</strong> (${cfg.s})</span>
        <span class="${cfg.c}">${cfg.pl}</span>
      </div>
      <div class="sim-json-preview">${JSON.stringify(payload, null, 2)}</div>
    `;
  });
};

// Interactive Web Audio API & BPM Beat Engine Simulator
const setupAudioSimWidget = () => {
  const toggleBtn = document.getElementById("toggleAudioBtn");
  const bpmRange = document.getElementById("audioBpmRange");
  const bpmDisplay = document.getElementById("bpmDisplay");
  const btnIcon = document.getElementById("audioBtnIcon");
  const btnText = document.getElementById("audioBtnText");
  const canvas = document.getElementById("audioCanvas");
  const outputDiv = document.getElementById("audioOutput");

  if (!toggleBtn || !bpmRange || !canvas || !outputDiv) return;

  let audioCtx = null;
  let isPlaying = false;
  let timerId = null;
  let currentStep = 0;
  let bpm = Number(bpmRange.value) || 124;
  let canvasCtx = canvas.getContext("2d");
  let freqData = new Uint8Array(16);

  bpmRange.addEventListener("input", (e) => {
    bpm = Number(e.target.value);
    if (bpmDisplay) bpmDisplay.textContent = bpm;
  });

  const playSynthPulse = (freq, type, duration) => {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Audio fallback
    }
  };

  const drawVisualizer = (step) => {
    if (!canvasCtx) return;

    const width = canvas.width;
    const height = canvas.height;
    canvasCtx.clearRect(0, 0, width, height);

    const numBars = 16;
    const barWidth = (width / numBars) - 2;

    for (let i = 0; i < numBars; i++) {
      let barHeight = 8 + Math.floor(Math.random() * 12);
      let color = "rgba(125, 249, 208, 0.3)";

      if (i === step) {
        barHeight = height - 6;
        color = "#7df9d0";
      } else if (i % 4 === 0) {
        barHeight += 10;
        color = "rgba(255, 141, 92, 0.6)";
      }

      canvasCtx.fillStyle = color;
      canvasCtx.fillRect(i * (barWidth + 2), height - barHeight, barWidth, barHeight);
    }
  };

  const tick = () => {
    currentStep = (currentStep + 1) % 16;

    // 4-on-the-floor beat pattern simulation
    if (currentStep % 4 === 0) {
      // Kick drum simulation
      playSynthPulse(110, "sine", 0.15);
    } else if (currentStep % 4 === 2) {
      // Snare / clap synth simulation
      playSynthPulse(320, "triangle", 0.08);
    } else {
      // Hi-hat tick
      playSynthPulse(800, "square", 0.03);
    }

    drawVisualizer(currentStep);

    const payload = {
      event: "AUDIO_BEAT_TICK",
      timestamp: new Date().toISOString().split("T")[1].slice(0, 8),
      engine: "Web Audio API (Synthesizer & Sequencer)",
      current_bpm: bpm,
      step_position: `${currentStep + 1}/16`,
      audio_nodes: ["OscillatorNode", "GainNode", "AudioDestination"],
      status: "PLAYING"
    };

    outputDiv.innerHTML = `
      <div class="sim-res-header">
        <span>Web Audio Sequencer: <strong>${bpm} BPM</strong> (Stap ${currentStep + 1}/16)</span>
        <span class="sim-res-success">● LIVE SYNTH</span>
      </div>
      <div class="sim-json-preview">${JSON.stringify(payload, null, 2)}</div>
    `;

    const intervalMs = (60 / bpm / 4) * 1000;
    timerId = setTimeout(tick, intervalMs);
  };

  toggleBtn.addEventListener("click", async () => {
    if (isPlaying) {
      isPlaying = false;
      if (timerId) clearTimeout(timerId);
      if (btnIcon) btnIcon.textContent = "▶";
      if (btnText) btnText.textContent = "Start Beat Generator";
      outputDiv.innerHTML = `
        <div class="sim-placeholder">Beat generator gepauzeerd. Klik om opnieuw te starten.</div>
      `;
      drawVisualizer(-1);
    } else {
      if (!audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) {
          audioCtx = new AudioCtxClass();
        }
      }

      if (audioCtx && audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      isPlaying = true;
      if (btnIcon) btnIcon.textContent = "⏹";
      if (btnText) btnText.textContent = "Stop Beat Generator";
      tick();
    }
  });

  // Initial draw
  drawVisualizer(-1);
};

setupThemeToggle();
setupMobileNav();
setupContactForm();
setupProjectDemos();
setupArtificerDiceSim();
setupSuperMailSim();
setupAudioSimWidget();
