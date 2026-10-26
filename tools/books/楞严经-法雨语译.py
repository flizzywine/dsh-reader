"""楞严经（法雨语译）EPUB → dsh-reader 折叠块 TXT.

Each 经文 paragraph is followed by its 白话 and, now and then, 注 (parenthesised notes or quotes
from other sutras and masters). The EPUB marks none of this, so paragraphs are classified by text:
经文 has almost no vernacular particles and no “” quotes; 注 opens with （ and runs until it closes.

usage: python3 -I tools/books/楞严经-法雨语译.py <OEBPS dir> <out.txt> <report.txt>
"""
import html
import re
import sys
from pathlib import Path

CN = '零一二三四五六七八九十'
VERNACULAR = set('的了们这那么呢吧着')
MASTERS = re.compile(r'^(海仁|圆瑛|宣化|交光|憨山|长水|蕅益|智旭|太虚|南怀瑾|温陵|戒环|子璿|传灯|真鉴|通理|妙叶|钱谦益|灌顶|正脉|讲义|按[：:]|注[：:]|又[，,]?按)')


def cn_number(n):
    return CN[n] if n <= 10 else ('十' + CN[n - 10] if n < 20 else CN[n // 10] + '十' + (CN[n % 10] if n % 10 else ''))


def paragraphs(oebps):
    """[(kind, text)] in reading order; kind is 'juan', 'sec' or 'p'."""
    out = []
    for f in sorted(Path(oebps).glob('text*.html')):
        s = f.read_text(encoding='utf8')
        for m in re.finditer(r'<p[^>]*>(.*?)</p>', s, re.S):
            inner = m.group(1)
            size = re.search(r'<font size="(\d)">', inner)
            t = html.unescape(re.sub(r'<[^>]+>', '', inner)).replace('\xa0', ' ').strip()
            t = re.sub(r'^[\s　]+', '', t)
            if not t:
                continue
            kind = 'juan' if size and size.group(1) == '7' else 'sec' if size and size.group(1) == '6' else 'p'
            out.append((kind, t))
    return out


def density(t):
    core = re.sub(r'（[^）]*）', '', t)
    return sum(c in VERNACULAR for c in core) / max(len(core), 1)


# Words the sutra's own Chinese never uses (it says 言/告/白, not 说：/对佛说) but the 白话 often does.
VERNACULAR_WORDS = re.compile(r'说[：:]|对佛说|没有|知道|什么|我们|你们|他们|自己|一样|因为|所以(?!者何)|这样|那样|已经|(?<!成)就(?!位)|确实|怎么|如此！|任何|只要|无论|由于|如果(?!位)|叫做|就叫')


def classify(t, prev=None):
    core = re.sub(r'（[^）]*）', '', t)  # inline glosses quote freely: （zhǎng同“掌”）
    d = density(t)
    if d >= 0.02:
        return '白'
    # The sutra itself quotes now and then; a long paragraph with no particle at all is still 经.
    if ('“' in core or '”' in core) and (d > 0 or len(core) <= 60):
        return '白'
    # 所以/因为/确实 turn up in the sutra too: one such word decides only a short paragraph.
    words = set(VERNACULAR_WORDS.findall(core))
    if len(words) >= 2 or (words and len(core) <= 60):
        return '白'
    # 「如是我闻：」 right after 「如是我闻，一时佛在……」: the 白话 opening with the sutra's own words.
    if prev and len(t) <= 12 and prev.startswith(t.rstrip('：:，,。')):
        return '白'
    # Two 经 in a row is rare outside verses and the mantra: the second, longer and a little more
    # vernacular, is the 白话 of the first.
    if prev and len(t) > len(prev) and density(t) >= 0.004 and density(t) > density(prev):
        return '白'
    return '经'


def heading_title(t):
    """第X卷 heading text must stay within 30 chars after 第X卷 for the importer."""
    t = re.sub(r'\s+', '', t).rstrip('。.，,')
    t = t.replace('．', '、')
    if len(t) <= 28:
        return t
    for sep in '：，':
        i = t.find(sep)
        if 0 < i <= 28:
            return t[:i]
    return t[:28]


def convert(paras):
    """[(role, text)] with role in 卷/节/经/白/注, after dropping the book's own front TOC."""
    first = next(i for i, (k, _) in enumerate(paras) if k == 'juan')
    roles = []
    juan = 0
    depth = 0
    run = 0
    note = '注'
    for kind, t in paras[first:]:
        if kind == 'juan':
            if t == 'Table of Contents':
                break
            juan += 1
            roles.append(('卷', juan, t))
            depth = 0
            continue
        if kind == 'sec':
            roles.append(('节', juan, t))
            depth = 0
            continue
        opening = depth == 0 and t.startswith('（')
        if opening:
            # A verse's 白话 comes as one bracketed run: （大意是：……）
            note = '白' if re.match(r'（\s*大意', t) else '注'
        if depth > 0 or opening:
            role = note
            depth += t.count('（') - t.count('）')
            run += 1
            # A note that never closes (a typo in the book) must not swallow the rest of the 卷.
            if depth <= 0 or run > 6:
                depth, run = 0, 0
        elif MASTERS.match(t):
            role = '注'
        else:
            role = classify(t, roles[-1][2] if roles and roles[-1][0] == '经' else None)
            run = 0
        roles.append((role, juan, t))
    return roles


def render(roles):
    lines = []
    fold = None
    pending_intro = None
    for role, juan, t in roles:
        if role in ('卷', '节'):
            if fold:
                lines.append(':::')
                fold = None
        if role == '卷':
            pending_intro = juan
            continue
        if role == '节':
            pending_intro = None
            lines.append('')
            lines.append(f'第{cn_number(juan)}卷 {heading_title(t)}')
            continue
        if pending_intro is not None:
            # 卷首 matter before the first 节 (translators, the title explained).
            lines.append('')
            lines.append(f'第{cn_number(juan)}卷 卷首')
            pending_intro = None
        label = {'白': '白话', '注': '注'}.get(role)
        if label != fold:
            if fold:
                lines.append(':::')
            if label:
                lines.append(f'::: {label}')
            fold = label
        lines.append(t)
    if fold:
        lines.append(':::')
    return '\n'.join(lines).strip() + '\n'


def main():
    oebps, out, report = sys.argv[1:4]
    roles = convert(paragraphs(oebps))
    Path(out).write_text(render(roles), encoding='utf8')
    with open(report, 'w', encoding='utf8') as f:
        for i, (role, juan, t) in enumerate(roles):
            f.write(f'{i:5d} 卷{juan:<2d} {role} {density(t):.3f} {len(t):4d} {t[:60]}\n')
    from collections import Counter
    print(Counter(r for r, _, _ in roles))


if __name__ == '__main__':
    main()
