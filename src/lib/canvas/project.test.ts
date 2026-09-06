import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { prepareHtmlProject, projectHtmlEntry, transpileScript } from "./project.ts";

test("script entry selection resolves paths and ignores coincidental filename text", () => {
  const files = {
    "other/index.html": '<script src="main.ts" type="module"></script><p>game.js</p>',
    "game/index.html": '<script src="./game.js" defer></script>',
    "index.html": '<script src="./src/main.ts" type="module"></script>',
  };
  assert.equal(projectHtmlEntry("game/game.js", files), "game/index.html");
  assert.equal(projectHtmlEntry("src/main.ts", files, true), "index.html");
  assert.equal(projectHtmlEntry("orphan.js", files), undefined);
});

test("inline TypeScript and CSS images are compiled into executable project resources", async () => {
  const html = await prepareHtmlProject(
    '<html><head><script type="text/typescript">enum Answer { Yes=42 }; window.answer=Answer.Yes;</script><link rel="stylesheet" href="css/game.css"></head></html>',
    {
      "css/game.css": 'body{background-image:url("../images/grid.svg")}',
      "images/grid.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    },
    "index.html",
  );
  assert.match(html, /type="text\/javascript"/);
  const code = decodeURIComponent(
    html.match(
      /<script type="text\/javascript" src="data:text\/javascript;charset=utf-8,([^"]+)"/,
    )![1],
  );
  const window: Record<string, unknown> = {};
  vm.runInNewContext(code, { window });
  assert.equal(window.answer, 42);
  const css = decodeURIComponent(html.match(/href="data:text\/css;charset=utf-8,([^"]+)"/)![1]);
  assert.match(css, /url\("data:image\/svg\+xml/);
});

test("TypeScript compiler preserves object literals, interfaces, generics and enums", async () => {
  const code = await transpileScript(
    'interface Item {name:string}; enum Kind {First}; const identity = <T,>(x:T):T => x; globalThis.result = identity({name:"ok",kind:Kind.First});',
    "main.ts",
  );
  const context: Record<string, unknown> = {};
  vm.runInNewContext(code, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), { name: "ok", kind: 0 });
});
test("local classic scripts retain defer/async and media attributes; source secrets never enter the frame", async () => {
  const html = await prepareHtmlProject(
    '<html><head><script src="game.js" defer></script><link rel="stylesheet" media="print" href="style.css"></head></html>',
    {
      "game.js": "window.game = 1;",
      "style.css": "body {color:red}",
      ".env": "NEVER_EMBED_THIS",
      "token.txt": "ALSO_PRIVATE",
    },
    "index.html",
  );
  assert.match(html, /<script[^>]+defer=""/);
  assert.match(html, /src="data:text\/javascript/);
  assert.match(html, /media="print"/);
  assert.doesNotMatch(html, /NEVER_EMBED_THIS|ALSO_PRIVATE/);
});
test("module graph handles relative TypeScript imports and cycles without duplicating modules", async () => {
  const html = await prepareHtmlProject(
    '<script type="module" src="src/a.ts"></script>',
    {
      "src/a.ts": 'import {b} from "./b.ts"; export const a = () => b;',
      "src/b.ts": 'import {a} from "./a.ts"; export const b = () => a;',
    },
    "index.html",
  );
  const imports = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)![1]).imports;
  assert.equal(Object.keys(imports).length, 2);
  assert.match(
    decodeURIComponent(imports["https://anvil-project.invalid/src/a.ts"]),
    /from "https:\/\/anvil-project.invalid\/src\/b.ts"/,
  );
});
test("missing local imports and incompatible CSP produce actionable errors", async () => {
  await assert.rejects(
    prepareHtmlProject(
      '<script type="module" src="main.js"></script>',
      { "main.js": 'import "./missing.js";' },
      "index.html",
    ),
    /Modul nicht gefunden/,
  );
  await assert.rejects(
    prepareHtmlProject(
      '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><canvas></canvas>',
      {},
      "index.html",
    ),
    /Content-Security-Policy/,
  );
});
test("inline JavaScript HTML strings are never rewritten as document tags", async () => {
  const source = "<script>window.template = '<img src=\"image.svg\">';</script>";
  const html = await prepareHtmlProject(source, { "image.svg": "<svg></svg>" }, "index.html");
  assert.ok(html.includes(source));
});
