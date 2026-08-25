#!/usr/bin/env python3
"""Regenerate the human-readable HTML mirror of ./docs.

Usage: python3 scripts/build-docs-mirror.py   (from the repo root)
Needs: markdown-it-py (`pip install markdown-it-py`).

The docs under ./docs govern this repo; humans read the mirror, not the
markdown. This script renders every markdown file under ./docs (sorted,
recursive) into one page at browse/index.html: exact content, presentation
only (banner, grouped table of contents, per-file labels, anchors). No
model and no network are involved, so the output is reproducible and can be
checked against the docs. Run it in the same commit as any doc change; where
the page and ./docs disagree, ./docs wins.
"""
import html
import re
import sys
from pathlib import Path

try:
    from markdown_it import MarkdownIt
except ImportError:  # pragma: no cover
    sys.exit("markdown-it-py is required: pip install markdown-it-py")

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "browse" / "index.html"

CSS = """
:root { color-scheme: light dark;
  --bg:#ffffff; --fg:#1a1f27; --muted:#5b6470; --border:#d9dee5;
  --accent:#0b5fa5; --code-bg:#f3f5f8; --banner-bg:#f6f8fa; --toc-bg:#fafbfc; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#12151a; --fg:#dde3ea; --muted:#98a2ad; --border:#2c333c;
    --accent:#6cb2e8; --code-bg:#1c2129; --banner-bg:#181d24; --toc-bg:#161a20; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:16px/1.65 Georgia, "Times New Roman", serif; }
.wrap { max-width: 58rem; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
.banner { background:var(--banner-bg); border:1px solid var(--border);
  border-radius:8px; padding:0.8rem 1.1rem; color:var(--muted);
  font:14px/1.5 system-ui, sans-serif; margin-bottom:2rem; }
.banner strong { color:var(--fg); }
h1,h2,h3,h4,h5,h6 { font-family: system-ui, sans-serif; line-height:1.25;
  margin: 1.8em 0 0.6em; }
h1 { font-size:1.75rem; } h2 { font-size:1.4rem; } h3 { font-size:1.15rem; }
a { color: var(--accent); }
nav.toc { background:var(--toc-bg); border:1px solid var(--border);
  border-radius:8px; padding:1rem 1.4rem; margin-bottom:2.5rem;
  font-family: system-ui, sans-serif; font-size:0.9rem; }
nav.toc ul { margin:0.25rem 0; padding-left:1.2rem; }
nav.toc > ul { padding-left: 0.2rem; list-style:none; }
nav.toc li { margin: 0.15rem 0; }
nav.toc .group { font-weight:700; margin-top:0.8rem; list-style:none; }
nav.toc .file { font-weight:600; }
nav.toc details { margin: 0.1rem 0; }
nav.toc summary { cursor:pointer; }
section.docfile { border-top: 3px double var(--border); margin-top:3rem;
  padding-top: 1rem; }
.filelabel { font:600 0.8rem/1 system-ui, sans-serif; letter-spacing:0.08em;
  text-transform:uppercase; color:var(--muted); margin:0 0 0.5rem; }
dl.frontmatter { background:var(--toc-bg); border:1px solid var(--border);
  border-radius:6px; padding:0.6rem 1rem; font:0.85rem system-ui, sans-serif;
  display:grid; grid-template-columns:max-content 1fr; gap:0.2rem 1rem; }
dl.frontmatter dt { color:var(--muted); } dl.frontmatter dd { margin:0; }
pre { background:var(--code-bg); border:1px solid var(--border);
  border-radius:6px; padding:0.8rem 1rem; overflow-x:auto;
  font:13.5px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
code { background:var(--code-bg); border-radius:4px; padding:0.1em 0.3em;
  font:0.875em ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
pre code { background:none; border:none; padding:0; font-size:inherit; }
.tablewrap { overflow-x:auto; }
table { border-collapse: collapse; margin:1em 0;
  font-family: system-ui, sans-serif; font-size:0.9rem; }
th, td { border:1px solid var(--border); padding:0.4rem 0.7rem;
  text-align:left; vertical-align:top; }
th { background: var(--banner-bg); }
blockquote { margin:1em 0; padding:0.1em 1em; border-left:4px solid var(--border);
  color: var(--muted); }
hr { border:none; border-top:1px solid var(--border); margin:2em 0; }
img { max-width:100%; }
.backtop { font: 13px system-ui, sans-serif; margin-top:1.5rem; }
"""

FRONT = re.compile(r"^---\n([\s\S]*?)\n---\n")


def slug(path: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(path).lower()).strip("-")


def front_matter(text: str):
    """Split a leading YAML-ish front matter block (the guides carry one:
    title, description, category, order) from the body. The block is
    content of the doc, so it is rendered, as a definition list."""
    m = FRONT.match(text)
    if not m:
        return [], text
    pairs = []
    for line in m.group(1).split("\n"):
        i = line.find(":")
        if i > 0:
            pairs.append((line[:i].strip(), line[i + 1:].strip()))
    return pairs, text[m.end():]


def main() -> None:
    md = MarkdownIt("commonmark").enable("table").enable("strikethrough")
    files = sorted(DOCS.rglob("*.md"), key=lambda p: (len(p.relative_to(DOCS).parts) > 1, str(p)))
    if not files:
        sys.exit(f"no markdown files under {DOCS}")

    groups: dict[str, list[str]] = {}
    sections = []
    for f in files:
        rel = f.relative_to(ROOT)
        group = str(f.relative_to(DOCS).parent) if len(f.relative_to(DOCS).parts) > 1 else "docs"
        fslug = slug(rel)
        pairs, body_md = front_matter(f.read_text(encoding="utf-8"))
        tokens = md.parse(body_md)

        heads = []
        n = 0
        for i, tok in enumerate(tokens):
            if tok.type == "heading_open":
                n += 1
                anchor = f"{fslug}--h{n}"
                tok.attrSet("id", anchor)
                heads.append((int(tok.tag[1]), anchor, tokens[i + 1].content))

        body = md.renderer.render(tokens, md.options, {})
        body = body.replace("<table>", '<div class="tablewrap"><table>').replace(
            "</table>", "</table></div>")
        if pairs:
            body = ('<dl class="frontmatter">' + "".join(
                f"<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>" for k, v in pairs)
                + "</dl>\n" + body)

        items = "\n".join(
            f'<li>{"&nbsp;&nbsp;" * max(lvl - 1, 0)}'
            f'<a href="#{a}">{html.escape(t)}</a></li>'
            for lvl, a, t in heads)
        groups.setdefault(group, []).append(
            f'<li><details><summary><a class="file" href="#file--{fslug}">{rel}</a></summary>\n'
            f"<ul>\n{items}\n</ul></details>\n</li>")
        sections.append(
            f'<section class="docfile" id="file--{fslug}">\n'
            f'<p class="filelabel">{rel}</p>\n{body}\n'
            f'<p class="backtop"><a href="#toc">&uarr; contents</a></p>\n'
            f"</section>")

    toc = []
    for group, items in groups.items():
        label = "docs/" if group == "docs" else f"docs/{group}/"
        toc.append(f'<li class="group">{html.escape(label)}<ul>\n' + "\n".join(items) + "\n</ul></li>")

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>telarchy-app docs</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<div class="banner"><strong>Derived mirror of <code>./docs</code>; the docs win.</strong>
This page is generated from the markdown files in <code>./docs</code>
(by <code>scripts/build-docs-mirror.py</code>) and adds nothing beyond
navigation and labels. Where this page and <code>./docs</code> disagree,
<code>./docs</code> is authoritative.</div>
<h1>telarchy-app documentation</h1>
<nav class="toc" id="toc">
<strong>Contents</strong>: every file in <code>./docs</code>, in full. Start at <a href="#file--docs-readme-md">docs/README.md</a>.
<ul>
{chr(10).join(toc)}
</ul>
</nav>
{chr(10).join(sections)}
</div>
</body>
</html>
"""
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    main()
