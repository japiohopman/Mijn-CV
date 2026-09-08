# 🔒 Privacy & Analytics Architecture Decision Record (ADR)

> **Status:** Decided & Implemented
> **Date:** March 2025
> **Owner:** Jaap Hopman (Creative Developer & Technologist)

---

## 1. Context & Problem Statement

Personal portfolio websites and CV applications serve as direct professional showcases for clients, recruiters, and collaborators. Standard web development practices frequently include third-party client-side tracking scripts (such as Google Analytics, Google Tag Manager, Hotjar, or Meta Pixel) to monitor page views and user paths.

However, adding third-party tracking scripts presents significant trade-offs:
- **Privacy & Compliance Overhead:** Requires cookie consent banners, intrusive tracking disclosures, and GDPR/ePrivacy regulatory compliance management.
- **Performance & User Experience:** Client-side analytics scripts add network overhead, execution latency, and potential layout shifts, contradicting the portfolio's sub-15ms TTFB and lightweight performance goals.
- **Security & Dependency Exposure:** Injecting third-party JavaScript creates external vector dependencies and data leaks to corporate tracking networks.

---

## 2. Decision: Zero Client-Side Tracking & Privacy-First Architecture

We have made a deliberate decision: **Measure only what is strictly justified through non-intrusive server metrics, and enforce zero client-side third-party tracking.**

### Core Directives:

1. **Zero Client-Side Third-Party Analytics & Cookies**
   - The application EJS view templates (`views/`, `views/partials/`) **do not contain any third-party tracking scripts** (e.g., Google Analytics, Tag Manager, Hotjar, Mixpanel, or Facebook Pixel).
   - No tracking cookies, local identifiers, or browser fingerprinting scripts are set.
   - Visitors can browse the entire portfolio without encountering cookie banners or cross-site tracking.

2. **Server-Level Operational Metrics Only**
   - Essential operational traffic monitoring (e.g., HTTP status codes, aggregate page hit counts, bandwidth utilization) relies exclusively on anonymous server-level logs provided by the hosting infrastructure (Render / Cloudflare).
   - Server metrics operate without tracking individual user identities, IP address profiles, or cross-site browsing history.

3. **Privacy-Preserving Contact Form (`/api/contact`)**
   - **No PII Logging:** User email addresses and message content are processed purely in-memory for validation and dispatch; they are **never** logged to stdout/application logs or saved to third-party log aggregators.
   - **Privacy-Safe Anti-Spam:** Spam protection uses a non-intrusive honeypot field (`website_url`) rather than tracking reCAPTCHA scripts, preserving visitor privacy while maintaining security.

4. **Automated Continuous Verification**
   - CI automated tests (`test/server.test.js`) inspect rendered HTML outputs to guarantee that no third-party tracking scripts or domain references are introduced into public routes (`/`, `/share`, `/keuken-cv`).

---

## 3. Benefits & Value Delivered

- **High-Performance Execution:** Zero third-party script execution ensures instant page loads and maintains optimal TTFB benchmarks.
- **Respect for Visitor Privacy:** Clean, banner-free browsing experience that respects user autonomy and data privacy by default.
- **Maintained Architectural Integrity:** Simple, clean, and self-contained codebase without third-party vendor lock-in.
