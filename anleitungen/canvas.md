# Canvas und HTML-Ausgabe

Anvil stellt in der HTML-Ausgabe die globale API `Anvil` bereit. Vorschau, Ausgabefenster und Agent verwenden denselben Projekt-Lader. Der Agent steuert die geöffnete Ausgabe; es gibt keine versteckte zweite Programmkopie.

## Starten und bedienen

- **Ausführen** startet das Dokument vollständig neu, auch bei unverändertem Code.
- **Pause / Weiter** hält die Simulation einer Anvil-Canvas-Instanz an bzw. setzt sie fort.
- **Stop** beendet das gesamte Ausgabedokument einschließlich eigener JavaScript-Schleifen.
- Schließen entfernt die Ausgabe und ihre Ressourcen.
- Der Status zeigt Laden, Bereit, Läuft, Pausiert, Gestoppt oder Fehler. Ein vorbereiteter HTML-Text allein gilt noch nicht als erfolgreicher Run.
- Bei einem Start- oder Laufzeitfehler erscheint die konkrete Meldung in der Ausgabe. Fehlerzustände werden auch an den Agenten zurückgemeldet.

Ein Wechsel zwischen angedockter Vorschau und eigenem Fenster erzeugt ein neues Dokument. Laufende JavaScript-Objekte werden nicht zwischen Fenstern übertragen; benötigten Spielstand vorher im projektbezogenen Speicher sichern.

## Minimales Beispiel

`index.html`:

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <script src="game.js" defer></script>
</head>
<body>
  <canvas id="game"></canvas>
</body>
</html>
```

`game.js`:

```js
let x = 40;
const game = Anvil.run({
  canvas: "game",
  width: 640,
  height: 360,
  fit: "contain",
  onInput() {
    if (this.input.start) this.pause(!this.paused);
  },
  update(dt) {
    const direction = Number(this.input.right) - Number(this.input.left);
    x = this.clamp(x + direction * 180 * dt, 0, this.width - 24);
  },
  draw() {
    this.clear("#101216");
    this.rect(x, 160, 24, 24, "#eeeeee");
    this.text("Pfeiltasten: bewegen · P: Pause", 16, 16, "#eeeeee", 18);
  }
});
```

Methodenschreibweise oder normale Funktionen verwenden, wenn der Callback über `this` auf die Engine zugreift. Pfeilfunktionen übernehmen kein solches `this`.

## Eingaben

`game.key.down(key)` fragt gehaltene Tasten ab. `pressed(key)` und `released(key)` gelten für einen Frame. Sowohl `event.key` (`"a"`, `" "`) als auch `event.code` (`"KeyA"`, `"Space"`) werden unterstützt.

`game.input.left/right/up/down` sind gehaltene Aktionen; `ok/fire/start` melden einen neuen Tastendruck. Sie verwenden dieselben Einstellungen wie die Agentensteuerung. Eingaben in Textfeldern bewegen das Spiel nicht. Bei mehreren Canvas-Instanzen erhält die fokussierte Instanz Tastatur und Gamepad; Mauszustände sind je Canvas getrennt.

`game.mouse` enthält Position, Weltposition, Bewegungsdelta, Rad und die aktuellen Maustasten. Abbruch eines Pointers oder Fokusverlust setzt gehaltene Eingaben zurück.

`Anvil.attach(canvas)` ergänzt Eingaben für eine bereits vorhandene eigene Animationsschleife. Der Handle aktualisiert Gamepads und setzt einmalige Eingaben automatisch am Frame-Ende zurück. Mit `handle.dispose()` wird er freigegeben. `update()` und `endFrame()` stehen auch für ausdrücklich manuell organisierte Schleifen zur Verfügung.

## Zeit und Lebenszyklus

- `Anvil.create(options)` erstellt eine Instanz; `game.start()` startet sie.
- `Anvil.run(options)` führt beides aus.
- `game.pause(true/false)` pausiert bzw. setzt die Simulation fort. `onInput()` bleibt für Menüs und Fortsetzen aktiv.
- `game.timeScale = 0` hält die Simulationszeit an; negative oder nicht endliche Werte sind ungültig.
- `game.stop()` beendet die Schleife und gibt Eingabe-Listener sowie Größenbeobachter frei. `start()` setzt diese Instanz wieder in Gang.
- `game.dispose()` gibt die Instanz vollständig frei. Ein von der Engine erzeugtes Canvas wird standardmäßig entfernt; `dispose(false)` behält das Element.
- `game.resize(width, height)` ändert die Zeichenfläche und erhält die konfigurierten Zeichenoptionen.
- Optional `fixedStep: 1 / 60` für feste Simulationsschritte; höchstens acht Schritte pro Zeichenframe verhindern unbegrenztes Nachholen.
- `game.fps` misst den echten Abstand zwischen Frames. `maxDelta` begrenzt unabhängig davon die Simulationszeit; Standard: 0,05 Sekunden.

Ein Fehler in `update`, `draw` oder `onInput` beendet die betroffene Schleife und wird sichtbar gemeldet. Ein neuer Run erzeugt einen frischen Zustand.

## Rendering und Bilder

Standard ist Canvas2D. `game.ctx` erlaubt direkten Zugriff auf den Zeichenkontext. Helfer: `clear`, `rect`, `round`, `stroke`, `circle`, `ring`, `line`, `poly`, `grid`, `text`, `measure`, `image`, `sprite`, `alpha`.

`world()` aktiviert die Kameratransformation; `hud()` stellt den vorherigen Zustand wieder her. Die Kamera besitzt `x`, `y`, `z` (Zoom) und `r` (Radiant). `toWorld(x,y)` rechnet Bildschirmkoordinaten um.

`pixel: true` verwendet ganze logische Pixel und deaktiviert Bildglättung. `smooth: false` deaktiviert nur die Glättung. `fit` unterstützt `contain`, `cover`, `fill` und `none`; Standard ist `contain` mit automatischer Größenanpassung. Änderungen der Bildschirm-Pixeldichte werden berücksichtigt.

Mit `gl: true` wird ausschließlich WebGL angefordert. Dann über `game.gl` zeichnen; die 2D-Zeichenhelfer stehen in diesem Modus nicht zur Verfügung. Ein schon als 2D verwendetes Canvas kann nicht nachträglich zu WebGL werden.

```js
const image = await Anvil.loadImage("assets/player.svg");
// Danach in draw(): this.image(image, 20, 20, 48, 48);
```

Bilder werden dekodiert und zwischengespeichert. Optional `{signal: abortController.signal}` zum Abbrechen übergeben. Externe Bildserver müssen CORS erlauben; Lade- und Aufnahmefehler werden gemeldet.

## Projektdateien

Lokale Skripte behalten `defer` und `async`. Module verwenden `type="module"`; relative JS-/TS-Imports werden aus den Projektdateien aufgelöst, auch bei zyklischen Imports. TypeScript wird mit dem Compiler übersetzt, nicht mit regulären Ausdrücken entfernt.

Lokale Stylesheets, CSS-Ressourcen, HTML-Bilder und `fetch("relative/datei.json")` verwenden den gemeinsamen Projektbestand. Binärdateien müssen als unterstützte Bild-/Datendatei im Projekt vorhanden sein. Bare Paketnamen wie `react` benötigen eine passende Import-Map oder externe Modul-URL. Die Vorschau führt kein `npm install` aus.

Eine eigene Content-Security-Policy bleibt erhalten. Blockiert sie die für die instrumentierte Vorschau nötigen Skripte, zeigt Anvil die Ursache an. Solche Seiten über ihren regulären Webserver starten; Anvil setzt die Richtlinie nicht still außer Kraft.

## Agent und Aufnahmen

`run_file` wartet auf das geladene Dokument, Schriften, Bilder und die Bereitschaft der Engine. Jede Sitzung, Anfrage und Codeversion hat eine eigene Kennung. Antworten alter oder geschlossener Sitzungen werden verworfen.

`play` bedient die geöffnete HTML-Ausgabe mit Tastatur, Maus und ausdrücklich angegebenem Text. Es steuert weder den Desktop noch ein Engine-Fenster. Im Hintergrund erfolgt die Eingabe über Chromium; die Browserausgabe verwendet synthetische DOM-Ereignisse. Browserfunktionen, die eine echte Nutzeraktivierung verlangen, bleiben im Browsermodus eingeschränkt.

`keys` sendet eine Folge von Tasten, zum Beispiel `{"keys":["Space","s","u","r","Delete"]}`. Auch Tab, Enter, Escape, Backspace, Home/End, PageUp/PageDown und Pfeiltasten sind verfügbar. Die Aktionen `left`, `right`, `up`, `down`, `ok`, `fire` und `start` verwenden die eingestellte Belegung. `Space` ist immer die Leertaste.

Für gezielte Bedienung verwendet der Agent `actions`. `run_file` und `see_run` liefern dafür die tatsächlichen CSS-Selektoren, Feldwerte und Elementpositionen. Ein Selektor muss genau ein sichtbares, bedienbares Ziel treffen. Koordinaten sind CSS-Pixel ab der linken oberen Ecke der Vorschau, keine Desktopkoordinaten.

```json
{"actions":[
  {"type":"click","selector":"#start"},
  {"type":"assert","selector":"#status","text":"Läuft","timeout_ms":1000},
  {"type":"key","selector":"#name","key":"a","modifiers":["Control"]},
  {"type":"type","selector":"#name","text":"Testauftrag"},
  {"type":"assert","selector":"#name","value":"Testauftrag"}
]}
```

Weitere Aktionen sind `move`, `drag` mit `to_selector` oder `to_x`/`to_y`, `scroll` mit `delta_x`/`delta_y` und `wait` mit `ms`. Positives `delta_y` scrollt nach unten. Klicks unterstützen links, rechts, Mitte und mit `count:2` den Doppelklick. Eine `assert`-Prüfung kann Text, Feldwert, Sichtbarkeit, Auswahlzustand (`checked`) oder Elementanzahl (`count`) vergleichen. Der Textvergleich ist exakt und entfernt nur äußere Leerzeichen.

Eine Folge umfasst höchstens 32 Aktionen, einzelne Halte- oder Wartezeiten höchstens 1000 ms, insgesamt höchstens 10 Sekunden ohne die begrenzten Erwartungsprüfungen. Der erste Fehler hält die Folge an; bereits ausgeführte Eingaben werden nicht wiederholt. Stop gibt gehaltene Tasten und Maustasten frei. Falsche Erwartungen bleiben fehlgeschlagene Tests. Die Zwischenablage des Rechners und Betriebssystem-Dateiauswahldialoge sind nicht Teil von `play`.

Der Agent muss den erwarteten Zustand tatsächlich prüfen. Eine zugestellte Taste, ein Klick oder eine Aufnahme bestätigt nicht automatisch die gesamte Anwendung. Für Programmlogik bleiben passende Testdateien und die vorhandenen Testbefehle erforderlich.

`see_run` nimmt die geöffnete Ausgabe auf. Die Desktop-Version erfasst den sichtbaren Bereich einschließlich HTML-Bedienelementen und mehrerer Canvas-Flächen. Im Browser wird die Oberfläche für eine Aufnahme gerastert; nicht freigegebene externe Ressourcen und Browserbeschränkungen werden als Aufnahmefehler gemeldet. Ein Aufnahmefehler ist von einem Programmfehler unterscheidbar.

## Speicher und Grenzen

Canvas-`localStorage` ist projektbezogen, übersteht Run-Neustarts und ist vom Anvil-Einstellungsspeicher getrennt. `sessionStorage` besitzt einen getrennten Speicher im jeweiligen Ausgabefenster. Pro Bereich stehen 256 KB zur Verfügung. Keine Zugangsdaten darin ablegen.

Zeichenflächen sind auf 32 Millionen Pixel begrenzt. Rasterabstände müssen positiv sein und dürfen höchstens 10.000 Linien erzeugen. Anvil ist eine kompakte Canvas-Laufzeit; externe Engines wie Godot und Unity werden weiterhin über ihre eigenen Werkzeuge gestartet.
