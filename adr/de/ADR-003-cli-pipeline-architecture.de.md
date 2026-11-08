# ADR-003: CLI-Pipeline mit Regelwerk, lokaler KI und Human-in-the-Loop

- **Status:** Angenommen (ergänzt 2026-10-07: Ollama-Host-Konfiguration, Grenzen der Entwürfe, gemessene Laufzeit; Laufzeit aktualisiert 2026-10-08. Der Teil "Local AI through Ollama" dieser Entscheidung wird am 2026-11-08 durch [ADR-006](ADR-006-litellm-backend.de.md) abgelöst: KI-Aufrufe laufen jetzt über einen selbst betriebenen LiteLLM-Endpoint, nicht mehr über einen lokalen Ollama-Host. Die Entscheidungen zu CLI-Pipeline, Regel-Engine und Human-in-the-Loop unten bleiben unverändert.)
- **Datum:** 2026-10-07
- **Entscheider:** Marius Kalder (Product Owner / Autor von Phrom)
- **Geltungsbereich:** Gesamtarchitektur von `phrom` (CLI, Regelwerk, KI-Integration, Ausgabe und Review-Schritt)

## Kontext

Phrom soll GitHub Issues vor dem Backlog-Refinement bewerten und für unzureichend vorbereitete Items konkrete Verbesserungsentwürfe liefern. Daraus ergeben sich mehrere Architekturfragen:

- Wer bewertet: ein Regelwerk, ein Sprachmodell oder beide?
- Wo läuft das Modell: bei einem Anbieter oder lokal?
- Wie autonom darf das System sein: Schreibt es nach GitHub oder macht es nur Vorschläge?
- Wie soll der Ablauf aufgebaut sein: feste Schritte oder ein Agent, der Tools selbst auswählt?
- Wo werden Ergebnisse gespeichert?

ADR-001 legt GitHub Issues als Datenquelle fest. ADR-002 trennt Code und Demo-Backlog. Dieses ADR beschreibt die Architektur dazwischen.

## Entscheidungstreiber

- **Nachvollziehbarkeit:** Jede Bewertung muss erklärbar sein. Der PO muss sehen können, warum ein Issue durchfällt.
- **Datenkontrolle:** Backlog-Inhalte dürfen nicht an einen LLM-Anbieter gesendet werden.
- **Menschliche Entscheidung:** Priorisierung, Schätzung und Freigabe bleiben beim PO und beim Team.
- **Reproduzierbarkeit:** Gleiche Eingaben sollen so weit wie möglich gleiche Ausgaben liefern.
- **Einfachheit:** Ein Solo-MVP ohne Framework, ohne zusätzliche Infrastruktur und ohne Cloud-Abhängigkeit für das Modell.
- **Konfigurierbarkeit:** Teams sollen Kriterien, Punkte und Pflicht-Flags ohne Codeänderung anpassen können.

## Betrachtete Optionen

**Option A: Bewertung nur durch ein LLM.** Das Modell erhält ein Issue und bewertet es frei. Vorteile: wenig Code und flexibel. Nachteile: schwer nachvollziehbar, nicht reproduzierbar, und das Modell würde auch formale Fehler prüfen, die Code zuverlässig erkennen kann.

**Option B: Agent mit Tool-Auswahl.** Das Modell entscheidet, welches Tool als Nächstes läuft, etwa Issues lesen, Regeln prüfen oder einen Entwurf erzeugen. Vorteile: flexibel und erweiterbar. Nachteile: weniger vorhersehbares und schwerer zu debuggendes Verhalten, höherer Aufwand für State-Management und Fehlerbehandlung, und für den MVP-Umfang unnötig.

**Option C: Cloud-LLM über eine API.** Vorteile: leistungsfähigere Modelle und keine Anforderungen an lokale Hardware. Nachteile: Backlog-Inhalte verlassen die lokale Umgebung, laufende Kosten und Abhängigkeit vom Anbieter.

**Option D: Feste Pipeline mit Regelwerk, lokaler KI und Review-Schritt.** Eine Node.js-CLI führt feste Schritte aus: Issues lesen, deterministische Checks ausführen, KI-Checks ausführen, das Ready Gate anwenden, optional einen Verbesserungsentwurf erzeugen und Ergebnisse speichern. Der PO prüft die Ausgabe und übernimmt Änderungen manuell.

## Entscheidung

Ich wähle **Option D: Eine feste Pipeline mit Regelwerk, lokaler KI und Human-in-the-Loop.**

```txt
PO
 │
 ▼
Node.js-CLI (phrom)
 │
 ├── GitHub REST API (nur lesend)─► GitHub Issues
 │
 ├── Regelwerk
 │   ├── Kriterien ───────────────► references/criteria/*.json (criteria-loader.js)
 │   ├── Deterministische Checks ─► checks.js
 │   └── Score + Ready Gate ──────► agent.js (evaluate)
 │
 ├── KI-Engine ───────────────────► model.js → ollama-client.js → Ollama (OLLAMA_HOST)
 │
 ├── Verbesserungs-Engine ────────► improve.js → model-improve.js
 │   └── Referenzbeispiele ───────► references/quality/*.json
 │
 └── Dateisystem ─────────────────► output/
     ├── reports/
     ├── improvement-suggestions/
     ├── summary-*.md
     └── results-*.json
 │
 ▼
PO-Review
 │
 ▼
Manuelle Übernahme
 │
 ▼
GitHub Issue
```

Begründung:

- **Erst Regeln, dann KI.** Alles, was Code zuverlässig prüfen kann – etwa Story-Format, Anzahl der Akzeptanzkriterien und Epic-Verknüpfungen –, läuft deterministisch in Millisekunden. Das Modell wird nur für semantische Fragen eingesetzt, zum Beispiel ob Akzeptanzkriterien messbar sind. Jedes Kriterium ist im Report als `(deterministic)` oder `(ai)` gekennzeichnet.
- **Regeln als Daten.** Kriterien, Punkte und Pflicht-Flags sind in `references/criteria/*.json` versioniert. Teams können sie ohne Codeänderung anpassen.
- **Das Ready Gate hat Vorrang vor dem Score.** Pflichtkriterien entscheiden, ob ein Item „Ready“ ist. Der Score zeigt den Fortschritt. Fehlt ein Ergebnis, etwa weil Ollama nicht verfügbar ist, gilt das Kriterium als nicht bestanden (fail-closed).
- **Lokale KI über Ollama.** Alle KI-Aufrufe gehen an den Ollama-Server unter `OLLAMA_HOST` (Standard: dieser Rechner) mit dem Modell aus `MODEL_NAME`. Mit lokalem Host und lokal ausgeführtem Modell werden Backlog-Inhalte nicht an einen LLM-Anbieter gesendet. Ein entfernter Host oder ein Ollama-Cloud-Modell würde das ändern, und die Demo meldet das. Antworten kommen als JSON nach einem festen Schema zurück, mit `temperature: 0`, `top_k: 1` und `seed: 42`, damit die Ergebnisse auf demselben Setup möglichst konsistent sind.
- **Verbesserungsentwürfe per One-Shot-Prompting.** Für jeden Issue-Typ erhält das Modell ein Referenzbeispiel aus `references/quality/*.json`. Es werden keine Modellgewichte trainiert. Der Prompt verlangt Platzhalter in eckigen Klammern statt erfundener Fakten. Issue-Nummern, Prozentangaben, ISO-Daten und Quartale, die nicht im Original stehen, werden automatisch ersetzt. Andere erfundene Details (zum Beispiel Meldungstexte oder Scope-Schnitte) werden nicht erkannt. Deshalb durchläuft jeder Entwurf das PO-Review. Am Testtag 2026-10-08 übernahmen Entwürfe außerdem Inhalte aus den Referenzbeispielen und ersetzten in einer Story vorhandenen Kontext durch Platzhalter (siehe `discovery/evidenz-2026-10-08.md`).
- **Pipeline statt Agent.** Das Modell wählt keine Tools aus. Das Verhalten ist reproduzierbar und einfach zu debuggen.
- **Kein Schreibzugriff auf GitHub.** Phrom arbeitet nur lesend. Der Code enthält keine Funktion, die nach GitHub schreibt. Der PO prüft jeden Vorschlag und übernimmt ihn manuell. Das Token benötigt für die Analyse nur _Issues: Read-only_.
- **Dateien als Ausgabe.** Reports, Entwürfe und Zusammenfassungen werden als Markdown und JSON in `output/` gespeichert. Das ist ohne zusätzliche Infrastruktur nachvollziehbar und versionierbar.

## Konsequenzen

### Positiv

- Bewertungen sind für jedes Kriterium erklärbar und nachvollziehbar.
- Mit lokalem Ollama-Host und lokalem Modell verlassen Backlog-Inhalte die lokale Umgebung nicht. Die Issues selbst liest Phrom über die GitHub REST API.
- Die Auswirkung von Fehlern ist begrenzt: Phrom kann keine Issues ändern.
- Kriterien lassen sich ohne Codeänderung anpassen.
- Keine Cloud-Kosten und keine zusätzliche Infrastruktur.

### Negativ / Risiken

- **Die Modellqualität ist nicht vollständig belegt.** Ob ein lokales Modell für semantische Checks wie `ac-testability`, `size-risk` und `business-value` ausreicht, bleibt eine Hypothese. Die Evaluierung gegen ein manuell bewertetes Testset ist noch unvollständig.
- **Laufzeit.** Lokale Inferenz ist langsam: Auf dem reinen CPU-Testsystem dauerten die KI-Checks mit `qwen3:30b-instruct` 24,7–55,1 Sekunden pro Issue (gemessen 2026-10-08), ein `phrom run` über 19 Issues gut 12 Minuten.
- **Heuristiken.** Deterministische Checks erkennen Muster und Schlüsselwörter, nicht Bedeutung. Ein Text kann bestehen, ohne gut zu sein.
- **Keine Wiederaufnahme.** Einzelne KI-Aufrufe werden zweimal wiederholt. Es gibt aber keinen Status pro Issue, kein Retry fehlgeschlagener Issues und kein Resume. Bricht ein Lauf ab, beginnt er von vorn.
- **Manueller Schritt.** Das Übernehmen von Vorschlägen kostet Zeit und ist bewusst nicht automatisiert.
- **Statische Referenzen.** Verbesserungsentwürfe nutzen feste Referenz-JSON-Dateien statt einer Ähnlichkeitssuche.

## Validierung

Die Entscheidung gilt als validiert, wenn:

- ein manuell bewertetes Testset zeigt, dass KI-Checks mit dem lokalen Modell ausreichend zuverlässig sind,
- Läufe auf demselben Setup reproduzierbare Ergebnisse liefern,
- ein Ausfall von Ollama zu einem klaren, nachvollziehbaren Ergebnis führt (fail-closed) statt zu falschen „Ready“-Ergebnissen.

## Offene Fragen

- **Modellwahl:** Ob ein kleineres Modell bei vergleichbarer Qualität deutlich schneller ist, soll ein Modellvergleich klären.
- **Fehlerstatus:** Ein eigener Status `incomplete` statt fail-closed 🔴 ist geplant.
- **Batch-Verarbeitung und Persistenz:** Geplant ist, die Zeitersparnis durch Batch-Verarbeitung und Persistenz in einer Datenbank zu messen.
- **Persistenz:** PostgreSQL statt Dateien ist eine mögliche Erweiterung.
- **Workflow:** Status-Tracking, Retry, Resume und eine spätere Weiterentwicklung zum Agent liegen bewusst außerhalb dieser Entscheidung.
- **Rückschreiben nach GitHub:** Ein Rückschreiben nach GitHub, etwa als Kommentare, würde die Leitplanken berühren und ein eigenes ADR erfordern.
