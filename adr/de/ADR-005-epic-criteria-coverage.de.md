# ADR-005: Schließen der Kriterienlücke bei Epics

- **Status:** Angenommen
- **Datum:** 2026-11-08
- **Entscheider:** Marius Kalder (Product Owner / Autor von Phrom)
- **Geltungsbereich:** Erweiterung des Epic-Regelwerks in `references/criteria/epic-check-criteria.json`, bevor eine Agenten-Schicht erwogen wird

## Kontext

Eine Code- und Fachanalyse von Phrom (angefordert vor jeder weiteren Erweiterung) verglich für jeden Issue-Typ die spezifizierten Kriterien (`references/criteria/*.json`) mit dem tatsächlich Implementierten. Epic war der klare Ausreißer: 6 von 18 spezifizierten Kriterien implementiert, gegenüber 8/9 bei Story, 9/11 bei Task und 8/9 bei Bug. Diese Lücke war bereits vor dieser Entscheidung als bekannte Einschränkung in `docs/RULES.en.md` dokumentiert ("Four further expected Epic gaps have no criterion yet").

Gleichzeitig lag eine extern erstellte Empfehlung vor (nicht vom Autor verfasst), die den Aufbau eines vollständigen "Product Discovery Review Agent" auf Phrom vorschlug: ein Planner, eine Tool-Registry, eine State Machine, Quality Gates und ein Cloud-LLM (Gemini) oder eine lokale `llama.cpp`-Laufzeit. Dieses ADR dokumentiert die Entscheidung, zuerst die belegte Epic-Lücke zu schließen, entlang der im README bereits dokumentierten Reihenfolge, statt die Agenten-Schicht direkt zu bauen.

## Entscheidungstreiber

- **Evidenzbasierte Priorisierung:** Die Epic-Kriterienlücke ist die größte, am deutlichsten belegte Schwäche aus der Analyse; sie ist dringender als eine neue Architekturschicht.
- **Architektonische Kontinuität:** Neue Kriterien sollen sich in die bestehende Konvention aus `implemented` / `required` / `points` (ADR-003: fail-closed, kriterien-JSON-getrieben, kein Agent) einfügen, nicht eine neue Engine erfordern.
- **Regressionssicherheit:** Das Seed-Testset und das Regressions-Gate `eval-seed.js` (eingeführt für CI) sollen weiterhin über Korrektheit neuer Kriterien entscheiden, nicht Stichproben von Hand.
- **Minimale neue Komplexität:** keine neue Abhängigkeit, kein neuer Modell-Host, keine Repository-Teilung, bevor die externe "Agenten"-Empfehlung eigenständig bewertet wird.

## Betrachtete Optionen

**Option A: Die extern empfohlene Agenten-Schicht direkt bauen.** Vorteile: entspricht der "Agenten"-Rahmung des externen Dokuments. Nachteile: widerspricht ADR-003 (Phrom ist bewusst kein Agent); ein Cloud-LLM-Pfad (Gemini) widerspricht der reinen Lokal-Haltung des Projekts bei Datenschutz; fügt State Machine und Tool-Registry hinzu, bevor die einfacheren, bereits geplanten Lücken geschlossen sind; die bestehende Roadmap im README nimmt das meiste vorweg, was das Agenten-Dokument fordert, nur ohne das Wort "Agent".

**Option B: Die im README bereits dokumentierte Roadmap fortsetzen, beginnend mit der größten belegten Lücke (Epic-Kriterien), vor jeder Agenten-Schicht.** Vorteile: jeder Schritt ist additiv zur bestehenden Architektur und mit der bestehenden Seed-/`eval-seed`-Maschinerie testbar; schließt die sichtbarste Schwäche zuerst; erhält die Positionen "kein Agent" und "nur lokal" unverändert; ist technische Voraussetzung für alles Weitere (eine Agenten-Schicht braucht verlässlichen Zustand und sichere Drafts, um sich zu lohnen). Nachteile: langsamer auf dem Weg zu etwas, das als "agentisch" wirkt; weniger visuell eindrucksvoll als ein neues Architekturdiagramm.

**Option C: Beides parallel, in einem separaten Experimental-Repository.** Vorteile: wettet auf beide Richtungen gleichzeitig. Nachteile: ADR-002 hat bereits festgestellt, dass die Trennung von Code und Demo-Daten über Repositories Reibung erzeugt; ein zweites Experimental-Repository würde das verstärken, und ohne konkreten Bedarf gibt es noch nichts für eine Agenten-Schicht zu orchestrieren.

## Entscheidung

Ich wähle **Option B: zuerst die Epic-Kriterienlücke schließen, als ersten Schritt der bestehenden Roadmap.**

- **Neue Kriterien** (jeweils `check: "code"`, `required: true`, 10 Punkte): `epic-context` (nutzt den Vertrag von `checkContext` wieder — Produkt und Zielgruppe müssen benannt sein, derselbe Maßstab wie bei Storys `story-context`), `epic-boundary` (explizite In-Scope- und Out-of-Scope-Abschnitte, jeweils mit echtem Inhalt), `epic-owner` (ein verantwortlicher Owner, benannt mit Rolle oder Team), `epic-stakeholders` (mindestens eine Stakeholder-Gruppe benannt).
- **Keine neue Architektur:** Die vier Prüfungen werden in `src/checks.js` ergänzt, in `runDeterministicChecks` (`src/agent.js`) verdrahtet und in `references/criteria/epic-check-criteria.json` deklariert — exakt das Muster, das bereits für Story, Task und Bug verwendet wird.
- **Korrektur der Seed-Fixture:** Der "good control"-Epic (`seed/issues.json`, Seed #1) brauchte explizite Owner- und Stakeholders-Abschnitte im Body. Der Kontrollfall soll wirklich vollständig sein, nicht eine in die neuen Regeln eingebaute Ausnahme.
- **Korrektur des Regressions-Gates:** Das Mapping `SPEC_TO_KEY.epic` in `scripts/eval-seed.js` brauchte vier neue Identitätseinträge (`epic-context`, `epic-boundary`, `epic-owner`, `epic-stakeholders`, jeweils auf sich selbst abgebildet). Ohne sie wurden die neuen, korrekten Befunde bei den schwachen/übergroßen Epic-Fixtures vom Gate gleichzeitig als "nicht implementiert" und als "zusätzlich" gezählt.

Begründung:

- Die Analyse ergab eine konkrete, belegte Priorität: Epic war der am wenigsten abgedeckte Typ, und die Lücke war bereits als bekannte Einschränkung dokumentiert. Sie zu schließen brauchte keine eigene Architekturentscheidung — nur vier weitere Prüfungen in der von ADR-003 bereits festgelegten Pipeline.
- Diese Arbeit hat zugleich das für CI gebaute Regressions-Gate (`eval-seed.js`) an einer echten, nicht-synthetischen Änderung erprobt, statt nur an der absichtlich fehlschlagenden Testfixture, mit der es ursprünglich verifiziert wurde.

## Konsequenzen

### Positiv

- Die Epic-Abdeckung stieg von 6/18 auf 10/18 spezifizierte Kriterien; die Punktsumme von Epic stieg von 73 auf 113 (für das Scoring weiterhin auf 100 normiert).
- Keine architektonische Änderung: fügt sich exakt in das bestehende fail-closed, kriterien-JSON-getriebene Design ein; keine neue Abhängigkeit, kein neuer LLM-Host, kein neues Repository.
- Das Regressions-Gate stimmt wieder exakt mit dem Seed-Set überein (18/18 Issues), nun an einer echten Änderung validiert.
- Die extern empfohlene Agenten-Architektur bleibt als spätere Option erhalten, sobald die günstigeren, besser belegten Lücken geschlossen sind — passend zur Prioritätsreihenfolge der Roadmap.

### Negativ / Risiken

- Die Wiederverwendung der `checkContext`-Heuristik durch `epic-context` kann bei Text bestehen, der nur zufällig Produkt-/Zielgruppen-Wörter enthält. Während dieser Arbeit bestätigt: "The customer portal should be modern and better." besteht `epic-context`, weil "portal" und "customer" als ganze Wörter erkannt werden, auch ohne expliziten Context-Abschnitt. Das ist eine bekannte, bereits vorher bestehende Einschränkung von `checkContext` (für Story in `docs/RULES.en.md` dokumentiert), die Epic nun erbt.
- `epic-owner` und `epic-stakeholders` erfordern ein explizites Abschnitts-Label ("Owner:", "Stakeholders:"); ein Epic, das einen Owner nur in Fließtext ohne Label benennt, scheitert — dieselbe Struktur-statt-Bedeutung-Einschränkung, die für andere deterministische Prüfungen bereits dokumentiert ist.
- Vier weitere Pflichtkriterien heben die Hürde für das Epic-Ready-Gate an; ein bestehendes Epic in einem echten Backlog, das zuvor 🟢 war, braucht unter Umständen einen Owner-/Stakeholders-Abschnitt, um wieder zu bestehen.
- `epic-boundary`, `epic-owner` und `epic-stakeholders` erschienen bereits vor dieser Änderung auf Spezifikationsebene im `examples`-Array von `epic-check-criteria.json`. Dieses ADR hält ihren Übergang von "spezifiziert" zu "implementiert" fest, nicht eine neue Spezifikationsentscheidung.

## Validierung

Die Entscheidung gilt als validiert, wenn:

- `npm test` besteht, einschließlich der neuen Unit-Tests für `checkEpicContext` / `checkEpicBoundary` / `checkEpicOwner` / `checkEpicStakeholders` und der aktualisierten `evaluate()`-Tests für Epic,
- `node scripts/eval-seed.js` gegen das vollständige 18-Issue-Seed-Set den Exit-Code 0 liefert,
- README.md / README.de.md und docs/RULES.en.md / .de.md die vier neuen Kriterien und die aktualisierte Epic-Punktsumme (113) beschreiben,
- die "good control"-Epic-Fixture mit den neuen Kriterien weiterhin das Ready Gate besteht.

## Offene Fragen

- Ob `epic-owner` und `epic-stakeholders` später, wie schon bei `goal-statement`/`epic-goal` und `benefit-statement`/`epic-benefit`, in ein formales (Struktur-) und ein KI-(Bedeutungs-)Paar aufgeteilt werden sollten, ist offen; vorerst bleiben sie rein deterministisch, damit die Pflichtkriterien des Ready Gate günstig zu prüfen bleiben.
- `epic-success-measure`, `epic-slicing` und die übrigen mit `implemented: false` markierten Epic-Kriterien (Company Goal, Milestones, Timeline, Risks, Dependencies, Child-Story-Status) werden von diesem ADR nicht behandelt; sie bleiben geplant.
- Ob als Nächstes der folgende Roadmap-Schritt (Status-Tracking / Retry / Resume) oder die extern empfohlene Agenten-Schicht folgt, ist eine separate, hier nicht getroffene Entscheidung.
