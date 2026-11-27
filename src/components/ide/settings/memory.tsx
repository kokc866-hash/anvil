import { Button } from "@/components/ui/button";

import { LEARN_DEFAULTS, openSkillLibrary, useLearn, type LearnPrefs } from "@/lib/learn";
import { useIde } from "@/store/ide";

import { SettingsSection, Head, Vis, Row, Seg, Toggle } from "./fields";

export function LearnSection({ q }: { q: string }) {
  const on = useLearn((s) => s.on);
  const raw = useLearn((s) => s.prefs);
  const p: LearnPrefs = { ...LEARN_DEFAULTS, ...(raw ?? {}) };
  const setPref = useLearn((s) => s.setPref);
  const facts = useLearn((s) => s.facts);
  const skills = useLearn((s) => s.skills);
  const events = useLearn((s) => s.events);
  const negs = useLearn((s) => s.negs);

  return (
    <SettingsSection q={q}>
      <Head>Gedächtnis</Head>
      <p className="mb-2 text-xs text-muted">
        {facts.length} Fakten · {skills.length} Skills · {negs.length} Einschränkungen · {events.length} Protokolleinträge
      </p>
      <Vis q={q} label="Lernen merken an aus">
        <Row label="Gedächtnis verwenden" hint="Wenn ausgeschaltet, speichert Anvil keine neuen Erinnerungen und gibt keine persönlichen oder projektbezogenen Gedächtnisinhalte an den Agenten weiter. Skills bleiben unabhängig davon einstellbar.">
          <Toggle on={on} onChange={(v) => useLearn.getState().setOn(v)} />
        </Row>
      </Vis>
      <Head>Wissen für Modellanfragen</Head>
      <Vis q={q} label="Kontext Prompt injizieren Agent">
        <Row label="Wissen an das Modell senden" hint="Ergänzt jede Modellanfrage um passendes Wissen. Wenn ausgeschaltet, bleibt das Wissen gespeichert, wird aber nicht an das Modell gesendet.">
          <Toggle on={p.inject} onChange={(v) => setPref("inject", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Person Fakten Stil immer lieber">
        <Row label="Persönliche Vorlieben" hint="Berücksichtigt deine bevorzugte Sprache, deinen Schreibstil und weitere persönliche Vorgaben.">
          <Toggle on={p.person} onChange={(v) => setPref("person", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Projekt Fakten pytest stack">
        <Row label="Projektwissen" hint="Berücksichtigt Wissen über dieses Projekt, etwa Tests, verwendete Technologien und Ordner.">
          <Toggle on={p.project} onChange={(v) => setPref("project", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Profil Statistik Run Debug">
        <Row label="Nutzungsprofil" hint="Berücksichtigt zusammengefasste Nutzungszahlen zu Ausführungen, Fehlersuche und Änderungen. Datei- und Chatinhalte sind darin nicht enthalten.">
          <Toggle on={p.profile} onChange={(v) => setPref("profile", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Negatives verworfene Diffs nicht so">
        <Row label="Einschränkungen" hint="Berücksichtigt abgelehnte Änderungen und deine Hinweise dazu, was der Agent vermeiden soll.">
          <Toggle on={p.negatives} onChange={(v) => setPref("negatives", v)} />
        </Row>
      </Vis>
      <Head>Skills · unabhängig vom Gedächtnis</Head>
      <Vis q={q} label="Skills Liste Prompt">
        <Row label="Skills verwenden" hint="Stellt dem Agenten Anvil-Skills und freigegebene Projekt-Skills zur Verfügung. Die Bibliothek findest du unter Erweiterungen → Skills.">
          <Toggle on={p.skills} onChange={(v) => setPref("skills", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Skills automatisch auswählen">
        <Row label="Passende Skills automatisch auswählen" hint="Wählt automatisch bis zu zwei passende Anleitungen vor. Ausdrücklich genannte und angeheftete Skills werden zusätzlich berücksichtigt und funktionieren auch ohne Automatik.">
          <Toggle on={p.skillAuto} onChange={(v) => setPref("skillAuto", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Skill Body Anweisung Tokens">
        <Row label="Skill-Anleitungen bei Bedarf laden" hint="Der Agent kann die Anleitung eines ausgewählten Skills und einzelne Referenzen lesen. Die vollständige Bibliothek wird nicht bei jeder Anfrage mitgesendet.">
          <Toggle on={p.skillBodies} onChange={(v) => setPref("skillBodies", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Fakten Limit Anzahl">
        <Row label="Fakten pro Anfrage">
          <Seg
            value={String(p.factLimit)}
            onChange={(v) => setPref("factLimit", Number(v))}
            options={[
              { id: "8", label: "8" },
              { id: "12", label: "12" },
              { id: "16", label: "16" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Skills Bibliothek verwalten importieren">
        <Button variant="quiet" onClick={() => { useIde.getState().setSettingsOpen(false); openSkillLibrary(); }}>Skill-Bibliothek öffnen</Button>
      </Vis>
      <Head>Automatik</Head>
      <Vis q={q} label="Destillieren Fakten aus Nutzung">
        <Row label="Wissen automatisch ableiten" hint="Leitet aus Ausführungen, Änderungen und wiederkehrenden Vorgaben neues Wissen ab.">
          <Toggle on={p.distill} onChange={(v) => setPref("distill", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="IDE anpassen Live-Run Auto-Diffs">
        <Row label="Einstellungen vorschlagen" hint="Schlägt passende Einstellungen vor. Automatische Änderungsübernahme und Ausführung werden nicht ohne dein Zutun umgestellt.">
          <Toggle on={p.adaptIde} onChange={(v) => setPref("adaptIde", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Plugin Skills Datei schreiben">
        <Row label="Skills als Plugin speichern" hint="Speichert neue Skills als Plugin-Dateien unter plugins/skills/.">
          <Toggle on={p.pluginSkills} onChange={(v) => setPref("pluginSkills", v)} />
        </Row>
      </Vis>
      <Head>Aufräumen</Head>
      <Vis q={q} label="Löschen Log Fakten Skills zurücksetzen">
        <div className="flex flex-wrap gap-2 py-3">
          <Button className="h-8" onClick={() => useLearn.getState().clearLog()}>
            Protokoll leeren
          </Button>
          <Button className="h-8" onClick={() => useLearn.getState().clearMemories()}>
            Gespeicherte Erinnerungen löschen
          </Button>
          <Button className="h-8" onClick={() => useLearn.getState().resetPrefs()}>
            Einstellungen zurücksetzen
          </Button>
        </div>
      </Vis>
    </SettingsSection>
  );
}
