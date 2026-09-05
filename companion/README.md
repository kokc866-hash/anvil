# Companion — außerhalb von Anvil

Anvil **1.3.1**. Electron startet Companion **selbst bei Run** und beendet ihn, wenn das Run-Fenster zu ist (oder lässt ihn, wenn **Anlassen** an ist).  
`companion\start.bat` nur, wenn Anvil **im Browser** läuft oder du Companion dauerhaft willst.

Kein Internet. Ein kleines Node-Programm **auf diesem PC**. Standard: `127.0.0.1:7845`. Anderer Port: `ANVIL_COMPANION_PORT`. LAN-Bind (selten): `ANVIL_COMPANION_HOST=0.0.0.0` — Token bleibt Pflicht, Pair nur localhost.

## Voraussetzung

- [Node.js](https://nodejs.org) (LTS)
- Im Anvil-Ordner (dort wo `package.json` liegt)

## Start (Windows)

Doppelklick:

```
companion\start.bat
```

Oder PowerShell, **als Administrator nicht nötig**:

```powershell
cd I:\AnvilTest\anvil
node companion\server.mjs
```

Fenster **offen lassen**. Zeile muss in etwa stehen:

```
Anvil companion http://127.0.0.1:7845
```

`127.0.0.1` = dieser Rechner, nicht das Web.

Stoppen: im Fenster `Strg+C`, oder `companion\stop.bat`.

## Token

Beim ersten Start schreibt Companion eine Datei:

```
C:\Users\<du>\.anvil-companion-token
```

Inhalt kopieren. In Anvil: Einstellungen → Companion → Token einfügen → **Prüfen**.

Oder im Browser **nur auf diesem PC**:

```
http://127.0.0.1:7845/v1/pair
```

Dann in Anvil **Koppeln**.

## Compiler (optional)

Im gleichen PATH wie das Companion-Fenster, sonst sieht er sie nicht:

| Sprache | Programm |
|---|---|
| Go | `go` |
| Rust | `rustc` / `cargo` |
| Java | `javac` + `java` |
| C/C++ | `gcc` / `g++` |
| PHP / Ruby | `php` / `ruby` |
| C# | `dotnet` |

Ohne diese Programme: Anvil Run nimmt den Netz-Compiler.

## Linux / Mac

```bash
cd /pfad/zu/anvil
node companion/server.mjs
```

Token: `~/.anvil-companion-token`
