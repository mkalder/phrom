# Phrom (พร้อม)

**Eine schreibgeschützte CLI, die GitHub Issues vor dem Backlog Refinement prüft und Verbesserungsvorschläge erstellt, die der Product Owner reviewt.**

**Phrom** (พร้อม, Thai für „bereit“) soll Product Ownern formale Vorarbeit abnehmen. Es prüft Issues gegen ein transparentes, versioniertes Regelwerk, bewertet, ob ein Item die Kriterien für das Refinement erfüllt (`phrom run`), und erstellt auf Anforderung einen Verbesserungsentwurf (`phrom improve`). KI-Prüfungen laufen über [Ollama](https://ollama.com) auf einem von dir konfigurierten Host; in der Standardkonfiguration ist das derselbe Rechner, auf dem Phrom läuft, und Backlog-Inhalte werden nicht an einen LLM-Anbieter übertragen. Die Analyse verändert GitHub Issues nie: Der Product Owner prüft jeden Vorschlag und übernimmt ihn manuell.

> **Status:** MVP, Version 1.0.0, Regelwerk 0.3.1. Die beschriebenen Funktionen sind implementiert. Die regelbasierten Prüfungen wurden offline gegen ein Testset mit 18 Issues ausgewertet; die KI-Prüfungen wurden mit den Erwartungen desselben Testsets verglichen. Alle Zahlen stammen aus dem Testtag vom 08.10.2026; Seed-Evaluation und `phrom run` gegen das Demo-Repository liefern dort identische Ergebnisse. Das ist keine unabhängige Messung. **Ob Phrom Product Ownern im echten Arbeitsalltag nützt, ist noch nicht untersucht**, siehe [Stand der Validierung](#stand-der-validierung). Bekannte Lücken stehen unter [Einschränkungen und Roadmap](#einschränkungen-und-roadmap).

<img src="docs/phrom-demo.gif" alt="Phrom-Demo: regelbasierte Backlog-Vorprüfung, KI-Analyse und ein Verbesserungsentwurf" width="600">

## Inhaltsverzeichnis

- [Beispiel](#beispiel)
- [Quick Start](#quick-start)
- [CLI-Befehle](#cli-befehle)
- [Wie Phrom Issues bewertet](#wie-phrom-issues-bewertet)
- [Architektur](#architektur)
- [Datenschutz und Sicherheit](#datenschutz-und-sicherheit)
- [Persistenz und Review](#persistenz-und-review)
- [Qualitätsmessung](#qualitätsmessung)
- [Stand der Validierung](#stand-der-validierung)
- [Einschränkungen und Roadmap](#einschränkungen-und-roadmap)
- [Hintergrund: Problem, Vision und Zielgruppe](#hintergrund-problem-vision-und-zielgruppe)
- [Lizenz](#lizenz)

---

## Beispiel

Issue #3 „Improve login“ im Demo-Repository besteht aus einem einzigen Satz: `The login should be better.`

**Phrom-Bewertung** (`phrom run`, 2026-10-08): 🔴 Not ready · 10/100, sieben fehlgeschlagene Kriterien.

| Kriterium        | Art   | Ergebnis                                                                 |
| ---------------- | ----- | ------------------------------------------------------------------------ |
| `story-format`   | Regel | ❌ Kein Story-Format gefunden                                            |
| `story-context`  | Regel | ❌ Weder Produkt noch Zielgruppe genannt                                 |
| `epic-link`      | Regel | ❌ Kein Epic-Verweis                                                     |
| `ac-presence`    | Regel | ❌ Keine Akzeptanzkriterien (die Regel findet nur eine „should“-Aussage) |
| `story-links`    | Regel | ✅ Besteht bei nicht leerem Body immer                                   |
| `ac-testability` | KI    | ❌ Kriterien vage und nicht messbar („should be better“)                 |
| `size-risk`      | KI    | ❌ Als XL bewertet: zu breit, keine klare Abgrenzung                     |
| `business-value` | KI    | ❌ Kein klarer Nutzer, Bedarf oder Nutzen                                |

**Nachher:** ein Auszug aus dem generierten Verbesserungsvorschlag, unverändert kopiert aus `output/improvement-suggestions/issue-3-improvements-2026-10-08T05-51-15-808Z.md` (erzeugt von `npm run demo`). Der Product Owner muss ihn prüfen, bevor irgendein Teil daraus verwendet wird.

```markdown
## Story

As a [role], I want to [specific login action or improvement], so that [concrete benefit].

## Acceptance Criteria

**Happy Path**

- [ ] Given I am on the login page and have valid credentials, when I enter my username and password and click "Sign in", then I am redirected to my dashboard within 2 seconds.

**Error Cases**

- [ ] Given I enter an incorrect password, when I click "Sign in", then I see a clear error message stating "Invalid credentials. Please try again." and the login form remains visible.
- [ ] Given I am on the login page and have no internet connection, when I attempt to sign in, then I see a network error message and the form is disabled.
```

Fehlende Informationen wie Rolle, Nutzen und Kontext erscheinen als Platzhalter in eckigen Klammern. Issue-Nummern, Prozentwerte, ISO-Daten und Quartale, die nicht im ursprünglichen Issue vorkommen, werden automatisch durch Platzhalter ersetzt. **Andere Details werden nicht abgefangen.** In diesem Entwurf hat das Modell die Antwortzeit „within 2 seconds“, den Meldungstext „Invalid credentials. Please try again.“ und das Kriterium zur fehlenden Internetverbindung erfunden. Die Zeitangabe rutscht durch, weil der Filter keine Zeiteinheiten erkennt. Außerdem fehlt ein Hinweis zum Schneiden, obwohl `size-risk` das Item als XL bewertet. Der Entwurf ist ein Ausgangspunkt, kein Ergebnis.

---

## Quick Start

### Voraussetzungen

- Node.js ≥ 22 und npm ≥ 10
- [Ollama](https://ollama.com) mit [`qwen3:30b-instruct`](https://ollama.com/library/qwen3:30b-instruct). Das dokumentierte Testsystem verwendete Ollama 0.22.1.
- Arbeitsspeicher für das Modell: etwa 19 GB (Quantisierung Q4_K_M, 18 GB auf der Festplatte). Siehe [Laufzeiten](#laufzeiten) für das Testsystem.

### 1. Ollama installieren

```bash
# Ollama installieren (Linux/macOS)
curl -fsSL https://ollama.com/install.sh | sh

# Modell herunterladen
ollama pull qwen3:30b-instruct

# Installation testen
ollama run qwen3:30b-instruct "Hello! What does phrom in thai mean and by the way I will use you as a LLM for phrom the Backlog Refinement MVP. Do you think you can be useful?"
```

Eine Beispielantwort steht in [docs/qwen3/output.md](docs/qwen3/output.md). Die Antwort des Modells variiert von Lauf zu Lauf.

Unter Linux läuft Ollama nach der Installation in der Regel als Systemdienst. Starte `ollama serve` nur, wenn der Dienst nicht aktiv ist.

### 2. Phrom installieren

```bash
git clone https://github.com/MKalder/phrom.git
cd phrom
npm install
```

Führe alle Befehle aus dem Repository-Root aus: Kriterien- und Referenzdateien werden relativ zum Arbeitsverzeichnis geladen.

### Option A: Demo (read-only)

Der schnellste Weg, Phrom in Aktion zu sehen. Die Demo verbindet sich mit einem öffentlichen Demo-Repository und verändert dort nichts.

```bash
cp .env.example .env
```

Werte für die Demo in `.env`:

```bash
GITHUB_OWNER=MKalder
GITHUB_REPO=phrom-backlog-demo
OLLAMA_HOST=http://localhost:11434
MODEL_NAME=qwen3:30b-instruct

#GITHUB_TOKEN=github_pat_your_token_here
```

```bash
npm run demo
```

Die Demo:

1. prüft Umgebung, GitHub, Ollama und Modell (Preflight),
2. führt die formale Vorprüfung (`phrom status`) über das Backlog aus und zeigt, wie viele Issues alle formalen Checks bestehen,
3. analysiert zwei Stories mit KI (zwei Aufrufe von `phrom select`): die mit den meisten formalen Lücken und die formal beste,
4. erstellt für die erste einen Verbesserungsentwurf (`phrom improve n1`) und zeigt ihn als **Vorher → Nachher**.

Optionen (bei npm `--` vor die Flags setzen):

| Option           | Wirkung                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `--verbose`      | Preflight-Details auch bei Erfolg anzeigen                                                     |
| `--full`         | Auch Entwurfsabschnitte anzeigen, die nur Platzhalter enthalten                                |
| `--showcase=<n>` | Ein anderes Issue für das Vorher-Nachher-Beispiel nutzen, z. B. `npm run demo -- --showcase=5` |

### Hinweis: GitHub-API-Limit

GitHub begrenzt die Anzahl der API-Anfragen. Für die öffentliche Demo kann das vor allem bei mehreren Testern relevant werden.

| Zugriff                           |                 Limit |
| --------------------------------- | --------------------: |
| Öffentlich, nicht authentifiziert | 60 Requests/Stunde/IP |
| Authentifiziert (PAT/OAuth)       | 5.000 Requests/Stunde |

Ein Demo-Lauf benötigt etwa 25 Requests. Ohne Authentifizierung ist das Limit deshalb schnell erreicht. In diesem Fall erscheint beispielsweise:

```text
✖ GitHub API rate limit exceeded for <IP>
(But here's the good news: Authenticated requests get a higher rate limit.)
```

Ein Token in `GITHUB_TOKEN` hebt das Limit an. Ein Login mit `gh auth login` reicht dafür nicht, weil die Analyse die GitHub CLI nicht verwendet.

### Option B: Eigenes Backlog

1. **Repository mit Issues anlegen.** Jedes Item erhält genau ein Typ-Label: `type:epic`, `type:story`, `type:task` oder `type:bug`. Fehlt das Label, bestimmt das Modell den Typ (in `run`, `select` und `improve`). Im Testlauf vom 08.10. wurde ein Issue ohne Label (#19) als Task eingeordnet und bewertet. Das zeigt, dass der Weg funktioniert, nicht dass die Zuordnung zuverlässig ist: Die Typ-Erkennung ist nicht evaluiert. Vergib die Labels daher selbst.
2. **Token für die Analyse erstellen.** Nutze einen Fine-grained Personal Access Token, der auf dieses eine Repository beschränkt ist und _Issues: Read-only_ besitzt. Die Analyse benötigt keine Schreibrechte. Nur das optionale Einspielen der Demo-Issues (`npm run seed`, Schritt 4) schreibt, und zwar mit einem eigenen Login; siehe [Datenschutz und Sicherheit](#datenschutz-und-sicherheit). Für ein öffentliches Repository ist kein Token nötig, nur das niedrigere API-Limit gilt.
3. **`.env` konfigurieren:**

   ```bash
   cp .env.example .env
   ```

   ```bash
   GITHUB_TOKEN=github_pat_read_only_token
   GITHUB_OWNER=dein-username
   GITHUB_REPO=mein-backlog

   OLLAMA_HOST=http://localhost:11434
   MODEL_NAME=qwen3:30b-instruct
   ```

4. **Optional: Demo-Backlog in dein Repository einspielen.** Seeding ist ein Schreibvorgang. Es läuft über die GitHub CLI mit einem eigenen Login und nutzt nie `GITHUB_TOKEN`:

   ```bash
   gh auth login
   node seed/labels.js
   npm run seed
   ```

5. **Start:** Führe `npm run phrom status` für einen formalen Überblick aus, anschließend `npm run phrom improve <n>` für ein konkretes Issue.

---

## CLI-Befehle

| Befehl                 | Zweck                                                               | Improvements | Dauer                      |
| ---------------------- | ------------------------------------------------------------------- | ------------ | -------------------------- |
| `phrom run`            | **Alle** offenen Issues bewerten                                    | ❌ Nein      | Lang (Issues × KI-Aufrufe) |
| `phrom improve <n...>` | **Ausgewählte** Issues bewerten und Verbesserungsentwürfe erstellen | ✅ Ja        | Mittel bis lang            |
| `phrom select <n...>`  | **Ausgewählte** Issues bewerten                                     | ❌ Nein      | Mittel                     |
| `phrom filter <type>`  | Issues eines **Typs** bewerten (`epic`, `story`, `task`, `bug`)     | ❌ Nein      | Mittel                     |
| `phrom status`         | **Formale Vorprüfung** (nur deterministische Checks)                | ❌ Nein      | Sekunden                   |
| `phrom list`           | Issues nur **auflisten**                                            | ❌ Nein      | Sekunden                   |

> **`phrom status` ist kein Readiness-Urteil.** Der Befehl führt nur die deterministischen Checks aus und gibt den Anteil bestandener Checks als Wert von 0–50 in drei Bereichen aus: 🟢 mindestens 80 %, 🟡 50–79 %, 🔴 unter 50 %. Er kennt weder KI-Kriterien noch Punktgewichte noch das Ready Gate und berichtet zusätzlich, wie viele Issues _alle_ formalen Checks bestehen. Erst `run`, `select`, `filter` und `improve` liefern die Bewertung.

### Laufzeiten

Gemessen am 2026-10-08 auf dem dokumentierten Testsystem (die Hardware wurde an diesem Tag nicht erneut aufgezeichnet): Linux-Server mit AMD EPYC 7543P (8 vCPUs), 31 GiB RAM **ohne GPU**. `qwen3:30b-instruct` ist ein Mixture-of-Experts-Modell (`qwen3moe`, 30,5 Milliarden Parameter, Q4_K_M). Die Zeiten hängen stark von der Hardware ab.

| Aktion                                               | Gemessen                  |
| ---------------------------------------------------- | ------------------------- |
| Regelbasierte Checks pro Issue                       | < 5 ms (höchstens 4,1 ms)                       |
| KI-Checks pro Issue                                  | 25–55 s (Mittelwert 38 s)                       |
| `phrom run`, 19 Issues                               | gut 12 Min. (729 s)                             |
| `phrom improve` für eine Story (Bewertung + Entwurf) | etwa 2,5 Min.                                   |
| `npm run demo`                                       | gut 3,5 Min. (Vorprüfung 6,5 s, KI und Entwurf 205 s) |

### Beispiele

Issue-Nummern beziehen sich auf das Demo-Repository und können sich nach einem Reset ändern.

```bash
npm run phrom run              # alle Issues bewerten (ohne Improvements)
npm run phrom improve 3        # ein Issue bewerten und verbessern
npm run phrom improve 3 7 5    # mehrere Issues verbessern
npm run phrom select 3 7 5     # mehrere Issues bewerten (ohne Improvements)
npm run phrom filter story     # alle Stories bewerten
npm run phrom status           # formale Vorprüfung
npm run phrom list             # Issues nur auflisten
```

### Ausgabedateien

| Befehl    | Dateien in `output/`                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `run`     | `reports/issue-N-report-*.md`, `summary-*.md`, `results-*.json`                                            |
| `improve` | `reports/issue-N-report-*.md`, `improvement-suggestions/issue-N-improvements-*.md`, `summary-improve-*.md` |
| `select`  | `reports/issue-N-report-*.md`, `summary-select-*.md`                                                       |
| `filter`  | `reports/issue-N-report-*.md`, `summary-filter-<type>-*.md`                                                |
| `status`  | Keine (nur Konsole)                                                                                        |
| `list`    | Keine (nur Konsole)                                                                                        |

---

## Wie Phrom Issues bewertet

Phrom bewertet jedes Issue auf **zwei Ebenen**. Das vollständige Regelwerk (Version 0.3.1) liegt versioniert im Repository; siehe [Regelwerk im Detail](docs/RULES.en.md).

1. **Score (0–100):** erreichte Punkte im Verhältnis zu erreichbaren Punkten.
2. **Ready Gate:** Jedes als `required` markierte Kriterium muss bestehen.

Der Typ eines Issues (`story`, `epic`, `task`, `bug`) bestimmt, welche Kriterien gelten.

| Status        | Bedingung                                      |
| ------------- | ---------------------------------------------- |
| 🟢 Ready      | Ready Gate bestanden **und** Score ≥ 80        |
| 🟡 Needs work | Ready Gate bestanden **und** Score 50–79       |
| 🔴 Not ready  | Ready Gate nicht bestanden **oder** Score < 50 |

**Das Ready Gate überstimmt den Score.** Beispiel aus dem Demo-Repository: Issue #4 „Reset password“ erreicht 80/100 Punkte und ist trotzdem 🔴 Not ready, weil die Pflichtangaben zu Produkt und Zielgruppe (`story-context`) fehlen. Punkte und Pflichtmarkierungen sind pro Kriterium in `references/criteria/*.json` definiert und lassen sich dort anpassen.

> **Im aktuellen Regelwerk kommt 🟡 nur für Stories vor.** Bei Task, Bug und Epic machen die Pflichtkriterien 81–100 % der Punkte aus. Ein bestandenes Gate bedeutet also immer einen Score von mindestens 80: Das Ergebnis ist praktisch 🟢 oder 🔴. [Regeln › Wann ist 🟡 erreichbar?](docs/RULES.en.md#score-and-ready-gate)

### Zwei Arten von Kriterien

- **Deterministisch (Regel):** in Code, in Millisekunden und reproduzierbar geprüft. Beispiele: Story-Format, Epic-Link und Anzahl der Akzeptanzkriterien.
- **KI:** Das Modell liefert eine begründete Einschätzung zu semantischen Fragen, etwa ob Akzeptanzkriterien messbar sind. Das ist eine Einschätzung, keine Tatsache. Reports und Entwürfe markieren jedes Kriterium als `(deterministic)` oder `(ai)`.

### Beispiel: Story (100 Punkte)

| Kriterium        | Art   | Punkte | Pflicht | Bestanden, wenn …                                                                                                                                                                 |
| ---------------- | ----- | -----: | :-----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `story-format`   | Regel |     10 |   ✅    | „As a [role], I want [goal] so that [benefit]“, deutsches Äquivalent oder Rollen-, Wunsch- und Nutzenwörter irgendwo im Text                                                      |
| `story-context`  | Regel |     10 |   ✅    | Produkt und Zielgruppe als ganze Wörter genannt sind, z. B. `Context: Customer Portal, residential customers`                                                                     |
| `epic-link`      | Regel |     10 |    –    | Eine Issue-Referenz wie `#1` vorhanden ist; bei mehreren Referenzen ist ein Epic-Kontextwort nötig. Empfehlung für Nachvollziehbarkeit; die Existenz des Epics wird nicht geprüft |
| `ac-presence`    | Regel |     10 |   ✅    | Mindestens zwei Akzeptanzkriterien vorhanden sind, von denen mindestens eines einen Fehler-, Leerzustands- oder Berechtigungsfall abdeckt                                         |
| `story-links`    | Regel |     10 |    –    | Bei nicht leerem Body immer bestanden; erkannte Abhängigkeitslinks werden als Hinweis gemeldet                                                                                    |
| `ac-testability` | KI    |     17 |   ✅    | Kriterien klar, messbar und prüfbar sind, ohne vage Begriffe zu verwenden                                                                                                         |
| `size-risk`      | KI    |     17 |    –    | Das Modell die Größe als S oder M bewertet; L und XL fallen durch. Ein Risikosignal, keine Schätzung oder Teamzusage                                                              |
| `business-value` | KI    |     16 |    –    | Nutzer, Bedarf und Nutzen erkennbar sind; Business-KPIs sind zunächst nicht erforderlich                                                                                          |

Rechenbeispiel, Issue #3 (10/100): Nur `story-links` bestehen, weil der body nicht leer ist. Die übrigen sieben Kriterien scheitern, vier davon sind Pflicht; damit scheitert auch das Ready Gate.

### Kriterien aller Typen

<details>
<summary>Epic, Task und Bug: Kriterien und Pflichtmarkierungen</summary>

#### **Epic** (Epics haben keine Akzeptanzkriterien, deshalb gilt `ac-testability` nicht.)

| Kriterium                                                         | Art   | Punkte | Pflicht |
| ----------------------------------------------------------------- | ----- | -----: | :-----: |
| `goal-statement` (Zielabschnitt mit mindestens fünf Wörtern)      | Regel |     15 |   ✅    |
| `benefit-statement` (Nutzenabschnitt mit mindestens fünf Wörtern) | Regel |     15 |   ✅    |
| `story-list` (mindestens zwei Child Stories)                      | Regel |     10 |   ✅    |
| `size-risk` (S oder M)                                            | KI    |     17 |   ✅    |
| `epic-goal` (Ziel beschreibt ein Ergebnis, keine Aktivität)       | KI    |      8 |   ✅    |
| `epic-benefit` (Nutzen nachvollziehbar, idealerweise messbar)     | KI    |      8 |   ✅    |

#### **Task**

| Kriterium                                                                                                  | Art   | Punkte | Pflicht |
| ---------------------------------------------------------------------------------------------------------- | ----- | -----: | :-----: |
| `technical-scope` (mindestens zwei Listenpunkte mit Aktionsverb)                                           | Regel |     15 |   ✅    |
| `justification` (Begründung mit konkretem Auslöser: EOL/Datum, Security, Performance oder Compliance)      | Regel |     10 |   ✅    |
| `impact-analysis` (zwei von drei: betroffene Systeme, Downtime/Fenster, Risiken)                           | Regel |     10 |   ✅    |
| `rollback-plan` (Rollback-Abschnitt mit zwei von vier: Verfahren, Test, Zeitschätzung, Runbook-Fundstelle) | Regel |     10 |   ✅    |
| `ac-presence`                                                                                              | Regel |      5 |    –    |
| `ac-testability`                                                                                           | KI    |     20 |   ✅    |
| `size-risk` (S oder M)                                                                                     | KI    |     15 |   ✅    |
| `technical-feasibility`                                                                                    | KI    |     10 |   ✅    |
| `rollback-risk`                                                                                            | KI    |      5 |    –    |

#### **Bug**

| Kriterium                                                           | Art   | Punkte | Pflicht |
| ------------------------------------------------------------------- | ----- | -----: | :-----: |
| `reproduction-steps` (mindestens zwei nummerierte Schritte)         | Regel |     15 |   ✅    |
| `expected-vs-actual`                                                | Regel |     15 |   ✅    |
| `environment-info` (zwei von: Browser, OS, Version, Gerät)          | Regel |     10 |   ✅    |
| `ac-presence`                                                       | Regel |     10 |    –    |
| `ac-testability`                                                    | KI    |     20 |   ✅    |
| `size-risk` (S oder M)                                              | KI    |     15 |   ✅    |
| `severity` (Critical/Major/Minor, durch genannten Impact begründet) | KI    |     10 |   ✅    |
| `reproducibility` (Always/Sometimes/Rarely)                         | KI    |     10 |    –    |

Epic summiert auf 73 Punkte, Bug auf 105 Punkte. Scores werden deshalb auf 100 normiert (erreichte ÷ erreichbare Punkte). Stories und Tasks summieren auf 100 Punkte; dort ändert die Normierung nichts.

</details>

---

## Architektur

Eine CLI-Pipeline mit Regelwerk, KI-Prüfungen über Ollama und einem Human-in-the-Loop-Schritt.

```txt
PO
 │
 ▼
Node.js CLI (phrom)
 │
 ├── GitHub REST API (read-only) ─► GitHub Issues
 │
 ├── Rules Engine
 │   ├── Criteria ────────────────► references/criteria/*.json (criteria-loader.js)
 │   ├── Deterministische Checks ─► checks.js
 │   └── Score + Ready Gate ──────► agent.js (evaluate; historischer Dateiname)
 │
 ├── AI Engine ───────────────────► model.js → ollama-client.js → Ollama (OLLAMA_HOST)
 │
 ├── Improvement Engine ──────────► improve.js → model-improve.js
 │   └── Referenzbeispiele ───────► references/quality/*.json
 │
 └── Filesystem ──────────────────► output/
     ├── reports/
     ├── improvement-suggestions/
     ├── summary-*.md
     └── results-*.json
 │
 ▼
PO Review → Manuelle Übernahme → GitHub Issue
```

**Es ist eine Pipeline, kein Agent.** Phrom führt feste Schritte aus: Issues lesen, deterministische Checks durchführen, KI-Checks ausführen, Ready Gate anwenden, optional einen Verbesserungsentwurf erzeugen und Ergebnisse speichern. Das Modell entscheidet nie, welcher Schritt als Nächstes läuft. Ein Agent mit Werkzeugauswahl, Zustandsverwaltung und Wiederaufnahme kann später als bewusste Erweiterung folgen; siehe [Roadmap](#einschränkungen-und-roadmap).

**Verbesserungsentwürfe** (Improvements) nutzen One-Shot-Prompting: Pro Issue-Typ erhält das Modell ein Referenzbeispiel aus `references/quality/*.json`. Es werden keine Modellgewichte trainiert oder angepasst.

### Assistenzgrenzen

Phrom trifft Aussagen über:

- die Erfüllung definierter Kriterien,
- mögliche Verbesserungen,
- konkrete Verbesserungsvorschläge.

Phrom trifft **keine** Entscheidungen über:

- Priorisierung von Issues,
- Aufwandsschätzung oder Sprint-Zusage,
- technische Machbarkeit,
- Sprint-Reife,
- Annahme von Verbesserungsvorschlägen.

„Ready for refinement“ ist nicht „ready for sprint planning“. Die KI-Kriterien `size-risk` und `technical-feasibility` sind Vorbereitungssignale: `size-risk` lässt das Modell eine Größe S/M/L/XL auf einer tagesbasierten Skala bewerten, aber das Ergebnis ist ein Risikosignal und keine Schätzung, die das Team übernehmen muss. Ob ein Item verstanden, sinnvoll geschnitten und machbar ist, entscheiden Product Owner und Team. Das Team kann jedes Item unabhängig von seiner Ampel besprechen.

---

## Datenschutz und Sicherheit

- **Wo die KI läuft:** Jeder KI-Aufruf geht an den Ollama-Server unter `OLLAMA_HOST` (Standard: `http://127.0.0.1:11434`) mit dem Modell in `MODEL_NAME`. Bei einem lokalen Host und lokal ausgeführtem Modell bleiben Backlog-Inhalte auf deinem Rechner und werden nicht an einen LLM-Anbieter übertragen.
- **Wann Inhalte den Rechner verlassen:** Zeigt `OLLAMA_HOST` auf einen anderen Rechner oder ist `MODEL_NAME` ein Ollama-Cloud-Modell (Suffix `:cloud` / `-cloud`, Ausführung auf ollama.com), werden Issue-Inhalte dorthin übertragen. Die Demo erkennt beide Fälle und bezeichnet sie nicht als „local“.
- **GitHub-Lesezugriffe:** Phrom liest Issues aus deinem Repository über die GitHub REST API. Die Analyse-Pipeline (`src/`) enthält keine Funktion, die nach GitHub schreibt. Schreibschutz ist aber kein allgemeiner Datenschutz: siehe die folgenden Punkte zu Tokens und `output/`.
- **Minimale Rechte:** Für ein privates Repository genügt ein Fine-grained Personal Access Token für dieses eine Repository mit _Issues: Read-only_ (`GITHUB_TOKEN`). Öffentliche Repositories brauchen keinen Token; ohne Token gilt das niedrigere API-Limit.
- **Getrennter Schreibzugriff:** Die Seed-Skripte sind getrennte Hilfswerkzeuge und die einzigen Schreibvorgänge. Sie laufen über die GitHub CLI, entfernen `GITHUB_TOKEN` aus deren Umgebung und nutzen das Konto aus `gh auth login`. Der Analyse-Token wird nie für Schreibzugriffe verwendet.
- **Geheimnisse:** Tokens liegen in `.env` und dürfen nicht committed werden.
- **Output enthält Issue-Inhalte:** `results-*.json` und die Reports enthalten Issue-Text. Behandle `output/` wie das Backlog selbst.
- **Demo ohne Token:** Die Demo benötigt keinen privaten Zugriff. Ohne Token gilt jedoch das anonyme GitHub-Limit von 60 Requests pro Stunde, und ein Demo-Lauf benötigt etwa 25 Requests; ein dritter Lauf innerhalb derselben Stunde erreicht daher das Limit. Jeder Token hebt das Limit an.

### Phrom spricht auf zwei Arten mit GitHub

```txt
Analyse (run, status, select, improve, demo)        Seeding (seed.js, labels.js)
───────────────────────────────────────────        ─────────────────────────────
Node.js-Prozess                                    Node.js startet Kindprozess "gh"
   │                                                  │
   ▼                                                  ▼
@octokit/rest  (src/tools.js, demo.js)             GitHub CLI
   │                                                  │
   │ liest NUR: process.env.GITHUB_TOKEN              │ liest: GITHUB_TOKEN (werden entfernt),
   │                                                  │ sonst eigenes Login aus
   │                                                  │ ~/.config/gh bzw. Keychain
   ▼                                                  ▼
GitHub REST API                                     GitHub API

```

---

## Persistenz und Review

Ergebnisse werden nach jedem Issue als Markdown gespeichert und bei `run` zusätzlich als JSON. Der Review-Ablauf:

1. Der Product Owner öffnet `output/reports/issue-N-report-*.md`. Der Report zeigt den bewerteten Issue-Text, bestandene und fehlgeschlagene Kriterien mit kurzen Begründungen, die Score-Tabelle und das Ready Gate.
2. `phrom improve <n>` erstellt zusätzlich `output/improvement-suggestions/issue-N-improvements-*.md`: einen Vorschlag pro Lücke (Problem, aktueller Stand, empfohlene Formulierung) sowie einen überarbeiteten Entwurf.
3. Der Product Owner übernimmt Vorschläge manuell und führt `phrom improve <n>` erneut aus, um das Ergebnis zu prüfen.

Jedes Kriterium ist als regelbasiert (deterministic) oder KI gekennzeichnet (ai). Es gibt keinen Confidence-Wert für KI-Einschätzungen und keinen „Neu prüfen“-Befehl. Stürzt ein Lauf ab, muss er neu gestartet werden; bereits geschriebene Reports bleiben in `output/` erhalten.

---

## Qualitätsmessung

Dieser Abschnitt beschreibt die **technische** Prüfung: Erkennt Phrom die Mängel, die das Regelwerk definiert? Ob das Product Ownern im Alltag hilft, ist eine andere Frage, siehe [Stand der Validierung](#stand-der-validierung).

Phrom beruht auf der Hypothese, dass ein lokal betriebenes Modell für inhaltliche Prüfungen wie AC-Testbarkeit, Größenrisiko und Business Value ausreichend gut ist. **Das ist eine Hypothese, kein bewiesenes Ergebnis.**

**Testset:** 18 Issues in `seed/issues.json` (7 Stories, 3 Epics, 4 Tasks, 4 Bugs), jeweils mit erwarteten Befunden. Jeder Typ hat mindestens ein gutes Kontroll-Issue sowie schwache, übergroße oder komplexe Issues. Das Set ist selbst erstellt und klein, besonders für Task und Bug.

**Regelbasierte Prüfungen** (offline, alle 18 Issues, `node scripts/eval-seed.js`, 2026-10-08):

- 18 von 18 Issues entsprechen exakt den Erwartungen.
- Alle 31 erwarteten Lücken werden gefunden.
- Es gibt keine zusätzlichen Befunde.

**Volle Pipeline einschließlich KI** (`node scripts/eval-seed.js --ai`, 2026-10-08, alle 18 Issues):

- Alle 45 prüfbaren erwarteten Lücken werden gefunden. Das Testset erwartet insgesamt 49; für vier davon (bei den Epics: Kontext, Abgrenzung zweimal, Erfolgsmaß) gibt es noch kein Kriterium.
- Keines der fünf Kontroll-Issues erhält einen Befund; alle erreichen 100/100 und 🟢.
- Es gibt 15 zusätzliche Befunde, alle aus KI-Kriterien und alle bei ohnehin schwachen Issues. Acht folgen zwingend aus den Kriteriendefinitionen (ein Issue ohne Akzeptanzkriterien fällt auch bei `ac-testability` durch), vier sind inhaltlich berechtigt, drei sind Urteilssache. Die Seed-Erwartungen sind an diesen Stellen unvollständig.
- 10 von 18 Issues entsprechen exakt den Erwartungen. Würden die acht zwingenden Folgebefunde in die Erwartungen aufgenommen, wären es 13 von 18.

**Reproduzierbarkeit:** Die KI-Prüfungen laufen mit Temperatur 0, `top_k` 1 und festem Seed. Am 2026-10-08 lieferten die Seed-Evaluation (liest `seed/issues.json`) und `phrom run` (liest das Demo-Repository über die GitHub-API) für alle 18 gemeinsamen Issues identische Scores, Status und Befunde. Neun Wiederholungen einzelner Issues über `select`, `improve` und die Demo waren bis auf den Zeitstempel identisch. Das gilt für identische Eingabe auf demselben System. Wie stark Urteile nahe einer Schwelle auf andere Formulierungen reagieren, ist nicht gemessen.

**Warum das keine unabhängige Messung ist:**

- Die Prompts wurden anhand derselben Issues angepasst. Beispielsweise bewertete der Größen-Check die übergroße Story „Manage account settings“ zunächst als mittelgroß, und der Value-Check verlangte bei einer Story zunächst Kennzahlen.
- Die Erwartungen wurden vom Autor formuliert.
- Getestet wurde nur ein Modell auf einem Testsystem.

Ein separates Testset und ein Modellvergleich stehen aus.

**Messgrundlage:** Seed-Evaluation, Demo, `phrom run` und alle `improve`-Läufe stammen vom 08.10.2026 und demselben Code-Stand (Regelwerk 0.3.1; ein Commit-Hash wurde nicht festgehalten). Das Demo-Repository enthält die 18 Seed-Issues mit denselben Nummern (#1–#18) und zusätzlich #19, ein Issue ohne Label zum Test der Typ-Erkennung. Auswertung und Schwachstellen beider Seiten, der Tests und des Produkts, stehen im Testbericht `discovery/evidenz-2026-10-08.md`.

```bash
node scripts/eval-seed.js         # nur Regeln, wenige Sekunden
node scripts/eval-seed.js --ai    # volle Pipeline inklusive KI, mehrere Minuten
```

---

## Stand der Validierung

**Technisch geprüft** (im dokumentierten MVP-Kontext: selbst erstelltes Testset mit 18 Issues, Modell `qwen3:30b-instruct`, ein CPU-Testserver):

- GitHub Issues eines öffentlichen Repositories werden schreibgeschützt eingelesen und bewertet.
- Feste Regeln und KI-Einschätzungen arbeiten in einer Pipeline zusammen; Score, Ready Gate und Reports entstehen nachvollziehbar.
- Im Testset findet Phrom alle prüfbaren erwarteten Lücken (45 von 49 erwarteten haben ein Kriterium), ohne die guten Kontroll-Issues zu bemängeln. Seed-Datei und GitHub liefern identische Ergebnisse; bei identischer Eingabe ist die Bewertung reproduzierbar.
- Gute Kontroll-Issues erhalten von `improve` keinen Entwurf. Entwürfe für Stories, ein Epic und einen Task sind aufgezeichnet; sie zeigen bekannte Mängel, siehe [Einschränkungen](#einschränkungen-und-roadmap).
- Ein Issue ohne Label wird einem Typ zugeordnet und bewertet (ein Beispiel, nicht evaluiert).
- Die KI läuft auf demselben Rechner wie Phrom, ohne LLM-Anbieter.

**Noch nicht belegt:**

- Übertragbarkeit auf fremde Backlogs;
- der Betrieb mit privaten Repositories;
- Entwürfe für Bugs; im Testtag nicht aufgezeichnet sind außerdem `phrom filter`, `status` und `list` sowie ein Ollama-Ausfall;
- die Verlässlichkeit der Entwürfe: Es gibt keinen automatisierten Test dafür;
- vor allem: **der Nutzen für Product Owner im echten Arbeitsalltag.**

Ein 🟢 bedeutet, dass ein Item die Kriterien des Regelwerks erfüllt; es ist keine Sprint-Zusage.

**Offene Fragen, die ich als Nächstes prüfe:**

1. **Relevante Lücken:** Zeigt Phrom Lücken, die ein Product Owner bei der eigenen Vorbereitung übersehen hätte und vor dem Refinement beheben würde? Gemeint ist nicht die Anzahl der Befunde, sondern ihre Relevanz.
2. **Netto-Aufwand:** Ist die aktive Arbeitszeit mit Phrom (Report lesen, Fehlbefunde verwerfen, korrigieren) nicht größer als ohne? Die Wartezeit auf das Modell wird getrennt betrachtet.
3. **Verwendbare Entwürfe:** Lässt sich ein Verbesserungsentwurf mit weniger Aufwand in eine brauchbare Fassung bringen als ein eigener Text, und werden die vom Modell erfundenen Details dabei erkannt?
4. **Erneute Nutzung:** Setzt ein Product Owner Phrom bei einer weiteren echten Vorbereitung tatsächlich wieder ein? Zählen wird beobachtetes Verhalten, nicht geäußerte Absicht.

**Erste Validierungsrunde:**

- **Teilnehmende:** zwei bis drei Product Owner, die selbst Backlog-Items vorbereiten.
- **Ablauf:** eine moderierte Session von etwa 60 Minuten per Videocall mit vorbereiteten, synthetischen Beispiel-Issues; optional ein kurzer Folgecheck nach vier Wochen.
- **Voraussetzungen:** keine Installation, keine vertraulichen Daten.

Die Runde dient dazu, Annahmen zu prüfen und die nächste Produktentscheidung vorzubereiten; sie ist kein statistischer Nachweis. Wenn du teilnehmen möchtest: [phrom@mariuskalder.de](mailto:phrom@mariuskalder.de) oder eine Direktnachricht auf LinkedIn.

---

## Einschränkungen und Roadmap

### Bekannte Einschränkungen (MVP)

- **Kleines, selbst erstelltes Testset:** je vier Issues für Task und Bug, drei Epics, je Typ ein gutes Kontroll-Issue (Story: zwei); getestet mit einem Modell auf einem System. Vier erwartete Epic-Lücken haben kein Kriterium.
- **Demo-Repository und Testset:** Das Demo-Repository enthält die 18 Seed-Issues mit denselben Nummern und zusätzlich #19 ohne Label.
- **Heuristiken:** Deterministische Checks erkennen Schlüsselwörter und Muster, keine Bedeutung. Sie sind auf Deutsch und Englisch ausgelegt. `story-context` ist streng: Das Produkt muss ausdrücklich genannt sein. `ac-presence` zählt außerdem Aussagen mit „must“/„should“, daher zählt ein einzelner Satz mit „should“ als ein Kriterium. `technical-scope` zählt auch fett gesetzte Zeilen wie `**Task:** Migrate …` als Arbeitspunkt. `impact-analysis` meldet „Impact section exists“, sobald etwa das Wort „rollback“ vorkommt, und nennt bei einem gefundenen Element dieses Element zugleich als fehlend; das Ergebnis stimmt in den aufgezeichneten Fällen, die Begründung ist irreführend.
- **Entwürfe erfinden Details:** Die Anweisungen verbieten es; Issue-Nummern, Prozentwerte, ISO-Daten und Quartale werden automatisch ersetzt. Alles andere wird nicht abgefangen. In den Entwürfen vom 08.10. erfand das Modell Antwortzeiten („within 2 seconds“, „within 1 second“), Fehlermeldungen und beim Epic #12 vollständige Scope-, Out-of-Scope- und Risikolisten, eine Zielgruppe sowie Beispielnamen in Platzhaltern („Alex Rivera, Senior Product Manager“). Entwürfe sind Vorschläge zur Prüfung.
- **Entwürfe übernehmen Inhalte aus dem Referenzbeispiel:** Der Task-Entwurf zu #14 besteht überwiegend aus Scope-Punkten, Risiken und Prüfschritten aus `references/quality/task-reference.json`; der Story-Entwurf zu #11 übernimmt alle drei Akzeptanzkriterien fast wörtlich aus `story-reference.json`. Der Prompt verbietet das; das Verbot hält nicht zuverlässig. Weil das Story-Referenzbeispiel eine ausgearbeitete Fassung eines Testset-Issues ist, wirken Story-Entwürfe auf diesem Testset besser, als sie sind.
- **Entwürfe können vorhandene Fakten verlieren:** Im Entwurf zu #11 wurden der vorhandene Kontext („Self-Service Customer Portal, residential customers, part of Epic #1“) und die Rolle „customer“ durch Platzhalter ersetzt, bei #5 ebenfalls die Rolle. Jeder Entwurf muss deshalb auch gegen das Original geprüft werden.
- **Feste Beispieltexte:** Der Standardvorschlag zu `ac-testability` bei Stories nennt immer einen PDF-Download, auch bei Login oder Kontoeinstellungen.
- **Entwürfe schwanken:** Checks laufen mit Temperatur 0, Entwürfe mit 0,3. Zwei Läufe können unterschiedliche Entwürfe liefern; wie stark, ist nicht gemessen.
- **Kein Status pro Issue:** Es gibt keinen Status `pending`, `running`, `done`, `failed` oder `incomplete`. Fällt Ollama aus, wird das Issue fail-closed als 🔴 geführt, und der Report sagt, dass die KI-Checks nicht gelaufen sind.
- **Kein Resume:** KI-Aufrufe werden zweimal wiederholt, nach 2 s und 4 s. Ein fehlgeschlagenes Issue wird nicht erneut versucht, und ein abgestürzter `phrom run` startet wieder von vorne.
- **Issue-Nummern:** Reports und Befehle verwenden GitHub-Issue-Nummern, die sich nach einem Reset des Demo-Repositories ändern.
- **Statische Referenzen:** Improvements nutzen feste Referenz-JSON-Dateien, keine Ähnlichkeitssuche. Passt das Beispiel inhaltlich nicht zum Issue (z. B. eine ausgearbeitete Datenbankmigration als Vorlage für ein Issue aus einem einzigen Satz), steigt das Risiko übernommener Inhalte.
- **Konfiguration über JSON und `.env`:** Kriterien, Pflichtmarkierungen und Referenzbeispiele liegen in `references/criteria/*.json` und `references/quality/*.json`; das Modell wird über `MODEL_NAME` festgelegt (Standard: `qwen3:30b-instruct`).
- **Keine UI:** Nur CLI und Markdown-Reports.

### Roadmap

- **Erste qualitative Validierungsrunde mit Product Ownern:** siehe [Stand der Validierung](#stand-der-validierung). Ihr Ergebnis entscheidet über die weiteren Punkte.
- **Unabhängige Evaluation:** separates, manuell bewertetes Testset und Vergleich verschiedener Modelle
- **Statusverfolgung, Retry und Resume** für lange Läufe, einschließlich eines Status `incomplete`
- **Persistenz in PostgreSQL** statt Dateien
- **Sicherere Entwürfe:** Referenzbeispiele ohne übertragbare Fakten, Prüfung auf wörtlich übernommene Sätze, Abgleich mit den Fakten des Originals
- **Referenz-Abgleich** per Ähnlichkeitssuche statt statischer Referenzdateien
- **PO-Review-UI** zur Freigabe von Vorschlägen und **Konfigurations-UI** für Kriterien und Modell
- **Optionales Zurückschreiben nach GitHub** (z. B. Kommentare), nur nach ausdrücklicher Freigabe des Product Owners und mit eigenem Decision Record

---

## Hintergrund: Problem, Vision und Zielgruppe

### Problem

Typische Probleme beim Refinement lassen sich in vier Gruppen zusammenfassen. Diese Gruppierung ist eine eigene Synthese des Autors aus den folgenden Quellen:

| Gruppe                                | Quelle                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schlecht vorbereitete Items           | [Age of Product: Product Backlog and Refinement Anti-Patterns](https://age-of-product.com/28-product-backlog-anti-patterns/) (fehlende Akzeptanzkriterien, Items, die kaum mehr als ein Titel sind); [Alignlee: User Story Readiness Checklist](https://alignlee.com/en/articles/user-story-readiness-checklist-backlog-refinement) |
| Falsche Detailtiefe zur falschen Zeit | [Humanizing Work: Avoiding the Detail Trap](https://www.humanizingwork.com/avoiding-the-detail-trap/)                                                                                                                                                                                                                               |
| Überfülltes Backlog                   | [Age of Product: Product Backlog and Refinement Anti-Patterns](https://age-of-product.com/28-product-backlog-anti-patterns/) (überdimensioniertes Product Backlog)                                                                                                                                                                  |
| Schlecht geführter Termin             | [Agile Pain Relief: Product Backlog Refinement Hell](https://agilepainrelief.com/blog/product-backlog-refinement-hell-solutions/)                                                                                                                                                                                                   |

> Phrom setzt nur bei der ersten Gruppe an: den schlecht vorbereiteten Items.

### Vision

Backlog Refinement soll seine Zeit für das verwenden, was nur ein Team leisten kann: gemeinsames Verständnis aufbauen, schätzen und über den technischen Lösungsweg entscheiden. Ein Teil dieser Zeit geht für Arbeit verloren, die vorher erledigt werden könnte: unklare Formulierungen, fehlende Akzeptanzkriterien und zu große Items.

Die Vision ist ein Assistent, der Handwerk automatisiert, aber das Urteil bei Menschen lässt. Phrom priorisiert **nicht**, schätzt **nicht** und entscheidet **nicht** über technische Machbarkeit. Es hilft Items, besser vorbereitet ins Refinement zu gelangen.

Phrom ist zugleich ein Demonstrationsprojekt. Es zeigt ein KI-gestütztes Tool mit transparentem Regelwerk, einem selbst betriebenen Modell und menschlicher Freigabe, gebaut ohne Framework und ohne Abhängigkeit von einem Cloud-LLM. Es behauptet nicht, dass KI Product Owner ersetzt.

**Architekturentscheidungen:**

- ADR-001: [GitHub Issues as the Data Source](adr/en/ADR-001-github-issues-data-source.en.md)
- ADR-002: [Separate Repositories for Code and Demo Backlog](adr/en/ADR-002-separate-repositories.en.md)
- ADR-003: [CLI Pipeline with Rules Engine, Local AI, and Human-in-the-Loop](adr/en/ADR-003-cli-pipeline-architecture.en.md)
- ADR-004: [Seed and Reset Scripts for the Demo Backlog](adr/en/ADR-004-seed-and-reset-scripts.en.md)

### Zielgruppe

**Primär: Product Owner**, die:

- ihr Backlog in GitHub Issues pflegen,
- Items vor jedem Refinement ohne Tooling-Budget nachschärfen müssen,
- Kontrolle über ihre Daten wollen und Backlog-Inhalte nicht an einen LLM-Anbieter senden möchten,
- Vorschläge prüfen und freigeben wollen, statt automatisierte Änderungen zu erhalten.

Typischer Kontext: ein Scrum-Team, ein Backlog mit einigen Dutzend offenen Items und Refinement-Termine, die mit Formulierungsfragen statt mit inhaltlichen Entscheidungen beginnen.

**Sekundär:** Technisch Interessierte, die sehen möchten, wie sich ein KI-gestütztes Tool mit Regelwerk, selbst betriebenem Modell und Freigabeschritt bauen lässt.

**Nicht die Zielgruppe:** Teams, die Priorisierung, Schätzung oder Sprint Planning automatisieren möchten, sowie Nutzer, die Änderungen ohne menschliche Prüfung wünschen.

### Nutzungsannahmen

- Das Backlog liegt in GitHub Issues.
- Items tragen genau ein Typ-Label: `type:epic`, `type:story`, `type:task` oder `type:bug`.
- Das Team einigt sich auf ein gemeinsames Regelwerk und entscheidet, welche Kriterien Pflicht sind.
- Ein lokal betriebenes Modell ist für die Aufgabe ausreichend gut (Hypothese; siehe [Qualitätsmessung](#qualitätsmessung)).
- Phrom spart Product Ownern netto Vorbereitungsaufwand (offen; siehe [Stand der Validierung](#stand-der-validierung)).

---

## Lizenz

Dieses Repository ist öffentlich zugänglich, damit du den Code lesen, aus dem Ansatz lernen und in Portfolios oder fachlichen Diskussionen darauf verweisen kannst. Es steht nicht unter einer Open-Source-Lizenz: © 2026 Marius Kalder, alle Rechte vorbehalten, soweit nicht ausdrücklich unten eingeräumt. Der Code demonstriert einen architektonischen Ansatz für KI-gestütztes Backlog Refinement.

**Du darfst:**

- den Code ansehen und studieren,
- das Repository zu persönlichen Lernzwecken forken,
- in Portfolios oder fachlichen Diskussionen darauf verweisen.

**Du darfst nicht:**

- den Code ohne Genehmigung kommerziell nutzen,
- ihn als Bestandteil eines Produkts weiterverbreiten,
- die Arbeit als deine eigene ausgeben.

Für Lizenzanfragen: [phrom@mariuskalder.de](mailto:phrom@mariuskalder.de)

---

_Dieses README beschreibt den aktuellen Stand (MVP, Version 1.0.0, Regelwerk 0.3.1)._
