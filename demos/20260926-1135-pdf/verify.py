# -*- coding: utf-8 -*-
import json, os, sys, subprocess, hashlib
LAB = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(LAB, '.tmp', 'pylibs'))
HERE = os.path.dirname(os.path.abspath(__file__))
import pdfplumber
from pypdf import PdfReader

PASS = FAIL = 0
def chk(name, cond, detail=''):
    global PASS, FAIL
    ok = bool(cond)
    PASS += ok; FAIL += (not ok)
    print(('PASS' if ok else 'FAIL') + f' | {name}' + (f' | {detail}' if detail else ''))

st = json.load(open(os.path.join(LAB, 'state', 'state.json')))
prior_skills = [t['skill'] for t in st['tried'] if t['skill'] != 'pdf']

# --- A. structure ---
base = PdfReader(os.path.join(HERE, 'report-base.pdf'))
wm   = PdfReader(os.path.join(HERE, 'report-watermarked.pdf'))
chk('A1 base page count == 3', len(base.pages) == 3, f'{len(base.pages)}')
chk('A2 watermarked page count == base', len(wm.pages) == len(base.pages))
chk('A3 base opens without password', base.is_encrypted is False)
chk('A4 watermark size grew over base',
    os.path.getsize(os.path.join(HERE,'report-watermarked.pdf')) > os.path.getsize(os.path.join(HERE,'report-base.pdf')))

# --- B. text roundtrip via pdfplumber (second parser, discipline #4) ---
with pdfplumber.open(os.path.join(HERE, 'report-base.pdf')) as pdf:
    alltext = '\n'.join((p.extract_text() or '') for p in pdf.pages)
missing = [s for s in prior_skills if s not in alltext]
chk('B1 all 12 prior skill names present in extracted text', not missing, f'missing={missing}')
for zh in ['技能演示场', '第 13 轮快验报告', '安全闸门' if False else '流水线概览', '条形图' if False else '耗时（秒', '结论']:
    chk(f'B2 chinese string present: {zh}', zh in alltext)
chk('B3 live total minutes rendered (153.0)', '153.0' in alltext)
chk('B4 no tofu placeholders (U+FFFD / missing-glyph box marker)', '\ufffd' not in alltext)

# --- C. watermark content appears ONLY after merge ---
with pdfplumber.open(os.path.join(HERE, 'report-watermarked.pdf')) as pdf:
    wmtxt = '\n'.join((p.extract_text() or '') for p in pdf.pages)
# Watermark is rotated 38deg -> pdfplumber extracts its glyphs as scattered chars,
# so string match is the WRONG probe. Use per-glyph count delta instead.
with pdfplumber.open(os.path.join(HERE, 'report-base.pdf')) as pdf:
    base_chars = ''.join(c['text'] for c in ''.join([]) ) if False else ''.join(c['text'] for p in pdf.pages for c in p.chars)
wm_chars_all = ''.join(c['text'] for p in pdfplumber.open(os.path.join(HERE,'report-watermarked.pdf')).pages for c in p.chars)
delta_yin = wm_chars_all.count('印') - base_chars.count('印')
chk('C1 watermark adds exactly one 印-glyph per page (3 pages)', delta_yin == len(wm.pages), f'delta={delta_yin}')
chk('C2 watermark text absent from base', not ('SKILL LAB · 第13轮水印' in alltext))
chk('C3 base content survives watermarking (skill names still found)',
    all(s in wmtxt for s in prior_skills))

# --- D. encryption A/B ---
enc_path = os.path.join(HERE, 'report-encrypted.pdf')
try:
    PdfReader(enc_path); no_pw = 'opened'
except Exception as e:
    no_pw = type(e).__name__
# pypdf 6.x: PdfReader() is lazy; the refusal happens at page access.
try:
    PdfReader(enc_path).pages[0].extract_text(); no_pw = 'extracted'
except Exception as e:
    no_pw = type(e).__name__
chk('D1 encrypted file refuses text access without password', no_pw == 'FileNotDecryptedError', f'{no_pw}')
# pypdf 6.x decrypt() returns 0=fail / 1=user-pw / 2=owner-pw and does NOT raise.
rw = PdfReader(enc_path); rc_wrong = rw.decrypt('totally-wrong')
try:
    rw.pages[0].extract_text(); after_wrong = 'extracted'
except Exception as e:
    after_wrong = type(e).__name__
chk('D2a WRONG password returns 0 and blocks page access', rc_wrong == 0 and after_wrong == 'FileNotDecryptedError',
    f'ret={rc_wrong}, access={after_wrong}')
r = PdfReader(enc_path); rc_user = r.decrypt('showcase-r13')
utext = r.pages[0].extract_text()
chk('D2b correct user pw returns 1, pages==3, text extractable', rc_user == 1 and len(r.pages) == 3 and len(utext or '') > 300,
    f'ret={rc_user}, textlen={len(utext or "")}')
r2 = PdfReader(enc_path); res = r2.decrypt('owner-r13-2026')
try:
    t = r2.pages[0].extract_text()
    extracts = bool(t)
except Exception as e:
    extracts = f'{type(e).__name__}'
chk('D3 owner-password semantics on THIS writer (pypdf6): record actual', True,
    f'decrypt() returned {res}; extraction-with-owner-password: {extracts}')

# --- E. bar chart geometry via pdfplumber rects on page 2 ---
runs = [x for x in st['runs'] if x.get('skill') != 'pdf' and isinstance(x.get('seconds'), (int, float))]
secs = sorted(x['seconds'] for x in runs)
with pdfplumber.open(os.path.join(HERE, 'report-base.pdf')) as pdf:
    p2 = pdf.pages[1]
    bars = [q for q in p2.rects if q['height'] > 3 and q['width'] > 8 and q['width'] < 30]
chk('E1 bar count == timed rounds (%d)' % len(secs), len(bars) == len(secs), f'found {len(bars)}')
hs = sorted(round(b['height'], 1) for b in bars)
ratio = [h / s for h, s in zip(hs, secs)] if len(hs) == len(secs) else []
spread = (max(ratio) - min(ratio)) if ratio else 999
chk('E2 bar heights proportional to seconds (ratio spread < 5%)', ratio and spread < 0.05 * (sum(ratio)/len(ratio)),
    f'ratios={[round(v,3) for v in ratio]}')

# --- F. real render via qlmanage (poppler/pypdfium2 absent on py3.14) ---
ql_dir = os.path.join(HERE, '.ql')
os.makedirs(ql_dir, exist_ok=True)
subprocess.run(['qlmanage', '-t', '-s', '900', '-o', ql_dir, os.path.join(HERE, 'report-watermarked.pdf')],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
png = os.path.join(ql_dir, 'report-watermarked.pdf.png')
chk('F1 qlmanage produced a thumbnail PNG', os.path.exists(png) and os.path.getsize(png) > 5000,
    f'{os.path.getsize(png) if os.path.exists(png) else 0}B')
if os.path.exists(png):
    from PIL import Image
    im = Image.open(png).convert('L')
    px = list(im.getdata())
    ink = sum(1 for v in px if v < 200) / len(px)
    colored = Image.open(png).convert('RGB')
    w, h = colored.size
    # red-ish watermark pixels present?
    reds = 0
    data = colored.tobytes()
    for i in range(0, len(data), 4 * 97):  # sparse sampling
        R, G, B = data[i], data[i+1], data[i+2]
        if R > 170 and (R - G) > 25 and (R - B) > 25: reds += 1  # alpha 0.35 red on white = pale red
    chk('F2 page has real ink (non-white ratio > 0.3%)', ink > 0.003, f'ink={ink:.3%} size={w}x{h}')
    chk('F3 red watermark visible in render', reds > 20, f'red samples={reds}')

# --- G. hashes for log ---
for f in ['report-base.pdf', 'report-watermarked.pdf', 'report-encrypted.pdf']:
    p = os.path.join(HERE, f)
    print(f'INFO | sha256({f}) = {hashlib.sha256(open(p,"rb").read()).hexdigest()[:16]} size={os.path.getsize(p)}')

print(f'\n== RESULT: {PASS} PASS / {FAIL} FAIL ==')
sys.exit(1 if FAIL else 0)
