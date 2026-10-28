"""Download official archive, cache it, export chronological 1440-row slice."""
from pathlib import Path
import urllib.request, zipfile, io, csv, json, hashlib, ssl, certifi
ROOT=Path(__file__).resolve().parents[1]; cache=ROOT/'data/cache';cache.mkdir(parents=True,exist_ok=True)
p=cache/'uci235.zip'
if not p.exists(): p.write_bytes(urllib.request.urlopen('https://archive.ics.uci.edu/static/public/235/individual+household+electric+power+consumption.zip', timeout=60, context=ssl.create_default_context(cafile=certifi.where())).read())
digest=hashlib.sha256(p.read_bytes()).hexdigest()
if digest!='9f84b46ade8a2d8e1286ec4b2b6c2987a45a755c59f263be3b3b3d10dfbda3ff': raise ValueError('Official archive checksum changed; inspect upstream before using new data')
z=zipfile.ZipFile(p)
with z.open('household_power_consumption.txt') as f:
    reader=csv.DictReader(io.TextIOWrapper(f),delimiter=';'); rows=[];times=[]
    for r in reader:
        rows.append([None if r[k] in ('?','') else float(r[k]) for k in ['Global_active_power','Voltage','Global_intensity']]);times.append(r['Date']+' '+r['Time'])
        if len(rows)==1440:break
out=dict(rows=rows,timestamps=times,source='UCI 235 / CC BY 4.0 / 1 分鐘 / 截取前 1440 筆與三通道',device='UCI-household-01',channels=['功率 kW','電壓 V','電流 A'],archive_sha256=hashlib.sha256(p.read_bytes()).hexdigest())
(ROOT/'data/uci_slice.json').write_text(json.dumps(out,ensure_ascii=False));print('Saved',len(rows),'rows; SHA256',out['archive_sha256'])
