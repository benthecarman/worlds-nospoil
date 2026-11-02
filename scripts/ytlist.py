import re,sys,urllib.request
def get(u):
    r=urllib.request.Request(u,headers={'Accept-Language':'en','User-Agent':'Mozilla/5.0'})
    return urllib.request.urlopen(r,timeout=30).read().decode()
def lst(u):
    s=get(u);seen=set();out=[]
    for m in re.finditer(r'"videoId":"([\w-]{11})"',s):
        v=m.group(1)
        if v in seen: continue
        seen.add(v);i=m.start()
        t=re.search(r'"(?:text|content)":"([^"]{6,160})"',s[i:i+3000])
        out.append((v,t.group(1) if t else ''))
    return out
if __name__=='__main__':
    for v,t in lst(sys.argv[1]): print(v,t)
