"""Rebuild Folio's curated research shelf from verified publisher objects.
Usage: python tools/research/build.py --input publisher-files --out dist/research
See RESEARCH-SOURCES.md. No code from the source publications executes.
"""
import argparse, hashlib, json, re, subprocess, xml.etree.ElementTree as ET
from pathlib import Path
P=argparse.ArgumentParser()
P.add_argument('--input',required=True,type=Path)
P.add_argument('--out',required=True,type=Path)
args=P.parse_args()
config=json.loads(Path(__file__).with_name('sources.json').read_text())
CC='https://creativecommons.org/licenses/by/4.0/'
X='{http://www.w3.org/1999/xlink}href'
items=[
 ('28123','blackbird-migration','Экология','Зачем одни чёрные дрозды улетают на зиму, а другие остаются? Сравнение двух стратегий по данным семи лет наблюдений.'),
 ('00861','umap','Анализ данных','Короткая публикация о UMAP: как представить многомерные данные на плоскости и сохранить их структуру.'),
 ('74816','group-drumming','Музыка и ритм','Участники держат ритм поодиночке и в ансамбле. Что меняется, когда каждый слышит игру остальных?'),
 ('73097','visual-navigation','Восприятие','Куда смотрит человек, когда планирует маршрут? Эксперимент с движениями глаз в виртуальной среде.'),
 ('75515','music-and-the-brain','Нейронаука','Как темп, знакомая мелодия и отчётливый ритм связаны с реакцией мозга на музыку? Исследование с ЭЭГ.'),
]
def norm(s): return ' '.join(s.replace('\u00ad','').split())
def inner(el): return norm(''.join(el.itertext())) if el is not None else ''
def paragraph(s): return {'text':norm(s),'translation':None}
def chapter(title,ss): return {'title':norm(title),'paragraphs':[paragraph(s) for s in ss if norm(s)]}
def dump(ob):return (json.dumps(ob,ensure_ascii=False,separators=(',',':'))+'\n').encode()
def need(val,msg):
 if not val: raise ValueError(msg)
def math(n):
 tag=n.tag.split('}')[-1]; kids=[math(c) for c in n]
 txt=(n.text or '')+''.join(kids)
 if tag in ('mn','mi','mo','mtext','mrow','math','mstyle'):return txt
 if tag=='mspace':return ' '
 if tag=='msqrt':return '√('+txt+')'
 if tag=='mfrac':return '('+kids[0]+')/('+kids[1]+')'
 if tag=='msup':return kids[0]+'^('+kids[1]+')'
 if tag in ('msub','munder'):return kids[0]+'_('+kids[1]+')'
 if tag=='munderover':return kids[0]+'_('+kids[1]+')^('+kids[2]+')'
 if tag=='mover':return 'over('+kids[0]+', '+kids[1]+')'
 if tag=='mtable':return '['+'; '.join(kids)+']'
 if tag=='mtr':return ', '.join(kids)
 if tag=='mtd':return txt
 raise ValueError('Unreviewed MathML: '+tag)
def plain(n):
 tag=n.tag
 if tag.startswith('{http://www.w3.org/1998/Math/MathML}'):return math(n)
 if tag in ('fig','fig-group','table-wrap','media','supplementary-material','graphic','inline-graphic'):return ''
 if tag=='label' and n.text and n.text.isnumeric():return '('+n.text+') '
 t=(n.text or '')+''.join(plain(c)+(c.tail or '') for c in n)
 if tag=='sup':return '^('+t+')'
 if tag=='sub':return '_('+t+')'
 return t
def secs(n,level=0):
 out=[]
 for c in n:
  if c.tag=='p':out.append(norm(plain(c)))
  elif c.tag=='sec':out.extend(secs(c,level+1))
  elif c.tag=='title':
   if level:out.append(norm(plain(c)))
  elif c.tag not in ('fig','fig-group','table-wrap','media','supplementary-material'):raise ValueError('Unreviewed section member: '+c.tag)
 return out
def parse_elife(path,num):
 x=ET.parse(path).getroot();meta=x.find('front/article-meta');body=x.find('body')
 need(body is not None and x.attrib.get('article-type')=='research-article','Missing original research body')
 need(not body.findall('.//permissions'),'Review rights exception')
 p=meta.find('permissions'); lic=p.find('license')
 need(lic.get(X,'').replace('http:','https:')==CC,'Not explicit CC BY 4.0')
 copyright=inner(p.find('copyright-statement'));need(copyright,'No copyright statement')
 names=[]
 for c in meta.findall('contrib-group/contrib[@contrib-type="author"]'):
  n=c.find('name');need(n is not None,'Unreviewed group author');names.append(norm((n.findtext('given-names') or '')+' '+n.findtext('surname')))
 date=next(d for d in meta.findall('pub-date') if d.get('date-type') in ('pub','publication'))
 doi=meta.findtext('article-id[@pub-id-type="doi"]');need(doi=='10.7554/eLife.'+num,'DOI mismatch')
 ed=dict(title=inner(meta.find('title-group/article-title')),author=', '.join(names),year=int(date.findtext('year')),doi=doi,
  journal='eLife',sourceUrl='https://elifesciences.org/articles/'+num,copyright=copyright)
 chapters=[]
 for a in meta.findall('abstract'):
  paras=[norm(plain(n)) for n in a.findall('p')];need(paras,'Empty abstract');chapters.append(chapter(a.findtext('title') or 'Abstract',paras))
 for s in body:
  need(s.tag=='sec','Unexpected body member');chapters.append(chapter(inner(s.find('title')),secs(s)))
 return ed,chapters
def parse_joss(path):
 # Exact PDF verified by git object ID before applying these layout anchors.
 def pdf(*opts):
  return subprocess.check_output(['pdftotext',*opts,str(path),'-']).decode()
 whole=pdf('-layout');need(all(s in whole for s in ['Authors of papers retain copyright','Creative' if 'Creative' in whole else 'Cre-','Attribution 4.0','ternational License (CC-BY).','10.21105/joss.00861']),'Missing JOSS rights or DOI')
 text=pdf('-f','1','-l','1','-x','168','-y','0','-W','449','-H','650','-layout').split('Summary\n')[1]
 text=norm(re.sub(r'([a-z])-\n([a-z])',r'\1\2',text)).replace('UMAP supports a number','\nUMAP supports a number').replace('For details of the','\nFor details of the')
 paras=text.splitlines();need(len(paras)==3 and paras[-1].endswith('2018).'),'PDF shape changed')
 ed=dict(title='UMAP: Uniform Manifold Approximation and Projection',author='Leland McInnes, John Healy, Nathaniel Saul, Lukas Großberger',year=2018,doi='10.21105/joss.00861',journal='Journal of Open Source Software',sourceUrl='https://joss.theoj.org/papers/10.21105/joss.00861',copyright='© 2018, Leland McInnes, John Healy, Nathaniel Saul, and Lukas Großberger')
 return ed,[chapter('Summary',paras)]
(args.out/'papers').mkdir(parents=True,exist_ok=True)
entries=[]
for num,slug,topic,desc in items:
 src=config[num];path=args.input/src['file'];raw=path.read_bytes()
 need(len(raw)<1_000_000 and hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==src['blob'],'Source object hash mismatch: '+num)
 ed,chapters=(parse_joss(path) if num=='00861' else parse_elife(path,num))
 need(chapters and all(c['title'] and c['paragraphs'] for c in chapters),'Empty paper')
 words=sum(len(p['text'].split()) for c in chapters for p in c['paragraphs'])
 provenance='https://github.com/'+src['repo']+'/blob/'+src['ref']+'/'+src['path']
 note='Folio reading edition: original English article prose, reformatted as plain text. Figures, tables, bibliography and supplementary files are available in the publication, not reproduced here. Mathematical notation is linearized. Any on-device translations are unofficial.'
 chapters.append(chapter('Source and license',[ed['title'],ed['author'],f"{ed['journal']} ({ed['year']}). DOI: {ed['doi']}.",ed['sourceUrl'],ed['copyright']+'. Creative Commons Attribution 4.0 International: '+CC,note]))
 id='research-'+slug;entry=dict(id=id,title=ed['title'],author=ed['author'],topic=topic,year=ed['year'],journal=ed['journal'],description=desc,language='en',doi=ed['doi'],sourceUrl=ed['sourceUrl'],license='CC BY 4.0',licenseUrl=CC,words=words,copyright=ed['copyright'])
 book=dict(id=id,title=ed['title'],author=ed['author'],kind='research',language='en',format='TXT',alignment='none',chapters=chapters)
 data=dump(book);(args.out/'papers'/(id+'.json')).write_bytes(data)
 entry.update(sha256=hashlib.sha256(data).hexdigest(),byteLen=len(data),asset='research/papers/'+id+'.json')
 entries.append(entry)
 print(id,words,len(chapters),len(data),provenance)
(args.out/'manifest.json').write_bytes(dump({'version':1,'papers':entries}))
