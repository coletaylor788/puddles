"""Text extraction policy. Only the restricted worker parses external HTML."""

import re

import html5lib

HTML_NS = "{http://www.w3.org/1999/xhtml}"
ALLOWED = frozenset(
    "body div span p br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd "
    "table caption colgroup col thead tbody tfoot tr td th "
    "a b strong i em u s small sub sup blockquote pre code "
    "section article header footer main center font address "
    "abbr cite q time strike tt big wbr".split()
)
BLOCKS = frozenset(
    "div p hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption "
    "thead tbody tfoot tr blockquote pre section article header "
    "footer main center address".split()
)


def extract_html_text(html: str) -> str:
    """Emit allowed HTML body text, never attributes or excluded descendants.

    HTML5 tree construction handles malformed markup. Text that merely resembles
    code remains untrusted prose; callers must still run their ingress guards.
    Iterative traversal avoids recursion failures on deeply nested mail layouts.
    """
    document = html5lib.parse(html, treebuilder="etree", namespaceHTMLElements=True)
    body = document.find(HTML_NS + "body")
    if body is None:
        return ""
    pieces: list[str] = []
    pending = [("node", body)]
    while pending:
        kind, value = pending.pop()
        if kind == "text":
            pieces.append(value)
            continue
        tag = value.tag
        if not isinstance(tag, str) or not tag.startswith(HTML_NS):
            continue
        name = tag[len(HTML_NS) :]
        if name not in ALLOWED:
            continue
        separator = "\n" if name in BLOCKS or name == "br" else "\t" if name in {"td", "th"} else ""
        if separator:
            pieces.append(separator)
            pending.append(("text", separator))
        children = list(value)
        for child in reversed(children):
            if child.tail:
                pending.append(("text", child.tail))
            pending.append(("node", child))
        if value.text:
            pieces.append(value.text)
    # Normalize layout indentation while retaining paragraph and cell boundaries.
    lines = [re.sub(r"[^\S\n\t]+", " ", line).strip() for line in "".join(pieces).splitlines()]
    return "\n".join(line for line in lines if line).strip()
