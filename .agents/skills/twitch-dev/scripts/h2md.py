# Convert a folder of dev.twitch.tv HTML pages to compact markdown (used by refresh-docs.sh).
# Usage: python3 h2md.py <html_dir> <md_dir>
import warnings
from bs4 import XMLParsedAsHTMLWarning
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
import sys, os, re
from bs4 import BeautifulSoup, NavigableString
def conv(el):
    out=[]
    for c in el.children:
        if isinstance(c, NavigableString):
            out.append(re.sub(r'\s+',' ',str(c))); continue
        n=c.name
        if n in ('script','style','nav','footer','header','svg','button'): continue
        if n and re.fullmatch(r'h[1-6]',n):
            lvl=int(n[1]); i=c.get('id')
            # Malformed pages leave headings unclosed, so the parser nests the rest of the
            # section inside the heading: title = inline content before the first block child.
            blocks=('table','p','div','section','ul','ol','pre','h1','h2','h3','h4','h5','h6','blockquote')
            kids=list(c.children); k=next((j for j,x in enumerate(kids) if getattr(x,'name',None) in blocks),len(kids))
            title=' '.join(x.get_text(' ',strip=True) if hasattr(x,'get_text') else str(x).strip() for x in kids[:k]).strip()
            out.append('\n\n'+'#'*lvl+' '+re.sub(r'\s+',' ',title)+(f'  {{#{i}}}' if i else '')+'\n\n')
            if k<len(kids):
                wrap=BeautifulSoup('','html.parser').new_tag('div')
                for x in kids[k:]: wrap.append(x.extract() if hasattr(x,'extract') else x)
                out.append(conv(wrap))
        elif n=='pre':
            out.append('\n\n```\n'+c.get_text()+'\n```\n\n')
        elif n=='code':
            out.append('`'+c.get_text()+'`')
        elif n=='table':
            rows=[]
            for tr in c.find_all('tr'):
                cells=[conv(td).strip().replace('\n',' ').replace('|','\\|') for td in tr.find_all(['td','th'])]
                rows.append('| '+' | '.join(cells)+' |')
            if rows:
                ncol=rows[0].count(' | ')+1
                rows.insert(1,'|'+'---|'*ncol)
            out.append('\n\n'+'\n'.join(rows)+'\n\n')
        elif n in ('p','div','section','article','main','blockquote'):
            out.append('\n\n'+conv(c)+'\n\n')
        elif n in ('ul','ol'):
            out.append('\n'+''.join('\n- '+conv(li).strip() for li in c.find_all('li',recursive=False))+'\n')
        elif n=='br': out.append('\n')
        elif n=='a':
            t=conv(c).strip(); h=c.get('href','')
            out.append(f'[{t}]({h})' if h and t and not h.startswith('#') else t)
        elif n in ('strong','b'): out.append('**'+conv(c).strip()+'**')
        else: out.append(conv(c))
    return ''.join(out)
src,dst=sys.argv[1],sys.argv[2]
os.makedirs(dst,exist_ok=True)
for f in sorted(os.listdir(src)):
    s=BeautifulSoup(open(os.path.join(src,f),encoding='utf-8'),'html.parser')
    main=s.find('main') or s.find('article') or s.body
    for sel in main.select('nav, .sidebar, .toc, #toc'): sel.decompose()
    md=re.sub(r'\n{3,}','\n\n',conv(main)).strip()
    open(os.path.join(dst,f[:-5]+'.md'),'w').write(f"<!-- source: https://dev.twitch.tv/docs/{f[:-5].replace('_','/')}/ -->\n\n"+md+'\n')
