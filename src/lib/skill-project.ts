/** Read project declarations only. This selects guidance; it does not resolve,
 * install, import or execute any project dependency. */
export function projectSkillFrameworks(files: Record<string, string>): string[] {
  for (const [rawPath, body] of Object.entries(files)) {
    const path = rawPath.replaceAll('\\', '/');
    if (/(?:^|\/)(?:\.anvil|plugins|node_modules|\.git|\.output|dist|build|coverage|artifacts|runs|ref)(?:\/|$)/i.test(path)) continue;
    if (/(?:^|\/)package\.json$/i.test(path)) {
      try {
        const manifest = JSON.parse(body);
        if (['dependencies', 'devDependencies', 'peerDependencies'].some(key => {
          const dependencies = manifest?.[key];
          return dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies) && typeof dependencies.react === 'string';
        })) return ['react'];
      } catch { /* An invalid manifest is not proof of a framework. */ }
    }
  }
  return [];
}
