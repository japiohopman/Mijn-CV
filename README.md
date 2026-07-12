# Jaap Hopman - Creative Developer Portfolio & CV

Dit is het geavanceerde, visuele en interactieve portfolio en CV van **Jaap Hopman**. Het project is gemigreerd naar een moderne, modulaire **Node.js, Express en EJS** server-side webapplicatie.

Dit zorgt voor een betere structuur (geen reusachtige, onoverzichtelijke enkele HTML-bestanden), snellere laadtijden, en maakt dynamische routing mogelijk (zoals een aparte pagina voor het makkelijk delen via mobiel en QR-codes).

---

## 🚀 Snelle Start (Lokaal Uitvoeren)

Om dit project op je eigen computer te draaien, volg je deze stappen:

1. **Installeer Node.js**: Zorg ervoor dat je [Node.js](https://nodejs.org/) geïnstalleerd hebt.
2. **Installeer Dependencies**: Open je terminal in de hoofdmap van dit project en voer uit:
   ```bash
   npm install
   ```
3. **Start de Server**:
   ```bash
   npm start
   ```
4. **Bekijk de Site**: Open je browser en ga naar `http://localhost:3000`.

---

## 🛠️ Project Structuur (MVC)

Het project is nu modulair en gestructureerd volgens professionele standaarden:

- `server.js`: De Express webserver en routing-logica (home `/` en share `/share`).
- `public/`: Statische bestanden die direct worden geserveerd:
  - `styles.css`: De complete, geavanceerde responsive stylesheet.
  - `app.js`: De interactieve scripts (zoals de projecten-galerij en animaties).
  - `images/`: Horeca certificaten, logo's en sfeerbeelden.
- `views/`: De pagina-templates die door EJS worden gerenderd:
  - `index.ejs`: De home-pagina.
  - `share.ejs`: De speciale, mobielvriendelijke deelpagina met de QR-code.
- `views/partials/`: Herbruikbare modules om de code overzichtelijk te houden:
  - `head.ejs`: Meta-tags, fonts en imports.
  - `nav.ejs`: De universele navigatiebalk.
  - `over.ejs`: Profielomschrijving, Chess.com-kaart, GitHub Actions-kaart en statistieken.
  - `ervaring.ejs`: Opleiding- en praktijk-tijdlijn.
  - `skills.ejs`: Development, creative en human skills.
  - `projecten.ejs`: De uitgewerkte featured projecten (*Artificer* en *Global Conquest*) en git-integraties.
  - `footer.ejs`: De footer en contact-sectie.

---

## ☁️ Deployen naar Render (Aanbevolen!)

Omdat GitHub Pages alleen **statische** bestanden host (geen Node.js/Express servers), zal GitHub Pages deze applicatie niet kunnen draaien.

**Render** is het perfecte, gratis alternatief voor Node.js-applicaties. Het project is hier al **volledig op voorbereid** (juiste `PORT`-omgevingsvariabelen, start-scripts en `.gitignore` zijn al ingesteld).

### Stappen om in 2 minuten live te gaan op Render:

1. **Zet je code op GitHub**: Push deze bijgewerkte code naar een (publieke of privé) GitHub repository.
2. **Log in op Render**: Ga naar [render.com](https://render.com/) en log in met je GitHub-account.
3. **Maak een nieuwe Web Service aan**:
   - Klik op de knop **"New +"** rechtsboven en kies **"Web Service"**.
   - Selecteer je GitHub-repository in de lijst.
4. **Configureer de instellingen**:
   - **Name**: Bijvoorbeeld `jaap-hopman-portfolio`.
   - **Environment**: Kies `Node` (dit wordt meestal automatisch gedetecteerd).
   - **Region**: Kies de regio die het dichtst bij je doelgroep ligt (bijvoorbeeld *Frankfurt / EU*).
   - **Branch**: Kies je hoofd-branch (meestal `main` of `master`).
   - **Build Command**: `npm install` (staat al standaard goed).
   - **Start Command**: `npm start` (staat al standaard goed).
5. **Kies de gratis versie**: Selecteer de **"Free"** instance-type.
6. **Klik op "Create Web Service"**: Render bouwt en start je server nu automatisch.

Binnen een minuut is je website live onder een gratis, beveiligde URL (zoals `https://jaap-hopman-portfolio.onrender.com`)!

---

## 📱 Mobielvriendelijke Extra's

- **`/share` Route**: Als je naar de `/share` pagina navigeert op je telefoon, zie je een permanente QR-code die direct naar je homepage linkt. Daaronder staan snelle deelknoppen voor WhatsApp, E-mail en een slimme "Kopieer Link"-knop met live feedback. Dit is perfect voor netwerken!
- **Geen Horizontal Scroll**: De layout is 100% responsive en geoptimaliseerd voor Android- en iOS-apparaten. Geen vreemde lege ruimtes of scrollende zijkanten.
- **Directe Activatie**: Door de vernieuwde Intersection Observer laden de projectkaarten en animaties direct in zodra je ze op mobiel in beeld scrollt.
