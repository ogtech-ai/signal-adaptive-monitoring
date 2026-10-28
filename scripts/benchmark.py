"""CPU-only measurement; synthetic coverage is not real fault recall."""
import json,platform,time
from pathlib import Path
import numpy as np, sklearn
from app.core import Monitor,synthetic
out={'cpu':platform.processor() or platform.machine(),'platform':platform.platform(),'python':platform.python_version(),'sklearn':sklearn.__version__,'scope':'single-device minute samples; not G520; point coverage of synthetic injections, not fault diagnosis','sources':[]}
for source,rows in [('synthetic',synthetic()),('uci235',json.loads(Path('data/uci_slice.json').read_text())['rows'])]:
    x=np.asarray(rows,dtype=float);x[400,0]+=2;x[600:690,0]+=np.linspace(0,1.5,90);x[900:910,0]=np.nan
    labels={'spike':[400],'drift':list(range(600,690)),'missing':list(range(900,910))}
    t=time.perf_counter();m=Monitor(x);m.frozen=False;s=[m.score(r,True) for r in x[180:]];elapsed=time.perf_counter()-t
    d={'source':source,'rows':len(rows),'reference':[0,180],'seconds':round(elapsed,3),'background_alert_points_no_fault_truth':sum((v['fixed']>4 or v['ml_alert'] or v['missing']) for i,v in enumerate(s,180) if not any(i in ids for ids in labels.values())),'synthetic_point_coverage':{},'coverage_definition':'MAD threshold 4 or ML threshold; missing data quality alerts count as detected for each column; no causal attribution to injection' }
    for name,ids in labels.items():d['synthetic_point_coverage'][name]={key:sum((s[i-180][key]>4 if key in ('fixed','adaptive') else s[i-180][key]) or s[i-180]['missing'] for i in ids)/len(ids) for key in ['fixed','adaptive','ml_alert']}
    out['sources'].append(d)
Path('docs/benchmark.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
