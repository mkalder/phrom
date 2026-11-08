# Phrom erweitern: Analyse & Empfehlung

Nov 8, 2026 · @Marius Kalder

## Ausgangslage

Stand heute: `main` bei `ad8836c` (15. Oktober 2026), seitdem keine Code-Änderung außer der eben committeten Session-Arbeit (Unit-Tests, CI-Workflow, Lizenz- und Beschreibungskorrektur). Version weiterhin `1.0.0`.

- 66 Unit-Tests (`test/*.test.js`) plus ein Regressionstest gegen die Seed-Erwartungen (`npm run eval-seed`) laufen jetzt bei jedem Push und Pull Request in GitHub Actions, ohne Secrets.
- Die Lizenz ist jetzt `UNLICENSED` (vorher irreführend `ISC`), die Projektbeschreibung nennt Phrom korrekt eine CLI-Pipeline statt eines "AI agent".
- Diese Analyse stützt sich auf den bestehenden Evidenzbericht vom 8. Oktober (`discovery/evidenz-2026-10-08.md`) und die Abschnitte "Validation status" und "Limitations and roadmap" im README. Beides wird hier zusammengeführt und für die Erweiterungsentscheidung ausgewertet, nicht neu erhoben.

## Code-Analyse

Die Pipeline ist klar in Verantwortungsbereiche getrennt: 3.285 Zeilen in `src/`, 1.003 in `scripts/`, jetzt 551 in `test/`.

| Modul | Zeilen | Aufgabe |
| --- | --- | --- |
| `checks.js` | 625 | 15 deterministische Prüfungen, kein Netzwerk |
| `improve.js` | 617 | Verbesserungsvorschläge je Kriterium zusammenstellen |
| `cli.js` | 406 | 6 Befehle: run, list, status, select, filter, improve |
| `model.js` | 375 | 9 KI-Prüfungen über Ollama |
| `agent.js` | 347 | Scoring, Ready Gate, Status, Zusammenfassung (Dateiname historisch) |
| `model-improve.js` | 315 | Entwurfsgenerierung + `sanitizeDraft()`-Sicherheitsnetz |
| `tools.js` | 92 | GitHub-Lesezugriff, seit heute lazy validiert |
| `criteria-loader.js` | 68 | lädt `references/criteria/*.json` |
| `ollama-client.js` | 52 | ein Ollama-Client für alle KI-Aufrufe, inkl. lokal/cloud-Erkennung |
| `ui.js` | 50 | Konsolenausgabe |

**Was robust ist:** `evaluate()` ist fail-closed (ein fehlendes Prüfergebnis zählt als nicht bestanden, nie als bestanden); die KI-Checks laufen bei Temperatur 0 mit festem Seed und sind damit reproduzierbar; Lese- und Schreibzugriff sind strikt getrennt (die Seed-Skripte nutzen die GitHub-CLI mit eigenem Login, nie den Analyse-Token); und seit heute laufen 66 Unit-Tests plus ein Regressionstest als CI-Gate.

**Wo die Grenzen liegen:** kein Status-Tracking, kein Retry, kein Resume – ein abgebrochener `phrom run` beginnt komplett neu; Persistenz nur als Dateien (`output/*.md`, `*.json`), keine Datenbank; feste Referenzbeispiele statt Ähnlichkeitssuche; keine Oberfläche außer CLI und Markdown-Reports; `sanitizeDraft()` fängt nur vier konkrete Muster ab (Issue-Nummern, Prozentzahlen, ISO-Daten, Quartale) – erfundene Fließtext-Details oder wörtlich kopierte Referenzinhalte nicht.

## Fachanalyse

Wie vollständig Phrom einen Issue-Typ prüft, hängt stark vom Typ ab – bei Epics ist die Lücke am größten. Aus `references/criteria/*.json`:

| Typ | Implementierte Kriterien | Spezifiziert, aber nicht gebaut | Max. Punkte |
| --- | --- | --- | --- |
| Story | 8 von 9 | `independence` (Duplikat-Erkennung) | 100 |
| Task | 9 von 11 | `task-context`, `task-dependencies` | 100 |
| Bug | 8 von 9 | `bug-impact` | 105 |
| Epic | 6 von 18 | `epic-context`, `epic-boundary`, `epic-success-measure`, `epic-slicing`, `epic-owner`, `epic-stakeholders`, `epic-company-goal`, `epic-milestones`, `epic-timeline`, `epic-risks`, `epic-dependencies`, `epic-child-story-status` | 73 |

Epics werden aktuell nur auf Ziel, Nutzen und eine grobe Story-Liste geprüft (`goal-statement`, `benefit-statement`, `story-list`, plus die KI-Prüfungen `epic-goal`, `epic-benefit`, `size-risk`). Zwölf weitere, bereits spezifizierte Kriterien – darunter Owner, Stakeholder, Verknüpfung zu einem Unternehmensziel, Meilensteine, Risiken, Abhängigkeiten und eine Scope-Abgrenzung – tragen keine Punkte und wirken sich laut `evaluate()` nicht auf Score oder Ready Gate aus, weil sie als `implemented: false` markiert sind. Das ist kein Bug, sondern ein bewusst dokumentierter Zustand – aber es bedeutet: Ein inhaltlich sehr dünnes Epic kann durch die aktuellen sechs Kriterien rutschen.

**Validierungsstatus:** Bisher ausschließlich technische Qualitätsmessung an einem selbst erstellten, kleinen Testset (18 Issues). Eine echte Validierung mit Product Ownern hat noch nicht stattgefunden; die vier im README offen gelassenen Fragen (relevante Lücken, Netto-Aufwand, nutzbare Entwürfe, Wiederholungsnutzung) sind weiterhin unbeantwortet.

**Bekannte Draft-Schwächen** (Stand 8. Oktober, weiterhin ungelöst): erfundene Details (Antwortzeiten, Fehlermeldungen, komplette Risikolisten), wörtlich aus dem Referenzbeispiel kopierte Inhalte (Story #11, Task #14) und Verlust vorhandener Fakten durch Platzhalter (#5, #11). Alle drei sind im Roadmap-Abschnitt des READMEs bereits benannt ("Safer drafts", "Reference matching"), aber noch nicht umgesetzt.

## Einordnung der externen Empfehlung

Das eingefügte Dokument empfiehlt, einen eigenständigen "Product Discovery Review Agent" zu bauen – mit Planner, Tool-Registry, State Machine und Quality Gates, auf Gemini oder lokalem llama.cpp. Das lässt sich an drei Stellen direkt mit Phroms eigener Architektur abgleichen.

**Übereinstimmung:** Phroms Architektur-Abschnitt im README sagt bereits wörtlich: "An agent with tool selection, state management and resumption can follow later as a deliberate extension." Die externe Empfehlung schlägt also keine neue Richtung vor, sondern bestätigt eine, die im Projekt selbst schon als nächster Schritt vorgesehen ist. Auch die einzelnen Bausteine entsprechen in der Substanz der eigenen Roadmap, nur anders benannt: "Status tracking, retry and resume" ist die State Machine; "Reference matching via similarity search" ist ein echter Tool-Aufruf statt der heutigen statischen Referenzdatei; "Independent evaluation" mit 20–50 Testfällen existiert in Ansätzen bereits (`eval-seed.js`, 18 Issues).

**Reibungspunkt 1 – Privacy-Architektur:** Die Empfehlung schlägt die Gemini Free API als LLM vor. Das widerspricht direkt der dokumentierten Haltung von Phrom ("Privacy and security": Backlog-Inhalte verlassen die Maschine nicht, solange Ollama lokal läuft). `ollama-client.js` unterscheidet bereits, ob ein Modell lokal oder cloud-basiert ist (`isLocal`, `cloudModel`) – genau weil ein Cloud-Modell etwas anderes ist, kein Detail, das man nebenbei einführt. Ein externer Anbieter wäre nur vertretbar, wenn er ebenso klar als "nicht lokal" gekennzeichnet wird wie heute schon ein Ollama-Cloud-Modell – nicht als stiller Ersatz.

**Reibungspunkt 2 – separates Repository vs. Weiterentwicklung:** Die Empfehlung spricht von einem neuen Projekt, das "auf Phrom aufbaut". Das würde die bereits aufgebaute Grundlage – Tests, CI, vier ADRs, ein öffentlich dokumentierter Evidenzbericht – entweder duplizieren oder ungenutzt lassen. Fachlich wäre die Kernaufgabe des vorgeschlagenen Agenten (Issue-Text strukturiert bewerten) zudem großteils identisch mit dem, was `checks.js` und `model.js` heute schon tun.

## Empfehlung: wie weiter

Baue die im README bereits dokumentierte Roadmap weiter aus, bevor eine Agenten-Schicht entsteht – in dieser Reihenfolge, weil jede Stufe eine bereits belegte Schwäche behebt und die nächste technisch voraussetzt.

&#91;embedded content: Roadmap · 4 Stufen plus spätere Agenten-Schicht\]

Die vier Stufen schließen dokumentierte Lücken in der bestehenden Pipeline; die Agenten-Schicht folgt erst danach, als eigener, ADR-dokumentierter Schritt.

1. **Epic-Kriterien schließen** – geringstes Risiko, sofort wirksam, kein Architekturwechsel: Zwölf Kriterien sind in `epic-check-criteria.json` schon spezifiziert, nur die Check-Funktionen fehlen noch. Schließt die größte in dieser Analyse gefundene fachliche Lücke.
2. **Status-Tracking, Retry, Resume** – behebt eine im README dokumentierte Schwäche (ein abgebrochener Lauf beginnt neu) und liefert die State Machine, die jede spätere Erweiterung braucht.
3. **Sicherere Drafts über Ähnlichkeitssuche statt statischer Referenz-JSONs** – behebt die am schwersten wiegende dokumentierte Schwäche (Referenz-Kopien, Faktenverlust) und führt echten Tool-Use ein (Retrieval als Werkzeug), ohne einen vollen Agenten-Loop zu bauen. Als Nebeneffekt wird damit auch das bisher fehlende `independence`-Kriterium für Stories erst möglich – es braucht genau dieselbe Ähnlichkeitssuche.
4. **Write-back mit Freigabe und Entscheidungs-Datensatz** – der erste Schritt zu echter Aktionsfähigkeit, weiterhin human-in-the-loop, genau wie im README als Roadmap-Punkt vorgesehen.

Erst wenn diese vier Bausteine stehen, wird die im externen Dokument beschriebene Agenten-Schicht (Planner, Tool-Registry, Quality Gates, Audit-Log) sinnvoll: als eigenes, versioniertes Kapitel von Phrom – mit einem eigenen ADR, nicht als Parallelprojekt.

## Was ich nicht empfehle

**Nicht sofort ein separates neues "Product Discovery Review Agent"-Repository starten**, bevor die vier Stufen oben stehen. Drei Gründe:

- **Verlust an Glaubwürdigkeit:** Tests, CI, vier ADRs, ein öffentlich dokumentierter Evidenzbericht und eine bewusst begründete Lizenzentscheidung sind in Phrom bereits vorhanden und belegt. Ein Parallelprojekt fängt bei null an und muss all das erst wieder aufbauen, um im Bewerbungsgespräch genauso glaubwürdig zu wirken.
- **Doppelte Arbeit an derselben fachlichen Aufgabe:** Die Kernaufgabe des vorgeschlagenen Agenten – einen Issue strukturiert bewerten – ist das, was `checks.js` und `model.js` heute schon leisten, einschließlich Ready Gate und Score. Ein neues Projekt würde diese Logik nicht wiederverwenden, sondern neu schreiben.
- **Die eigene Architektur-Doku widerspricht der Prämisse nicht, der Zeitpunkt aber schon:** Phrom sieht eine Agenten-Erweiterung ausdrücklich vor – aber als nächsten Schritt auf der bestehenden Grundlage, nicht als Ersatz dafür, bevor diese Grundlage ihre dokumentierten Lücken (Epic-Kriterien, Status-Tracking, sichere Drafts) geschlossen hat.

## Nächste konkrete Schritte

Für Stufe 1 (Epic-Kriterien) ist der kleinste sinnvolle erste Zuschnitt: vier der zwölf fehlenden Kriterien sind rein regelbasiert (`check: "code"`), brauchen also kein KI-Prompting und folgen demselben Muster wie die 15 bestehenden Check-Funktionen: `epic-context`, `epic-boundary`, `epic-owner`, `epic-stakeholders`. Die restlichen acht (`epic-slicing`, `epic-company-goal`, `epic-milestones`, `epic-timeline`, `epic-risks`, `epic-dependencies`, `epic-success-measure`, `epic-child-story-status`) brauchen KI- oder Ähnlichkeitssuche und gehören in Stufe 3.

1. **ADR-005 schreiben:** welche vier Kriterien zuerst, warum diese vier, wie die restlichen acht folgen – nach demselben Muster wie ADR-001 bis ADR-004.
2. **`src/checks.js`:** vier neue Funktionen nach dem Muster von `checkContext`/`checkGoalStatement`.
3. **`src/agent.js`:** die vier neuen Keys im Epic-Zweig von `runDeterministicChecks` ergänzen.
4. **`references/criteria/epic-check-criteria.json`:** `implemented: true` setzen und Punkte vergeben; `totalPoints` entsprechend erhöhen.
5. **`seed/issues.json` und `test/checks.test.js`:** die drei Epic-Issues im Testset gegen die neuen Kriterien prüfen und die erwarteten Befunde sowie die Unit-Tests ergänzen.
6. **`node scripts/eval-seed.js`:** gegen das erweiterte Testset laufen lassen, bevor etwas committet wird – wie bisher bei jeder Änderung an den Kriterien.
7. **README.md/.de.md und docs/RULES:** die neue Kriterienabdeckung für Epics dokumentieren.

Stufe 2 (Status-Tracking) und Stufe 3 (Ähnlichkeitssuche) bekommen jeweils ein eigenes ADR, sobald Stufe 1 abgeschlossen ist – das hält jede Änderung auf dem bisherigen Niveau an Nachvollziehbarkeit.
