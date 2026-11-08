# Phrom-Regelwerk

**Version:** 0.3.1
**Datum:** 2026-10-08 (Überarbeitung des Dokuments; erstmals veröffentlicht für 0.3.1 am 2026-10-07)
**Änderungen gegenüber 0.3.0:** Beschreibungen und Bestehensbedingungen in den JSON-Dateien entsprechen jetzt der Implementierung; Punkte und Pflichtmarkierungen sind unverändert.
**Überarbeitung des Dokuments am 2026-10-08:** Beispiele und Grenzen beruhen auf dem Testtag vom 2026-10-08; die genauen Auslösebedingungen von `technical-scope` und `impact-analysis` und ihre bekannten Nebenwirkungen sind dokumentiert. Kriterien, Punkte und Pflichtmarkierungen sind unverändert.
**Epic-Kriterien erweitert am 2026-11-08:** Vier neue deterministische Kriterien (`epic-context`, `epic-boundary`, `epic-owner`, `epic-stakeholders`) wurden zu Epic hinzugefügt; die Punktsumme stieg von 73 auf 113. Siehe [ADR-005](../adr/en/ADR-005-epic-criteria-coverage.en.md).
**Geltungsbereich:** Bewertung von GitHub Issues vor dem Refinement

Dieses Dokument beschreibt, was Phrom prüft, wie der Score berechnet wird und wann ein Issue als „Ready“ gilt. Es ist **keine Definition of Done** und entscheidet nicht über die Sprint-Reife. Die Kriterien selbst liegen maschinenlesbar in `references/criteria/*.json`; von dort werden Punktgewichte und Pflichtmarkierungen gelesen.

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Typ-Erkennung](#typ-erkennung)
- [Score und Ready Gate](#score-und-ready-gate)
- [Kriterien je Typ](#kriterien-je-typ)
- [Regeln der deterministischen Checks](#regeln-der-deterministischen-checks)
- [KI-Checks](#ki-checks)
- [Schnellstatus (`phrom status`)](#schnellstatus-phrom-status)
- [Beispiele](#beispiele)
- [Grenzen der Bewertung](#grenzen-der-bewertung)
- [Geplante Kriterien](#geplante-kriterien)

---

## Überblick

Phrom bewertet jedes Issue auf zwei Ebenen:

1. **Score (0–100):** Der Anteil der erreichten an den erreichbaren Punkten.
2. **Ready Gate:** Alle als **Pflicht** markierten Kriterien müssen bestehen.

| Status | Bedingung |
| --- | --- |
| 🟢 Ready | Ready Gate bestanden **und** Score ≥ 80 |
| 🟡 Needs work | Ready Gate bestanden **und** Score 50–79 |
| 🔴 Not ready | Ready Gate nicht bestanden **oder** Score < 50 |

**Das Ready Gate überstimmt den Score.** Scheitert ein Pflichtkriterium, ist das Issue unabhängig von seiner Punktzahl 🔴. Der Score zeigt den Fortschritt; das Gate entscheidet.

Es gibt zwei Arten von Kriterien:

- **Deterministisch (`code`):** Regelbasierte Checks, in Code implementiert, in Millisekunden ausgeführt und reproduzierbar.
- **KI (`model`):** Ein über Ollama bereitgestelltes Modell liefert eine begründete Einschätzung. Das ist eine Einschätzung, keine Tatsache.

„Bereit fürs Refinement“ ist nicht dasselbe wie „bereit fürs Sprint Planning“. Phrom priorisiert nicht, schätzt nicht und bestätigt keine technische Machbarkeit.

---

## Typ-Erkennung

Der Typ bestimmt, welche Kriterien gelten.

1. **Label:** `type:epic`, `type:story`, `type:task` oder `type:bug`.
2. **Fallback bei fehlendem Label:** Das Modell ordnet das Issue genau einem der vier Typen zu, mit Konfidenz `high`, `medium` oder `low` und einer Begründung. Dieser Fallback wird in `run`, `select` und `improve` verwendet.
3. `phrom filter <type>` berücksichtigt nur Issues mit Label. `phrom status` wendet Story-Checks an, wenn kein Label vorhanden ist.

Beispiel vom Testtag am 2026-10-08: Issue #19 hat kein Label, wurde vom Modell als Task eingestuft (Konfidenz `high`) und dann mit den Task-Kriterien bewertet. Das zeigt, dass der Fallback funktioniert; ob seine Zuordnungen verlässlich sind, ist nicht ausgewertet. Setze Labels selbst.

---

## Score und Ready Gate

**Score** = `round(achieved points ÷ achievable points × 100)`

- Ein Kriterium vergibt seine Punkte entweder vollständig oder gar nicht.
- Erreichbar sind nur Kriterien, die implementiert sind (`implemented` ist nicht `false`) und Punkte tragen.
- Die Punktsumme je Typ steht in `scoring.totalPoints` der jeweiligen JSON-Datei. Story und Task ergeben 100, Epic 113 und Bug 105 Punkte; der Score wird daher auf 100 normiert.

**Ready Gate:** Für jedes Pflichtkriterium muss ein Ergebnis vorliegen, **und** es muss bestehen. Fehlt ein Ergebnis, etwa weil Ollama nicht erreichbar ist, gilt das Kriterium als nicht bestanden. Das Issue wird dann als 🔴 markiert.

```javascript
function calculateStatus(score, gateFailed) {
  if (gateFailed) return { status: "not-ready", emoji: "🔴" };
  if (score >= 80) return { status: "ready", emoji: "🟢" };
  if (score >= 50) return { status: "needs-work", emoji: "🟡" };
  return { status: "not-ready", emoji: "🔴" };
}
```

**Wann ist 🟡 erreichbar?** Nur wenn Pflichtkriterien weniger als 80 % der Gesamtpunkte ausmachen. Das trifft auf **Story** zu (Pflicht = 47 von 100 Punkten). Bei Task (90 %), Epic (100 %) und Bug (81 %) führt ein bestandenes Gate immer zu einem Score von mindestens 80; für diese Typen ist der Status praktisch 🟢 oder 🔴.

Beispiele aus dem Lauf am 2026-10-08: „Reset password“ (#4) erreicht 80 und „Download invoice“ (#11) erreicht 90, dennoch sind beide 🔴, weil ein Pflichtkriterium scheitert (`story-context` bzw. `ac-presence`). „Change payment method“ (#8) erreicht 90 und ist 🟢, obwohl der Epic-Verweis fehlt, weil `epic-link` optional ist.

Weil `story-links` bei nicht leerem Body immer besteht, erreicht eine Story mit bestandenem Gate mindestens 57. Der Zweig „Score < 50“ von 🔴 wird daher bei bestandenem Gate für keinen Typ erreicht: In der Praxis bedeutet 🔴 immer, dass das Ready Gate gescheitert ist.

| Typ | Pflichtpunkte | Gesamtpunkte | Pflichtanteil | 🟡 möglich |
| --- | ---: | ---: | ---: | :---: |
| Story | 47 | 100 | 47 % | ✅ |
| Task | 90 | 100 | 90 % | – |
| Epic | 113 | 113 | 100 % | – |
| Bug | 85 | 105 | 81 % | – |

---

## Kriterien je Typ

Punkte, Art und Pflichtstatus je Kriterium. ✅ = Pflicht (Ready Gate), „–“ = optional (zählt nur im Score).

### Story (100 Punkte)

| Kriterium | Art | Punkte | Pflicht |
| --- | --- | ---: | :---: |
| `story-format` | Regel | 10 | ✅ |
| `story-context` | Regel | 10 | ✅ |
| `epic-link` | Regel | 10 | – |
| `ac-presence` | Regel | 10 | ✅ |
| `story-links` | Regel | 10 | – |
| `ac-testability` | KI | 17 | ✅ |
| `size-risk` | KI | 17 | – |
| `business-value` | KI | 16 | – |

Stories können ohne Epic existieren, etwa Bugfixes, Spikes oder kleine Features. Der Epic-Verweis ist daher eine Empfehlung für die Nachvollziehbarkeit, keine Pflicht. `size-risk` ist ein Risikosignal, keine Schätzung und keine Zusage des Teams.

### Task (100 Punkte)

| Kriterium | Art | Punkte | Pflicht |
| --- | --- | ---: | :---: |
| `technical-scope` | Regel | 15 | ✅ |
| `justification` | Regel | 10 | ✅ |
| `impact-analysis` | Regel | 10 | ✅ |
| `rollback-plan` | Regel | 10 | ✅ |
| `ac-presence` | Regel | 5 | – |
| `ac-testability` | KI | 20 | ✅ |
| `size-risk` | KI | 15 | ✅ |
| `technical-feasibility` | KI | 10 | ✅ |
| `rollback-risk` | KI | 5 | – |

### Bug (105 Punkte, auf 100 normiert)

| Kriterium | Art | Punkte | Pflicht |
| --- | --- | ---: | :---: |
| `reproduction-steps` | Regel | 15 | ✅ |
| `expected-vs-actual` | Regel | 15 | ✅ |
| `environment-info` | Regel | 10 | ✅ |
| `ac-presence` | Regel | 10 | – |
| `ac-testability` | KI | 20 | ✅ |
| `size-risk` | KI | 15 | ✅ |
| `severity` | KI | 10 | ✅ |
| `reproducibility` | KI | 10 | – |

### Epic (113 Punkte, auf 100 normiert)

| Kriterium | Art | Punkte | Pflicht |
| --- | --- | ---: | :---: |
| `goal-statement` | Regel | 15 | ✅ |
| `benefit-statement` | Regel | 15 | ✅ |
| `story-list` | Regel | 10 | ✅ |
| `size-risk` | KI | 17 | ✅ |
| `epic-goal` | KI | 8 | ✅ |
| `epic-benefit` | KI | 8 | ✅ |
| `epic-context` | Regel | 10 | ✅ |
| `epic-boundary` | Regel | 10 | ✅ |
| `epic-owner` | Regel | 10 | ✅ |
| `epic-stakeholders` | Regel | 10 | ✅ |

---

## Regeln der deterministischen Checks

Alle deterministischen Checks arbeiten auf dem Issue-Body und unterscheiden nicht zwischen Groß- und Kleinschreibung. Ein leerer Body lässt jeden deterministischen Check scheitern.

### Story

**`story-format`** besteht, wenn der Text einem bekannten Muster folgt oder alle drei Bestandteile enthält:

- Deutsch: „Als … möchte ich … damit …“, „… um … zu …“, „… will ich … damit …“
- Englisch: „As a … I want … so that …“, „… in order to …“, „As a … I need … so that …“, „… I should be able to … so that …“
- Umgekehrte Reihenfolge: „In order to …, as a … I want …“ und „Um … zu …, als … möchte ich …“.
- Fallback: Rolle („als“ oder „as“ gefolgt von einem Wort, optional „as a“), Wunsch (möchte, will, want, need, should be able to) und Nutzen (damit, um … zu, so that, in order to) kommen irgendwo im Text vor, auch ohne Standardformulierung.

**`story-context`** besteht, wenn sowohl ein **Produkt** (zum Beispiel product, feature, system, portal, app, platform, service) als auch eine **Zielgruppe** (zum Beispiel user, customer, client, admin, kunde, benutzer) als ganze Wörter vorkommen. Die Rolle im Story-Satz („As a customer“) zählt als Zielgruppe, ein Produkt muss aber zusätzlich genannt sein, etwa in einer Zeile wie `Context: Customer Portal, residential customers`. Business-Begriffe (value, goal, need usw.) zählen nicht; den Nutzen bewertet `business-value` (KI).

**`epic-link`** besteht, wenn eine Issue-Referenz (`#12` oder `owner/repo#12`) vorhanden ist und entweder:

- genau eine Referenz existiert, die als wahrscheinliches übergeordnetes Epic gilt; oder
- mehrere Referenzen existieren und ein Epic-Kontextwort vorkommt (epic, parent, part of, belongs to, under, related to, tracking, initiative).

Ob das referenzierte Epic in GitHub existiert, wird nicht geprüft.

**`ac-presence`** zählt Akzeptanzkriterien auf drei Arten und verwendet das Maximum: Checklistenpunkte (`- [ ] …`), Gherkin-Szenarien (Zeilen mit Given/When/Then/And/But; drei Zeilen ≙ ein Szenario) und Vorkommen von „must“, „should“, „verify that“ oder „it is required that“. Er besteht mit **mindestens zwei** Kriterien, von denen mindestens eines einen **Fehler-, Leerzustands- oder Berechtigungsfall** abdeckt (error, invalid, fail, empty, „no …“, „not signed in“, expired, redirected usw.). Geprüft wird der Text der Kriterien, nicht der gesamte Body. Gibt es weder Checklistenpunkte noch Gherkin-Zeilen noch einen AC-Abschnitt, ergibt sich die Anzahl nur aus „must/should“-Aussagen; der Report meldet dann „No acceptance criteria found (only n 'must/should' statement)“.

**`story-links`** besteht bei jedem nicht leeren Body. Erkannte Muster (depends on, blocked by, requires, blocks, related to, see also, duplicate of) werden als Hinweis ausgegeben. Fehlende Links führen zu keinem Abzug; die 10 Punkte werden daher praktisch immer vergeben.

### Task

**`technical-scope`** besteht, wenn ein Abschnitt „What / Scope / Technical Scope“ (Überschrift, fettes Label oder `Label:`) oder eine Liste mit Aktionsverben vorhanden ist und mindestens **zwei** Zeilen, die mit `-` oder `*` beginnen, ein Aktionsverb enthalten (upgrade, migrate, implement, create, update, configure, refactor, deploy, setup, install, remove, add). Es zählen Zeilen im gesamten Body, nicht nur im Scope-Abschnitt. Weil fette Labels ebenfalls mit `*` beginnen, wird eine Zeile wie `**Task:** Migrate …` als Arbeitspunkt gezählt; zwei solche Label-Zeilen können den Check daher ohne echte Liste bestehen lassen.

**`justification`** besteht, wenn ein Begründungsabschnitt (Why, Reason, Justification, Background, Motivation; Überschrift oder Label) oder ein Schlüsselwort vorkommt **und** ein konkreter Auslöser genannt ist: EOL/Jahr/Quartal (eol, end-of-life, `Q1`–`Q4`, `202x`), security, performance oder compliance. „debt“ oder „deprecated“ allein reichen nicht.

**`impact-analysis`** besteht, wenn ein Impact-Abschnitt (Überschrift Impact, Affected, Downtime, Risks) oder eines der Schlüsselwörter „affected systems“, „downtime“, „maintenance window“ oder „rollback“ vorkommt **und** mindestens **zwei von drei** Elementen irgendwo im Body genannt sind: betroffene Systeme (affected systems, databases, services), Downtime (downtime, window, maintenance) und Risiken (risk, risks).

Bekannte Nebenwirkung: Das Wort „rollback“ allein löst den zweiten Schritt aus; ein Issue mit Rollback-Plan, aber ohne Impact-Abschnitt erhält daher die Meldung „Impact section exists but incomplete“. Wird genau ein Element gefunden, nennt die Meldung es als gefunden und, weil der Text fest vorgegeben ist, zugleich als fehlend („Found: affected systems. Missing: affected systems + downtime/risks.“). Das Ergebnis stimmt in den aufgezeichneten Fällen; der Begründungstext ist irreführend.

**`rollback-plan`** besteht, wenn ein Abschnitt „Rollback“ (Überschrift oder Label) existiert **und** mindestens **zwei von vier** Angaben genannt sind: Verfahren (procedure, steps, restore, backup), Test (tested, test), Zeitschätzung (zum Beispiel „15 minutes“ oder „within 30“) und Fundstelle (runbook, documented in, location).

**`ac-presence`:** wie bei Story.

### Bug

**`reproduction-steps`** besteht, wenn ein Reproduktionsabschnitt, eine nummerierte Liste oder „Step n“ vorkommt und mindestens **zwei** nummerierte Schritte oder „Step“-Markierungen vorhanden sind.

**`expected-vs-actual`** besteht, wenn „expected“ vorkommt und zusätzlich „actual“, „instead“ oder „but got“.

**`environment-info`** besteht, wenn ein Umgebungsabschnitt oder ein Schlüsselwort (browser, os, version, device, platform, ios, android, windows, mac, safari, chrome, firefox) vorkommt und mindestens **zwei** Angaben erkannt werden: Browser, OS, Version oder Gerät/Plattform.

**`ac-presence`:** wie bei Story.

### Epic

**`goal-statement`** besteht, wenn ein Zielabschnitt (Überschrift `## Goal`, Label `**Goal:**` oder `Goal:`; auch Objective, Aim, Purpose) mit mindestens fünf Wörtern vorhanden ist oder der Text „goal is to“ / „objective is to“ enthält. Geprüft wird nur die Struktur. Ob das Ziel ein Ergebnis beschreibt, bewertet `epic-goal` (KI); messbare Ziele und Termine werden als Hinweis ausgegeben.

**`benefit-statement`** besteht, wenn ein Nutzenabschnitt (Benefit, Value, Impact, Outcome als Überschrift oder Label) mit mindestens fünf Wörtern vorhanden ist oder der Text „benefit is/will be“ enthält. Geprüft wird nur die Struktur; ob der Nutzen verständlich ist, bewertet `epic-benefit` (KI). Eine Quantifizierung wird als Hinweis ausgegeben.

**`story-list`** besteht, wenn mindestens **zwei** Issue-Referenzen (`#n`) im Body vorkommen oder ein Abschnitt namens „Stories“, „Child Stories“, „Candidate Stories“ oder „Slices“ mindestens **zwei** Listenpunkte enthält.

**`epic-context`** teilt sich Vertrag und Implementierung mit `story-context` (`checkContext`): Produkt und Zielgruppe müssen als ganze Wörter benannt sein. Wie bei Story reichen zufällige Treffer (zum Beispiel „portal“ und „customer“ irgendwo im Text); ein expliziter „Context“-Abschnitt ist nicht erforderlich.

**`epic-boundary`** besteht, wenn sowohl ein „In Scope“- als auch ein „Out of Scope“-Abschnitt (Überschrift oder Label) vorhanden ist und jeder mindestens drei Wörter echten Inhalt enthält.

**`epic-owner`** besteht, wenn ein „Owner“-Abschnitt (Überschrift oder Label) vorhanden und nicht leer ist. Eine Rolle oder ein Teamname wird erwartet (zum Beispiel „Owner: Jane Doe, Platform Team“), wird aber nicht getrennt vom restlichen Abschnitt geparst.

**`epic-stakeholders`** besteht, wenn ein „Stakeholders“-Abschnitt (Überschrift oder Label) vorhanden und nicht leer ist. Eine oder mehrere Stakeholder-Gruppen können aufgeführt werden, zum Beispiel als Aufzählung.

---

## KI-Checks

KI-Checks laufen über den Ollama-Server unter `OLLAMA_HOST` (Standard `http://127.0.0.1:11434`) mit dem Modell in `MODEL_NAME` (Standard `qwen3:30b-instruct`). Inhalte bleiben nur dann auf dem Rechner, wenn der Host lokal ist und das Modell kein Ollama-Cloud-Modell ist.

**Technische Details:**

- Antworten sind JSON nach einem festen Schema (Structured Output), ohne Freitext-Parsing.
- `temperature: 0`, `top_k: 1` und `seed: 42` werden verwendet, um auf demselben Setup möglichst konsistente Ergebnisse zu erhalten. Eine bitgenaue Garantie über Hardware oder Modellversionen hinweg gibt es nicht.
- Bei Fehlern werden bis zu zwei Wiederholungen versucht, mit 2 s bzw. 4 s Wartezeit.
- Jeder Check liefert eine kurze Begründung in der Sprache des Issues.
- Die Prompts für `size-risk`, `technical-feasibility` und `severity` weisen das Modell an, nur den Issue-Text zu bewerten und keine Technologien oder Plattformen anzunehmen, die nicht genannt sind.
- Fällt Ollama aus, fehlen die KI-Ergebnisse. Pflichtkriterien gelten dann als nicht bestanden (fail-closed).

| Kriterium | Typen | Besteht, wenn … |
| --- | --- | --- |
| `ac-testability` | Story, Task, Bug | Alle Akzeptanzkriterien sind klar, messbar, eindeutig und testbar. Vage Formulierungen wie „works well“ oder „user-friendly“ sowie fehlende Kriterien scheitern. |
| `size-risk` | Alle | Die geschätzte Größe ist **S** oder **M** (S: < 1 Tag, geringes Risiko; M: 1–3 Tage, offene Fragen; L: 3–10 Tage; XL: > 10 Tage). Der Prompt enthält typspezifische Breitenindikatoren aus der Kriterien-JSON, zum Beispiel mehrere unabhängige Ziele, mehrere Plattformen oder „all“ / „complete“ ohne Abgrenzung. Er weist das Modell an, die Breite zu beurteilen: Trifft kein Indikator eindeutig zu, ist das Ergebnis S oder M, auch wenn die Arbeit umfangreich ist. L und XL scheitern. Die tagesbasierte Skala macht die Einstufung konkret; das Ergebnis ist ein Risikosignal, keine Schätzung, die das Team übernehmen muss. In den Seed-Erwartungen für Epics erscheint dieses Kriterium als `epic-oversize-risk`. |
| `business-value` | Story | Ein Nutzer oder eine Rolle, ein konkretes Bedürfnis und ein nachvollziehbarer Nutzen aus Sicht des Nutzers sind erkennbar. Business-KPIs sind nicht erforderlich. „Improve X“ ohne Nutzen scheitert. |
| `epic-goal` | Epic | Das Ziel beschreibt ein Ergebnis für das Business oder den Nutzer, nicht nur ein Thema. |
| `epic-benefit` | Epic | Der Nutzen ist verständlich: Wer gewinnt was, idealerweise messbar. |
| `technical-feasibility` | Task | Der technische Ansatz ist machbar und verstanden; erhebliche technische Unsicherheit scheitert. |
| `rollback-risk` | Task | Der Rollback ist der Auswirkung auf die Produktion angemessen; ein ungetesteter Rollback scheitert. |
| `severity` | Bug | Der Schweregrad (Critical, Major, Minor) ist klar begründet. |
| `reproducibility` | Bug | Die Reproduzierbarkeit (Always, Sometimes, Rarely) ist klar angegeben. |

KI-Ergebnisse sind in Reports und Entwürfen als `(ai)` markiert, deterministische Ergebnisse als `(deterministic)`.

---

## Schnellstatus (`phrom status`)

`phrom status` führt **nur deterministische Checks** aus. Er kennt weder KI-Kriterien noch Punktgewichte noch das Ready Gate und ist **kein Readiness-Urteil**.

- Wert = `round(passed checks ÷ number of checks × 50)`
- Bereiche: 🟢 mindestens 80 % der formalen Checks bestanden (Wert ≥ 40), 🟡 50–79 % (≥ 25), 🔴 unter 50 %
- Zusätzlich: die Anzahl der Issues, die **alle** formalen Checks bestehen

🟢 bedeutet hier nicht „keine formalen Lücken“: Ein Issue mit 4 von 5 bestandenen Checks ist 🟢, auch wenn der gescheiterte Check Pflicht ist. In der vollständigen Analyse kann es zudem 🔴 sein, etwa weil seine Akzeptanzkriterien nicht testbar sind. Nur die Bewertung mit KI (`run`, `select`, `filter`, `improve`) wendet das Ready Gate an.

---

## Beispiele

Alle Beispiele stammen aus dem `phrom run` vom 2026-10-08 gegen das Demo-Repository.

### Issue #3 „Improve login“ (Story): 10/100, 🔴 Not ready

| Kriterium | Ergebnis | Punkte |
| --- | :---: | ---: |
| `story-format` | ✖ | 0 |
| `story-context` | ✖ | 0 |
| `epic-link` | ✖ | 0 |
| `ac-presence` (keine Kriterien; eine „should“-Aussage) | ✖ | 0 |
| `story-links` | ✔ | 10 |
| `ac-testability` | ✖ | 0 |
| `size-risk` | ✖ | 0 |
| `business-value` | ✖ | 0 |
| **Summe** | | **10** |

Das Ready Gate scheitert an vier Pflichtkriterien: den Regelkriterien `story-format`, `story-context` und `ac-presence` sowie dem KI-Kriterium `ac-testability`.

### Issue #7 „View invoice overview“ (Story): 100/100, 🟢 Ready

Alle fünf formalen Checks bestehen – Story-Format, Kontext (`Self-Service Customer Portal, residential customers`), Epic-Verweis, drei Akzeptanzkriterien einschließlich eines Leerzustands und Story-Links –, ebenso alle drei KI-Checks.

### Rechenbeispiel: Das Gate überstimmt den Score

Eine Story besteht alles außer `ac-testability` (17 Punkte, Pflicht). Ihr Score ist 83 und läge damit im 🟢-Bereich. Weil ein Pflichtkriterium scheitert, ist das Issue trotzdem 🔴 Not ready: Nicht testbare Akzeptanzkriterien wie „All options“ und „the change is applied“ machen ein Issue nicht bereit fürs Refinement, auch wenn es sonst formal vollständig ist.

---

## Grenzen der Bewertung

- **Heuristiken:** Deterministische Checks erkennen Schlüsselwörter und Muster, keine Bedeutung. Ein Text kann bestehen, ohne gut zu sein, und umgekehrt.
- **Schlüsselwörter:** Produkt und Zielgruppe werden über Wortlisten erkannt; ganze Wörter, Pluralformen und deutsche Endungen werden toleriert. Ein Produkt, das nicht in der Liste steht, zum Beispiel „Dashboard“, wird nicht erkannt und lässt `story-context` scheitern.
- **Sprachen:** Formate und Schlüsselwörter sind auf Deutsch und Englisch ausgelegt.
- **Epic-Verweis:** Die Existenz des Epics und der Rückverweis in GitHub werden nicht geprüft.
- **KI-Einschätzungen** sind begründete Meinungen. Sie können falsch sein, und ihre Qualität hängt vom Modell ab. Am Testtag 2026-10-08 stimmten die regelbasierten Checks exakt mit dem Seed-Testset aus 18 Issues überein (18/18 Issues, 31/31 erwartete Lücken, keine zusätzlichen Befunde). Mit KI wurden alle 45 prüfbaren erwarteten Lücken gefunden, keines der 5 Kontroll-Issues wurde markiert, und es gab 15 zusätzliche Befunde bei schwachen Issues. Für eine weitere erwartete Epic-Lücke gibt es noch kein Kriterium (Success Measure; siehe Geplante Kriterien). Die Prompts wurden an denselben Issues abgestimmt; ein unabhängiges Testset steht aus.
- **KI-Begründungen können vom Kriterium abweichen:** Zum Beispiel kann eine fehlende Aussage als „kein Risiko“ gelesen werden (`technical-feasibility` bestand für #9, weil „no external dependencies or risks are mentioned“), oder ein fehlendes Label kann als Prozessproblem gewertet werden (`rollback-risk` bei #19).
- **Begründungstexte werden nicht ausgewertet:** Die Auswertung prüft, welche Kriterien scheitern, nicht, ob die angezeigte Begründung stimmt (siehe `technical-scope` und `impact-analysis` oben).
- **Kein Ausfallstatus:** Fällt das Modell aus, wird das Issue fail-closed als 🔴 geführt. Ein eigener Status `incomplete` ist geplant.
- **Report-Zusammenfassung:** Sie nennt die wichtigsten Lücken, ist aber keine vollständige Liste. Maßgeblich ist die Kriterienliste im Report.

---

## Geplante Kriterien

Diese Kriterien sind in `references/criteria/*.json` mit `implemented: false` beschrieben, aber noch nicht implementiert. Sie tragen keine Punkte und beeinflussen das Ready Gate nicht.

| Typ | Kriterien |
| --- | --- |
| Story | `independence` (Überschneidung mit anderen Stories per Ähnlichkeitssuche) |
| Task | `task-context`, `task-dependencies` |
| Bug | `bug-impact` |
| Epic | `epic-success-measure`, `epic-slicing`, `epic-company-goal`, `epic-milestones`, `epic-timeline`, `epic-risks`, `epic-dependencies`, `epic-child-story-status` |

Weitere geplante Regeln aus den JSON-Dateien:

- **Dreiwertiges Ergebnis** (`plannedResultValues`: `pass`, `flag`, `not-assessable`) statt `pass / fail`.
- **Belegpflicht** (`plannedRequireEvidence`): Die KI zitiert die Textstelle, auf der ihre Bewertung beruht.
- **Status `incomplete`** (`plannedAssessmentIncomplete`, Epic), wenn Ollama nicht erreichbar ist oder KI-Checks fehlschlagen; ein solcher Lauf muss wiederholt werden.
