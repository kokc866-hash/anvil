import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectSkillFrameworks } from './skill-project.ts';

test('React guidance uses actual dependency declarations, including nested projects', () => {
  const cases: Record<string, string>[] = [
    { 'package.json': '{"dependencies":{"react":"^19"}}' },
    { 'web/package.json': '{"devDependencies":{"react":"19"}}' },
    { 'packages/widgets/package.json': '{"peerDependencies":{"react":"*"}}' },
  ];
  for (const files of cases) assert.deepEqual(projectSkillFrameworks(files), ['react']);
});

test('names, comments in documentation, generated copies and malformed manifests do not select React', () => {
  const cases: Record<string, string>[] = [
    { 'README.md': "Use React. import { useState } from 'react';" },
    { 'react-notes.txt': 'react' },
    { 'package.json': '{"description":"react project","dependencies":{"preact":"*"}}' },
    { 'package.json': '{"dependencies":{"react":false}}' },
    { 'package.json': '{"devDependencies":{"@types/react":"*"}}' },
    { 'package.json': '{broken json react' },
    { 'node_modules/widget/package.json': '{"dependencies":{"react":"*"}}' },
    { 'ref/example.tsx': "import React from 'react';" },
    { '.anvil/skills/example/assets/app.tsx': "import React from 'react';" },
    { 'plugins/example/app.jsx': "import React from 'react';" },
    { 'dist/assets/app.js': "import React from 'react';" },
    { 'src/view.tsx': "import { h } from 'preact';" },
    { 'src/notes.ts': '// Old example: import React from "react";' },
    { 'src/notes.ts': "const example = \"import React from 'react';\";" },
    { 'app.tsx': 'import { useState } from "react"; export const App = () => null;' },
  ];
  for (const files of cases) assert.deepEqual(projectSkillFrameworks(files), []);
});
