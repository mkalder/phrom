# ADR-006: Wechsel des KI-Backends von lokalem Ollama zu einem selbst betriebenen LiteLLM-Endpoint

- **Status:** Angenommen (ändert die Entscheidung "Local AI through Ollama" aus ADR-003)
- **Datum:** 2026-11-08
- **Entscheider:** Marius Kalder (Product Owner / Autor von Phrom)
- **Geltungsbereich:** Ersetzen des direkten Ollama-Clients durch einen OpenAI-kompatiblen Client gegen einen selbst betriebenen LiteLLM-Endpoint

## Kontext

ADR-003 entschied, dass alle KI-Aufrufe direkt über das npm-Paket `ollama` an einen lokal laufenden Ollama-Server gehen, konkret damit Backlog-Inhalte den lokalen Rechner nicht verlassen und Phrom nicht von einem Cloud-LLM-Anbieter abhängt.

Der Autor leitet den Modellzugriff nun über eine selbst betriebene LiteLLM-Instanz unter einer eigenen Subdomain, `phorm.prodowner.de`, statt Ollamas native API direkt anzusprechen. LiteLLM exponiert eine OpenAI-kompatible Schnittstelle (`/v1/chat/completions`, `/v1/models`) vor einem oder mehreren Backend-Modellen, adressiert über einen zentral gepflegten Endpoint und eine zentrale Konfiguration statt einer pro Projekt eingestellten Ollama-Host-Variable. Dieses ADR hält die daraus resultierende Implementierungsänderung fest und, vor allem, ihre Auswirkung auf die von ADR-003 getroffene Privacy-Aussage.

## Entscheidungstreiber

- **Protokollwechsel ist unvermeidbar:** Der LiteLLM-Proxy spricht das OpenAI-Chat-Completions-Format, nicht Ollamas natives Wire-Format (`/api/chat`, `/api/generate`). Das npm-Paket `ollama` kann nicht einfach darauf umgebogen werden – der Client muss ersetzt, nicht umkonfiguriert werden.
- **Minimale neue Abhängigkeitsfläche:** Der Treiber "kein Framework, keine zusätzliche Infrastruktur" aus ADR-003 gilt weiterhin. Die tatsächlich benötigte Fläche – ein JSON-Endpoint, optionales SSE-Streaming – ist klein genug für Node's eingebautes `fetch`.
- **Ehrlichkeit der Privacy-Aussage:** `phorm.prodowner.de` ist vom Autor selbst betriebene Infrastruktur, aber bleibt ein entfernter Host, der über das Netzwerk erreicht wird, egal wo Phrom läuft. Das ist eine inhaltlich andere, schwächere Aussage als "bleibt auf der Maschine", und die Dokumentation muss das präzise so sagen, statt die alte Formulierung zu behalten.
- **Umgang mit Secrets:** Das Repository ist öffentlich auf GitHub. `LITELLM_API_KEY` darf ausschließlich in der per `.gitignore` ausgeschlossenen `.env` liegen, nie in `.env.example` oder committetem Code – dieselbe Konvention, die bereits für `GITHUB_TOKEN` gilt.

## Betrachtete Optionen

**Option A: Ollama als einziges Backend behalten.** Nachteil: erfüllt nicht die Entscheidung des Autors, den Modellzugriff über einen selbst betriebenen LiteLLM-Endpoint zu leiten.

**Option B: Das npm-Paket `openai` hinzufügen und dessen Client gegen den OpenAI-kompatiblen LiteLLM-Endpoint verwenden.** Vorteile: ein gut getesteter Client, der Retries, Typisierung und Streaming-Sonderfälle bereits abdeckt. Nachteile: eine neue Abhängigkeit, die das Projekt sonst nicht braucht; die hier tatsächlich benötigte Fläche (Chat Completions, JSON-Schema-Structured-Output, SSE-Streaming) ist schmal genug, dass `fetch` sie direkt abdeckt – dieselbe Begründung, die zuvor schon Node's eingebauten Test-Runner gegenüber Jest oder Vitest bevorzugt hat.

**Option C: Einen minimalen OpenAI-kompatiblen Client mit Node's eingebautem `fetch` implementieren, keine neue Abhängigkeit.** Vorteile: keine neue Abhängigkeit; passt zum bisherigen Stil des Projekts. Nachteile: Phrom besitzt nun ein wenig HTTP-/SSE-Parsing-Code, den sonst eine Client-Bibliothek liefern würde, und dieser muss gezielt getestet werden, statt sich auf ein gepflegtes Paket zu verlassen.

## Entscheidung

Ich wähle **Option C: ein minimaler, fetch-basierter Client, `src/llm-client.js`, ersetzt `src/ollama-client.js`.**

- **Neue Umgebungsvariablen:** `LITELLM_HOST` (Basis-URL, z. B. `https://phorm.prodowner.de`, kein Default – muss gesetzt sein), `LITELLM_API_KEY` (Bearer-Token, Secret, nur in `.env`, nie in `.env.example`), `MODEL_NAME` (Name unverändert; jetzt die Modell-Kennung, wie sie auf LiteLLM-Seite konfiguriert ist, nicht zwingend ein Ollama-Tag). `OLLAMA_HOST` und `OLLAMA_KEEP_ALIVE` entfallen.
- **Ein Endpoint für alles:** Sowohl die strukturierten Pass/Fail-/Size-Checks in `model.js` als auch die Draft-Generierung in `model-improve.js` laufen jetzt über eine einzige Funktion `chatCompletion({ messages, format, options })`, die `POST {LITELLM_HOST}/v1/chat/completions` aufruft. Das löst den Ollama-spezifischen Split zwischen `chat` (Messages) und `generate` (roher Prompt) auf – die OpenAI-kompatible API kennt diesen Split nicht, und der Prompt aus `model-improve.js` geht jetzt als einzelne User-Message durch, genau wie jeder andere Check bereits zuvor.
- **Structured Output:** Ollamas `format: <json-schema>` wird für die Pass/Fail- und Size-Checks in `model.js` zu `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`. Der lockerere Modus `format: 'json'` aus `model-improve.js` wird zu `response_format: { type: "json_object" }`. Reine Textgenerierung sendet gar kein `response_format`.
- **Entfallene Per-Request-Optionen ohne OpenAI-API-Äquivalent:** `top_k` (nicht Teil der OpenAI-Chat-Completions-Spezifikation) und Ollamas `keep_alive` (eine Server-seitige Einstellung; das Entladeverhalten des Modells ist jetzt eine Konfigurationsfrage von LiteLLM bzw. des Backends, nichts, was Phrom pro Request setzen kann). `temperature` und `seed` bleiben überall erhalten, wo sie verwendet wurden – beide sind Teil des OpenAI-kompatiblen Schemas.
- **`isCloudModel()` entfällt.** Die Funktion prüfte Ollamas eigene Cloud-Modell-Namenskonvention (Suffix `:cloud` / `-cloud`), die ohne Ollama als Backend keine Bedeutung mehr hat. `describeAiEndpoint()` wird auf ein rein hostname-basiertes Lokal/Remote-Signal vereinfacht: `isLocal` ist nur dann wahr, wenn der konfigurierte Host auf diese Maschine aufgelöst wird.
- **`package.json`:** Die Abhängigkeit `ollama` wird entfernt.
- **Der Preflight-Check in `scripts/demo.js`** ruft jetzt `GET {LITELLM_HOST}/v1/models` (den OpenAI-kompatiblen Modell-Listen-Endpoint) auf statt Ollamas `/api/tags`, und beschriftet einen nicht-lokalen Endpoint generisch, statt ein Ollama-Cloud-Modell von jedem anderen entfernten Host zu unterscheiden – diese Unterscheidung gilt nicht mehr.

## Konsequenzen

### Positiv

- Ein einheitlicher Client für jeden KI-Aufruf (Checks und Draft-Generierung), der einen Split auflöst, der nur wegen Ollamas eigener API-Form existierte.
- Keine neue Abhängigkeit: `fetch` ist ab Node ≥18 eingebaut, und das Projekt verlangt bereits Node ≥22.
- Modell-Routing und ein eventuelles künftiges Provider-Failover sind jetzt zentral in der eigenen LiteLLM-Konfiguration des Autors gebündelt, statt pro Projekt, das sie nutzt, doppelt zu existieren.

### Negativ / Risiken

- **Die Privacy-Aussage ändert sich, und das ist die wichtigste Konsequenz dieses ADR.** ADR-003 sowie die README-/RULES-Dokumentation sagten, Backlog-Inhalte "bleiben auf dem Rechner", wenn der Host lokal ist. `phorm.prodowner.de` ist ein entfernter Host, der über das Netzwerk erreicht wird, auch wenn der Autor ihn selbst betreibt; `describeAiEndpoint().isLocal` ergibt für dieses Setup korrekt `false`, und Demo/Report hören auf, das "lokale KI" zu nennen. README.md/.de.md und docs/RULES.en.md/.de.md werden so angepasst, dass sie präzise sagen, was jetzt zutrifft und was nicht: Inhalte verlassen den Rechner, auf dem Phrom läuft, und erreichen Infrastruktur, die der Autor kontrolliert – eine inhaltlich andere und schwächere Aussage als "bleibt auf dem Rechner". Niemand sollte beim Lesen "selbst betrieben" mit "lokal" verwechseln.
- **Wer das öffentliche Repository klont, verliert den bisherigen Zero-Setup-Lokalpfad.** Phrom gegen ein lokales Ollama laufen zu lassen funktionierte bisher durch Installation von Ollama und Setzen von `OLLAMA_HOST`. Jetzt braucht ein Klon irgendeinen erreichbaren OpenAI-kompatiblen Endpoint – am einfachsten eine eigene LiteLLM-Instanz, die wiederum auf das eigene lokale Ollama zeigen kann, wenn dieselbe "bleibt auf meinem Rechner"-Eigenschaft gewünscht ist, die dieses Projekt für das eigene Deployment des Autors nun nicht mehr behauptet.
- **Verlust von `top_k` als Stellschraube:** `top_k: 1` war Teil davon, wie das bisherige Setup die Sampling-Varianz für die deterministisch wirkenden Checks minimierte. Ob `temperature: 0` und `seed` allein eine vergleichbare Determinismus über LiteLLM und das jeweils angesteuerte Modell erreichen, ist nicht gemessen.
- **Ob `response_format` mit `strict: true` durchgängig** (LiteLLM → konfiguriertes Backend-Modell) eingehalten wird, ist durch diese Änderung allein nicht verifiziert. Ein Backend, das `strict` ignoriert, könnte fehlerhaftes JSON liefern, an dem der bestehende Aufruf `JSON.parse(content)` scheitert – das würde als geworfener Fehler sichtbar, nicht als klares Konfigurationsproblem.
- **Diese Änderung konnte aus der Umgebung, die sie vorgenommen hat, nicht gegen ein echtes Modell verifiziert werden.** Die isolierte Session, die diese Änderung umgesetzt hat, hat keinen Netzwerkpfad zu `phorm.prodowner.de`; `chatCompletion()` und das SSE-Parsing wurden deshalb gegen einen lokalen Mock-HTTP-Server verifiziert, der eine OpenAI-kompatible Streaming-Antwort simuliert (Klartext, `json_object`- und `json_schema`-Modus, sowie der Fehlerpfad für eine Nicht-200-Antwort und für ein fehlendes `LITELLM_HOST`), nicht gegen den echten Endpoint. `npm test` (76/76) und `node scripts/eval-seed.js` (18/18, Exit 0) bestehen, aber keiner von beiden prüft den Netzwerkpfad. Ein Live-Lauf ist weiterhin erforderlich (siehe Validierung).

## Validierung

Die Entscheidung gilt als validiert, wenn:

- `npm test` mit dem neuen Client besteht (bestätigt; die Unit-Tests selbst brauchen kein Netzwerk),
- ein Live-Lauf von `phrom run` oder `phrom select` gegen den konfigurierten LiteLLM-Endpoint für jeden KI-Check valides, schemakonformes JSON liefert, ohne manuelle JSON-Reparatur,
- `node scripts/eval-seed.js --ai` gegen das Seed-Set Ergebnisse liefert, die mit dem vorherigen Ollama-basierten Lauf vergleichbar sind (gleiches Pass/Fail-Muster, übliche Modell-Beurteilungsvarianz zugelassen),
- der Preflight-Check in `scripts/demo.js` den LiteLLM-Endpoint korrekt meldet und den Lauf als nicht lokal beschriftet, da der Host entfernt ist.

## Offene Fragen

- Ob für das bzw. die konkret hinter `phorm.prodowner.de` konfigurierten Backend-Modelle ein `top_k`-Äquivalent verfügbar ist und ob es sich lohnt, es als optionalen, Backend-spezifischen Parameter wieder zu ergänzen.
- Ob Phrom später wieder einen reinen Lokal-Ollama-Pfad unterstützen soll (zum Beispiel über einen Schalter `LLM_BACKEND=ollama|litellm`), für alle, die das öffentliche Repository klonen, ohne Zugriff auf die eigene LiteLLM-Instanz des Autors zu haben. Dieses ADR ergänzt das nicht: Es widerspricht dem Treiber "minimale Komplexität", und niemand hat danach gefragt.
- Ob strikter JSON-Schema-Structured-Output von dem bzw. den hinter `phorm.prodowner.de` konfigurierten Modellen zuverlässig eingehalten wird, bleibt empirisch zu bestätigen, gegen einen Live-Lauf.
