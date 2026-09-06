import { Button } from "@/components/ui/button";

import { LEARN_DEFAULTS, useLearn, type LearnPrefs } from "@/lib/learn";

import { Head, Vis, Row, Seg, Toggle } from "./fields";

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
    <section>
      <Head>Gedächtnis</Head>
      <p className="mb-2 text-xs text-muted">
        {facts.length} Fakten · {skills.length} Skills · {negs.length} Verbote · {events.length} Log
      </p>
      <Vis q={q} label="Lernen merken an aus">
        <Row label="Lernen" hint="Aus: nichts Neues merken, nichts an den Agenten geben.">
          <Toggle on={on} onChange={(v) => useLearn.getState().setOn(v)} />
        </Row>
      </Vis>
      <Head>An das Modell</Head>
      <Vis q={q} label="Kontext Prompt injizieren Agent">
        <Row label="In den Prompt" hint="Gelerntes vor jeder Agent-Runde. Aus = merken ohne zu teilen.">
          <Toggle on={p.inject} onChange={(v) => setPref("inject", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Person Fakten Stil immer lieber">
        <Row label="Person" hint="Stil, Sprache, „immer/lieber“.">
          <Toggle on={p.person} onChange={(v) => setPref("person", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Projekt Fakten pytest stack">
        <Row label="Projekt" hint="Nur dieses Repo (pytest, Stack, Ordner).">
          <Toggle on={p.project} onChange={(v) => setPref("project", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Profil Statistik Run Debug">
        <Row label="Nutzungsprofil" hint="Run/Debug/Diff-Zahlen. Kurz, keine Inhalte.">
          <Toggle on={p.profile} onChange={(v) => setPref("profile", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Negatives verworfene Diffs nicht so">
        <Row label="Verbote" hint="Abgelehnte Diffs und „nicht so“.">
          <Toggle on={p.negatives} onChange={(v) => setPref("negatives", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Skills Liste Prompt">
        <Row label="Skills nennen" hint="Namen und Wann, damit der Agent skill_run nutzt.">
          <Toggle on={p.skills} onChange={(v) => setPref("skills", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Skill Body Anweisung Tokens">
        <Row label="Skill-Text" hint="Voller Text der passenden Skills. Kostet Context.">
          <Toggle on={p.skillBodies} onChange={(v) => setPref("skillBodies", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Fakten Limit Anzahl">
        <Row label="Fakten im Prompt">
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
      <Vis q={q} label="Skills Limit Anzahl">
        <Row label="Skills im Prompt">
          <Seg
            value={String(p.skillLimit)}
            onChange={(v) => setPref("skillLimit", Number(v))}
            options={[
              { id: "2", label: "2" },
              { id: "5", label: "5" },
              { id: "8", label: "8" },
            ]}
          />
        </Row>
      </Vis>
      <Head>Automatik</Head>
      <Vis q={q} label="Destillieren Fakten aus Nutzung">
        <Row label="Destillieren" hint="Aus Runs, Diffs, „immer…“ Fakten schreiben.">
          <Toggle on={p.distill} onChange={(v) => setPref("distill", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="IDE anpassen Live-Run Auto-Diffs">
        <Row label="IDE anpassen" hint="Nur Hinweis, keine stillen Änderungen an Auto-Diffs / Live-Run.">
          <Toggle on={p.adaptIde} onChange={(v) => setPref("adaptIde", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Plugin Skills Datei schreiben">
        <Row label="Skills als Plugin" hint="Neue Plugin-Skills nach plugins/skills/.">
          <Toggle on={p.pluginSkills} onChange={(v) => setPref("pluginSkills", v)} />
        </Row>
      </Vis>
      <Head>Aufräumen</Head>
      <Vis q={q} label="Löschen Log Fakten Skills zurücksetzen">
        <div className="flex flex-wrap gap-2 py-3">
          <Button className="h-8" onClick={() => useLearn.getState().clearLog()}>
            Nur Log
          </Button>
          <Button className="h-8" onClick={() => useLearn.getState().clear()}>
            Alles löschen
          </Button>
          <Button className="h-8" onClick={() => useLearn.getState().resetPrefs()}>
            Standard
          </Button>
        </div>
      </Vis>
    </section>
  );
}
