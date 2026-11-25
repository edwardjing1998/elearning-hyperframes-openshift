/** Trusted template metadata + bounded, filesystem-discovered Markdown documents. */
import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,199}$/;
const TYPES = new Set(['static', 'review', 'sequence', 'kafka']);

export function loadTemplateRegistry(compositionDir) {
  const filename = path.join(compositionDir, 'template-registry.json');
  const entries = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Invalid template registry');
  const registry = {};
  for (const [name, config] of Object.entries(entries)) {
    if (!ID.test(name) || !config || typeof config !== 'object' || !TYPES.has(config.type)) throw new Error(`Invalid template registry entry: ${name}`);
    const html = config.html;
    if (typeof html !== 'string' || !/^[a-zA-Z0-9_-]+\.html$/.test(html)) throw new Error(`Invalid HTML template filename: ${name}`);
    if (!fs.statSync(path.join(compositionDir, 'templates', html)).isFile()) throw new Error(`Template HTML missing: ${html}`);
    if (config.type !== 'static') {
      if (typeof config.documents !== 'string' || !FOLDER.test(config.documents) || config.documents.split('/').includes('..')) throw new Error(`Invalid document folder for ${name}`);
      if (typeof config.defaultDocument !== 'string' || !ID.test(config.defaultDocument)) throw new Error(`Invalid default document for ${name}`);
    }
    registry[name] = Object.freeze({...config});
  }
  return Object.freeze(registry);
}

export function listDocuments(compositionDir, config) {
  if (!config || config.type === 'static') return [];
  const root = path.join(compositionDir, 'documents');
  const directory = path.resolve(root, config.documents);
  const rootReal = fs.realpathSync(root);
  const dirReal = fs.realpathSync(directory);
  if (!dirReal.startsWith(rootReal + path.sep)) throw new Error('Document folder escapes composition/documents');
  return fs.readdirSync(directory, {withFileTypes:true})
    .filter(entry => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.md$/.test(entry.name))
    .map(entry => entry.name.slice(0,-3)).sort();
}

export function resolveDocument(compositionDir, config, requested = null) {
  if (requested !== null && (typeof requested !== 'string' || !ID.test(requested))) throw new Error('Invalid document identifier');
  if (!config || config.type === 'static') {
    if (requested !== null) throw new Error('This template does not support documents');
    return null;
  }
  const allowed = listDocuments(compositionDir, config);
  const id = requested ?? config.defaultDocument;
  if (!allowed.includes(id)) throw new Error(`Unknown Markdown document: ${id}. Available: ${allowed.join(', ')}`);
  const directory = path.join(compositionDir, 'documents', config.documents);
  const filename = path.join(directory, `${id}.md`);
  if (!fs.statSync(filename).isFile()) throw new Error('Invalid document file');
  return {id, filename, markdown:fs.readFileSync(filename,'utf8')};
}
