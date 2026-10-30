import React, {useMemo, type ReactNode} from 'react';
import './markdown.css';

// 极简 Markdown 渲染：只生成 React 元素，不使用 innerHTML。admin/src/markdown.tsx 为同一实现的副本。
type Block = {type: 'h'; level: number; text: string} | {type: 'p' | 'quote'; lines: string[]} | {type: 'ul' | 'ol'; items: string[]} | {type: 'code'; lang: string; text: string} | {type: 'hr'};
const UL = /^\s*[-*+]\s+/, OL = /^\s*\d+[.)]\s+/, BREAK = /^(```|#{1,4}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|(-{3,}|\*{3,})\s*$)/;

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n'), out: Block[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) { const body: string[] = []; i++; while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]); i++; out.push({type: 'code', lang: fence[1], text: body.join('\n')}); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { out.push({type: 'h', level: heading[1].length, text: heading[2].trim()}); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push({type: 'hr'}); i++; continue; }
    if (/^>\s?/.test(line)) { const quote: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, '')); out.push({type: 'quote', lines: quote}); continue; }
    if (UL.test(line) || OL.test(line)) { const pattern = OL.test(line) ? OL : UL, items: string[] = []; while (i < lines.length && pattern.test(lines[i])) items.push(lines[i++].replace(pattern, '')); out.push({type: pattern === OL ? 'ol' : 'ul', items}); continue; }
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() && !BREAK.test(lines[i])) para.push(lines[i++]);
    out.push({type: 'p', lines: para});
  }
  return out;
}

const safeHref = (href: string) => /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) ? href : null;
function inline(text: string): ReactNode[] {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g, out: ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0], key = out.length;
    if (match[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key}>{inline(token.slice(2, -2))}</strong>);
    else if (match[3]) out.push(<em key={key}>{inline(token.slice(1, -1))}</em>);
    else {
      const [, label, target] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!, href = safeHref(target);
      out.push(href ? <a key={key} href={href} {...(/^https?:/i.test(href) ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>{label}</a> : token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const plain = (text: string) => text.replace(/[`*]|\[([^\]]+)\]\([^)]*\)/g, (_, label) => label || '');

export function markdownHeadings(source: string) {
  return parse(source).filter(b => b.type === 'h' && b.level <= 2).map((b, i) => ({id: `doc-${i}`, text: plain((b as {text: string}).text)}));
}

export function Markdown({source, renderCode}: {source: string; renderCode?: (code: string, lang: string) => ReactNode}) {
  const blocks = useMemo(() => parse(source), [source]);
  let section = 0;
  return <>{blocks.map((b, i) => {
    switch (b.type) {
      case 'h': { if (b.level <= 2) return <h2 key={i} id={`doc-${section++}`}>{inline(b.text)}</h2>; const Tag = b.level === 3 ? 'h3' : 'h4'; return <Tag key={i}>{inline(b.text)}</Tag>; }
      case 'p': return <p key={i}>{b.lines.map((l, k) => <React.Fragment key={k}>{k > 0 && <br/>}{inline(l)}</React.Fragment>)}</p>;
      case 'quote': return <blockquote key={i}>{b.lines.map((l, k) => <React.Fragment key={k}>{k > 0 && <br/>}{inline(l)}</React.Fragment>)}</blockquote>;
      case 'ul': return <ul key={i}>{b.items.map((item, k) => <li key={k}>{inline(item)}</li>)}</ul>;
      case 'ol': return <ol key={i}>{b.items.map((item, k) => <li key={k}>{inline(item)}</li>)}</ol>;
      case 'code': return <React.Fragment key={i}>{renderCode ? renderCode(b.text, b.lang) : <pre><code>{b.text}</code></pre>}</React.Fragment>;
      default: return <hr key={i}/>;
    }
  })}</>;
}
