#!/usr/bin/env python3
"""Builds data/matches.json with NO titles, results, durations or game counts.
Raw titles are only used here (server side) for matching and are discarded."""
import json, re, os, sys, urllib.request, html
sys.path.insert(0, os.path.dirname(__file__))
from ytlist import lst, get
from datetime import datetime, timedelta, timezone
CACHE=os.path.join(os.path.dirname(__file__),'..','data','pubcache.json')
try: PUB=json.load(open(CACHE))
except Exception: PUB={}
def pub(v):
    for _ in range(3):
        if PUB.get(v): break
        m=re.search(r'"(?:uploadDate|publishDate|startTimestamp)":"([^"]+)"',get('https://www.youtube.com/watch?v='+v))
        PUB[v]=m.group(1) if m else None
    return PUB[v]
def dt(s): return datetime.fromisoformat(s.replace('Z','+00:00')) if s else None

KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z'  # public lolesports.com web key
API = 'https://esports-api.lolesports.com/persisted/gw/'
WORLDS = '98767975604431411'
YEAR = os.environ.get('WORLDS_YEAR', '2026')
ALIAS = {'TLAW': ['TL', 'LIQUID'], 'MKOI': ['KOI', 'MKOI'], 'GEN': ['GEN', 'GENG', 'GEN.G'], 'LYON': ['LYON', 'LYN'], 'HLE': ['HLE', 'HANWHA'], 'KC': ['KC', 'KCORP', 'KARMINE']}

def api(path):
    r = urllib.request.Request(API + path, headers={'x-api-key': KEY})
    return json.load(urllib.request.urlopen(r, timeout=30))['data']

def tokens(t):
    return set(re.findall(r'[A-Z0-9.]+', html.unescape(t).upper()))

def names(code):
    return set([code] + ALIAS.get(code, []))

GQL='https://gql.twitch.tv/gql'
TWCID=os.environ.get('TWITCH_GQL_CLIENT_ID','kimne78kx3ncx6brgo4mv6wki5h1ko')  # public twitch.tv web client id, no secret
def twitch_vods(login='caedrel'):
    out=[]; cur=None
    for _ in range(5):
        a=f',after:"{cur}"' if cur else ''
        q='{user(login:"%s"){videos(first:100,type:ARCHIVE,sort:TIME%s){edges{cursor node{id createdAt lengthSeconds}}pageInfo{hasNextPage}}}}'%(login,a)
        r=urllib.request.Request(GQL,data=json.dumps({'query':q}).encode(),headers={'Client-Id':TWCID,'Content-Type':'application/json'})
        v=json.load(urllib.request.urlopen(r,timeout=30))['data']['user']['videos']
        for e in v['edges']: out.append((e['node']['id'],dt(e['node']['createdAt']),e['node']['lengthSeconds'])); cur=e['cursor']
        if not v['pageInfo']['hasNextPage']: break
    return out
GSTART=os.path.join(os.path.dirname(__file__),'..','data','gamestart.json')
try: GS=json.load(open(GSTART))
except Exception: GS={}
def game1_start(games):
    g=[x for x in games if x['number']==1]
    if not g: return None
    gid=g[0]['id']
    if gid not in GS:
        try: GS[gid]=json.load(urllib.request.urlopen('https://feed.lolesports.com/livestats/v1/window/'+gid,timeout=30))['frames'][0]['rfc460Timestamp']
        except Exception: return None
    return dt(GS[gid])
LEAD=timedelta(minutes=int(os.environ.get('LEAD_MIN','10')))  # start this long before game 1 (draft + broadcast delay)

def main():
    events = api(f'getSchedule?hl=en-US&leagueId={WORLDS}')['schedule']['events']
    events = [e for e in events if e.get('match') and e['startTime'][:4] == YEAR]
    caed = []
    for u in ('https://www.youtube.com/@Caedrel/videos', 'https://www.youtube.com/@Caedrel/streams'):
        try: caed += lst(u)
        except Exception as ex: print('warn', u, ex)
    try: TV=twitch_vods()
    except Exception as ex: TV=[]; print('warn twitch',ex)
    caed = [(v, tokens(t)) for v, t in caed if 'WORLDS' in t.upper() and YEAR in t]
    out = []
    for e in events:
        m = e['match']; teams = [t['code'] for t in m['teams']]
        item = {'id': m['id'], 'start': e['startTime'], 'stage': e.get('blockName') or '',
                'bestOf': m.get('strategy', {}).get('count', 1), 'teams': teams, 'caedrel': [], 'official': [], 'twitch': []}
        if 'TBD' not in teams:
            st = dt(e['startTime']); c = []
            for v, tk in caed:
                if not all(names(x) & tk for x in teams): continue
                p = dt(pub(v))
                if p and st - timedelta(hours=12) <= p <= st + timedelta(days=3): c.append((p, v))
            item['caedrel'] = [v for p, v in sorted(c)]
            if e['state'] == 'completed':
                try:
                    g = api(f'getEventDetails?hl=en-US&id={m["id"]}')['event']['match']['games']
                    g1 = game1_start(g); tgt = (g1 - LEAD) if g1 else st
                    for vid, c0, ln in TV:
                        if c0 <= tgt + timedelta(minutes=5) and tgt < c0 + timedelta(seconds=ln):
                            item['twitch'] = [{'v': vid, 't': max(0, int((tgt - c0).total_seconds()))}]; break
                    ids = []
                    for game in sorted(g, key=lambda x: x['number']):
                        for v in game.get('vods', []):
                            if v['provider'] == 'youtube' and v.get('locale', '').startswith('en') and v['parameter'] not in ids:
                                ids.append(v['parameter'])
                    item['official'] = ids  # per-game or per-day ids; count never shown in UI
                except Exception as ex: print('warn details', m['id'], ex)
        out.append(item)
    json.dump(GS, open(GSTART,'w'))
    json.dump({k:v for k,v in PUB.items() if v}, open(CACHE,'w'))
    json.dump({'matches': out}, open(os.path.join(os.path.dirname(__file__), '..', 'data', 'matches.json'), 'w'), indent=1)
    print(len(out), 'matches;', sum(1 for i in out if i['caedrel']), 'with caedrel;', sum(1 for i in out if i['twitch']), 'with twitch')
main()
