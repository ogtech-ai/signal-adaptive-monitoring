"""Causal robust monitoring; no labels are accepted by the model."""
import copy
import numpy as np
from sklearn.ensemble import IsolationForest

CHANNELS = ['power_kw', 'voltage_v', 'current_a']

def synthetic(n=1440):
    rng = np.random.default_rng(520)
    t = np.arange(n)
    p = 2 + .15*np.sin(t/35) + rng.normal(0,.045,n)
    return np.column_stack([p, 230+rng.normal(0,.5,n), p*4.35+rng.normal(0,.08,n)]).tolist()

def validate(rows):
    x = np.asarray(rows,dtype=float)
    if x.ndim != 2 or x.shape[1] != 3 or len(x)<80 or len(x)>20000:
        raise ValueError('需要 80–20000 列、三通道資料')
    if np.isinf(x).any(): raise ValueError('不能含無限值')
    return x

class Monitor:
    def __init__(self, rows, start=0, end=180):
        x = validate(rows)
        if not 0 <= start < end <= len(x) or end-start<40: raise ValueError('參考區間至少 40 筆')
        ref=x[start:end]
        if np.isnan(ref).any(): raise ValueError('參考區間不可缺值')
        self.base=np.median(ref,axis=0)
        self.scale=np.maximum(1.4826*np.median(abs(ref-self.base),axis=0),[.03,.2,.1])
        self.center=self.base.copy(); self.frozen=True; self.version=0; self.history=[]
        # Time split: fit first 70%; calibrate on later 30%, never shuffle.
        cut=int(len(ref)*.7)
        self.ml=IsolationForest(n_estimators=64,max_samples=min(128,cut),random_state=520,n_jobs=1).fit((ref[:cut]-self.base)/self.scale)
        self.ml_threshold=float(np.quantile(-self.ml.score_samples((ref[cut:]-self.base)/self.scale),.98))
        self.end=end
    def rollback(self):
        self.center=self.history.pop() if self.history else self.base.copy()
        self.version+=1; self.frozen=True
    def score(self, row, approved=False):
        x=np.asarray(row,dtype=float); missing=bool(np.isnan(x).any())
        # Causal missing handling: reference median, no future interpolation; do not update.
        x=np.where(np.isnan(x),self.base,x)
        fixed=float(np.max(abs(x-self.base)/self.scale))
        adaptive=float(np.max(abs(x-self.center)/self.scale))
        ml=float(-self.ml.score_samples([(x-self.base)/self.scale])[0])
        out=dict(fixed=fixed,adaptive=adaptive,ml=ml,ml_alert=ml>self.ml_threshold,missing=missing,shift=float(np.max(abs(self.center-self.base)/self.scale)),version=self.version)
        # Score precedes update. Explicit approval and immutable baseline gate updates.
        if approved and not self.frozen and not missing and fixed<3 and adaptive<3:
            self.history.append(self.center.copy()); self.history=self.history[-500:]
            self.center += .025*(x-self.center); self.version+=1
        out['updated']=self.version!=out['version']
        return out
