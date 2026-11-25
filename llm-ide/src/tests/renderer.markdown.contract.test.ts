import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vm from 'node:vm';

/**
 * Read the renderer assets that decide how chat markdown reaches the DOM.
 *
 * Purpose: markdown rendering lives entirely in the plain-script renderer, so the only durable
 * guard against regressions is asserting the shipped assets and the render pipeline itself.
 * Inputs: none; paths resolve relative to the compiled test location.
 * Outputs: the renderer HTML, stylesheet and JavaScript source strings.
 * Side effects: reads local source files only.
 * Errors: propagates file-read errors so missing renderer assets fail the test.
 * Performance: reads four small source files once per test.
 * Security/privacy: never loads user chat data or contacts a network endpoint.
 * Concurrency: read-only and safe to run concurrently.
 * Rationale: the reported symptoms (tables, graphs, embedded HTML) each came from a different
 * layer - CSS, a missing library and a sanitizer gap - so all three layers are asserted.
 */
async function readMarkdownSources(): Promise<{ html: string; css: string; app: string }> {
  const rendererDir = path.resolve(__dirname, '..', '..', 'renderer');
  const [html, css, app] = await Promise.all([
    fs.readFile(path.join(rendererDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(rendererDir, 'styles.css'), 'utf8'),
    fs.readFile(path.join(rendererDir, 'app.js'), 'utf8')
  ]);
  return { html, css, app };
}

/**
 * Load the markdown pipeline out of app.js into an isolated context.
 *
 * Purpose: exercise the real pipeline functions without a browser or a DOM test dependency.
 * Inputs: the app.js source, plus optional window stubs (marked, DOMPurify).
 * Outputs: the pipeline functions and the globals they were defined with.
 * Side effects: creates a throwaway VM context; nothing outside it is touched.
 * Errors: throws if the pipeline boundaries are missing from app.js, which is itself a signal
 * that the pipeline was removed or renamed.
 * Performance: one slice and one compile per call.
 * Security/privacy: the vendored marked build is executed inside vm with no filesystem, network
 * or process access.
 * Concurrency: each call builds its own context.
 * Rationale: the repo already runs extracted renderer slices through vm in other renderer
 * contract tests, so no jsdom or Playwright devDependency is needed.
 */
async function loadMarkdownPipeline(
  app: string,
  windowStubs: Record<string, unknown> = {}
): Promise<Record<string, any>> {
  const start = app.indexOf('function escapeHtml(');
  const end = app.indexOf('function createModelUri(');
  assert.ok(start >= 0 && end > start, 'Expected the markdown pipeline block in renderer/app.js.');

  const context: Record<string, any> = {
    console,
    window: { ...windowStubs },
    document: { createElement: () => ({ classList: { add() {} }, dataset: {} }) },
    setTimeout: () => 0,
    clearTimeout: () => undefined
  };
  context.globalThis = context;
  vm.runInNewContext(app.slice(start, end), context);
  return context;
}

/** Load the vendored marked build so behavioural tests use the shipped parser, not a mock. */
async function loadVendoredMarked(): Promise<any> {
  const vendorPath = path.resolve(__dirname, '..', '..', 'renderer', 'vendor', 'marked.umd.js');
  const context: Record<string, any> = { console };
  context.globalThis = context;
  vm.runInNewContext(await fs.readFile(vendorPath, 'utf8'), context);
  assert.equal(typeof context.marked?.parse, 'function', 'Vendored marked must expose parse().');
  return context.marked;
}

test('renderer ships vendored markdown libraries instead of unpinned CDN builds', async () => {
  const { html } = await readMarkdownSources();

  for (const file of ['marked.umd.js', 'purify.min.js', 'mermaid.min.js']) {
    assert.match(
      html,
      new RegExp(`<script src="\\./vendor/${file}"></script>`),
      `Expected index.html to load ./vendor/${file}.`
    );
  }

  assert.ok(
    !/cdn\.jsdelivr\.net\/npm\/marked/.test(html),
    'An unpinned marked CDN URL reintroduces the version drift that broke table rendering.'
  );
  assert.ok(
    !/cdn\.jsdelivr\.net\/npm\/dompurify/.test(html),
    'DOMPurify must be vendored so the sanitizer cannot silently fail to load.'
  );
});

test('markdown libraries load before Monaco installs its AMD loader', async () => {
  const { html } = await readMarkdownSources();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(match => ({
    attributes: match[1],
    src: match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? ''
  }));
  const monacoLoader = scripts.findIndex(script =>
    script.src === 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js'
  );

  assert.ok(monacoLoader >= 0, 'Expected the Monaco AMD loader script tag.');
  assert.doesNotMatch(
    scripts[monacoLoader].attributes,
    /\basync\b/i,
    'Monaco must not load asynchronously; its position defines when AMD define() becomes global.'
  );
  for (const file of ['marked.umd.js', 'purify.min.js', 'mermaid.min.js']) {
    const markdownLibrary = scripts.findIndex(script => script.src === `./vendor/${file}`);
    assert.ok(markdownLibrary >= 0, `Expected a script tag for ./vendor/${file}.`);
    assert.doesNotMatch(
      scripts[markdownLibrary].attributes,
      /\b(?:async|type\s*=\s*["']module["'])/i,
      `${file} must execute as an ordered classic script, not race Monaco's AMD loader.`
    );
    assert.ok(
      markdownLibrary < monacoLoader,
      `${file} must execute before Monaco installs global AMD define(); reversing this order previously broke Mermaid initialization.`
    );
  }
});

test('vendored markdown libraries exist and are not empty', async () => {
  const vendorDir = path.resolve(__dirname, '..', '..', 'renderer', 'vendor');
  for (const file of ['marked.umd.js', 'purify.min.js', 'mermaid.min.js']) {
    const stat = await fs.stat(path.join(vendorDir, file));
    assert.ok(stat.size > 10_000, `${file} looks truncated (${stat.size} bytes).`);
  }
});

test('CSP allows https images so markdown images render', async () => {
  const { html } = await readMarkdownSources();
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'Expected a Content-Security-Policy meta tag.');

  const imgSrc = csp.split(';').map(part => part.trim()).find(part => part.startsWith('img-src'));
  assert.ok(imgSrc, 'Expected an img-src directive.');
  assert.match(imgSrc as string, /https:/, 'Markdown images from https URLs are blocked without it.');
  assert.match(imgSrc as string, /'self'/, "img-src must keep 'self' for local images.");
  assert.match(csp, /script-src 'self'/, 'Scripts must stay limited to local and CDN sources.');
});

test('markdown tables are not styled with display:block', async () => {
  const { css } = await readMarkdownSources();

  const tableRules = [...css.matchAll(/([^{}]*\.assistant-markdown table[^{}]*)\{([^}]*)\}/g)]
    .map(match => ({ selector: match[1].trim(), body: match[2] }));
  assert.ok(tableRules.length >= 2, 'Expected both the spacing rule and the layout rule for tables.');
  for (const { selector, body } of tableRules) {
    assert.ok(
      !/display:\s*block/.test(body),
      `${selector} must not use display:block; it splits thead/tbody into separate grids and leaves a dead bordered area.`
    );
  }
  assert.ok(
    tableRules.some(({ body }) => /max-width:\s*100%/.test(body)),
    'A table must not overflow its column.'
  );

  assert.match(
    css,
    /\.markdown-table-scroll[^{]*\{[^}]*overflow-x:\s*auto/,
    'Wide tables need the scroll wrapper inserted by wrapMarkdownTables().'
  );
});

test('GFM alignment markers are honoured by the stylesheet', async () => {
  const { css } = await readMarkdownSources();

  for (const alignment of ['left', 'center', 'right']) {
    assert.match(
      css,
      new RegExp(`\\.assistant-markdown (?:th|td)\\[align="${alignment}"\\][^{]*\\{[^}]*text-align:\\s*${alignment}`),
      `marked emits align="${alignment}"; the cell text-align rule would otherwise override it.`
    );
  }
});

test('mermaid diagrams have styles for both the rendered and failed states', async () => {
  const { css } = await readMarkdownSources();
  assert.match(css, /\.mermaid-diagram\s*\{/, 'Expected a style for a rendered diagram.');
  assert.match(css, /\.mermaid-diagram-failed/, 'Expected a style for a diagram that failed to render.');
  assert.match(css, /\.mermaid-diagram-note/, 'Expected a style for the failure note.');
});

test('every markdown surface renders through renderMarkdownInto', async () => {
  const { app } = await readMarkdownSources();

  const directPaints = [...app.matchAll(/\.innerHTML\s*=\s*renderMarkdownToHtml\(/g)];
  assert.equal(
    directPaints.length,
    1,
    'Only renderMarkdownInto() may paint markdown; a second call site skips table wrapping and diagrams.'
  );
  assert.match(app, /element\.innerHTML = renderMarkdownToHtml\(markdownText\);/);

  const callSites = [...app.matchAll(/renderMarkdownInto\(/g)].length;
  assert.ok(callSites >= 15, `Expected the markdown call sites to use renderMarkdownInto(), saw ${callSites}.`);
});

test('renderMarkdownToHtml never returns unsanitized HTML', async () => {
  const { app } = await readMarkdownSources();

  assert.match(app, /function sanitizeRenderedHtml\(html\)/);
  assert.match(
    app,
    /if \(!purifier \|\| typeof purifier\.sanitize !== 'function'\) \{\s*return null;/,
    'A missing DOMPurify must report failure instead of returning the raw parser output.'
  );
  assert.match(app, /return renderMarkdownAsEscapedText\(normalizedMarkdown\);/);

  const marked = await loadVendoredMarked();
  const withoutSanitizer = await loadMarkdownPipeline(app, { marked });
  const escaped = withoutSanitizer.renderMarkdownToHtml('# Title\n\n<style>body{color:red}</style>\n\n- item');
  assert.ok(!escaped.includes('<style>'), 'Model-authored CSS must never reach the DOM.');
  assert.ok(escaped.includes('&lt;style&gt;'), 'Expected the injected markup to be escaped.');
  assert.ok(escaped.includes('Title'), 'The fallback must still show the model text.');
});

test('normalizeMarkdownTables keeps paragraphs out of table bodies', async () => {
  const { app } = await readMarkdownSources();
  const { normalizeMarkdownTables, countTableCells, padTableDelimiter } = await loadMarkdownPipeline(app);

  assert.equal(countTableCells('| A | B | C |'), 3);
  assert.equal(countTableCells('A | B'), 2);
  assert.equal(countTableCells('escaped \\| pipe | B'), 2);

  assert.equal(padTableDelimiter('|---|---|', 3), '| --- | --- | --- |');
  assert.equal(padTableDelimiter('|:---|---:|', 3), '| :--- | ---: | --- |');

  const padded = normalizeMarkdownTables('| A | B | C |\n|---|---|\n| 1 | 2 | 3 |');
  assert.match(padded, /\| --- \| --- \| --- \|/, 'A short separator row must be padded to the header width.');

  const separated = normalizeMarkdownTables('| A | B |\n|---|---|\n| 1 | 2 |\nOutro text');
  assert.match(separated, /\| 1 \| 2 \|\n\nOutro text/, 'A paragraph after a table must stay a paragraph.');

  const fenced = normalizeMarkdownTables('```markdown\n| A | B |\n| 1 | 2 |\n```');
  assert.equal(fenced, '```markdown\n| A | B |\n| 1 | 2 |\n```', 'Fenced samples must be left untouched.');
});

test('the vendored parser produces a real table for the reported markdown shapes', async () => {
  const { app } = await readMarkdownSources();
  const marked = await loadVendoredMarked();
  const pipeline = await loadMarkdownPipeline(app, {
    marked,
    DOMPurify: { sanitize: (html: string) => html }
  });

  const tableHtml = pipeline.renderMarkdownToHtml('| A | B | C |\n|---|---|\n| 1 | 2 | 3 |');
  assert.match(tableHtml, /<table>/, 'A short separator row must still render as a table.');
  assert.match(tableHtml, /<th>C<\/th>/);

  const aligned = pipeline.renderMarkdownToHtml('| Left | Center | Right |\n|:---|:---:|---:|\n| a | b | 12,340 |');
  assert.match(aligned, /<th align="left">Left<\/th>/);
  assert.match(aligned, /<th align="center">Center<\/th>/);
  assert.match(aligned, /<th align="right">Right<\/th>/);

  const afterTable = pipeline.renderMarkdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |\nOutro text');
  assert.match(afterTable, /<p>Outro text<\/p>/, 'The paragraph must not be absorbed as a table row.');
  assert.ok(!afterTable.includes('<td>Outro text</td>'), 'Outro text became a table cell.');

  const blockHtml = pipeline.renderMarkdownToHtml('<details>\n<summary>More</summary>\n\n- one\n\n</details>');
  assert.match(blockHtml, /<details>/, 'Embedded block HTML must survive the pipeline.');
  assert.match(blockHtml, /<summary>More<\/summary>/);
});

test('markdown post-processing repairs embedded-HTML and line-break artifacts', async () => {
  const { app } = await readMarkdownSources();

  assert.match(app, /function normalizeRenderedParagraphs\(element\)/);
  assert.match(app, /:scope > p/, 'Only top-level paragraphs may be pruned; nested ones stay.');
  assert.match(app, /function collapseRedundantLineBreaks\(element\)/);
  assert.match(
    app,
    /element\.innerHTML = renderMarkdownToHtml\(markdownText\);\s*wrapMarkdownTables\(element\);\s*normalizeRenderedParagraphs\(element\);\s*collapseRedundantLineBreaks\(element\);/,
    'renderMarkdownInto() must apply every post-processing pass.'
  );
});

test('mermaid rendering is wired with the hardened security level', async () => {
  const { app } = await readMarkdownSources();

  assert.match(app, /securityLevel: 'strict'/, 'mermaid defaults to a looser security level.');
  assert.match(app, /startOnLoad: false/, 'mermaid must not scan the document on page load.');
  assert.match(app, /suppressErrorRendering: true/);
  assert.match(app, /pre > code\.language-mermaid/, 'Only mermaid fences may be rendered as diagrams.');
  assert.match(app, /function markMermaidFailure\(preElement, error\)/, 'A failed diagram must keep its source.');
  assert.match(app, /data-mermaid-rendered/, 'Streaming must not re-render a growing diagram per frame.');
});

test('wrapMarkdownTables skips tables that are already wrapped', async () => {
  const { app } = await readMarkdownSources();
  assert.match(
    app,
    /if \(table\.closest\('\.markdown-table-scroll'\)\) continue;/,
    'Nested tables must not each gain a scroll wrapper.'
  );
});
